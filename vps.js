window.VPS = {
    bridgeUrl: 'http://127.0.0.1:8765',
    wsBaseUrl: 'ws://127.0.0.1:8765',
    servers: {},
    cwds: {},
    activeServer: "LOCAL",
    logs: {},
    cmdHistory: [],
    snippets: [],
    activeExecWs: null,
    ready: null,

    getDefaultSnippets: function() {
        const isRu = window.I18N && window.I18N.lang === 'ru';
        return [
            { id: 'def_1', title: isRu ? 'Статус и ветки Git' : 'Git status & branches', category: 'Git', lang: 'shell', cmd: 'git status -sb && git branch -a' },
            { id: 'def_2', title: isRu ? 'Коммит и пуш' : 'Commit & push', category: 'Git', lang: 'shell', cmd: 'git add -A && git commit -m "{{message=update}}" && git push' },
            { id: 'def_3', title: isRu ? 'Контейнеры Docker' : 'Docker containers', category: 'Docker', lang: 'shell', cmd: 'docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"' },
            { id: 'def_4', title: isRu ? 'Логи контейнера' : 'Container logs', category: 'Docker', lang: 'shell', cmd: 'docker logs --tail {{lines=100}} {{container}}' },
            { id: 'def_5', title: isRu ? 'Открытые порты (Windows)' : 'Listening ports (Windows)', category: 'System', lang: 'powershell', cmd: 'Get-NetTCPConnection -State Listen | Select-Object LocalAddress,LocalPort,OwningProcess | Sort-Object LocalPort' },
            { id: 'def_6', title: isRu ? 'Нагрузка и диск (Linux)' : 'Load & disk (Linux)', category: 'VPS', lang: 'bash', cmd: 'uptime && free -h && df -h /' }
        ];
    },

    init: function() {
        this.ready = new Promise((resolve) => {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.get(
                    ['cockpit_vps_list', 'cockpit_cwds', 'cockpit_active_server', 'cockpit_cmd_history', 'cockpit_snippets'],
                    (res) => {
                        if (res.cockpit_vps_list) {
                            this.servers = res.cockpit_vps_list;
                        } else {
                            try {
                                const legacy = localStorage.getItem('cockpit_vps_list');
                                if (legacy) {
                                    this.servers = JSON.parse(legacy);
                                    chrome.storage.local.set({ cockpit_vps_list: this.servers });
                                    localStorage.removeItem('cockpit_vps_list');
                                }
                            } catch(e) {}
                        }
                        if (res.cockpit_cwds) this.cwds = res.cockpit_cwds;
                        if (res.cockpit_active_server) this.activeServer = res.cockpit_active_server;
                        if (Array.isArray(res.cockpit_cmd_history)) this.cmdHistory = res.cockpit_cmd_history;
                        if (Array.isArray(res.cockpit_snippets)) {
                            this.snippets = res.cockpit_snippets;
                        } else {
                            this.snippets = this.getDefaultSnippets();
                            chrome.storage.local.set({ cockpit_snippets: this.snippets });
                        }

                        if (window.UI) {
                            window.UI.renderVpsTabs();
                            if (window.UI.syncCwdUi) window.UI.syncCwdUi();
                            if (window.UI.renderSnippets) window.UI.renderSnippets();
                        }
                        resolve();
                    }
                );
            } else {
                this.snippets = this.getDefaultSnippets();
                resolve();
            }
        });
    },

    saveLocalServers: function() {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ cockpit_vps_list: this.servers });
        }
    },

    saveSnippets: function() {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ cockpit_snippets: this.snippets });
        }
    },

    addCmdHistory: function(cmd) {
        const clean = (cmd || '').trim();
        if (!clean) return;
        if (this.cmdHistory[this.cmdHistory.length - 1] !== clean) {
            this.cmdHistory.push(clean);
            if (this.cmdHistory.length > 100) this.cmdHistory = this.cmdHistory.slice(-100);
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.set({ cockpit_cmd_history: this.cmdHistory });
            }
        }
    },

    checkDangerousCommand: function(cmd) {
        if (!cmd) return null;
        const isRu = window.I18N && window.I18N.lang === 'ru';
        const patterns = [
            { re: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|--recursive\s+--force|--no-preserve-root)/i, label: isRu ? 'Рекурсивное удаление (rm -rf)' : 'Recursive delete (rm -rf)' },
            { re: /\bRemove-Item\b.*(-Recurse|-Force)/i, label: isRu ? 'Рекурсивное удаление PowerShell' : 'PowerShell recursive delete (Remove-Item -Recurse)' },
            { re: /\b(rmdir|rd)\s+\/s/i, label: isRu ? 'Удаление каталога с подпапками (rd /s)' : 'Directory tree delete (rd /s)' },
            { re: /\bdel\s+.*\/[sqf]/i, label: isRu ? 'Массовое удаление файлов (del /s /q)' : 'Bulk file delete (del /s /q)' },
            { re: /\b(format\s+[a-z]:|Format-Volume|diskpart|mkfs(\.[a-z0-9]+)?|fdisk|dd\s+if=.*of=\/dev\/)\b/i, label: isRu ? 'Форматирование / запись на диск' : 'Disk format / raw disk write' },
            { re: /\b(DROP\s+(DATABASE|TABLE|SCHEMA)|TRUNCATE\s+TABLE)\b/i, label: isRu ? 'Удаление БД или таблицы (DROP/TRUNCATE)' : 'Database/Table drop (DROP/TRUNCATE)' },
            { re: /\bgit\s+(reset\s+--hard|clean\s+-[a-zA-Z]*f|push\s+.*--force)\b/i, label: isRu ? 'Необратимая операция Git (reset --hard / force push)' : 'Destructive Git operation (reset --hard / force push)' },
            { re: /(?:^|[\s;|&])(shutdown|reboot|Stop-Computer|Restart-Computer)(?=[\s;|&]|$)/im, label: isRu ? 'Выключение / перезагрузка системы' : 'System shutdown / reboot' },
            { re: /:\(\)\s*\{\s*:\|\:&\s*\};\s*:/, label: 'Fork bomb' }
        ];
        const hits = patterns.filter(p => p.re.test(cmd)).map(p => p.label);
        return hits.length ? hits : null;
    },

    confirmIfDangerous: function(cmd, targetLabel = '') {
        const hits = this.checkDangerousCommand(cmd);
        if (!hits) return true;
        const preview = cmd.length > 220 ? cmd.slice(0, 220) + '...' : cmd;
        return confirm(window.t('danger_title', { srv: targetLabel || this.activeServer, hits: hits.join('\n• '), preview }));
    },

    setActiveServer: function(name) {
        this.activeServer = name || "LOCAL";
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ cockpit_active_server: this.activeServer });
        }
    },

    getActiveCwd: function() {
        return this.cwds[this.activeServer] || '';
    },

    setActiveCwd: function(path) {
        this.cwds[this.activeServer] = (path || '').trim();
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ cockpit_cwds: this.cwds });
        }
    },

    getServerConfig: function(serverName) {
        return this.servers[serverName] ||
               Object.entries(this.servers).find(([k]) => k.toLowerCase() === (serverName || '').toLowerCase())?.[1];
    },

    deleteServer: function(name) {
        delete this.servers[name];
        delete this.logs[name];
        delete this.cwds[name];
        this.setActiveServer("LOCAL");
        this.saveLocalServers();
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ cockpit_cwds: this.cwds });
        }
    },

    testConnection: async function(config) {
        try {
            const res = await fetch(`${this.bridgeUrl}/exec`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Cockpit-Client': 'aistudio-cockpit' },
                body: JSON.stringify({ server: 'test', command: 'echo OK', lang: 'shell', config: config })
            });
            const data = await res.json();
            return { success: data.status === 'ok', msg: data.status === 'ok' ? window.t('vps_ok') : (data.error || 'Error') };
        } catch(e) {
            return { success: false, msg: window.t('vps_no_bridge') };
        }
    },

    executeCommand: async function(serverName, command, lang = 'shell') {
        const srv = this.getServerConfig(serverName);
        const cwd = this.cwds[serverName] || '';
        const res = await fetch(`${this.bridgeUrl}/exec`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cockpit-Client': 'aistudio-cockpit' },
            body: JSON.stringify({ server: serverName, command: command, lang: lang, cwd: cwd, config: srv })
        });
        return await res.json();
    },

    runAgentTools: async function(tools) {
        const serverName = this.activeServer || 'LOCAL';
        const srv = this.getServerConfig(serverName);
        const cwd = this.getActiveCwd();
        const res = await fetch(`${this.bridgeUrl}/agent/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cockpit-Client': 'aistudio-cockpit' },
            body: JSON.stringify({ server: serverName, cwd: cwd, config: srv, tools: tools })
        });
        return await res.json();
    },

    stopActiveExec: function() {
        if (this.activeExecWs && this.activeExecWs.readyState === WebSocket.OPEN) {
            try { this.activeExecWs.send(JSON.stringify({ type: 'stop' })); } catch(e) {}
        }
    },

    executeCommandStream: function(serverName, command, lang = 'shell', onChunk = null) {
        return new Promise((resolve, reject) => {
            this.stopActiveExec();
            const srv = this.getServerConfig(serverName);
            const cwd = this.cwds[serverName] || '';
            const ws = new WebSocket(`${this.wsBaseUrl}/ws/exec`);
            this.activeExecWs = ws;
            if (window.UI && window.UI.setExecRunning) window.UI.setExecRunning(true);

            let fullOut = '';
            let fullErr = '';
            let settled = false;

            const finish = (res) => {
                if (settled) return;
                settled = true;
                if (this.activeExecWs === ws) this.activeExecWs = null;
                if (window.UI && window.UI.setExecRunning) window.UI.setExecRunning(false);
                resolve(res);
            };

            ws.onopen = () => {
                ws.send(JSON.stringify({ server: serverName, command: command, lang: lang, cwd: cwd, config: srv }));
            };

            ws.onmessage = (e) => {
                try {
                    const msg = JSON.parse(e.data);
                    if (msg.type === 'out' && msg.data) {
                        fullOut += msg.data;
                        if (onChunk) onChunk(msg.data, 'out');
                    } else if (msg.type === 'err' && msg.data) {
                        fullErr += msg.data;
                        if (onChunk) onChunk(msg.data, 'err');
                    } else if (msg.type === 'done') {
                        const combined = [fullOut.trim(), fullErr.trim()].filter(Boolean).join('\n') ||
                            (msg.stopped ? window.t('agent_stopped') : (msg.status === 'ok' ? 'OK' : 'Error'));
                        finish({ output: combined, stderr: fullErr.trim(), status: msg.status || 'ok', stopped: !!msg.stopped });
                        try { ws.close(); } catch(err) {}
                    }
                } catch(err) {}
            };

            ws.onerror = async () => {
                if (settled) return;
                if (this.activeExecWs === ws) this.activeExecWs = null;
                if (window.UI && window.UI.setExecRunning) window.UI.setExecRunning(false);
                try {
                    const fallback = await this.executeCommand(serverName, command, lang);
                    if (onChunk && fallback.output) onChunk(fallback.output, 'out');
                    finish(fallback);
                } catch(e) {
                    settled = true;
                    reject(new Error(window.t('vps_no_bridge')));
                }
            };

            ws.onclose = () => {
                if (!settled) {
                    const combined = [fullOut.trim(), fullErr.trim()].filter(Boolean).join('\n') || 'Connection closed.';
                    finish({ output: combined, status: 'fail', stopped: false });
                }
            };
        });
    },

    gitAction: async function(action) {
        const serverName = this.activeServer || 'LOCAL';
        const srv = this.getServerConfig(serverName);
        const cwd = this.getActiveCwd();
        const res = await fetch(`${this.bridgeUrl}/git/action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cockpit-Client': 'aistudio-cockpit' },
            body: JSON.stringify({ server: serverName, cwd: cwd, action: action, config: srv })
        });
        return await res.json();
    },

    bundleProject: async function() {
        const serverName = this.activeServer || 'LOCAL';
        const srv = this.getServerConfig(serverName);
        const cwd = this.getActiveCwd();
        const res = await fetch(`${this.bridgeUrl}/project/bundle`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Cockpit-Client': 'aistudio-cockpit' },
            body: JSON.stringify({ server: serverName, cwd: cwd, config: srv })
        });
        return await res.json();
    },

    pickLocalDir: async function() {
        const res = await fetch(`${this.bridgeUrl}/project/pick-dir`, { method: 'POST' });
        return await res.json();
    }
};
window.VPS.init();

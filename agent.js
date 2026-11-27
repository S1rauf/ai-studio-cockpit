window.Agent = {
    running: false,
    aborted: false,

    officeToolsSet: new Set([
        'XLSX_INFO', 'XLSX_READ', 'XLSX_WRITE', 'DOCX_CREATE', 'DOCX_READ', 'DOCX_REPLACE'
    ]),

    runOfficeModule: async function(officeTools, termOut) {
        const srv = window.VPS.activeServer || 'LOCAL';
        const cwd = window.VPS.getActiveCwd() || '';
        const realTools = window.PiiVault ? window.PiiVault.unmaskDeep(officeTools) : officeTools;
        const payloadJson = JSON.stringify({ cwd, tools: realTools });
        const b64 = btoa(unescape(encodeURIComponent(payloadJson)));
        const cmd = `set "H=%COCKPIT_HOME%" & if "%H%"=="" set "H=C:\\ai_studio_cockpit_ext" & "%H%\\modules\\office_agent.exe" -payload "${b64}"`;
        const res = await window.VPS.executeCommandStream(srv, cmd, 'shell', (chunk) => {
            if (termOut) { termOut.value += chunk; termOut.scrollTop = termOut.scrollHeight; }
        });
        let out = res.output || '';
        if (window.PiiVault && window.Utils && window.Utils.anonymizeEnabled) {
            out = window.PiiVault.mask(out).text;
        }
        return { status: res.status || 'ok', output: out, stopped: !!res.stopped };
    },

    desktopToolsSet: new Set([
        'WIN_LIST', 'WIN_FOCUS', 'UI_TREE', 'UIA_CLICK',
        'MOUSE_CLICK', 'MOUSE_DRAG_PATH', 'KEY_TYPE', 'SCREENSHOT_WIN'
    ]),

    runDesktopModule: async function(desktopTools, termOut) {
        const srv = window.VPS.activeServer || 'LOCAL';
        const cwd = window.VPS.getActiveCwd() || 'C:\\ai_studio_cockpit_ext';
        const payloadJson = JSON.stringify({ cwd, tools: desktopTools });
        const b64 = btoa(unescape(encodeURIComponent(payloadJson)));
        const psCmd = `powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "C:\\ai_studio_cockpit_ext\\modules\\desktop_rpa.ps1" -PayloadBase64 "${b64}"`;
        const res = await window.VPS.executeCommandStream(srv, psCmd, 'powershell', (chunk) => {
            if (termOut) { termOut.value += chunk; termOut.scrollTop = termOut.scrollHeight; }
        });
        return { status: res.status || 'ok', output: res.output || '', stopped: !!res.stopped };
    },

    getMaxSteps: function() {
        const sel = document.getElementById('agent-max-steps');
        return parseInt(sel ? sel.value : (localStorage.getItem('cockpit_agent_steps') || '3'), 10) || 3;
    },

    isAutoEnabled: function() {
        const chk = document.getElementById('chk-agent-mode');
        return !!(chk && chk.checked);
    },

    updateStatus: function(text, active = false) {
        const badge = document.getElementById('agent-status-badge');
        const stopBtn = document.getElementById('btn-agent-stop');
        if (badge) {
            badge.textContent = text;
            badge.style.color = active ? '#ffd166' : '#888';
        }
        if (stopBtn) stopBtn.style.display = active ? 'inline-flex' : 'none';
    },

    stop: function() {
        this.aborted = true;
        this.running = false;
        if (window.VPS && window.VPS.stopActiveExec) window.VPS.stopActiveExec();
        this.updateStatus(window.t('agent_stopped'), false);
    },

    parseToolsPayload: function(raw) {
        const parsed = JSON.parse(raw);
        let tools = [];
        let forceContinue = false;
        if (Array.isArray(parsed)) {
            tools = parsed;
        } else if (parsed && Array.isArray(parsed.cockpit_tools)) {
            tools = parsed.cockpit_tools;
            forceContinue = !!parsed.continue;
        } else if (parsed && parsed.tool) {
            tools = [parsed];
        }
        return { tools, forceContinue };
    },

    runToolsOnce: async function(rawJson) {
        const srv = window.VPS.activeServer || 'LOCAL';
        const { tools, forceContinue } = this.parseToolsPayload(rawJson);
        if (!tools.length) throw new Error('cockpit_tools list is empty');

        for (const call of tools) {
            if (String(call.tool || '').toUpperCase() === 'RUN_CMD' && call.cmd) {
                if (window.VPS.confirmIfDangerous && !window.VPS.confirmIfDangerous(call.cmd, srv)) {
                    return { status: 'canceled', output: window.t('agent_canceled_danger'), stopped: true };
                }
            }
        }

        for (const call of tools) {
            const tu = String(call.tool || '').toUpperCase().trim();
            const pLow = String(call.path || '').toLowerCase();
            if (tu === 'WRITE_FILE' && (pLow.endsWith('.docx') || pLow.endsWith('.xlsx'))) {
                const hint = pLow.endsWith('.docx')
                    ? 'ERROR: Нельзя создавать .docx через WRITE_FILE (это бинарный архив). Используй {"tool":"DOCX_CREATE","path":"...","title":"...","blocks":[{"type":"heading","text":"..."},{"type":"text","text":"..."},{"type":"table","border":false,"rows":[["...","..."]]}]}'
                    : 'ERROR: Нельзя создавать .xlsx через WRITE_FILE. Используй {"tool":"XLSX_WRITE","path":"...","rows":[[...]],"header_row":1}';
                const readToolsSet = new Set(['DOCX_READ', 'XLSX_READ', 'XLSX_INFO', 'READ_LINES']);
        const writeToolsSet = new Set(['DOCX_REPLACE', 'XLSX_WRITE', 'PATCH_FILE', 'REPLACE_LINES']);
        let hasReadTool = false;
        let hasWriteTool = false;
        for (const call of tools) {
            const tu = String(call.tool || '').toUpperCase().trim();
            if (readToolsSet.has(tu)) hasReadTool = true;
            if (writeToolsSet.has(tu)) hasWriteTool = true;
        }
        let deferredWriteTools = false;
        if (hasReadTool && hasWriteTool) {
            const onlyReads = tools.filter(c => !writeToolsSet.has(String(c.tool || '').toUpperCase().trim()));
            if (onlyReads.length > 0) {
                tools.length = 0;
                onlyReads.forEach(x => tools.push(x));
                deferredWriteTools = true;
            }
        }

        document.getElementById('tab-vps')?.click();
                const termOut = document.getElementById('terminal-out');
                if (termOut) { termOut.value += `\n${hint}\n`; termOut.scrollTop = termOut.scrollHeight; }
                return { status: 'fail', output: hint, readOnly: true, forceContinue: false };
            }
        }

        const readToolsSet = new Set(['DOCX_READ', 'XLSX_READ', 'XLSX_INFO', 'READ_LINES']);
        const writeToolsSet = new Set(['DOCX_REPLACE', 'XLSX_WRITE', 'PATCH_FILE', 'REPLACE_LINES']);
        let hasReadTool = false;
        let hasWriteTool = false;
        for (const call of tools) {
            const tu = String(call.tool || '').toUpperCase().trim();
            if (readToolsSet.has(tu)) hasReadTool = true;
            if (writeToolsSet.has(tu)) hasWriteTool = true;
        }
        let deferredWriteTools = false;
        if (hasReadTool && hasWriteTool) {
            const onlyReads = tools.filter(c => !writeToolsSet.has(String(c.tool || '').toUpperCase().trim()));
            if (onlyReads.length > 0) {
                tools.length = 0;
                onlyReads.forEach(x => tools.push(x));
                deferredWriteTools = true;
            }
        }

        document.getElementById('tab-vps')?.click();
        const termOut = document.getElementById('terminal-out');
        if (termOut) {
            termOut.value += `\n$ [${srv}] (Go-Agent: ${tools.map(x => x.tool).join(', ')})\n`;
            termOut.scrollTop = termOut.scrollHeight;
        }

        const groups = [];
        for (const call of tools) {
            const tu = String(call.tool || '').toUpperCase().trim();
            const kind = this.officeToolsSet.has(tu) ? 'office' : 'bridge';
            if (!groups.length || groups[groups.length - 1].kind !== kind) groups.push({ kind, items: [call] });
            else groups[groups.length - 1].items.push(call);
        }
        const outputs = [];
        let overallStatus = 'ok';
        let readOnly = true;
        for (const grp of groups) {
            if (grp.kind === 'office') {
                for (const c of grp.items) {
                    const tu = String(c.tool || '').toUpperCase();
                    if (tu === 'XLSX_WRITE' || tu === 'DOCX_REPLACE' || tu === 'DOCX_CREATE') readOnly = false;
                }
                const oRes = await this.runOfficeModule(grp.items, termOut);
                if (oRes.output) outputs.push(oRes.output);
                if (oRes.status === 'fail') { overallStatus = 'fail'; break; }
            } else {
                const res = await window.VPS.runAgentTools(grp.items);
                const out = res.output || res.error || '';
                if (termOut && out) { termOut.value += `${out}\n`; termOut.scrollTop = termOut.scrollHeight; }
                if (out) outputs.push(out);
                if (!res.read_only) readOnly = false;
                if (res.status === 'fail') { overallStatus = 'fail'; break; }
            }
        }
        const finalOut = outputs.join('\n\n').trim();
        if (termOut) {
            if (!termOut.value.endsWith('\n')) termOut.value += '\n';
            window.VPS.logs[srv] = termOut.value;
            termOut.scrollTop = termOut.scrollHeight;
        }
        window.lastCleanCommandOutput = finalOut;
        window.lastExecutedCommand = `Go-Agent (${tools.map(x => x.tool).join(', ')})`;
        if (window.UI && window.UI.refreshGitStatus) window.UI.refreshGitStatus();
        let outWithNote = finalOut;
        if (deferredWriteTools && overallStatus === 'ok') {
            outWithNote += '\n\n[Cockpit: правка файла отложена, чтобы не делать замену вслепую. Теперь выполни DOCX_REPLACE / XLSX_WRITE, используя точные токены и текст из вывода выше.]';
            readOnly = true;
        }
        return { status: overallStatus, output: outWithNote, readOnly, forceContinue };
    },

    hasExecutionError: function(res) {
        if (!res) return true;
        if (res.stopped) return false;
        if (res.status === 'fail') return true;
        const out = res.output || '';
        return /(^|\n)\s*(Traceback \(most recent call last\):|SyntaxError:|BUILD ERROR:|fatal:|Unhandled exception)/i.test(out);
    },

    waitForAiResponse: function(prevTurnCount) {
        return new Promise((resolve) => {
            const startedAt = Date.now();
            let lastSig = '';
            let stableTicks = 0;

            const timer = setInterval(() => {
                if (this.aborted) { clearInterval(timer); resolve({ ok: false, reason: 'aborted' }); return; }
                if (Date.now() - startedAt > 120000) { clearInterval(timer); resolve({ ok: false, reason: 'timeout' }); return; }

                const turns = Array.from(document.querySelectorAll('ms-chat-turn'));
                if (turns.length <= prevTurnCount) return;

                const newest = turns[turns.length - 1];
                const isModel = !!newest.querySelector('ms-model-turn, .model');
                if (!isModel) return;

                const isGenerating = !!document.querySelector('ms-run-button button[aria-label*="Stop" i], button[aria-label*="Cancel" i]');
                const sig = `${newest.textContent.length}_${newest.querySelectorAll('ms-code-block').length}`;

                if (!isGenerating && sig === lastSig && newest.textContent.trim().length > 0) stableTicks++;
                else { lastSig = sig; stableTicks = 0; }

                if (stableTicks >= 4) {
                    clearInterval(timer);
                    const blocks = newest.querySelectorAll('ms-code-block');
                    resolve({ ok: true, block: blocks.length ? blocks[blocks.length - 1] : null });
                }
            }, 450);
        });
    },

    runStreamIntoTerminal: async function(cmd, lang) {
        const srv = window.VPS.activeServer || 'LOCAL';
        for (const call of tools) {
            const tu = String(call.tool || '').toUpperCase().trim();
            const pLow = String(call.path || '').toLowerCase();
            if (tu === 'WRITE_FILE' && (pLow.endsWith('.docx') || pLow.endsWith('.xlsx'))) {
                const hint = pLow.endsWith('.docx')
                    ? 'ERROR: Нельзя создавать .docx через WRITE_FILE (это бинарный архив). Используй {"tool":"DOCX_CREATE","path":"...","title":"...","blocks":[{"type":"heading","text":"..."},{"type":"text","text":"..."},{"type":"table","border":false,"rows":[["...","..."]]}]}'
                    : 'ERROR: Нельзя создавать .xlsx через WRITE_FILE. Используй {"tool":"XLSX_WRITE","path":"...","rows":[[...]],"header_row":1}';
                const readToolsSet = new Set(['DOCX_READ', 'XLSX_READ', 'XLSX_INFO', 'READ_LINES']);
        const writeToolsSet = new Set(['DOCX_REPLACE', 'XLSX_WRITE', 'PATCH_FILE', 'REPLACE_LINES']);
        let hasReadTool = false;
        let hasWriteTool = false;
        for (const call of tools) {
            const tu = String(call.tool || '').toUpperCase().trim();
            if (readToolsSet.has(tu)) hasReadTool = true;
            if (writeToolsSet.has(tu)) hasWriteTool = true;
        }
        let deferredWriteTools = false;
        if (hasReadTool && hasWriteTool) {
            const onlyReads = tools.filter(c => !writeToolsSet.has(String(c.tool || '').toUpperCase().trim()));
            if (onlyReads.length > 0) {
                tools.length = 0;
                onlyReads.forEach(x => tools.push(x));
                deferredWriteTools = true;
            }
        }

        document.getElementById('tab-vps')?.click();
                const termOut = document.getElementById('terminal-out');
                if (termOut) { termOut.value += `\n${hint}\n`; termOut.scrollTop = termOut.scrollHeight; }
                return { status: 'fail', output: hint, readOnly: true, forceContinue: false };
            }
        }

        const readToolsSet = new Set(['DOCX_READ', 'XLSX_READ', 'XLSX_INFO', 'READ_LINES']);
        const writeToolsSet = new Set(['DOCX_REPLACE', 'XLSX_WRITE', 'PATCH_FILE', 'REPLACE_LINES']);
        let hasReadTool = false;
        let hasWriteTool = false;
        for (const call of tools) {
            const tu = String(call.tool || '').toUpperCase().trim();
            if (readToolsSet.has(tu)) hasReadTool = true;
            if (writeToolsSet.has(tu)) hasWriteTool = true;
        }
        let deferredWriteTools = false;
        if (hasReadTool && hasWriteTool) {
            const onlyReads = tools.filter(c => !writeToolsSet.has(String(c.tool || '').toUpperCase().trim()));
            if (onlyReads.length > 0) {
                tools.length = 0;
                onlyReads.forEach(x => tools.push(x));
                deferredWriteTools = true;
            }
        }

        document.getElementById('tab-vps')?.click();
        const termOut = document.getElementById('terminal-out');
        if (termOut) {
            termOut.value += `\n$ [${srv}] (${lang})\n`;
            termOut.scrollTop = termOut.scrollHeight;
        }
        const res = await window.VPS.executeCommandStream(srv, cmd, lang, (chunk) => {
            if (termOut) {
                termOut.value += chunk;
                termOut.scrollTop = termOut.scrollHeight;
            }
        });
        if (termOut) {
            if (!termOut.value.endsWith('\n')) termOut.value += '\n';
            window.VPS.logs[srv] = termOut.value;
            termOut.scrollTop = termOut.scrollHeight;
        }
        window.lastCleanCommandOutput = res.output || '';
        window.lastExecutedCommand = lang;
        if (window.UI && window.UI.refreshGitStatus) window.UI.refreshGitStatus();
        return res;
    },

    runLoop: async function(initialCmd, initialLang, maxSteps = null) {
        if (this.running) return alert(window.t('agent_running_warn'));
        const limit = maxSteps || this.getMaxSteps();
        this.running = true;
        this.aborted = false;

        let cmd = initialCmd;
        let lang = initialLang;
        const isRu = window.I18N && window.I18N.lang === 'ru';

        try {
            for (let step = 1; step <= limit; step++) {
                if (this.aborted) break;
                const srv = window.VPS.activeServer || 'LOCAL';
                let res = null;
                let needContinue = false;

                if (lang === 'agent_tools') {
                    this.updateStatus(window.t('agent_step_exec', { step, limit }), true);
                    res = await this.runToolsOnce(cmd);
                    if (res.stopped || this.aborted) {
                        this.updateStatus(window.t('agent_stopped'), false);
                        break;
                    }
                    needContinue = (res.status === 'ok') && (res.readOnly || res.forceContinue);
                } else {
                    if (window.VPS.confirmIfDangerous && !window.VPS.confirmIfDangerous(cmd, srv)) {
                        this.updateStatus(window.t('agent_canceled_danger'), false);
                        break;
                    }
                    this.updateStatus(window.t('agent_step_exec', { step, limit }), true);
                    res = await this.runStreamIntoTerminal(cmd, lang);
                    if (res.stopped || this.aborted) {
                        this.updateStatus(window.t('agent_stopped'), false);
                        break;
                    }
                }

                const hasErr = this.hasExecutionError(res);

                if (!hasErr && !needContinue) {
                    this.updateStatus(window.t('agent_done', { step }), false);
                    const termOut = document.getElementById('terminal-out');
                    if (termOut) {
                        termOut.value += `\n[Agent Loop] ${window.t('agent_done', { step })}\n`;
                        termOut.scrollTop = termOut.scrollHeight;
                    }
                    break;
                }

                if (step >= limit) {
                    this.updateStatus(window.t('agent_limit', { limit }), false);
                    const termOut = document.getElementById('terminal-out');
                    if (termOut) {
                        termOut.value += `\n[Agent Loop] ${window.t('agent_limit', { limit })}\n`;
                        termOut.scrollTop = termOut.scrollHeight;
                    }
                    break;
                }

                this.updateStatus(window.t('agent_step_wait', { step, limit }), true);
                let outText = res.output || 'Error';
                if (window.Utils) {
                    outText = window.Utils.scrubSecrets(window.Utils.compressLog(outText, 6000).text).text;
                }

                const prevTurns = document.querySelectorAll('ms-chat-turn').length;
                let prompt;
                if (lang === 'agent_tools' && !hasErr) {
                    prompt = isRu
                        ? `[Go-Agent • шаг ${step}/${limit}] Результат операций на [${srv}]:\n\`\`\`text\n${outText}\n\`\`\`\nПродолжай: выдай следующий блок \`\`\`json с "cockpit_tools" (например READ_LINES или PATCH_FILE) либо итоговый ответ текстом.`
                        : `[Go-Agent • step ${step}/${limit}] Tool output on [${srv}]:\n\`\`\`text\n${outText}\n\`\`\`\nContinue with the next \`\`\`json "cockpit_tools" block (e.g. READ_LINES or PATCH_FILE) or give your final text answer.`;
                } else {
                    prompt = window.t('agent_prompt', { step, limit, lang, srv, out: outText });
                }

                if (window.UI) window.UI.injectIntoChat(prompt, true);

                const aiRes = await this.waitForAiResponse(prevTurns);
                if (!aiRes.ok) { this.updateStatus(`⚠️ ${aiRes.reason}`, false); break; }
                if (!aiRes.block) {
                    if (lang === 'agent_tools' && !hasErr) {
                        this.updateStatus(window.t('agent_done', { step }), false);
                    } else {
                        this.updateStatus(window.t('agent_no_code'), false);
                    }
                    break;
                }

                const codeEl = aiRes.block.querySelector('code, pre');
                cmd = (codeEl?.textContent || '').trim();
                lang = window.CodeRunner ? window.CodeRunner.detectLang(aiRes.block, cmd) : lang;

                if (!cmd || lang === 'browser_code') { this.updateStatus(window.t('agent_no_exec_code'), false); break; }
                if (lang === 'bash' || lang === 'shell') cmd = cmd.replace(/^\$\s+/gm, '');
            }
        } catch(e) {
            this.updateStatus(`❌ ${e.message}`, false);
        } finally {
            this.running = false;
        }
    }
};

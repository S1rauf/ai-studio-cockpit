window.CodeRunner = {
    detectLang: function(container, codeText) {
        const clone = container.cloneNode(true);
        clone.querySelectorAll('pre, code').forEach(el => el.remove());
        const h = (clone.textContent || '').toLowerCase();
        const low = (codeText || '').trim().toLowerCase();
        const agentRe = new RegExp('"cockpit' + '_tools"\\s*:');

        if (h.includes('cockpit-agent')) return 'agent_tools';
        if (h.includes('java' + 'script') || h.includes('typescript')) return 'browser_code';
        if (h.includes('powershell') || h.includes('pwsh')) return 'powershell';
        if (h.includes('python')) return 'python';
        if (h.includes('bash') || h.includes('shell') || h.includes('zsh')) return 'bash';
        if (h.includes('cmd') || h.includes('bat') || h.includes('dos')) return 'shell';

        if (agentRe.test(codeText || '')) return 'agent_tools';
        if (codeText.includes('console.log(') || codeText.includes('document.querySelector')) return 'browser_code';
        if (/^(import |from |def |print\()/m.test(codeText) && !low.startsWith('python ')) return 'python';
        if (low.includes('write-host') || low.includes('get-') || codeText.includes('$env:')) return 'powershell';
        return 'shell';
    },

    inject: function() {
        document.querySelectorAll('ms-code-block').forEach(container => {
            const codeEl = container.querySelector('code, pre');
            const preview = (codeEl?.textContent || '').trim();
            const lang = this.detectLang(container, preview);

            const prevBar = container.previousElementSibling;
            const hasBar = prevBar && prevBar.classList && prevBar.classList.contains('cockpit-run-bar');

            if (hasBar && container.dataset.cockpitLang === lang) return;
            if (hasBar) prevBar.remove();

            container.setAttribute('data-vps-run-ready', 'true');
            container.dataset.cockpitLang = lang;

            const isBrowser = lang === 'browser_code';
            const isAgentTools = lang === 'agent_tools';
            const isDanger = !isBrowser && !isAgentTools && window.VPS && window.VPS.checkDangerousCommand && window.VPS.checkDangerousCommand(preview);
            const icon = isAgentTools ? '🤖 Go-Agent' :
                         isBrowser ? window.t('js_btn') :
                         lang === 'python' ? '🐍 Python' :
                         lang === 'powershell' ? '⚡ PS' : '▶';

            const bar = document.createElement('div');
            bar.className = 'cockpit-run-bar';
            bar.style.cssText = 'display:flex; justify-content:flex-end; align-items:center; gap:6px; padding:4px 10px; background:#1c1d1f; border:1px solid #3c4043; border-bottom:none; border-radius:6px 6px 0 0; margin-top:4px;';

            const runBtn = document.createElement('button');
            const getLabel = () => isBrowser ? icon : `${isDanger ? '⚠️ ' : ''}${icon} ${window.t('on_srv')} [${window.VPS.activeServer || 'LOCAL'}]`;
            runBtn.innerHTML = getLabel();
            runBtn.setAttribute('data-lang-icon', icon);
            const bgCol = isAgentTools ? '#261e3d' : (isBrowser ? '#1c2d42' : (isDanger ? '#3c2020' : '#1b3b2b'));
            const fgCol = isAgentTools ? '#d2bfff' : (isBrowser ? '#80b3ff' : (isDanger ? '#ffb4ab' : '#85e3a1'));
            const brCol = isAgentTools ? '#55438a' : (isBrowser ? '#335588' : (isDanger ? '#6b3030' : '#2d6a4f'));
            runBtn.style.cssText = `cursor:pointer; padding:4px 10px; background:${bgCol}; color:${fgCol}; border:1px solid ${brCol}; border-radius:4px; font-size:11px; font-weight:bold;`;

            runBtn.onclick = async () => {
                const el = container.querySelector('code, pre');
                let txt = (el?.textContent || '').trim();
                const currentLang = this.detectLang(container, txt);
                if (!txt) return alert(window.t('empty_code'));

                if (currentLang !== 'browser_code' && window.Agent && window.Agent.isAutoEnabled()) {
                    if (currentLang === 'bash' || currentLang === 'shell') txt = txt.replace(/^\$\s+/gm, '');
                    await window.Agent.runLoop(txt, currentLang);
                    return;
                }

                if (currentLang === 'agent_tools') {
                    runBtn.textContent = window.t('running_btn');
                    runBtn.disabled = true;
                    try {
                        if (window.Agent) await window.Agent.runToolsOnce(txt);
                    } catch(e) {
                        alert(e.message);
                    } finally {
                        runBtn.innerHTML = getLabel();
                        runBtn.disabled = false;
                    }
                    return;
                }

                if (currentLang !== 'browser_code' && window.VPS && window.VPS.confirmIfDangerous) {
                    if (!window.VPS.confirmIfDangerous(txt, window.VPS.activeServer || 'LOCAL')) return;
                }

                runBtn.textContent = window.t('running_btn');
                runBtn.disabled = true;

                try {
                    if (currentLang === 'browser_code') {
                        chrome.runtime.sendMessage({ type: 'RUN_PAGE_CODE', code: txt }, (res) => {
                            const err = chrome.runtime.lastError?.message;
                            const out = err ? `❌ ${err}` : (res?.output || 'No response');
                            window.lastCleanCommandOutput = out;
                            window.lastExecutedCommand = 'Browser Console';
                            document.getElementById('tab-vps')?.click();
                            const termOut = document.getElementById('terminal-out');
                            if (termOut) {
                                termOut.value += `\n$ [BROWSER CONSOLE]\n${out}\n`;
                                termOut.scrollTop = termOut.scrollHeight;
                            }
                            runBtn.innerHTML = getLabel();
                            runBtn.disabled = false;
                        });
                        return;
                    }

                    if (currentLang === 'bash' || currentLang === 'shell') txt = txt.replace(/^\$\s+/gm, '');
                    document.getElementById('tab-vps')?.click();
                    const termOut = document.getElementById('terminal-out');
                    const srv = window.VPS.activeServer || 'LOCAL';
                    if (termOut) {
                        termOut.value += `\n$ [${srv}] (${currentLang})\n`;
                        termOut.scrollTop = termOut.scrollHeight;
                    }
                    const res = await window.VPS.executeCommandStream(srv, txt, currentLang, (chunk) => {
                        if (termOut) {
                            termOut.value += chunk;
                            termOut.scrollTop = termOut.scrollHeight;
                        }
                    });
                    window.lastCleanCommandOutput = res.output || '';
                    window.lastExecutedCommand = currentLang;
                    if (termOut) {
                        if (!termOut.value.endsWith('\n')) termOut.value += '\n';
                        window.VPS.logs[srv] = termOut.value;
                        termOut.scrollTop = termOut.scrollHeight;
                    }
                    if (window.UI && window.UI.refreshGitStatus) window.UI.refreshGitStatus();
                } catch(e) {
                    alert(`${e.message}`);
                } finally {
                    if (currentLang !== 'browser_code') {
                        runBtn.innerHTML = getLabel();
                        runBtn.disabled = false;
                    }
                }
            };

            bar.appendChild(runBtn);

            if (!isBrowser) {
                const autoBtn = document.createElement('button');
                autoBtn.textContent = window.t('auto_btn');
                autoBtn.title = window.t('auto_tip');
                autoBtn.style.cssText = 'cursor:pointer; padding:4px 8px; background:#232038; color:#c8b6ff; border:1px solid #4c3f7a; border-radius:4px; font-size:11px; font-weight:bold;';
                autoBtn.onclick = async () => {
                    const el = container.querySelector('code, pre');
                    let txt = (el?.textContent || '').trim();
                    const currentLang = this.detectLang(container, txt);
                    if (!txt) return alert(window.t('empty_code'));
                    if (currentLang === 'bash' || currentLang === 'shell') txt = txt.replace(/^\$\s+/gm, '');
                    if (window.Agent) await window.Agent.runLoop(txt, currentLang);
                };
                bar.appendChild(autoBtn);
            }

            container.parentNode.insertBefore(bar, container);
        });
    }
};

window.UI = {
    panelWidth: parseInt(localStorage.getItem('cockpit_width') || '450', 10),
    isHidden: localStorage.getItem('cockpit_hidden') === 'true',
    liveWs: null,
    activeSnippetCat: 'ALL',
    editingSnippetId: null,
    historyIndex: -1,
    historyDraft: '',
    activeTabId: 'tab-toc',
    helpOpen: false,

    getStudioLeftOffset: function() {
        const candidates = Array.from(document.querySelectorAll('ms-navbar, mat-drawer, mat-sidenav, aside, nav'));
        for (const el of candidates) {
            const style = getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            const r = el.getBoundingClientRect();
            if (r.left <= 15 && r.width >= 40 && r.width <= 380 && r.height > 200) {
                return Math.round(r.right);
            }
        }
        const mainEl = document.querySelector('mat-sidenav-content, .mat-drawer-content, main, .main-content');
        if (mainEl) {
            const mr = mainEl.getBoundingClientRect();
            if (mr.left >= 40 && mr.left <= 380) return Math.round(mr.left);
        }
        return 0;
    },

    updateDockLayout: function() {
        const panel = document.getElementById('ai-studio-cockpit-docked');
        const mainContent = document.querySelector('mat-sidenav-content, .mat-drawer-content, .main-content, main');
        if (!panel) return;

        const leftOffset = this.getStudioLeftOffset();
        panel.style.left = `${leftOffset}px`;

        if (mainContent) {
            mainContent.style.boxSizing = 'border-box';
            if (this.isHidden) {
                mainContent.style.paddingLeft = '0px';
                mainContent.style.paddingRight = '0px';
            } else {
                const mainRectLeft = mainContent.getBoundingClientRect().left;
                const neededLeft = Math.max(0, (leftOffset + this.panelWidth + 16) - mainRectLeft);
                mainContent.style.paddingLeft = `${neededLeft}px`;
                mainContent.style.paddingRight = '48px';
            }
        }
    },

    setExecRunning: function(isRunning) {
        const stopBtn = document.getElementById('btn-stop-exec');
        const runBtn = document.getElementById('btn-run-cmd');
        const liveInd = document.getElementById('live-indicator');
        if (stopBtn) stopBtn.style.display = isRunning ? 'inline-flex' : 'none';
        if (runBtn) runBtn.disabled = isRunning;
        if (liveInd && !this.liveWs) {
            liveInd.textContent = isRunning ? window.t('mode_streaming') : window.t('mode_commands');
        }
    },

    updateDeleteCount: function() {
        const checked = document.querySelectorAll('.cockpit-turn-chk:checked');
        const btn = document.getElementById('btn-del-selected-turns');
        if (btn) {
            btn.style.display = checked.length > 0 ? 'block' : 'none';
            btn.textContent = window.t('del_selected_chat', { n: checked.length });
        }
    },

    toggleDock: function(forceState = null) {
        const panel = document.getElementById('ai-studio-cockpit-docked');
        const floatBtn = document.getElementById('cockpit-restore-btn');
        if (!panel) return;

        this.isHidden = forceState !== null ? forceState : !this.isHidden;
        localStorage.setItem('cockpit_hidden', this.isHidden.toString());

        if (this.isHidden) {
            panel.style.display = 'none';
            if (floatBtn) floatBtn.style.display = 'flex';
        } else {
            panel.style.display = 'flex';
            if (floatBtn) floatBtn.style.display = 'none';
        }
        this.updateDockLayout();
    },

    closeLiveWs: function() {
        if (!this.liveWs) return;
        this.liveWs.close();
        this.liveWs = null;
        const btnToggleLive = document.getElementById('btn-toggle-live-ssh');
        const liveIndicator = document.getElementById('live-indicator');
        const termOut = document.getElementById('terminal-out');
        if (btnToggleLive) {
            btnToggleLive.textContent = window.t('live_btn');
            btnToggleLive.style.background = '#202830';
        }
        if (liveIndicator) liveIndicator.textContent = window.t('mode_commands');
        if (termOut) termOut.readOnly = true;
    },

    syncPiiVaultUi: function() {
        const btnDrawer = document.getElementById('btn-pii-toggle-drawer');
        const listEl = document.getElementById('pii-vault-list');
        if (!window.PiiVault) return;
        const cnt = window.PiiVault.count();
        if (btnDrawer) btnDrawer.textContent = `🛡️ Сейф (${cnt})`;
        if (listEl) {
            listEl.replaceChildren();
            const entries = Object.entries(window.PiiVault.state.toReal || {});
            if (entries.length === 0) {
                const empty = document.createElement('div');
                empty.style.color = '#777';
                empty.textContent = 'Сейф пуст. Реквизиты сохраняются автоматически при маскировке.';
                listEl.appendChild(empty);
            } else {
                entries.forEach(([tok, real]) => {
                    const row = document.createElement('div');
                    row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:6px; background:#121314; padding:2px 5px; border-radius:3px;';
                    const s1 = document.createElement('span');
                    s1.style.cssText = 'color:#85e3a1; flex-shrink:0;';
                    s1.textContent = tok;
                    const s2 = document.createElement('span');
                    s2.style.cssText = 'color:#ddd; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-left:auto;';
                    s2.textContent = real;
                    const delBtn = document.createElement('button');
                    delBtn.textContent = '✕';
                    delBtn.title = 'Удалить эту запись из сейфа';
                    delBtn.style.cssText = 'cursor:pointer; border:none; background:transparent; color:#ff8a80; font-size:10px; padding:0 3px; flex-shrink:0;';
                    delBtn.onclick = () => {
                        if (window.PiiVault) window.PiiVault.removeToken(tok);
                    };
                    row.appendChild(s1);
                    row.appendChild(s2);
                    row.appendChild(delBtn);
                    listEl.appendChild(row);
                });
            }
        }
    },

    syncAnonymizeUi: function() {
        const btn = document.getElementById('btn-toggle-anonymize');
        if (!btn || !window.Utils) return;
        const on = window.Utils.anonymizeEnabled;
        btn.textContent = on ? '🛡️' : '🛡️✕';
        btn.style.background = on ? '#1b3b2b' : '#3c2020';
        btn.style.color = on ? '#85e3a1' : '#ffb4ab';
        btn.style.borderColor = on ? '#2d6a4f' : '#5c3030';
        btn.title = on ? window.t('anon_on') : window.t('anon_off');
    },

    renderHelp: function() {
        const list = document.getElementById('help-list');
        const search = document.getElementById('search-help');
        if (!list || !window.I18N?.getHelpSections) return;

        const q = search ? search.value.trim().toLowerCase() : '';
        const sections = window.I18N.getHelpSections();
        list.replaceChildren();

        sections.forEach(sec => {
            if (q && !(sec.title + ' ' + sec.body).toLowerCase().includes(q)) return;
            const card = document.createElement('div');
            card.style.cssText = 'background:#1c1d1f; border:1px solid #333; border-radius:6px; padding:10px 11px; display:flex; flex-direction:column; gap:6px;';

            const h = document.createElement('div');
            h.textContent = sec.title;
            h.style.cssText = 'font-size:12px; font-weight:700; color:#a8c7fa;';

            const b = document.createElement('div');
            b.textContent = sec.body;
            b.style.cssText = 'font-size:11px; line-height:1.55; color:#d0d0d0; white-space:pre-wrap; user-select:text;';

            card.appendChild(h);
            card.appendChild(b);
            list.appendChild(card);
        });
    },

    syncHandoffBadge: function() {
        const btnLoad = document.getElementById('btn-handoff-load');
        if (!btnLoad || typeof chrome === 'undefined' || !chrome.storage?.local) return;
        chrome.storage.local.get(['cockpit_handoff'], (res) => {
            if (res.cockpit_handoff && res.cockpit_handoff.text) {
                const tok = window.Utils ? window.Utils.formatTokens(res.cockpit_handoff.tokens || 0) : '';
                btnLoad.textContent = `${window.t('handoff_load')} (${tok})`;
                btnLoad.style.opacity = '1';
                btnLoad.disabled = false;
            } else {
                btnLoad.textContent = window.t('handoff_load');
                btnLoad.style.opacity = '0.5';
                btnLoad.disabled = true;
            }
        });
    },

    syncCwdUi: function() {
        const cwdInput = document.getElementById('cwd-input');
        const pickBtn = document.getElementById('btn-pick-cwd');
        const srv = (window.VPS.activeServer || 'LOCAL').toUpperCase();
        const isLocal = srv.includes('LOCAL') || srv.includes('ПК');

        if (cwdInput) {
            cwdInput.value = window.VPS.getActiveCwd();
            cwdInput.placeholder = isLocal ? window.t('cwd_ph_local') : window.t('cwd_ph_vps');
        }
        if (pickBtn) pickBtn.style.display = isLocal ? 'inline-flex' : 'none';
        this.refreshGitStatus();
    },

    refreshGitStatus: async function() {
        const badge = document.getElementById('git-status-pill');
        const btnDiff = document.getElementById('btn-git-diff-ai');
        const btnRollback = document.getElementById('btn-git-rollback');
        const btnBundle = document.getElementById('btn-bundle-code');
        if (!badge) return;

        const cwd = window.VPS.getActiveCwd();
        if (!cwd) {
            badge.textContent = window.t('no_dir');
            badge.style.color = '#777';
            if (btnDiff) btnDiff.disabled = true;
            if (btnRollback) btnRollback.disabled = true;
            if (btnBundle) btnBundle.disabled = true;
            return;
        }

        if (btnBundle) btnBundle.disabled = false;
        badge.textContent = window.t('git_loading');
        badge.style.color = '#a8c7fa';

        try {
            const res = await window.VPS.gitAction('info');
            if (res.is_git) {
                const chg = res.changed || 0;
                badge.textContent = chg > 0 ? window.t('git_dirty', { branch: res.branch, n: chg }) : window.t('git_clean', { branch: res.branch });
                badge.style.color = chg > 0 ? '#ffd166' : '#85e3a1';
                if (btnDiff) btnDiff.disabled = false;
                if (btnRollback) btnRollback.disabled = chg === 0;
            } else {
                badge.textContent = res.error ? `⚠️ ${res.error}` : window.t('not_git');
                badge.style.color = res.error ? '#ffb4ab' : '#888';
                if (btnDiff) btnDiff.disabled = true;
                if (btnRollback) btnRollback.disabled = true;
            }
        } catch(e) {
            badge.textContent = window.t('bridge_down_short');
            badge.style.color = '#ffb4ab';
            if (btnDiff) btnDiff.disabled = true;
            if (btnRollback) btnRollback.disabled = true;
        }
    },

    resolvePlaceholders: function(cmdText) {
        const matches = Array.from(cmdText.matchAll(/\{\{([a-zA-Z0-9_а-яА-ЯёЁ.-]+)(?:=([^}]*))?\}\}/g));
        if (matches.length === 0) return cmdText;

        const values = {};
        for (const m of matches) {
            const key = m[1];
            const defVal = m[2] !== undefined ? m[2] : '';
            if (values[key] !== undefined) continue;
            const ans = prompt(window.t('snip_var_prompt', { key }), defVal);
            if (ans === null) return null;
            values[key] = ans;
        }
        return cmdText.replace(/\{\{([a-zA-Z0-9_а-яА-ЯёЁ.-]+)(?:=[^}]*)?\}\}/g, (_, key) => values[key]);
    },

    openSnippetForm: function(editId = null) {
        const form = document.getElementById('snippet-form');
        const titleEl = document.getElementById('snippet-form-title');
        if (!form) return;

        this.editingSnippetId = editId;
        form.style.display = 'flex';

        if (editId) {
            const sn = (window.VPS.snippets || []).find(s => s.id === editId);
            if (sn) {
                titleEl.textContent = window.t('snip_edit', { title: sn.title });
                document.getElementById('snip-title').value = sn.title || '';
                document.getElementById('snip-cat').value = sn.category || 'Custom';
                document.getElementById('snip-lang').value = sn.lang || 'shell';
                document.getElementById('snip-cmd').value = sn.cmd || '';
                return;
            }
        }
        titleEl.textContent = window.t('snip_new');
        document.getElementById('snip-title').value = '';
        document.getElementById('snip-cat').value = this.activeSnippetCat !== 'ALL' ? this.activeSnippetCat : 'Custom';
        document.getElementById('snip-lang').value = 'shell';
        document.getElementById('snip-cmd').value = '';
    },

    renderSnippets: function() {
        const catsBar = document.getElementById('snippet-cats-bar');
        const listEl = document.getElementById('snippet-list');
        const searchEl = document.getElementById('search-snippets');
        if (!catsBar || !listEl) return;

        const all = window.VPS.snippets || [];
        const query = searchEl ? searchEl.value.trim().toLowerCase() : '';

        const cats = ['ALL', ...Array.from(new Set(all.map(s => s.category || 'Custom')))];
        if (!cats.includes(this.activeSnippetCat)) this.activeSnippetCat = 'ALL';

        catsBar.replaceChildren();
        cats.forEach(c => {
            const active = c === this.activeSnippetCat;
            const b = document.createElement('button');
            b.textContent = c === 'ALL' ? window.t('snip_all') : c;
            b.style.cssText = `cursor:pointer; padding:3px 8px; border-radius:12px; font-size:10px; white-space:nowrap; border:1px solid ${active ? '#388bfd' : '#3c4043'}; background:${active ? '#1c2d42' : '#202122'}; color:${active ? '#80b3ff' : '#aaa'};`;
            b.onclick = () => { this.activeSnippetCat = c; this.renderSnippets(); };
            catsBar.appendChild(b);
        });

        listEl.replaceChildren();
        const filtered = all.filter(s => {
            if (this.activeSnippetCat !== 'ALL' && (s.category || 'Custom') !== this.activeSnippetCat) return false;
            if (query) {
                const hay = `${s.title} ${s.category} ${s.cmd}`.toLowerCase();
                if (!hay.includes(query)) return false;
            }
            return true;
        });

        if (filtered.length === 0) {
            const empty = document.createElement('div');
            empty.style.cssText = 'text-align:center; color:#666; font-size:12px; padding:24px 8px;';
            empty.textContent = window.t('snip_empty');
            listEl.appendChild(empty);
            return;
        }

        filtered.forEach(sn => {
            const card = document.createElement('div');
            card.style.cssText = 'background:#1c1d1f; border:1px solid #333; border-radius:6px; padding:8px 10px; display:flex; flex-direction:column; gap:5px;';

            const top = document.createElement('div');
            top.style.cssText = 'display:flex; justify-content:space-between; align-items:center; gap:6px;';

            const left = document.createElement('div');
            left.style.cssText = 'display:flex; align-items:center; gap:6px; min-width:0;';

            const catTag = document.createElement('span');
            catTag.textContent = sn.category || 'Custom';
            catTag.style.cssText = 'font-size:9px; background:#252628; color:#ffd166; padding:1px 5px; border-radius:4px; border:1px solid #3c3520; flex-shrink:0;';

            const titleSpan = document.createElement('span');
            titleSpan.textContent = sn.title || '';
            titleSpan.style.cssText = 'font-size:12px; font-weight:600; color:#e3e3e3; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';

            left.appendChild(catTag);
            left.appendChild(titleSpan);

            const btns = document.createElement('div');
            btns.style.cssText = 'display:flex; align-items:center; gap:4px; flex-shrink:0;';

            const mkBtn = (txt, title, bg, col, border) => {
                const b = document.createElement('button');
                b.textContent = txt;
                b.title = title;
                b.style.cssText = `cursor:pointer; padding:2px 6px; border-radius:4px; font-size:11px; background:${bg}; color:${col}; border:1px solid ${border};`;
                return b;
            };

            const btnRun = mkBtn('▶', `${window.t('run_btn')} [${window.VPS.activeServer || 'LOCAL'}]`, '#1b3b2b', '#85e3a1', '#2d6a4f');
            btnRun.onclick = async () => {
                const finalCmd = this.resolvePlaceholders(sn.cmd);
                if (finalCmd === null) return;
                if (window.VPS.confirmIfDangerous && !window.VPS.confirmIfDangerous(finalCmd, window.VPS.activeServer || 'LOCAL')) return;

                window.VPS.addCmdHistory(finalCmd);
                window.lastExecutedCommand = finalCmd;
                document.getElementById('tab-vps')?.click();
                const termOut = document.getElementById('terminal-out');
                const srv = window.VPS.activeServer || 'LOCAL';
                if (termOut) {
                    termOut.value += `\n$ [${srv}] ${finalCmd}\n`;
                    termOut.scrollTop = termOut.scrollHeight;
                }
                try {
                    const res = await window.VPS.executeCommandStream(srv, finalCmd, sn.lang || 'shell', (chunk) => {
                        if (termOut) {
                            termOut.value += chunk;
                            termOut.scrollTop = termOut.scrollHeight;
                        }
                    });
                    window.lastCleanCommandOutput = res.output || '';
                    if (termOut) {
                        if (!termOut.value.endsWith('\n')) termOut.value += '\n';
                        window.VPS.logs[srv] = termOut.value;
                        termOut.scrollTop = termOut.scrollHeight;
                    }
                    this.refreshGitStatus();
                } catch(e) {
                    if (termOut) termOut.value += `${e.message}\n`;
                }
            };

            const btnToInput = mkBtn('⌨️', window.t('cmd_ph'), '#252628', '#a8c7fa', '#444');
            btnToInput.onclick = () => {
                const finalCmd = this.resolvePlaceholders(sn.cmd);
                if (finalCmd === null) return;
                document.getElementById('tab-vps')?.click();
                const inp = document.getElementById('cmd-input');
                if (inp) { inp.value = finalCmd; inp.focus(); }
            };

            const btnToChat = mkBtn('🤖', window.t('term_ask_ai'), '#1c2d42', '#80b3ff', '#335588');
            btnToChat.onclick = () => this.injectIntoChat(`\`\`\`${sn.lang || 'bash'}\n${sn.cmd}\n\`\`\``, false);

            const btnEdit = mkBtn('✏️', 'Edit', 'transparent', '#aaa', 'transparent');
            btnEdit.onclick = () => this.openSnippetForm(sn.id);

            const btnDel = mkBtn('✕', 'Delete', 'transparent', '#888', 'transparent');
            btnDel.onclick = () => {
                if (!confirm(window.t('snip_del_confirm', { title: sn.title }))) return;
                window.VPS.snippets = window.VPS.snippets.filter(x => x.id !== sn.id);
                window.VPS.saveSnippets();
                this.renderSnippets();
            };

            btns.appendChild(btnRun);
            btns.appendChild(btnToInput);
            btns.appendChild(btnToChat);
            btns.appendChild(btnEdit);
            btns.appendChild(btnDel);

            top.appendChild(left);
            top.appendChild(btns);

            const codePre = document.createElement('div');
            codePre.textContent = sn.cmd;
            codePre.style.cssText = 'font-family:monospace; font-size:11px; color:#85e3a1; background:#121314; padding:5px 7px; border-radius:4px; white-space:pre-wrap; word-break:break-all; max-height:66px; overflow:hidden;';

            card.appendChild(top);
            card.appendChild(codePre);
            listEl.appendChild(card);
        });
    },

    renderVpsTabs: function() {
        const vpsTabsBar = document.getElementById('vps-tabs-bar');
        const termOut = document.getElementById('terminal-out');
        if (!vpsTabsBar) return;

        vpsTabsBar.replaceChildren();
        const allTargets = ["LOCAL", ...Object.keys(window.VPS.servers)];

        allTargets.forEach(sName => {
            const isActive = sName === window.VPS.activeServer;
            const tab = document.createElement('div');
            tab.style.cssText = `
                display:flex; align-items:center; border-radius:4px;
                background: ${isActive ? '#1b3b2b' : '#252628'};
                border: 1px solid ${isActive ? '#2d6a4f' : '#444'};
            `;

            const btn = document.createElement('button');
            btn.textContent = sName === "LOCAL" ? window.t('local_pc') : sName;
            btn.style.cssText = `cursor:pointer; padding:3px 7px; border:none; background:transparent; font-size:11px; font-weight:500; color:${isActive ? '#85e3a1' : '#aaa'};`;
            btn.onclick = () => {
                if (this.liveWs && window.VPS.activeServer !== sName) this.closeLiveWs();
                window.VPS.setActiveServer(sName);
                this.renderVpsTabs();
                this.syncCwdUi();
                document.querySelectorAll('.cockpit-run-bar button').forEach(b => {
                    const icon = b.getAttribute('data-lang-icon');
                    if (icon && !b.innerText.includes('JS')) {
                        b.textContent = `${icon} ${window.t('on_srv')} [${sName}]`;
                    }
                });
            };

            tab.appendChild(btn);

            if (sName !== "LOCAL") {
                const btnEdit = document.createElement('button');
                btnEdit.innerHTML = '✏️';
                btnEdit.style.cssText = 'cursor:pointer; border:none; background:transparent; font-size:10px; color:#aaa; padding:2px 4px;';
                btnEdit.onclick = () => this.openVpsForm(sName);

                const btnDel = document.createElement('button');
                btnDel.innerHTML = '✕';
                btnDel.style.cssText = 'cursor:pointer; border:none; background:transparent; font-size:10px; color:#888; padding:2px 4px;';
                btnDel.onclick = () => {
                    if (confirm(window.t('vps_del_confirm', { name: sName }))) {
                        window.VPS.deleteServer(sName);
                        this.renderVpsTabs();
                        this.syncCwdUi();
                    }
                };
                tab.appendChild(btnEdit);
                tab.appendChild(btnDel);
            }

            vpsTabsBar.appendChild(tab);
        });

        if (termOut && !this.liveWs) {
            termOut.value = window.VPS.logs[window.VPS.activeServer] || window.t('term_ready', { srv: window.VPS.activeServer });
        }
    },

    openVpsForm: function(editName = null) {
        const form = document.getElementById('vps-add-form');
        const title = document.getElementById('form-vps-title');
        this.editingServerName = editName;
        form.style.display = 'flex';
        document.getElementById('test-conn-status').textContent = '';

        if (editName && window.VPS.servers[editName]) {
            const s = window.VPS.servers[editName];
            title.textContent = window.t('vps_edit', { name: editName });
            document.getElementById('add-vps-name').value = editName;
            document.getElementById('add-vps-host').value = s.host || '';
            document.getElementById('add-vps-user').value = s.user || 'root';
            document.getElementById('add-vps-pass').value = s.password || '';
            document.getElementById('add-vps-key').value = s.key || '';
        } else {
            title.textContent = window.t('vps_add');
            document.getElementById('add-vps-name').value = '';
            document.getElementById('add-vps-host').value = '';
            document.getElementById('add-vps-user').value = 'root';
            document.getElementById('add-vps-pass').value = '';
            document.getElementById('add-vps-key').value = '';
        }
    },

    injectIntoChat: function(text, autoSend = false) {
        const inputArea = document.querySelector('ms-autosize-textarea textarea, textarea.chat-input, textarea[placeholder*="prompt" i], textarea[aria-label*="prompt" i], [contenteditable="true"]');
        if (!inputArea) return;

        if (inputArea.tagName === 'TEXTAREA') {
            inputArea.value = text;
            inputArea.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
            inputArea.innerText = text;
            inputArea.dispatchEvent(new Event('input', { bubbles: true }));
        }
        inputArea.focus();

        if (autoSend) {
            setTimeout(() => {
                const runBtn = document.querySelector('button[aria-label="Run"], button.run-button, ms-run-button button');
                if (runBtn && !runBtn.disabled) runBtn.click();
            }, 150);
        }
    },

    switchLanguage: function(newLang) {
        this.closeLiveWs();
        window.I18N.setLang(newLang);
        const oldPanel = document.getElementById('ai-studio-cockpit-docked');
        const oldFloat = document.getElementById('cockpit-restore-btn');
        if (oldPanel) oldPanel.remove();
        if (oldFloat) oldFloat.remove();
        this.createPanel();
        document.getElementById('tab-status')?.click();
        document.querySelectorAll('.cockpit-run-bar').forEach(b => b.remove());
        document.querySelectorAll('ms-code-block[data-vps-run-ready]').forEach(el => el.removeAttribute('data-vps-run-ready'));
        if (window.CodeRunner) window.CodeRunner.inject();
        if (window.TOC) window.TOC.render();
    },

    createPanel: function() {
        if (document.getElementById('ai-studio-cockpit-docked')) return;

        const leftOffset = this.getStudioLeftOffset();
        const t = window.t;

        const panel = document.createElement('div');
        panel.id = 'ai-studio-cockpit-docked';
        panel.style.cssText = `
            position: fixed !important; top: 56px; left: ${leftOffset}px;
            width: ${this.panelWidth}px; bottom: 0px; z-index: 9999;
            background: #18191a; border-right: 1px solid #3c4043; border-left: 1px solid #2b2c2e;
            display: flex; flex-direction: column; box-shadow: 4px 0 15px rgba(0,0,0,0.5);
            font-family: Roboto, -apple-system, sans-serif; color: #e3e3e3; user-select: none;
        `;

        panel.innerHTML = `
            <div id="cockpit-header" style="padding: 10px 12px; background: #202122; border-bottom: 1px solid #3c4043; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; gap: 6px;">
                <div style="display:flex; align-items:center; gap:6px; min-width:0;">
                    <span id="cockpit-title" style="font-weight:600; font-size:13px; white-space:nowrap;">🛠️ Cockpit</span>
                    <span style="font-size:10px; background:#2a2b2d; color:#80b3ff; padding:1px 5px; border-radius:4px; font-weight:bold;">v3.6</span>
                    <span id="bridge-pill" style="font-size:11px; padding:2px 7px; border-radius:12px; background:#3c2020; color:#ffb4ab; display:flex; align-items:center; gap:4px; cursor:pointer; white-space:nowrap;" title="${t('bridge_check_tip')}">
                        <span id="bridge-dot" style="width:7px; height:7px; border-radius:50%; background:#e53935;"></span>
                        <span id="bridge-text">${t('bridge_off')}</span>
                    </span>
                </div>
                <div style="display:flex; align-items:center; gap:4px; flex-shrink:0;">
                    <button id="btn-toggle-anonymize" style="border:1px solid #2d6a4f; border-radius:4px; cursor:pointer; font-size:11px; padding:2px 6px;">🛡️</button>
                    <button id="btn-toggle-help" title="${t('help_btn_tip')}" style="background:#252628; border:1px solid #444; border-radius:4px; color:#ffd166; cursor:pointer; font-size:11px; padding:2px 6px; font-weight:bold;">❓</button>
                    <button id="btn-insert-ai-guide" title="${t('ai_guide_tip')}" style="background:#1c2d42; border:1px solid #335588; border-radius:4px; color:#80b3ff; cursor:pointer; font-size:11px; padding:2px 7px; font-weight:500;">${t('ai_guide_btn')}</button>
                    <button id="btn-toggle-dock" title="${t('hide_panel_tip')}" style="background:#252628; border:1px solid #444; border-radius:4px; color:#aaa; cursor:pointer; font-size:11px; padding:2px 6px;">✕</button>
                </div>
            </div>
            <div id="tabs-nav" style="display: flex; background: #252628; border-bottom: 1px solid #3c4043; flex-shrink: 0;">
                <button id="tab-toc" style="flex:1; padding:8px 4px; background:#18191a; color:#a8c7fa; border:none; border-bottom:2px solid #a8c7fa; cursor:pointer; font-size:11px; font-weight:500;">${t('tab_chat')}</button>
                <button id="tab-vps" style="flex:1; padding:8px 4px; background:transparent; color:#aaa; border:none; cursor:pointer; font-size:11px; font-weight:500;">${t('tab_term')}</button>
                <button id="tab-snippets" style="flex:1; padding:8px 4px; background:transparent; color:#aaa; border:none; cursor:pointer; font-size:11px; font-weight:500;">${t('tab_cmds')}</button>
                <button id="tab-status" style="flex:1; padding:8px 4px; background:transparent; color:#aaa; border:none; cursor:pointer; font-size:11px; font-weight:500;">${t('tab_bridge')}</button>
            </div>
            <div id="body-toc" style="padding: 12px; display: flex; flex-direction: column; gap: 8px; flex-grow: 1; min-height: 0; overflow: hidden;">
                <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                    <div style="display:flex; align-items:center; gap:6px; background:#252628; border:1px solid #444; border-radius:6px; padding:4px 8px; flex-grow:1;">
                        <span>🔍</span>
                        <input type="text" id="search-toc" placeholder="${t('search_chat')}" style="flex-grow:1; background:transparent; border:none; outline:none; color:#fff; font-size:12px;">
                    </div>
                    <button id="btn-filter-anchors" title="${t('filter_anchors_tip')}" style="cursor:pointer; padding:5px 8px; background:#252628; color:#ffd166; border:1px solid #444; border-radius:6px; font-size:11px;">📌</button>
                </div>
                <div style="display:flex; align-items:center; gap:5px; background:#1b1d20; border:1px solid #2e3238; border-radius:6px; padding:5px 7px; flex-shrink:0;">
                    <span style="font-size:10px; color:#888; margin-right:auto;">${t('handoff_label')}</span>
                    <button id="btn-handoff-save" title="${t('handoff_save_tip')}" style="cursor:pointer; padding:3px 7px; background:#252628; color:#ffd166; border:1px solid #4a4020; border-radius:4px; font-size:10px; font-weight:500;">${t('handoff_save')}</button>
                    <button id="btn-handoff-new" title="${t('handoff_new_tip')}" style="cursor:pointer; padding:3px 7px; background:#1c2d42; color:#80b3ff; border:1px solid #335588; border-radius:4px; font-size:10px; font-weight:500;">${t('handoff_new')}</button>
                    <button id="btn-handoff-load" title="${t('handoff_load_tip')}" style="cursor:pointer; padding:3px 7px; background:#1b3b2b; color:#85e3a1; border:1px solid #2d6a4f; border-radius:4px; font-size:10px; font-weight:500;">${t('handoff_load')}</button>
                </div>
                <div id="pii-vault-box" style="display:flex; flex-direction:column; gap:5px; background:#171d1b; border:1px solid #284236; border-radius:6px; padding:6px 7px; flex-shrink:0;">
                    <div style="display:flex; align-items:center; gap:4px; flex-wrap:wrap;">
                        <button id="btn-pii-mask-input" title="Замаскировать ИНН, компании, ФИО, счета и телефоны в поле ввода чата" style="cursor:pointer; padding:3px 7px; background:#1b3b2b; color:#85e3a1; border:1px solid #2d6a4f; border-radius:4px; font-size:10px; font-weight:500;">🎭 Маскировать ввод</button>
                        <button id="btn-pii-unmask-reply" title="Вернуть реальные реквизиты в последнем ответе ИИ и скопировать в буфер" style="cursor:pointer; padding:3px 7px; background:#1c2d42; color:#80b3ff; border:1px solid #335588; border-radius:4px; font-size:10px; font-weight:500;">🔓 Ответ → буфер</button>
                        <button id="btn-pii-toggle-drawer" style="cursor:pointer; padding:3px 7px; background:#252628; color:#ffd166; border:1px solid #444; border-radius:4px; font-size:10px; margin-left:auto;">🛡️ Сейф (0)</button>
                    </div>
                    <div id="pii-vault-drawer" style="display:none; flex-direction:column; gap:5px; border-top:1px solid #284236; padding-top:5px;">
                        <div style="display:flex; gap:4px;">
                            <input type="text" id="pii-custom-real" placeholder="Реальное значение (напр. ООО Вектор)" style="flex:1; min-width:0; background:#121314; border:1px solid #333; color:#fff; padding:3px 6px; font-size:10px; border-radius:4px;">
                            <input type="text" id="pii-custom-tag" placeholder="Токен (КОМПАНИЯ_2)" style="width:95px; background:#121314; border:1px solid #333; color:#85e3a1; padding:3px 6px; font-size:10px; border-radius:4px;">
                            <button id="btn-pii-add-custom" style="cursor:pointer; padding:3px 7px; background:#1b3b2b; color:#85e3a1; border:1px solid #2d6a4f; border-radius:4px; font-size:10px; font-weight:bold;">+</button>
                            <button id="btn-pii-clear" title="Очистить сейф" style="cursor:pointer; padding:3px 6px; background:#3c2020; color:#ffb4ab; border:1px solid #5c3030; border-radius:4px; font-size:10px;">🗑️</button>
                        </div>
                        <div id="pii-vault-list" style="max-height:110px; overflow-y:auto; font-family:monospace; font-size:10px; color:#ccc; display:flex; flex-direction:column; gap:2px;"></div>
                    </div>
                </div>
                <button id="btn-del-selected-turns" style="cursor:pointer; padding:8px 12px; background:#8c1d18; color:#fff; border:none; border-radius:6px; font-size:12px; font-weight:bold; display:none; flex-shrink:0;">
                    ${t('del_selected_chat', { n: 0 })}
                </button>
                <div id="list-toc" style="flex-grow:1; overflow-y:auto; display:flex; flex-direction:column; gap:6px; padding-right:2px;"></div>
            </div>
            <div id="body-vps" style="padding: 12px; display: none; flex-direction: column; gap: 8px; flex-grow: 1; min-height: 0; overflow: hidden; background: #121314;">
                <div style="display:flex; justify-content:space-between; align-items:center; flex-shrink:0; gap:6px;">
                    <div style="display:flex; align-items:center; gap:4px; overflow-x:auto; min-width:0;">
                        <div id="vps-tabs-bar" style="display:flex; gap:6px;"></div>
                        <button id="btn-add-vps" style="cursor:pointer; padding:3px 8px; background:#252628; color:#a8c7fa; border:1px solid #444; border-radius:4px; font-size:11px; flex-shrink:0;">+ VPS</button>
                    </div>
                    <button id="btn-toggle-live-ssh" style="cursor:pointer; padding:3px 8px; background:#202830; color:#80b3ff; border:1px solid #335588; border-radius:4px; font-size:11px; flex-shrink:0;">${t('live_btn')}</button>
                </div>
                <div id="workspace-git-box" style="display:flex; flex-direction:column; gap:6px; background:#18191b; border:1px solid #2d2f33; border-radius:6px; padding:7px 8px; flex-shrink:0;">
                    <div style="display:flex; align-items:center; gap:5px;">
                        <span style="font-size:12px;">📂</span>
                        <input type="text" id="cwd-input" placeholder="${t('cwd_ph_local')}" style="flex-grow:1; min-width:0; background:#222326; border:1px solid #3c4043; color:#e3e3e3; font-family:monospace; font-size:11px; padding:4px 7px; border-radius:4px; outline:none;">
                        <button id="btn-pick-cwd" title="${t('pick_dir_tip')}" style="cursor:pointer; padding:4px 7px; background:#252628; color:#ffd166; border:1px solid #444; border-radius:4px; font-size:11px;">📁</button>
                        <button id="btn-apply-cwd" title="${t('apply_cwd_tip')}" style="cursor:pointer; padding:4px 7px; background:#1b3b2b; color:#85e3a1; border:1px solid #2d6a4f; border-radius:4px; font-size:11px;">✓</button>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; flex-wrap:wrap;">
                        <span id="git-status-pill" style="font-size:11px; color:#888; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:170px;">${t('no_dir')}</span>
                        <div style="display:flex; gap:4px; flex-shrink:0;">
                            <button id="btn-git-diff-ai" title="${t('diff_ai_tip')}" style="cursor:pointer; padding:3px 7px; background:#1c2d42; color:#80b3ff; border:1px solid #335588; border-radius:4px; font-size:10px; font-weight:500;">${t('diff_ai')}</button>
                            <button id="btn-git-rollback" title="${t('rollback_tip')}" style="cursor:pointer; padding:3px 7px; background:#3c2020; color:#ffb4ab; border:1px solid #5c3030; border-radius:4px; font-size:10px; font-weight:500;">${t('rollback')}</button>
                            <button id="btn-bundle-code" title="${t('bundle_tip')}" style="cursor:pointer; padding:3px 7px; background:#252628; color:#ffd166; border:1px solid #4a4020; border-radius:4px; font-size:10px; font-weight:500;">${t('bundle')}</button>
                        </div>
                    </div>
                </div>
                <div id="vps-add-form" style="display:none; flex-direction:column; gap:6px; background:#1c1d1f; border:1px solid #444; border-radius:6px; padding:10px; flex-shrink:0;">
                    <div id="form-vps-title" style="font-weight:bold; font-size:11px; color:#a8c7fa;">${t('vps_params')}</div>
                    <input type="text" id="add-vps-name" placeholder="${t('vps_name_ph')}" style="background:#252628; border:1px solid #444; color:#fff; padding:4px; font-size:11px;">
                    <input type="text" id="add-vps-host" placeholder="${t('vps_ip_ph')}" style="background:#252628; border:1px solid #444; color:#fff; padding:4px; font-size:11px;">
                    <input type="text" id="add-vps-user" placeholder="${t('vps_user_ph')}" style="background:#252628; border:1px solid #444; color:#fff; padding:4px; font-size:11px;">
                    <input type="password" id="add-vps-pass" placeholder="${t('vps_pass_ph')}" style="background:#252628; border:1px solid #444; color:#fff; padding:4px; font-size:11px;">
                    <input type="text" id="add-vps-key" placeholder="${t('vps_key_ph')}" style="background:#252628; border:1px solid #444; color:#fff; padding:4px; font-size:11px;">
                    <div id="test-conn-status" style="font-size:11px; min-height:14px;"></div>
                    <div style="display:flex; justify-content:space-between;">
                        <button id="btn-test-conn" style="cursor:pointer; padding:3px 8px; background:#252628; color:#a8c7fa; border:1px solid #444; font-size:11px;">${t('vps_test')}</button>
                        <div>
                            <button id="btn-cancel-vps" style="cursor:pointer; padding:3px 8px; background:#252628; color:#aaa; border:1px solid #444; font-size:11px;">${t('cancel')}</button>
                            <button id="btn-save-vps" style="cursor:pointer; padding:3px 10px; background:#1b3b2b; color:#85e3a1; border:1px solid #2d6a4f; font-size:11px; font-weight:bold;">${t('save')}</button>
                        </div>
                    </div>
                </div>
                <div style="display:flex; gap:5px; flex-shrink:0;">
                    <input type="text" id="cmd-input" placeholder="${t('cmd_ph')}" style="flex-grow:1; min-width:0; background:#1e1f20; border:1px solid #333; color:#4af626; font-family:monospace; font-size:12px; padding:6px 8px; border-radius:4px; outline:none;">
                    <button id="btn-run-cmd" style="cursor:pointer; padding:6px 10px; background:#1b3b2b; color:#85e3a1; border:1px solid #2d6a4f; border-radius:4px; font-size:11px; font-weight:bold; flex-shrink:0;">${t('run_btn')}</button>
                    <button id="btn-stop-exec" style="display:none; cursor:pointer; padding:6px 9px; background:#8c1d18; color:#fff; border:1px solid #b3261e; border-radius:4px; font-size:11px; font-weight:bold; flex-shrink:0;">${t('stop_btn')}</button>
                </div>
                <div id="agent-bar" style="display:flex; align-items:center; justify-content:space-between; gap:6px; background:#191824; border:1px solid #332c4d; border-radius:6px; padding:4px 8px; flex-shrink:0;">
                    <label style="display:flex; align-items:center; gap:5px; cursor:pointer; font-size:11px; color:#c8b6ff;">
                        <input type="checkbox" id="chk-agent-mode" style="cursor:pointer; margin:0; accent-color:#9d7bff;">
                        <span>${t('agent_auto')}</span>
                    </label>
                    <div style="display:flex; align-items:center; gap:5px;">
                        <select id="agent-max-steps" style="background:#232038; color:#c8b6ff; border:1px solid #4c3f7a; border-radius:4px; font-size:10px; padding:2px 4px;">
                            <option value="2">${t('agent_steps', { n: 2 })}</option>
                            <option value="3" selected>${t('agent_steps', { n: 3 })}</option>
                            <option value="5">${t('agent_steps_5')}</option>
                        </select>
                        <span id="agent-status-badge" style="font-size:10px; color:#888;">${t('agent_ready')}</span>
                        <button id="btn-agent-stop" style="display:none; cursor:pointer; padding:2px 6px; background:#8c1d18; color:#fff; border:none; border-radius:4px; font-size:10px; font-weight:bold;">⛔</button>
                    </div>
                </div>
                <textarea id="terminal-out" readonly style="flex-grow:1; min-height:0; background:#0d0e0f; color:#4af626; font-family:monospace; font-size:12px; padding:10px; border:1px solid #333; border-radius:6px; resize:none; white-space:pre-wrap; word-break:break-word; outline:none; user-select:text;" placeholder="${t('term_ph')}"></textarea>
                <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; flex-shrink:0;">
                    <span id="live-indicator" style="font-size:10px; color:#888;">${t('mode_commands')}</span>
                    <div style="display:flex; gap:6px;">
                        <button id="btn-term-send" style="cursor:pointer; padding:4px 8px; background:#252628; color:#a8c7fa; border:1px solid #444; border-radius:4px; font-size:11px;">${t('term_insert')}</button>
                        <button id="btn-term-ask-ai" style="cursor:pointer; padding:4px 8px; background:#1b3b2b; color:#85e3a1; border:1px solid #2d6a4f; border-radius:4px; font-size:11px; font-weight:bold;">${t('term_ask_ai')}</button>
                    </div>
                </div>
            </div>
            <div id="body-snippets" style="padding: 12px; display: none; flex-direction: column; gap: 8px; flex-grow: 1; min-height: 0; overflow: hidden; background: #141516;">
                <div style="display:flex; gap:6px; align-items:center; flex-shrink:0;">
                    <div style="display:flex; align-items:center; gap:6px; background:#252628; border:1px solid #444; border-radius:6px; padding:4px 8px; flex-grow:1;">
                        <span>🔍</span>
                        <input type="text" id="search-snippets" placeholder="${t('snip_search')}" style="flex-grow:1; background:transparent; border:none; outline:none; color:#fff; font-size:12px;">
                    </div>
                    <button id="btn-add-snippet" style="cursor:pointer; padding:5px 9px; background:#1b3b2b; color:#85e3a1; border:1px solid #2d6a4f; border-radius:6px; font-size:11px; font-weight:bold; flex-shrink:0;">${t('snip_add')}</button>
                </div>
                <div id="snippet-cats-bar" style="display:flex; gap:5px; overflow-x:auto; flex-shrink:0; padding-bottom:2px;"></div>
                <div id="snippet-form" style="display:none; flex-direction:column; gap:6px; background:#1c1d1f; border:1px solid #444; border-radius:6px; padding:10px; flex-shrink:0;">
                    <div id="snippet-form-title" style="font-weight:bold; font-size:11px; color:#a8c7fa;">${t('snip_new')}</div>
                    <input type="text" id="snip-title" placeholder="${t('snip_title_ph')}" style="background:#252628; border:1px solid #444; color:#fff; padding:5px; font-size:11px; border-radius:4px;">
                    <div style="display:flex; gap:6px;">
                        <input type="text" id="snip-cat" placeholder="${t('snip_cat_ph')}" style="flex:1; background:#252628; border:1px solid #444; color:#fff; padding:5px; font-size:11px; border-radius:4px;">
                        <select id="snip-lang" style="background:#252628; border:1px solid #444; color:#fff; padding:5px; font-size:11px; border-radius:4px;">
                            <option value="shell">shell / cmd</option>
                            <option value="powershell">powershell</option>
                            <option value="bash">bash</option>
                            <option value="python">python</option>
                        </select>
                    </div>
                    <textarea id="snip-cmd" rows="3" placeholder="${t('snip_cmd_ph')}" style="background:#121314; border:1px solid #444; color:#85e3a1; font-family:monospace; padding:6px; font-size:11px; border-radius:4px; resize:vertical;"></textarea>
                    <div style="display:flex; justify-content:flex-end; gap:6px;">
                        <button id="btn-cancel-snippet" style="cursor:pointer; padding:4px 9px; background:#252628; color:#aaa; border:1px solid #444; border-radius:4px; font-size:11px;">${t('cancel')}</button>
                        <button id="btn-save-snippet" style="cursor:pointer; padding:4px 10px; background:#1b3b2b; color:#85e3a1; border:1px solid #2d6a4f; border-radius:4px; font-size:11px; font-weight:bold;">${t('save')}</button>
                    </div>
                </div>
                <div id="snippet-list" style="flex-grow:1; overflow-y:auto; display:flex; flex-direction:column; gap:6px; padding-right:2px;"></div>
                <div style="display:flex; justify-content:space-between; align-items:center; flex-shrink:0; border-top:1px solid #2b2c2e; padding-top:6px;">
                    <span style="font-size:10px; color:#777;">${t('snip_vars_hint')}</span>
                    <div style="display:flex; gap:6px;">
                        <button id="btn-export-snippets" style="cursor:pointer; padding:3px 7px; background:#252628; color:#a8c7fa; border:1px solid #444; border-radius:4px; font-size:10px;">${t('snip_export')}</button>
                        <button id="btn-import-snippets" style="cursor:pointer; padding:3px 7px; background:#252628; color:#ffd166; border:1px solid #444; border-radius:4px; font-size:10px;">${t('snip_import')}</button>
                    </div>
                </div>
            </div>
            <div id="body-status" style="padding: 14px; display: none; flex-direction: column; gap: 12px; flex-grow: 1; background: #161718; font-size: 12px;">
                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #333; padding-bottom:6px;">
                    <span style="font-weight:bold; font-size:13px; color:#a8c7fa;">Bridge Server (Go Native)</span>
                    <span style="font-size:10px; color:#888;">v3.6</span>
                </div>
                <div style="display:flex; gap:8px;">
                    <button id="btn-bridge-start" style="cursor:pointer; flex:1; padding:8px; background:#1b3b2b; color:#85e3a1; border:1px solid #2d6a4f; border-radius:6px; font-weight:bold;">${t('btn_start')}</button>
                    <button id="btn-bridge-stop" style="cursor:pointer; flex:1; padding:8px; background:#3c2020; color:#ffb4ab; border:1px solid #5c3030; border-radius:6px; font-weight:bold;">${t('btn_stop')}</button>
                    <button id="btn-restart-bridge" style="cursor:pointer; flex:1; padding:8px; background:#1c2d42; color:#58a6ff; border:1px solid #388bfd; border-radius:6px; font-weight:bold;">${t('btn_restart')}</button>
                </div>
                <div id="bridge-health-info" style="color:#ccc; line-height:1.6; background:#202122; border:1px solid #333; border-radius:6px; padding:10px;">${t('checking')}</div>
                <div style="display:flex; justify-content:space-between; align-items:center; background:#202122; border:1px solid #333; border-radius:6px; padding:8px 10px;">
                    <span style="color:#ccc;">${t('lang_label')}</span>
                    <div style="display:flex; gap:6px;">
                        <button id="btn-lang-ru" style="cursor:pointer; padding:3px 9px; border-radius:4px; font-size:11px; border:1px solid ${window.I18N.lang === 'ru' ? '#388bfd' : '#444'}; background:${window.I18N.lang === 'ru' ? '#1c2d42' : '#252628'}; color:${window.I18N.lang === 'ru' ? '#80b3ff' : '#aaa'};">RU</button>
                        <button id="btn-lang-en" style="cursor:pointer; padding:3px 9px; border-radius:4px; font-size:11px; border:1px solid ${window.I18N.lang === 'en' ? '#388bfd' : '#444'}; background:${window.I18N.lang === 'en' ? '#1c2d42' : '#252628'}; color:${window.I18N.lang === 'en' ? '#80b3ff' : '#aaa'};">EN</button>
                    </div>
                </div>
                <div style="background:#1b1c1d; border:1px solid #2d2e30; border-radius:6px; padding:10px; font-family:monospace; font-size:11px; color:#888;">
                    <div style="color:#aaa; font-weight:bold; margin-bottom:4px;">${t('proj_loc')}</div>
                    <div>%COCKPIT_HOME% (Go Native + Office CLI)</div>
                    <div style="margin-top:4px; color:#666;">${t('proj_bin')}</div>
                </div>
            </div>
            <div id="body-help" style="padding: 12px; display: none; flex-direction: column; gap: 8px; flex-grow: 1; min-height: 0; overflow: hidden; background: #141516;">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-shrink:0;">
                    <span style="font-weight:bold; font-size:13px; color:#ffd166;">${t('help_title')}</span>
                    <button id="btn-help-close" style="cursor:pointer; padding:3px 8px; background:#252628; color:#a8c7fa; border:1px solid #444; border-radius:4px; font-size:11px;">${t('help_close')}</button>
                </div>
                <div style="display:flex; align-items:center; gap:6px; background:#252628; border:1px solid #444; border-radius:6px; padding:4px 8px; flex-shrink:0;">
                    <span>🔍</span>
                    <input type="text" id="search-help" placeholder="${t('help_search')}" style="flex-grow:1; background:transparent; border:none; outline:none; color:#fff; font-size:12px;">
                </div>
                <div id="help-list" style="flex-grow:1; overflow-y:auto; display:flex; flex-direction:column; gap:8px; padding-right:2px;"></div>
            </div>
        `;

        const resizer = document.createElement('div');
        resizer.style.cssText = 'position: absolute; top: 0; right: -4px; width: 8px; bottom: 0; cursor: col-resize; z-index: 10000;';
        panel.appendChild(resizer);
        document.body.appendChild(panel);

        const floatBtn = document.createElement('button');
        floatBtn.id = 'cockpit-restore-btn';
        floatBtn.title = t('show_panel_tip');
        floatBtn.textContent = '🛠️ Cockpit';
        floatBtn.style.cssText = `
            position: fixed; bottom: 16px; right: 16px; z-index: 9999;
            display: none; align-items: center; gap: 6px; padding: 7px 12px;
            background: #202122; color: #a8c7fa; border: 1px solid #3c4043;
            border-radius: 20px; font-size: 12px; font-weight: 600; cursor: pointer;
            box-shadow: 0 4px 12px rgba(0,0,0,0.6);
        `;
        floatBtn.onclick = () => this.toggleDock(false);
        document.body.appendChild(floatBtn);

        let isResizing = false;
        resizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            isResizing = true;
            document.body.style.cursor = 'col-resize';
        });
        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const navLeft = parseInt(panel.style.left || '0', 10);
            const newW = e.clientX - navLeft;
            if (newW >= 260 && newW <= 800) {
                this.panelWidth = newW;
                panel.style.width = `${newW}px`;
                this.updateDockLayout();
            }
        });
        document.addEventListener('mouseup', () => {
            if (!isResizing) return;
            isResizing = false;
            document.body.style.cursor = 'default';
            localStorage.setItem('cockpit_width', this.panelWidth.toString());
        });

        if (!window._cockpitResizeBound) {
            window._cockpitResizeBound = true;
            window.addEventListener('resize', () => this.updateDockLayout());
            if (typeof ResizeObserver !== 'undefined') {
                const ro = new ResizeObserver(() => this.updateDockLayout());
                ro.observe(document.body);
            }
            setInterval(() => {
                this.updateHealthCheck();
                this.updateDockLayout();
            }, 4000);
        }

        panel.querySelector('#btn-toggle-dock').onclick = () => this.toggleDock(true);

        if (!window._cockpitHotkeyBound) {
            window._cockpitHotkeyBound = true;
            document.addEventListener('keydown', (e) => {
                if (e.altKey && !e.ctrlKey && !e.shiftKey && e.code === 'KeyC') {
                    e.preventDefault();
                    window.UI.toggleDock();
                }
            });
        }

        this.bindEvents(panel);
        this.syncAnonymizeUi();
        this.syncPiiVaultUi();
        this.syncHandoffBadge();
        this.renderVpsTabs();
        this.syncCwdUi();
        this.renderSnippets();
        this.renderHelp();
        this.updateHealthCheck();
        this.toggleDock(this.isHidden);
    },

    bindEvents: function(panel) {
        const tToc = panel.querySelector('#tab-toc');
        const tVps = panel.querySelector('#tab-vps');
        const tSnip = panel.querySelector('#tab-snippets');
        const tStatus = panel.querySelector('#tab-status');
        const bToc = panel.querySelector('#body-toc');
        const bVps = panel.querySelector('#body-vps');
        const bSnip = panel.querySelector('#body-snippets');
        const bStatus = panel.querySelector('#body-status');
        const bHelp = panel.querySelector('#body-help');
        const btnHelp = panel.querySelector('#btn-toggle-help');

        const setTab = (btn, body) => {
            this.helpOpen = false;
            this.activeTabId = btn.id;
            if (bHelp) bHelp.style.display = 'none';
            if (btnHelp) { btnHelp.style.background = '#252628'; btnHelp.style.borderColor = '#444'; }
            [tToc, tVps, tSnip, tStatus].forEach(b => { b.style.background = 'transparent'; b.style.color = '#aaa'; b.style.borderBottom = 'none'; });
            [bToc, bVps, bStatus, bSnip].forEach(b => b.style.display = 'none');
            btn.style.background = '#18191a'; btn.style.color = '#a8c7fa'; btn.style.borderBottom = '2px solid #a8c7fa';
            body.style.display = 'flex';
        };

        tToc.onclick = () => { setTab(tToc, bToc); this.syncHandoffBadge(); };
        tVps.onclick = () => { setTab(tVps, bVps); this.renderVpsTabs(); this.syncCwdUi(); };
        tSnip.onclick = () => { setTab(tSnip, bSnip); this.renderSnippets(); };
        tStatus.onclick = () => { setTab(tStatus, bStatus); this.updateHealthCheck(); };
        panel.querySelector('#bridge-pill').onclick = () => this.updateHealthCheck();

        const toggleHelp = (force = null) => {
            this.helpOpen = force !== null ? force : !this.helpOpen;
            if (this.helpOpen) {
                [bToc, bVps, bSnip, bStatus].forEach(b => b.style.display = 'none');
                bHelp.style.display = 'flex';
                btnHelp.style.background = '#3a3215';
                btnHelp.style.borderColor = '#ffd166';
                this.renderHelp();
            } else {
                document.getElementById(this.activeTabId || 'tab-toc')?.click();
            }
        };
        btnHelp.onclick = () => toggleHelp();
        panel.querySelector('#btn-help-close').onclick = () => toggleHelp(false);
        panel.querySelector('#search-help').addEventListener('input', () => this.renderHelp());

        panel.querySelector('#btn-lang-ru').onclick = () => this.switchLanguage('ru');
        panel.querySelector('#btn-lang-en').onclick = () => this.switchLanguage('en');

        const btnPiiMaskInput = panel.querySelector('#btn-pii-mask-input');
        if (btnPiiMaskInput) {
            btnPiiMaskInput.onclick = () => {
                if (!window.PiiVault) return;
                const inputArea = document.querySelector('ms-autosize-textarea textarea, textarea.chat-input, textarea[placeholder*="prompt" i], textarea[aria-label*="prompt" i], [contenteditable="true"]');
                if (!inputArea) return;
                const raw = inputArea.tagName === 'TEXTAREA' ? inputArea.value : inputArea.innerText;
                if (!raw || !raw.trim()) return;
                const res = window.PiiVault.mask(raw);
                if (inputArea.tagName === 'TEXTAREA') {
                    inputArea.value = res.text;
                    inputArea.dispatchEvent(new Event('input', { bubbles: true }));
                } else {
                    inputArea.innerText = res.text;
                    inputArea.dispatchEvent(new Event('input', { bubbles: true }));
                }
                btnPiiMaskInput.textContent = `✅ Скрыто: ${res.count}`;
                setTimeout(() => { btnPiiMaskInput.textContent = '🎭 Маскировать ввод'; }, 1800);
            };
        }

        const btnPiiUnmaskReply = panel.querySelector('#btn-pii-unmask-reply');
        if (btnPiiUnmaskReply) {
            btnPiiUnmaskReply.onclick = async () => {
                if (!window.PiiVault) return;
                const modelTurns = Array.from(document.querySelectorAll('ms-chat-turn')).filter(t => t.querySelector('ms-model-turn, .model'));
                if (!modelTurns.length) return;
                const last = modelTurns[modelTurns.length - 1].cloneNode(true);
                last.querySelectorAll('.cockpit-turn-selector, .cockpit-run-bar, button, mat-icon').forEach(el => el.remove());
                const restored = window.PiiVault.unmask((last.textContent || '').trim());
                try { await navigator.clipboard.writeText(restored); } catch (e) {}
                btnPiiUnmaskReply.textContent = '✅ Скопировано';
                setTimeout(() => { btnPiiUnmaskReply.textContent = '🔓 Ответ → буфер'; }, 1800);
            };
        }

        const btnPiiDrawer = panel.querySelector('#btn-pii-toggle-drawer');
        const piiDrawer = panel.querySelector('#pii-vault-drawer');
        if (btnPiiDrawer && piiDrawer) {
            btnPiiDrawer.onclick = () => {
                const open = piiDrawer.style.display === 'flex';
                piiDrawer.style.display = open ? 'none' : 'flex';
                if (!open) this.syncPiiVaultUi();
            };
        }

        const btnPiiAdd = panel.querySelector('#btn-pii-add-custom');
        if (btnPiiAdd) {
            btnPiiAdd.onclick = () => {
                if (!window.PiiVault) return;
                const realInp = document.getElementById('pii-custom-real');
                const tagInp = document.getElementById('pii-custom-tag');
                const realVal = (realInp?.value || '').trim();
                if (!realVal) return;
                window.PiiVault.addCustom(realVal, tagInp?.value || '');
                if (realInp) realInp.value = '';
                if (tagInp) tagInp.value = '';
            };
        }

        const btnPiiClear = panel.querySelector('#btn-pii-clear');
        if (btnPiiClear) {
            btnPiiClear.onclick = () => {
                if (window.PiiVault && confirm('Очистить все сохранённые соответствия в сейфе реквизитов?')) {
                    window.PiiVault.clear();
                }
            };
        }

        const btnAnon = panel.querySelector('#btn-toggle-anonymize');
        if (btnAnon) {
            btnAnon.onclick = () => {
                if (!window.Utils) return;
                window.Utils.setAnonymize(!window.Utils.anonymizeEnabled);
                this.syncAnonymizeUi();
        this.syncPiiVaultUi();
            };
        }

        const stepsSel = panel.querySelector('#agent-max-steps');
        if (stepsSel) {
            const savedSteps = localStorage.getItem('cockpit_agent_steps');
            if (savedSteps) stepsSel.value = savedSteps;
            stepsSel.onchange = () => localStorage.setItem('cockpit_agent_steps', stepsSel.value);
        }
        panel.querySelector('#btn-stop-exec').onclick = () => window.VPS.stopActiveExec();
        panel.querySelector('#btn-agent-stop').onclick = () => { if (window.Agent) window.Agent.stop(); };

        const btnHandoffSave = panel.querySelector('#btn-handoff-save');
        if (btnHandoffSave) {
            btnHandoffSave.onclick = async () => {
                if (!window.Utils) return;
                const res = window.Utils.buildChatHandoff();
                if (!res) return alert(window.t('handoff_empty'));
                if (typeof chrome !== 'undefined' && chrome.storage?.local) {
                    chrome.storage.local.set({ cockpit_handoff: res }, () => this.syncHandoffBadge());
                }
                try { await navigator.clipboard.writeText(res.text); } catch(e) {}
                btnHandoffSave.textContent = `✅ ${window.Utils.formatTokens(res.tokens)}`;
                setTimeout(() => { btnHandoffSave.textContent = window.t('handoff_save'); }, 2200);
            };
        }

        const btnHandoffNew = panel.querySelector('#btn-handoff-new');
        if (btnHandoffNew) {
            btnHandoffNew.onclick = () => {
                window.location.href = 'https://aistudio.google.com/prompts/new_chat';
            };
        }

        const btnHandoffLoad = panel.querySelector('#btn-handoff-load');
        if (btnHandoffLoad) {
            btnHandoffLoad.onclick = () => {
                if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
                chrome.storage.local.get(['cockpit_handoff'], (res) => {
                    if (res.cockpit_handoff && res.cockpit_handoff.text) {
                        this.injectIntoChat(res.cockpit_handoff.text, false);
                    }
                });
            };
        }

        const btnAiGuide = panel.querySelector('#btn-insert-ai-guide');
        if (btnAiGuide) {
            btnAiGuide.onclick = () => {
                const target = window.VPS.activeServer || 'LOCAL';
                const cwd = window.VPS.getActiveCwd();
                const isRu = window.I18N.lang === 'ru';
                const toolKey = 'cockpit' + '_tools';
                const guide = isRu ? [
                    'Ты работаешь через панель AI Cockpit, встроенную в AI Studio.',
                    'Над каждым твоим блоком кода панель автоматически добавляет кнопку запуска по тегу языка:',
                    `- \`\`\`json с полем "${toolKey}" (рекомендуется для кода и файлов!) — запускает встроенного Go File-Agent внутри рабочей папки:`,
                    '  • {"tool":"TREE","path":".","depth":3} — дерево файлов',
                    '  • {"tool":"GREP","query":"текст","path":"."} — поиск по коду',
                    '  • {"tool":"OUTLINE","path":"file.js"} — карта функций/блоков файла со строками (Lstart-Lend)',
                    '  • {"tool":"READ_LINES","path":"file.go","start":1,"end":120} — точечное чтение строк',
                    '  • {"tool":"REPLACE_LINES","path":"file.js","start":40,"end":65,"content":"новый блок"} — замена блока по строкам (с авто-проверкой синтаксиса)',
                    '  • {"tool":"PATCH_FILE","path":"file.go","search":"точный старый кусок","replace":"новый кусок"} — точечная правка (с авто-проверкой синтаксиса)',
                    '  • {"tool":"WRITE_FILE","path":"new.txt","content":"..."} — создание файла',
                    '  • {"tool":"CHECK_FILE","path":"file.yaml"} — проверка синтаксиса (JSON, Go, JS, Python, PowerShell, YAML)',
                    '  • {"tool":"RUN_CMD","cmd":"go test ./...","lang":"powershell"} — запуск сборки/теста',
                    '  • Office (Excel/Word): XLSX_INFO, XLSX_READ (sheet, range), XLSX_WRITE (rows:[[...]], start_row, header_row, cells, merges — авто-границы и ширина), DOCX_CREATE (title, subtitle, header_right:[...], blocks:[{"type":"heading|text|center|right|table","text":"...","rows":[[...]],"border":true|false}]), DOCX_READ, DOCX_REPLACE (out_path, map:{"{{tag}}":"val"}) — токены [КОМПАНИЯ_1]/[ИНН_1]/[ФИО_1] подставляются автоматически; NEVER use WRITE_FILE for .docx/.xlsx! NEVER mix DOCX_READ and DOCX_REPLACE in one block — read first, replace on next step.',
                    '  • Desktop RPA: WIN_LIST, WIN_FOCUS, UI_TREE, MOUSE_CLICK, MOUSE_DRAG_PATH (strokes:[[[x,y],...]]), KEY_TYPE, SCREENSHOT_WIN (window:"Paint")',
                    '- ```powershell — скрипт на Windows ПК ([LOCAL]) через powershell.exe (UTF-8).',
                    '- ```python — отдельный Python-скрипт (на [LOCAL] или python3 на VPS).',
                    '- ```bash / ```shell — команды на Linux VPS по SSH (или .bat на [LOCAL]).',
                    '- ```javascript — выполнение во вкладке браузера через chrome.debugger (вывод через console.log).',
                    '',
                    'Правила работы:',
                    `1. Для изучения проекта и правок файлов используй Go File-Agent (\`\`\`json с {"${toolKey}":[...]}) — сначала TREE/GREP/OUTLINE/READ_LINES, затем REPLACE_LINES или PATCH_FILE.`,
                    '2. Разделяй крупные блоки и функции понятными комментариями (// === Название: описание ===), чтобы OUTLINE строил чистую карту файла, а правки шли блоками через REPLACE_LINES.',
                    '3. Всегда ставь точный тег языка; код должен быть полностью автономным (без Read-Host, pause, nano/vim и без "$ ").',
                    '4. Вывод делай кратким.',
                    `Текущая цель: [${target}]${cwd ? ` (рабочая папка: ${cwd})` : ''}.`,
                    '',
                    'Моя задача: '
                ].join('\n') : [
                    'You are working with AI Cockpit inside Google AI Studio.',
                    'Every code block gets an execution button based on its tag:',
                    `- \`\`\`json with "${toolKey}" (preferred for codebase work!) — runs the built-in Go File-Agent inside working dir:`,
                    '  • {"tool":"TREE","path":".","depth":3} — project tree',
                    '  • {"tool":"GREP","query":"text","path":"."} — search codebase',
                    '  • {"tool":"OUTLINE","path":"file.js"} — map of functions/blocks with line numbers (Lstart-Lend)',
                    '  • {"tool":"READ_LINES","path":"file.go","start":1,"end":120} — read specific lines',
                    '  • {"tool":"REPLACE_LINES","path":"file.js","start":40,"end":65,"content":"new block"} — replace block by lines (with auto-lint)',
                    '  • {"tool":"PATCH_FILE","path":"file.go","search":"exact unique snippet","replace":"new snippet"} — surgical patch (with auto-lint)',
                    '  • {"tool":"WRITE_FILE","path":"new.txt","content":"..."} — write/create file',
                    '  • {"tool":"CHECK_FILE","path":"file.yaml"} — syntax check (JSON, Go, JS, Python, PowerShell, YAML)',
                    '  • {"tool":"RUN_CMD","cmd":"go test ./...","lang":"powershell"} — run build/test',
                    '  • Office (Excel/Word): XLSX_INFO, XLSX_READ (sheet, range), XLSX_WRITE (rows:[[...]], start_row, header_row, cells, merges — авто-границы и ширина), DOCX_CREATE (title, subtitle, header_right:[...], blocks:[{"type":"heading|text|center|right|table","text":"...","rows":[[...]],"border":true|false}]), DOCX_READ, DOCX_REPLACE (out_path, map:{"{{tag}}":"val"}) — токены [КОМПАНИЯ_1]/[ИНН_1]/[ФИО_1] подставляются автоматически; NEVER use WRITE_FILE for .docx/.xlsx! NEVER mix DOCX_READ and DOCX_REPLACE in one block — read first, replace on next step.',
                    '  • Desktop RPA: WIN_LIST, WIN_FOCUS, UI_TREE, MOUSE_CLICK, MOUSE_DRAG_PATH (strokes:[[[x,y],...]]), KEY_TYPE, SCREENSHOT_WIN (window:"Paint")',
                    '- ```powershell — runs on Windows PC ([LOCAL]) via powershell.exe (UTF-8).',
                    '- ```python — standalone Python script ([LOCAL] or python3 on VPS).',
                    '- ```bash / ```shell — Linux VPS via SSH (or .bat on [LOCAL]).',
                    '- ```javascript — runs in active browser tab via chrome.debugger (use console.log).',
                    '',
                    'Rules:',
                    `1. Prefer Go File-Agent (\`\`\`json {"${toolKey}":[...]}) for inspecting and patching files — use TREE/GREP/OUTLINE/READ_LINES first, then REPLACE_LINES or PATCH_FILE.`,
                    '2. Structure large code into commented sections (// === Name: description ===) so OUTLINE builds a clear map and edits use REPLACE_LINES cleanly.',
                    '3. Always include exact language tags; keep blocks self-contained and non-interactive (no Read-Host, pause, nano/vim, or "$ " prefixes).',
                    '4. Keep output concise.',
                    `Active target: [${target}]${cwd ? ` (working dir: ${cwd})` : ''}.`,
                    '',
                    'My task: '
                ].join('\n');
                this.injectIntoChat(guide, false);
            };
        }

        const cwdInput = panel.querySelector('#cwd-input');
        const applyCwd = () => {
            window.VPS.setActiveCwd(cwdInput.value);
            this.refreshGitStatus();
        };
        panel.querySelector('#btn-apply-cwd').onclick = applyCwd;
        cwdInput.onkeydown = (e) => { if (e.key === 'Enter') applyCwd(); };

        panel.querySelector('#btn-pick-cwd').onclick = async () => {
            const btn = panel.querySelector('#btn-pick-cwd');
            btn.disabled = true;
            try {
                const res = await window.VPS.pickLocalDir();
                if (res && res.path) { cwdInput.value = res.path; applyCwd(); }
            } catch(e) {
                alert(window.t('vps_no_bridge'));
            } finally {
                btn.disabled = false;
            }
        };

        panel.querySelector('#btn-git-diff-ai').onclick = async () => {
            const btn = panel.querySelector('#btn-git-diff-ai');
            btn.textContent = '⏳...';
            try {
                const res = await window.VPS.gitAction('diff');
                if (!res.ok) return alert(res.error || 'Git diff error');
                if (!res.diff) return alert(window.t('no_diff'));
                const cwd = window.VPS.getActiveCwd();
                const scr = window.Utils ? window.Utils.scrubSecrets(res.diff) : { text: res.diff, count: 0 };
                const note = scr.count > 0 ? ` (🛡️ ${scr.count})` : '';
                const prompt = window.t('diff_prompt', { cwd, srv: window.VPS.activeServer, note, diff: scr.text });
                this.injectIntoChat(prompt, false);
            } catch(e) {
                alert(e.message);
            } finally {
                btn.textContent = window.t('diff_ai');
            }
        };

        panel.querySelector('#btn-git-rollback').onclick = async () => {
            const cwd = window.VPS.getActiveCwd();
            if (!confirm(window.t('confirm_rollback', { cwd }))) return;
            try {
                const res = await window.VPS.gitAction('rollback');
                const termOut = document.getElementById('terminal-out');
                if (termOut) {
                    termOut.value += `\n$ [${window.VPS.activeServer}] git checkout -- .\n${res.output || res.error || 'OK'}\n`;
                    termOut.scrollTop = termOut.scrollHeight;
                }
                this.refreshGitStatus();
            } catch(e) {
                alert(e.message);
            }
        };

        panel.querySelector('#btn-bundle-code').onclick = async () => {
            const btn = panel.querySelector('#btn-bundle-code');
            const cwd = window.VPS.getActiveCwd();
            if (!cwd) return alert(window.t('need_cwd'));
            btn.textContent = window.t('bundle_collecting');
            btn.disabled = true;
            try {
                const res = await window.VPS.bundleProject();
                if (!res.ok) return alert(res.error || 'Bundle error');
                const scr = window.Utils ? window.Utils.scrubSecrets(res.bundle) : { text: res.bundle, count: 0 };
                const tok = window.Utils ? window.Utils.formatTokens(window.Utils.estimateTokens(scr.text)) : `${res.size_kb} KB`;
                const secNote = scr.count > 0 ? `, 🛡️ ${scr.count}` : '';
                const prompt = window.t('bundle_prompt', { cwd, files: res.files_count, tok, sec: secNote, bundle: scr.text });
                this.injectIntoChat(prompt, false);
                btn.textContent = `✅ ~${tok}`;
                setTimeout(() => { btn.textContent = window.t('bundle'); }, 2200);
            } catch(e) {
                alert(e.message);
                btn.textContent = window.t('bundle');
            } finally {
                btn.disabled = false;
            }
        };

        panel.querySelector('#search-snippets').addEventListener('input', () => this.renderSnippets());
        panel.querySelector('#btn-add-snippet').onclick = () => this.openSnippetForm();
        panel.querySelector('#btn-cancel-snippet').onclick = () => { document.getElementById('snippet-form').style.display = 'none'; };

        panel.querySelector('#btn-save-snippet').onclick = () => {
            const title = document.getElementById('snip-title').value.trim();
            const category = document.getElementById('snip-cat').value.trim() || 'Custom';
            const lang = document.getElementById('snip-lang').value;
            const cmd = document.getElementById('snip-cmd').value.trim();
            if (!title || !cmd) return alert(window.t('snip_fill'));

            if (this.editingSnippetId) {
                const idx = window.VPS.snippets.findIndex(s => s.id === this.editingSnippetId);
                if (idx !== -1) window.VPS.snippets[idx] = { id: this.editingSnippetId, title, category, lang, cmd };
            } else {
                window.VPS.snippets.unshift({ id: 'sn_' + Date.now(), title, category, lang, cmd });
            }
            window.VPS.saveSnippets();
            document.getElementById('snippet-form').style.display = 'none';
            this.renderSnippets();
        };

        panel.querySelector('#btn-export-snippets').onclick = async () => {
            const json = JSON.stringify(window.VPS.snippets || [], null, 2);
            try {
                await navigator.clipboard.writeText(json);
                alert(window.t('snip_exported', { n: (window.VPS.snippets || []).length }));
            } catch(e) {
                prompt('JSON:', json);
            }
        };

        panel.querySelector('#btn-import-snippets').onclick = () => {
            const raw = prompt(window.t('snip_import_prompt'));
            if (!raw) return;
            try {
                const parsed = JSON.parse(raw);
                if (!Array.isArray(parsed)) throw new Error('Expected JSON array');
                const valid = parsed.filter(x => x && x.title && x.cmd).map((x, i) => ({
                    id: x.id || `imp_${Date.now()}_${i}`,
                    title: String(x.title),
                    category: String(x.category || 'Custom'),
                    lang: String(x.lang || 'shell'),
                    cmd: String(x.cmd)
                }));
                window.VPS.snippets = [...valid, ...(window.VPS.snippets || [])];
                window.VPS.saveSnippets();
                this.renderSnippets();
                alert(window.t('snip_imported', { n: valid.length }));
            } catch(e) {
                alert(e.message);
            }
        };

        panel.querySelector('#btn-del-selected-turns').onclick = () => window.Actions.deleteSelectedTurns();

        const btnFilterAnchors = panel.querySelector('#btn-filter-anchors');
        if (btnFilterAnchors) {
            btnFilterAnchors.onclick = () => {
                window.TOC.onlyAnchors = !window.TOC.onlyAnchors;
                btnFilterAnchors.style.background = window.TOC.onlyAnchors ? '#3a3215' : '#252628';
                btnFilterAnchors.style.borderColor = window.TOC.onlyAnchors ? '#ffd166' : '#444';
                window.TOC.render(true);
            };
        }

        const cmdInput = panel.querySelector('#cmd-input');
        const termOut = panel.querySelector('#terminal-out');
        const runCmd = async () => {
            const cmd = cmdInput.value.trim();
            if (!cmd) return;

            window.VPS.addCmdHistory(cmd);
            this.historyIndex = -1;
            this.historyDraft = '';
            cmdInput.value = '';

            if (window.Agent && window.Agent.isAutoEnabled()) {
                await window.Agent.runLoop(cmd, 'shell');
                return;
            }

            if (window.VPS.confirmIfDangerous && !window.VPS.confirmIfDangerous(cmd, window.VPS.activeServer || 'LOCAL')) return;

            const srv = window.VPS.activeServer || 'LOCAL';
            window.lastExecutedCommand = cmd;
            termOut.value += `\n$ [${srv}] ${cmd}\n`;
            termOut.scrollTop = termOut.scrollHeight;
            try {
                const res = await window.VPS.executeCommandStream(srv, cmd, 'shell', (chunk) => {
                    termOut.value += chunk;
                    termOut.scrollTop = termOut.scrollHeight;
                });
                window.lastCleanCommandOutput = res.output || '';
                if (!termOut.value.endsWith('\n')) termOut.value += '\n';
                window.VPS.logs[srv] = termOut.value;
                this.refreshGitStatus();
            } catch(e) { termOut.value += `${e.message}\n`; }
            termOut.scrollTop = termOut.scrollHeight;
        };
        panel.querySelector('#btn-run-cmd').onclick = runCmd;
        cmdInput.onkeydown = (e) => {
            if (e.key === 'Enter') { runCmd(); return; }
            const hist = window.VPS.cmdHistory || [];
            if (hist.length === 0) return;

            if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (this.historyIndex === -1) {
                    this.historyDraft = cmdInput.value;
                    this.historyIndex = hist.length - 1;
                } else if (this.historyIndex > 0) this.historyIndex--;
                cmdInput.value = hist[this.historyIndex] || '';
            } else if (e.key === 'ArrowDown') {
                if (this.historyIndex === -1) return;
                e.preventDefault();
                if (this.historyIndex < hist.length - 1) {
                    this.historyIndex++;
                    cmdInput.value = hist[this.historyIndex] || '';
                } else {
                    this.historyIndex = -1;
                    cmdInput.value = this.historyDraft;
                }
            }
        };

        const prepareOutputForAi = (raw) => {
            if (!window.Utils) return { text: (raw || '').trim(), note: '' };
            const comp = window.Utils.compressLog(raw, 4200);
            const scr = window.Utils.scrubSecrets(comp.text);
            const parts = [];
            if (comp.savedTokens > 30) parts.push(`📉 -${comp.savedTokens} tok`);
            if (scr.count > 0) parts.push(`🛡️ ${scr.count}`);
            return { text: scr.text, note: parts.length ? ` (${parts.join(', ')})` : '' };
        };

        panel.querySelector('#btn-term-send').onclick = () => {
            const raw = (window.lastCleanCommandOutput || '').trim();
            if (!raw) return;
            const prep = prepareOutputForAi(raw);
            this.injectIntoChat(`\`\`\`text\n${prep.text}\n\`\`\``, false);
        };

        panel.querySelector('#btn-term-ask-ai').onclick = () => {
            const raw = (window.lastCleanCommandOutput || '').trim();
            if (!raw) return;
            const prep = prepareOutputForAi(raw);
            const cmdInfo = window.lastExecutedCommand ? `\`${window.lastExecutedCommand}\`` : 'command';
            const prompt = window.t('ask_ai_prompt', { cmd: cmdInfo, srv: window.VPS.activeServer, note: prep.note, text: prep.text });
            this.injectIntoChat(prompt, true);
        };

        panel.querySelector('#btn-bridge-start').onclick = () => {
            const info = document.getElementById('bridge-health-info');
            const text = document.getElementById('bridge-text');
            if (text) text.textContent = window.t('bridge_starting');
            if (info) info.innerHTML = window.t('bridge_starting_html');

            window.location.href = 'cockpit://start';

            let attempts = 0;
            const poll = setInterval(async () => {
                attempts++;
                const isUp = await this.updateHealthCheck();
                if (isUp || attempts >= 30) clearInterval(poll);
            }, 500);
        };

        panel.querySelector('#btn-bridge-stop').onclick = async () => {
            try { await fetch('http://127.0.0.1:8765/shutdown', { method: 'POST', headers: { 'X-Cockpit-Client': 'aistudio-cockpit' } }); } catch(e) {}
            setTimeout(() => this.updateHealthCheck(), 500);
        };

        const btnRestart = panel.querySelector('#btn-restart-bridge');
        if (btnRestart) {
            btnRestart.onclick = async () => {
                btnRestart.textContent = window.t('btn_restarting');
                try { await fetch('http://127.0.0.1:8765/restart', { method: 'POST', headers: { 'X-Cockpit-Client': 'aistudio-cockpit' } }); } catch(e) {}
                setTimeout(() => {
                    btnRestart.textContent = window.t('btn_restart');
                    this.updateHealthCheck();
                }, 1200);
            };
        }

        panel.querySelector('#btn-add-vps').onclick = () => this.openVpsForm();
        panel.querySelector('#btn-cancel-vps').onclick = () => { document.getElementById('vps-add-form').style.display = 'none'; };

        panel.querySelector('#btn-test-conn').onclick = async () => {
            const statusEl = document.getElementById('test-conn-status');
            statusEl.style.color = '#a8c7fa';
            statusEl.textContent = window.t('vps_testing');
            const cfg = {
                host: document.getElementById('add-vps-host').value.trim(),
                user: document.getElementById('add-vps-user').value.trim() || 'root',
                password: document.getElementById('add-vps-pass').value.trim(),
                key: document.getElementById('add-vps-key').value.trim(),
                port: 22
            };
            const res = await window.VPS.testConnection(cfg);
            statusEl.style.color = res.success ? '#85e3a1' : '#ffb4ab';
            statusEl.textContent = res.success ? `✅ ${res.msg}` : `❌ ${res.msg}`;
        };

        panel.querySelector('#btn-save-vps').onclick = () => {
            const name = document.getElementById('add-vps-name').value.trim();
            const host = document.getElementById('add-vps-host').value.trim();
            const user = document.getElementById('add-vps-user').value.trim() || 'root';
            const pass = document.getElementById('add-vps-pass').value.trim();
            const key = document.getElementById('add-vps-key').value.trim();
            if (!name || !host) return alert(window.t('vps_fill_req'));

            if (this.editingServerName && this.editingServerName !== name) {
                delete window.VPS.servers[this.editingServerName];
            }
            window.VPS.servers[name] = { host, user, password: pass, key, port: 22 };
            window.VPS.saveLocalServers();
            document.getElementById('vps-add-form').style.display = 'none';
            window.VPS.setActiveServer(name);
            this.renderVpsTabs();
            this.syncCwdUi();
        };

        panel.querySelector('#search-toc').addEventListener('input', () => window.TOC.render(true));

        const btnToggleLive = panel.querySelector('#btn-toggle-live-ssh');
        const liveIndicator = panel.querySelector('#live-indicator');

        btnToggleLive.onclick = () => {
            if (this.liveWs) { this.closeLiveWs(); return; }

            const target = window.VPS.activeServer || 'LOCAL';
            const targetUpper = target.toUpperCase();
            const isLocal = targetUpper.includes('LOCAL') || targetUpper.includes('ПК');
            const cwd = window.VPS.getActiveCwd();

            let srvConfig = null;
            if (!isLocal) {
                srvConfig = window.VPS.getServerConfig(target);
                if (!srvConfig) return alert(window.t('vps_not_found', { name: target }));
            }
            const cfg = isLocal ? { is_local: true, cwd } : Object.assign({}, srvConfig, { cwd });

            termOut.value = `\n[Live: ${target}...]\n`;
            termOut.readOnly = false;

            const ws = new WebSocket('ws://127.0.0.1:8765/ws/term');
            this.liveWs = ws;

            ws.onopen = () => {
                ws.send(JSON.stringify(cfg));
                btnToggleLive.textContent = window.t('live_disconnect');
                btnToggleLive.style.background = '#8c1d18';
                liveIndicator.textContent = window.t('live_online');
                termOut.focus();
            };

            ws.onmessage = (e) => {
                const clean = window.Utils ? window.Utils.stripAnsi(e.data) : e.data;
                termOut.value += clean;
                termOut.scrollTop = termOut.scrollHeight;
                window.lastCleanCommandOutput = termOut.value.slice(-2500);
            };

            ws.onclose = () => {
                termOut.value += '\n[Session closed]\n';
                if (this.liveWs === ws) {
                    this.liveWs = null;
                    btnToggleLive.textContent = window.t('live_btn');
                    btnToggleLive.style.background = '#202830';
                    liveIndicator.textContent = window.t('mode_commands');
                    termOut.readOnly = true;
                }
            };

            termOut.onpaste = (e) => {
                if (this.liveWs && this.liveWs.readyState === WebSocket.OPEN) {
                    e.preventDefault();
                    const text = (e.clipboardData || window.clipboardData).getData('text');
                    if (text) this.liveWs.send(text);
                }
            };

            termOut.onkeydown = (e) => {
                if (!this.liveWs || this.liveWs.readyState !== WebSocket.OPEN) return;

                if (e.ctrlKey && e.key.toLowerCase() === 'c') {
                    if (termOut.selectionStart === termOut.selectionEnd) {
                        e.preventDefault();
                        this.liveWs.send("\x03");
                    }
                    return;
                }
                if (e.ctrlKey && e.key.toLowerCase() === 'v') return;

                const specialKeys = {
                    'Enter': isLocal ? "\r\n" : "\r",
                    'Backspace': "\b",
                    'Tab': "\t",
                    'Escape': "\x1b",
                    'ArrowUp': "\x1b[A",
                    'ArrowDown': "\x1b[B",
                    'ArrowRight': "\x1b[C",
                    'ArrowLeft': "\x1b[D",
                    'Delete': "\x1b[3~"
                };

                if (specialKeys[e.key]) {
                    e.preventDefault();
                    this.liveWs.send(specialKeys[e.key]);
                } else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
                    e.preventDefault();
                    this.liveWs.send(e.key);
                }
            };
        };
    },

    updateHealthCheck: async function() {
        const pill = document.getElementById('bridge-pill');
        const dot = document.getElementById('bridge-dot');
        const text = document.getElementById('bridge-text');
        const info = document.getElementById('bridge-health-info');
        if (!pill) return false;

        const t0 = performance.now();
        try {
            const res = await fetch('http://127.0.0.1:8765/status', { signal: AbortSignal.timeout(1200) });
            const ping = Math.round(performance.now() - t0);
            if (res.ok) {
                const data = await res.json();
                pill.style.background = '#1b3b2b'; pill.style.color = '#85e3a1';
                dot.style.background = '#4caf50';
                text.textContent = window.t('bridge_on', { ms: ping });
                if (info) {
                    info.innerHTML = window.t('bridge_active_html', {
                        backend: data.backend || 'Go Native',
                        uptime: data.uptime,
                        ping,
                        pid: data.pid
                    });
                }
                return true;
            }
        } catch(e) {}

        pill.style.background = '#3c2020'; pill.style.color = '#ffb4ab';
        dot.style.background = '#e53935';
        text.textContent = window.t('bridge_off');
        if (info) info.innerHTML = window.t('bridge_down_html');
        return false;
    }
};

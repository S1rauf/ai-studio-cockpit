(function() {
    'use strict';
    if (window.top !== window.self) return;

    window.lastCleanCommandOutput = "";
    window.lastExecutedCommand = "";

    function injectTurnButtons() {
        const turns = document.querySelectorAll('ms-chat-turn:not([data-cockpit-injected])');
        if (!turns.length) return;

        turns.forEach(turn => {
            turn.setAttribute('data-cockpit-injected', 'true');
            turn.style.position = 'relative';

            const badge = document.createElement('div');
            badge.className = 'cockpit-turn-selector';
            badge.style.cssText = `
                position: absolute; top: 4px; left: calc(100% + 8px); z-index: 50;
                display: flex; flex-direction: column; align-items: center; gap: 5px;
                background: #1a1b1d; border: 1px solid #3c4043; border-radius: 6px; padding: 6px 4px;
                user-select: none; opacity: 0.35; transition: opacity 0.2s; width: 28px; box-sizing: border-box;
            `;

            turn.addEventListener('mouseenter', () => { badge.style.opacity = '1'; });
            turn.addEventListener('mouseleave', () => {
                if (!chk.checked) badge.style.opacity = '0.35';
            });

            const chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.className = 'cockpit-turn-chk';
            chk.title = window.t('turn_sel_tip');
            chk.style.cssText = 'cursor:pointer; margin:0;';
            chk.onchange = () => {
                turn.style.outline = chk.checked ? '2px solid #8c1d18' : 'none';
                badge.style.opacity = chk.checked ? '1' : '0.35';
                syncTocHighlight(turn.id, chk.checked);
                if (window.UI) window.UI.updateDeleteCount();
            };

            const btnAnchor = document.createElement('button');
            btnAnchor.className = 'cockpit-btn-anchor';
            btnAnchor.textContent = '📌';
            btnAnchor.title = window.t('turn_pin');
            btnAnchor.style.cssText = 'background:none; border:none; cursor:pointer; font-size:12px; padding:0; opacity:0.6; filter:grayscale(100%); transition:all 0.15s; line-height:1;';
            btnAnchor.onclick = (e) => {
                e.stopPropagation();
                const all = Array.from(document.querySelectorAll('ms-chat-turn'));
                const idx = all.indexOf(turn);
                if (window.TOC) window.TOC.toggleAnchor(turn, idx);
            };

            const btnBelow = document.createElement('button');
            btnBelow.textContent = '⬇️';
            btnBelow.title = window.t('turn_below');
            btnBelow.style.cssText = 'background:none; border:none; color:#a8c7fa; cursor:pointer; font-size:12px; padding:0; line-height:1;';
            btnBelow.onclick = (e) => {
                e.stopPropagation();
                const all = Array.from(document.querySelectorAll('ms-chat-turn'));
                const sIdx = all.indexOf(turn);
                if (sIdx !== -1) {
                    all.slice(sIdx).forEach(t => {
                        const c = t.querySelector('.cockpit-turn-chk');
                        if (c) {
                            c.checked = true;
                            t.style.outline = '2px solid #8c1d18';
                            const b = t.querySelector('.cockpit-turn-selector');
                            if (b) b.style.opacity = '1';
                            syncTocHighlight(t.id, true);
                        }
                    });
                    if (window.UI) window.UI.updateDeleteCount();
                }
            };

            const btnCopy = document.createElement('button');
            btnCopy.textContent = '📋';
            btnCopy.title = window.t('turn_copy');
            btnCopy.style.cssText = 'background:none; border:none; color:#aaa; cursor:pointer; font-size:12px; padding:0; line-height:1;';
            btnCopy.onclick = async (e) => {
                e.stopPropagation();
                if (window.Actions) await window.Actions.copyTurnText(turn);
                btnCopy.textContent = '✅';
                setTimeout(() => btnCopy.textContent = '📋', 1200);
            };

            const btnDelSingle = document.createElement('button');
            btnDelSingle.textContent = '🗑️';
            btnDelSingle.title = window.t('turn_del');
            btnDelSingle.style.cssText = 'background:none; border:none; color:#e57373; cursor:pointer; font-size:12px; padding:0; line-height:1;';
            btnDelSingle.onclick = async (e) => {
                e.stopPropagation();
                if (confirm(window.t('confirm_del_turn')) && window.Actions) {
                    await window.Actions.deleteSingleTurn(turn);
                }
            };

            badge.appendChild(chk);
            badge.appendChild(btnAnchor);
            badge.appendChild(btnBelow);
            badge.appendChild(btnCopy);
            badge.appendChild(btnDelSingle);
            turn.appendChild(badge);
        });

        if (window.TOC) window.TOC.render();
    }

    function syncTocHighlight(turnId, isChecked) {
        if (!turnId) return;
        const item = document.querySelector(`.toc-card[data-turn-id="${turnId}"]`);
        if (item) {
            item.style.background = isChecked ? '#3d2020' : '#202122';
            item.style.borderColor = isChecked ? '#8c1d18' : '#333';
            const cb = item.querySelector('.toc-chk');
            if (cb) cb.checked = isChecked;
        }
    }

    let _tick = null;
    const observer = new MutationObserver(() => {
        if (_tick) return;
        _tick = setTimeout(() => {
            _tick = null;
            injectTurnButtons();
            if (window.CodeRunner) window.CodeRunner.inject();
            if (window.Actions && window.Actions.injectHistoryManager) {
                window.Actions.injectHistoryManager();
            }
            if (window.TOC) window.TOC.render();
        }, 350);
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
        if (window.UI) window.UI.createPanel();
        injectTurnButtons();
        if (window.CodeRunner) window.CodeRunner.inject();
        if (window.TOC) window.TOC.render(true);
    }, 600);
})();

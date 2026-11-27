window.Actions = {
    lastHistCheckedIndex: -1,

    estimateTokens: function(text) {
        if (!text) return 0;
        const cyr = (text.match(/[\u0400-\u04FF]/g) || []).length;
        const tok = cyr > text.length * 0.3 ? Math.ceil(text.length / 2.2) : Math.ceil(text.length / 3.8);
        return tok >= 1000 ? (tok / 1000).toFixed(1) + 'k' : tok;
    },

    copyTurnText: async function(turn) {
        if (!turn) return;
        const clone = turn.cloneNode(true);
        clone.querySelectorAll('.cockpit-turn-selector, .cockpit-run-bar, button, mat-icon').forEach(el => el.remove());
        let text = (clone.textContent || '').trim();
        if (window.PiiVault) text = window.PiiVault.unmask(text);
        try { await navigator.clipboard.writeText(text); } catch(e) {}
    },

    deleteSingleTurn: async function(turn) {
        if (!turn) return;
        const optBtn = turn.querySelector('button[aria-label*="options" i], button[aria-label*="more" i], ms-chat-turn-options button');
        if (optBtn) {
            optBtn.click();
            await new Promise(r => setTimeout(r, 100));
            const menuItems = Array.from(document.querySelectorAll('.cdk-overlay-container button[role="menuitem"], mat-menu button, .mat-mdc-menu-item'));
            const del = menuItems.find(b => {
                const t = b.innerText.toLowerCase();
                return t.includes('delete') || t.includes('удалить');
            });
            if (del) {
                del.click();
                await new Promise(r => setTimeout(r, 150));
                const confirmBtns = Array.from(document.querySelectorAll('mat-dialog-container button, .mat-mdc-dialog-container button, [role="dialog"] button'));
                const confirmBtn = confirmBtns.find(b => {
                    const t = b.innerText.trim().toLowerCase();
                    return t === 'delete' || t === 'удалить';
                });
                if (confirmBtn) {
                    confirmBtn.click();
                    await new Promise(r => setTimeout(r, 150));
                }
            }
        }
        document.querySelectorAll('.cdk-overlay-backdrop').forEach(b => b.click());
        turn.remove();
        if (window.UI) window.UI.updateDeleteCount();
        if (window.TOC) window.TOC.render(true);
    },

    deleteSelectedTurns: async function() {
        const checked = Array.from(document.querySelectorAll('.cockpit-turn-chk:checked'));
        if (checked.length === 0) return;
        if (!confirm(window.t('confirm_del_turns', { n: checked.length }))) return;

        const btn = document.getElementById('btn-del-selected-turns');
        for (let i = 0; i < checked.length; i++) {
            if (btn) btn.textContent = window.t('deleting_progress', { i: i + 1, n: checked.length });
            const turn = checked[i].closest('ms-chat-turn');
            if (turn) await this.deleteSingleTurn(turn);
        }

        if (window.UI) window.UI.updateDeleteCount();
        if (window.TOC) window.TOC.render(true);
    },

    injectHistoryManager: function() {
        const isHistoryPage = window.location.href.includes('/library') || window.location.href.includes('/history');
        const oldBar = document.getElementById('cockpit-history-bar');

        if (!isHistoryPage) {
            if (oldBar) oldBar.remove();
            return;
        }

        const rows = Array.from(document.querySelectorAll('tbody tr[mat-row], tr.mat-mdc-row, mat-row'));
        if (rows.length === 0) return;

        if (!oldBar) {
            const topBar = document.createElement('div');
            topBar.id = 'cockpit-history-bar';
            topBar.style.cssText = `
                position: sticky; top: 0; z-index: 900; display: flex; align-items: center; justify-content: space-between;
                gap: 12px; padding: 10px 16px; background: #1e1f20; border: 1px solid #3c4043;
                border-bottom: 2px solid #8c1d18; border-radius: 8px; margin-bottom: 10px; color: #fff;
            `;
            topBar.innerHTML = `
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="font-weight:bold; font-size:13px; color:#a8c7fa;">${window.t('hist_mgr')}</span>
                    <button id="btn-hist-select-all" style="cursor:pointer; padding:5px 12px; background:#252628; color:#e3e3e3; border:1px solid #444; border-radius:6px; font-size:12px;">${window.t('hist_sel_all')}</button>
                    <span style="font-size:11px; color:#888;">${window.t('hist_shift')}</span>
                </div>
                <div style="display:flex; align-items:center; gap:10px;">
                    <span id="hist-progress-bar" style="font-family:monospace; font-size:12px; color:#ffd166; display:none;"></span>
                    <button id="btn-hist-delete" style="cursor:pointer; padding:6px 14px; background:#8c1d18; color:#fff; border:none; border-radius:6px; font-size:12px; font-weight:bold; display:none;">${window.t('hist_del_btn', { n: 0 })}</button>
                </div>
            `;

            const table = document.querySelector('table, mat-table');
            if (table && table.parentNode) table.parentNode.insertBefore(topBar, table);

            topBar.querySelector('#btn-hist-select-all').onclick = () => {
                const chks = Array.from(document.querySelectorAll('.cockpit-hist-chk'));
                const allChecked = chks.length > 0 && chks.every(c => c.checked);
                chks.forEach(c => {
                    c.checked = !allChecked;
                    const row = c.closest('tr, mat-row');
                    if (row) row.style.background = c.checked ? 'rgba(140, 29, 24, 0.22)' : '';
                });
                this.updateHistoryDeleteBtn();
            };

            topBar.querySelector('#btn-hist-delete').onclick = async () => {
                const selected = Array.from(document.querySelectorAll('.cockpit-hist-chk:checked'));
                if (selected.length === 0) return;
                if (!confirm(window.t('hist_del_confirm', { n: selected.length }))) return;

                const delBtn = document.getElementById('btn-hist-delete');
                const progEl = document.getElementById('hist-progress-bar');
                delBtn.disabled = true;
                progEl.style.display = 'inline';

                for (let i = 0; i < selected.length; i++) {
                    const pct = Math.round(((i + 1) / selected.length) * 10);
                    const barStr = '█'.repeat(pct) + '░'.repeat(10 - pct);
                    progEl.textContent = `[${barStr}] ${i + 1}/${selected.length}`;
                    delBtn.textContent = '⏳...';

                    const row = selected[i].closest('tr, mat-row');
                    if (row) row.style.opacity = '0.35';
                    await this.deleteHistoryRow(row);
                    if (row && row.parentNode) row.remove();
                }

                progEl.textContent = window.t('hist_done');
                setTimeout(() => window.location.reload(), 600);
            };
        }

        rows.forEach(row => {
            if (row.getAttribute('data-cockpit-history')) return;
            row.setAttribute('data-cockpit-history', 'true');

            const firstCell = row.querySelector('td, mat-cell');
            if (firstCell && !firstCell.querySelector('.cockpit-hist-chk')) {
                firstCell.style.display = 'flex';
                firstCell.style.alignItems = 'center';
                firstCell.style.gap = '10px';

                const chk = document.createElement('input');
                chk.type = 'checkbox';
                chk.className = 'cockpit-hist-chk';
                chk.style.cssText = 'cursor: pointer; width: 16px; height: 16px; accent-color: #e53935; flex-shrink: 0;';

                chk.onclick = (e) => {
                    e.stopPropagation();
                    const allChks = Array.from(document.querySelectorAll('.cockpit-hist-chk'));
                    const currentIdx = allChks.indexOf(chk);

                    if (e.shiftKey && this.lastHistCheckedIndex !== -1) {
                        const start = Math.min(this.lastHistCheckedIndex, currentIdx);
                        const end = Math.max(this.lastHistCheckedIndex, currentIdx);
                        for (let k = start; k <= end; k++) {
                            allChks[k].checked = chk.checked;
                            const r = allChks[k].closest('tr, mat-row');
                            if (r) r.style.background = chk.checked ? 'rgba(140, 29, 24, 0.22)' : '';
                        }
                    } else {
                        row.style.background = chk.checked ? 'rgba(140, 29, 24, 0.22)' : '';
                    }

                    this.lastHistCheckedIndex = currentIdx;
                    this.updateHistoryDeleteBtn();
                };

                firstCell.insertBefore(chk, firstCell.firstChild);
            }
        });
    },

    updateHistoryDeleteBtn: function() {
        const count = document.querySelectorAll('.cockpit-hist-chk:checked').length;
        const btn = document.getElementById('btn-hist-delete');
        if (btn) {
            btn.style.display = count > 0 ? 'block' : 'none';
            btn.textContent = window.t('hist_del_btn', { n: count });
        }
    },

    deleteHistoryRow: async function(row) {
        if (!row) return;
        const moreBtn = row.querySelector('ms-prompt-options-menu button, button[aria-label*="options" i], button[aria-label*="more" i], td:last-child button');
        if (!moreBtn) return;

        moreBtn.click();
        await new Promise(r => setTimeout(r, 150));

        const menuItems = Array.from(document.querySelectorAll('.cdk-overlay-container button[role="menuitem"], mat-menu button, .mat-mdc-menu-item'));
        const delItem = menuItems.find(b => {
            const t = b.innerText.toLowerCase();
            return t.includes('delete') || t.includes('удалить');
        });

        if (delItem) {
            delItem.click();
            let confirmBtn = null;
            for (let i = 0; i < 25; i++) {
                await new Promise(r => setTimeout(r, 60));
                const btns = Array.from(document.querySelectorAll('mat-dialog-container button, .mat-mdc-dialog-container button, [role="dialog"] button'));
                confirmBtn = btns.find(b => {
                    const t = b.innerText.trim().toLowerCase();
                    return t === 'delete' || t === 'delete prompt' || t === 'удалить';
                });
                if (confirmBtn) break;
            }
            if (confirmBtn) {
                confirmBtn.click();
                for (let i = 0; i < 30; i++) {
                    await new Promise(r => setTimeout(r, 60));
                    if (!document.querySelector('mat-dialog-container, .mat-mdc-dialog-container, [role="dialog"]')) break;
                }
                await new Promise(r => setTimeout(r, 200));
            }
        }
        document.querySelectorAll('.cdk-overlay-backdrop').forEach(b => b.click());
    }
};

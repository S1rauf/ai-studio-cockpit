window.TOC = {
    onlyAnchors: false,

    getChatKey: function() {
        return 'cockpit_anchors_' + window.location.pathname;
    },

    getAnchors: function() {
        try { return JSON.parse(localStorage.getItem(this.getChatKey()) || '{}'); }
        catch (e) { return {}; }
    },

    saveAnchors: function(anchors) {
        localStorage.setItem(this.getChatKey(), JSON.stringify(anchors));
    },

    getTurnKey: function(turn, idx) {
        if (turn && turn.id) return turn.id;
        return `idx_${idx}`;
    },

    syncAnchorButtons: function() {
        const anchors = this.getAnchors();
        const turns = Array.from(document.querySelectorAll('ms-chat-turn'));
        turns.forEach((turn, idx) => {
            const btn = turn.querySelector('.cockpit-btn-anchor');
            if (!btn) return;
            const key = this.getTurnKey(turn, idx);
            const active = !!anchors[key];
            btn.style.opacity = active ? '1' : '0.6';
            btn.style.filter = active ? 'none' : 'grayscale(100%)';
            btn.title = active ? window.t('turn_unpin') : window.t('turn_pin');
        });
    },

    toggleAnchor: function(turn, idx) {
        const anchors = this.getAnchors();
        const key = this.getTurnKey(turn, idx);
        if (anchors[key]) delete anchors[key];
        else anchors[key] = true;
        this.saveAnchors(anchors);
        this.syncAnchorButtons();
        this.render();
    },

    render: function() {
        const listToc = document.getElementById('list-toc');
        const searchInput = document.getElementById('search-toc');
        if (!listToc) return;

        const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
        const anchors = this.getAnchors();
        listToc.replaceChildren();
        this.syncAnchorButtons();

        const navs = Array.from(document.querySelectorAll('ms-items-scrollbar button[aria-controls], ms-chat-session button[aria-controls]'));
        const allTurns = Array.from(document.querySelectorAll('ms-chat-turn'));

        const buildCard = (uIdx, title, turnId, actualTurn, anchorKey) => {
            const isAnchored = !!anchors[anchorKey];
            if (this.onlyAnchors && !isAnchored) return;
            if (query && !title.toLowerCase().includes(query)) return;

            const isChecked = actualTurn?.querySelector('.cockpit-turn-chk')?.checked || false;

            const item = document.createElement('div');
            item.className = 'toc-card';
            if (turnId) item.setAttribute('data-turn-id', turnId);
            item.style.cssText = `
                display:flex; align-items:center; gap:7px; padding:6px 9px;
                background: ${isChecked ? '#3d2020' : '#202122'};
                border: 1px solid ${isChecked ? '#8c1d18' : (isAnchored ? '#6b5b26' : '#333')};
                border-radius: 6px; cursor: pointer;
            `;

            const chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.className = 'toc-chk';
            chk.checked = isChecked;
            chk.style.cssText = 'cursor:pointer; margin:0; flex-shrink:0;';
            chk.onclick = (e) => {
                e.stopPropagation();
                if (actualTurn) {
                    const turnChk = actualTurn.querySelector('.cockpit-turn-chk');
                    if (turnChk) {
                        turnChk.checked = chk.checked;
                        actualTurn.style.outline = chk.checked ? '2px solid #8c1d18' : 'none';
                        const b = actualTurn.querySelector('.cockpit-turn-selector');
                        if (b) b.style.opacity = chk.checked ? '1' : '0.35';
                    }
                }
                item.style.background = chk.checked ? '#3d2020' : '#202122';
                item.style.borderColor = chk.checked ? '#8c1d18' : (isAnchored ? '#6b5b26' : '#333');
                if (window.UI) window.UI.updateDeleteCount();
            };

            const badge = document.createElement('span');
            badge.style.cssText = 'font-size:10px; background:#2a2b2d; color:#a8c7fa; padding:2px 5px; border-radius:4px; font-weight:bold; flex-shrink:0;';
            badge.textContent = `#${uIdx}`;

            const textSpan = document.createElement('span');
            textSpan.style.cssText = 'flex-grow:1; font-size:11px; color:#e3e3e3; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
            textSpan.textContent = title;

            item.appendChild(chk);
            item.appendChild(badge);
            item.appendChild(textSpan);

            if (isAnchored) {
                const pin = document.createElement('span');
                pin.textContent = '📌';
                pin.style.cssText = 'font-size:11px; flex-shrink:0;';
                item.appendChild(pin);
            }

            item.onclick = () => {
                if (actualTurn) {
                    actualTurn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    actualTurn.style.outline = '2px solid #388bfd';
                    setTimeout(() => {
                        const checkedNow = actualTurn.querySelector('.cockpit-turn-chk')?.checked;
                        actualTurn.style.outline = checkedNow ? '2px solid #8c1d18' : 'none';
                    }, 1200);
                }
            };

            listToc.appendChild(item);
        };

        if (navs.length === 0) {
            let uIdx = 0;
            allTurns.forEach((t, idx) => {
                const isModel = !!t.querySelector('ms-model-turn, .model');
                if (isModel) return;
                uIdx++;
                const rawTitle = (t.textContent || '').replace(/[\n\r]+/g, ' ').trim();
                const title = rawTitle ? (rawTitle.length > 55 ? rawTitle.slice(0, 52) + '...' : rawTitle) : window.t('req_num', { n: uIdx });
                buildCard(uIdx, title, t.id, t, this.getTurnKey(t, idx));
            });
            return;
        }

        let uIdx = 0;
        navs.forEach(btnDot => {
            const label = (btnDot.getAttribute('aria-label') || '').trim();
            const turnId = btnDot.getAttribute('aria-controls');
            if (label.toLowerCase().includes('model') || label.toLowerCase().includes('thought')) return;

            uIdx++;
            let title = label.replace(/[\n\r]+/g, ' ').replace(/\s{2,}/g, ' ');
            if (!title || title.toLowerCase().includes('user turn')) title = window.t('req_num', { n: uIdx });
            if (title.length > 55) title = title.slice(0, 52) + '...';

            const actualTurn = turnId ? document.getElementById(turnId) : null;
            const turnIdx = actualTurn ? allTurns.indexOf(actualTurn) : uIdx;
            buildCard(uIdx, title, turnId, actualTurn, this.getTurnKey(actualTurn, turnIdx));
        });
    }
};

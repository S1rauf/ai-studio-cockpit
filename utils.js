window.Utils = {
    anonymizeEnabled: localStorage.getItem('cockpit_anonymize') !== 'false',

    setAnonymize: function(val) {
        this.anonymizeEnabled = !!val;
        localStorage.setItem('cockpit_anonymize', this.anonymizeEnabled.toString());
    },

    stripAnsi: function(str) {
        return (str || '')
            .replace(/\x1b\[\?[0-9]+[hl]/g, '')
            .replace(/\x1b\]0;[^\x07\x1b\r\n]*[\x07\x1b]/g, '')
            .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
    },

    estimateTokens: function(text) {
        if (!text) return 0;
        const cyr = (text.match(/[\u0400-\u04FF]/g) || []).length;
        return cyr > text.length * 0.3 ? Math.ceil(text.length / 2.2) : Math.ceil(text.length / 3.8);
    },

    formatTokens: function(tok) {
        return tok >= 1000 ? (tok / 1000).toFixed(1) + 'k' : String(tok);
    },

    scrubSecrets: function(input) {
        if (!input || !this.anonymizeEnabled) return { text: input || '', count: 0 };
        let text = String(input);
        let count = 0;

        if (window.PiiVault) {
            const piiRes = window.PiiVault.mask(text);
            text = piiRes.text;
            count += piiRes.count;
        }

        const sub = (re, replacer) => {
            text = text.replace(re, (...args) => {
                count++;
                return typeof replacer === 'function' ? replacer(...args) : replacer;
            });
        };

        sub(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]');
        sub(/\b(sk-(?:proj-|ant-|live-|test-)?[A-Za-z0-9_-]{20,})\b/g, '[REDACTED_API_KEY]');
        sub(/\b(gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[REDACTED_GH_TOKEN]');
        sub(/\b(AIza[0-9A-Za-z_-]{30,})\b/g, '[REDACTED_GOOGLE_KEY]');
        sub(/\b(AKIA[0-9A-Z]{16})\b/g, '[REDACTED_AWS_KEY]');
        sub(/\b(\d{8,12}:[A-Za-z0-9_-]{30,})\b/g, '[REDACTED_TG_TOKEN]');
        sub(/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_JWT]');
        sub(/(Authorization\s*:\s*Bearer\s+)[^\s"'`]+/gi, (_, p1) => p1 + '[REDACTED_BEARER]');
        sub(/((?:password|passwd|pwd|secret|api_key|apikey|access_token|auth_token|private_key|client_secret|db_pass|jwt_secret)\s*[:=]\s*["']?)([^\s"'`,;}{\r\n]{4,})(["']?)/gi,
            (_, p1, val, p3) => {
                if (val.startsWith('[REDACTED') || val.includes('(') || val.includes('document.')) { count--; return _; }
                return `${p1}[REDACTED]${p3}`;
            }
        );

        if (window.VPS && window.VPS.servers) {
            Object.entries(window.VPS.servers).forEach(([srvName, cfg]) => {
                if (!cfg) return;
                if (cfg.password && cfg.password.length >= 4) {
                    const esc = cfg.password.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    sub(new RegExp(esc, 'g'), `[VPS_PASS_${srvName}]`);
                }
                if (cfg.host && cfg.host.length >= 7) {
                    const escH = cfg.host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    sub(new RegExp(escH, 'g'), `[VPS_HOST_${srvName}]`);
                }
            });
        }

        return { text, count };
    },

    compressLog: function(raw, maxChars = 4200) {
        let cleaned = this.stripAnsi(raw || '');
        const origTokens = this.estimateTokens(cleaned);

        const rawLines = cleaned.split(/\r?\n/).map(line => {
            if (line.includes('\r')) {
                const parts = line.split('\r');
                return parts[parts.length - 1];
            }
            return line.replace(/[ \t]+$/g, '');
        });

        const deduped = [];
        let lastLine = null;
        let repeatCount = 0;
        for (const line of rawLines) {
            if (line === lastLine && line.trim() !== '') {
                repeatCount++;
            } else {
                if (repeatCount > 0) {
                    deduped[deduped.length - 1] += `  [×${repeatCount + 1}]`;
                    repeatCount = 0;
                }
                deduped.push(line);
                lastLine = line;
            }
        }
        if (repeatCount > 0 && deduped.length > 0) {
            deduped[deduped.length - 1] += `  [×${repeatCount + 1}]`;
        }

        let compact = deduped.join('\n').replace(/\n{3,}/g, '\n\n').trim();

        if (compact.length > maxChars) {
            const headLen = Math.floor(maxChars * 0.25);
            const tailLen = Math.floor(maxChars * 0.55);
            const head = compact.slice(0, headLen);
            const mid = compact.slice(headLen, compact.length - tailLen);
            const tail = compact.slice(-tailLen);

            const errLines = mid.split('\n').filter(l => /(error|err:|fail|exception|traceback|fatal|panic|denied|not found|warn)/i.test(l));
            const errSnippet = errLines.slice(0, 12).join('\n').slice(0, 800);
            const skippedTok = Math.max(0, this.estimateTokens(mid) - this.estimateTokens(errSnippet));

            compact = head +
                `\n${window.t('compressed_note', { n: skippedTok })}\n` +
                (errSnippet ? errSnippet + '\n...\n' : '') +
                tail;
        }

        const finalTokens = this.estimateTokens(compact);
        return {
            text: compact,
            origTokens,
            finalTokens,
            savedTokens: Math.max(0, origTokens - finalTokens)
        };
    },

    buildChatHandoff: function() {
        const turns = Array.from(document.querySelectorAll('ms-chat-turn'));
        if (turns.length === 0) return null;

        const anchors = (window.TOC && window.TOC.getAnchors) ? window.TOC.getAnchors() : {};
        const hasAnchors = Object.keys(anchors).length > 0;

        const extractTurn = (turn, compactOld) => {
            const clone = turn.cloneNode(true);
            clone.querySelectorAll('.cockpit-turn-selector, .cockpit-run-bar, button, mat-icon').forEach(el => el.remove());
            const isModel = !!turn.querySelector('ms-model-turn, .model');
            const role = isModel ? 'ASSISTANT' : 'USER';

            if (compactOld) {
                clone.querySelectorAll('pre, code').forEach(el => {
                    const txt = (el.textContent || '').trim();
                    const lines = txt.split('\n').length;
                    if (txt.length > 350) {
                        el.textContent = window.t('code_compressed_note', { n: lines });
                    }
                });
            }
            let txt = (clone.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
            if (compactOld && txt.length > 900) {
                txt = txt.slice(0, 650) + `\n${window.t('shortened_note')}\n` + txt.slice(-200);
            }
            return `[${role}]\n${txt}`;
        };

        const blocks = [];
        turns.forEach((turn, idx) => {
            const key = (window.TOC && window.TOC.getTurnKey) ? window.TOC.getTurnKey(turn, idx) : (turn.id || `idx_${idx}`);
            const isAnchored = !!anchors[key];
            const isRecent = idx >= turns.length - 2;

            if (hasAnchors) {
                if (isAnchored || isRecent) blocks.push(extractTurn(turn, false));
            } else {
                blocks.push(extractTurn(turn, !isRecent));
            }
        });

        const srv = window.VPS ? (window.VPS.activeServer || 'LOCAL') : 'LOCAL';
        const cwd = window.VPS ? window.VPS.getActiveCwd() : '';
        const cwdStr = cwd ? `, cwd: ${cwd}` : '';
        const header = [
            window.t('handoff_header'),
            window.t('handoff_env', { srv, cwd: cwdStr }),
            window.t('handoff_blocks', { inc: blocks.length, tot: turns.length }),
            '---'
        ].join('\n');

        let full = header + '\n\n' + blocks.join('\n\n---\n\n') + '\n\n---\n' + window.t('handoff_footer');
        const scrubbed = this.scrubSecrets(full);
        return {
            text: scrubbed.text,
            tokens: this.estimateTokens(scrubbed.text),
            scrubbedCount: scrubbed.count,
            includedTurns: blocks.length,
            totalTurns: turns.length
        };
    }
};

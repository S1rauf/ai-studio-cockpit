window.PiiVault = {
    STORAGE_KEY: 'cockpit_pii_vault_v1',
    state: { toToken: {}, toReal: {}, counters: {} },

    init: function() {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && parsed.toToken && parsed.toReal) {
                    this.state = {
                        toToken: parsed.toToken || {},
                        toReal: parsed.toReal || {},
                        counters: parsed.counters || {}
                    };
                }
            }
        } catch (e) {}
    },

    save: function() {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.state));
        } catch (e) {}
        if (window.UI && window.UI.syncPiiVaultUi) window.UI.syncPiiVaultUi();
    },

    removeToken: function(tok) {
        if (!tok || !this.state.toReal[tok]) return;
        const real = this.state.toReal[tok];
        delete this.state.toReal[tok];
        if (real && this.state.toToken[real] === tok) {
            delete this.state.toToken[real];
        }
        this.save();
    },

    clear: function() {
        this.state = { toToken: {}, toReal: {}, counters: {} };
        this.save();
    },

    count: function() {
        return Object.keys(this.state.toReal).length;
    },

    getOrCreateToken: function(category, realValue) {
        const clean = String(realValue || '').trim();
        if (!clean) return realValue;
        if (this.state.toToken[clean]) return this.state.toToken[clean];

        const nextNum = (this.state.counters[category] || 0) + 1;
        this.state.counters[category] = nextNum;
        const token = `[${category}_${nextNum}]`;

        this.state.toToken[clean] = token;
        this.state.toReal[token] = clean;
        this.save();
        return token;
    },

    addCustom: function(realValue, customLabel) {
        const cleanReal = String(realValue || '').trim();
        if (!cleanReal) return null;
        let tag = String(customLabel || '').trim().toUpperCase().replace(/[^A-ZА-ЯЁ0-9_]/g, '_');
        if (!tag) return this.getOrCreateToken('СЕКРЕТ', cleanReal);
        if (!tag.startsWith('[')) tag = `[${tag}]`;
        this.state.toToken[cleanReal] = tag;
        this.state.toReal[tag] = cleanReal;
        this.save();
        return tag;
    },

    mask: function(input) {
        if (!input) return { text: '', count: 0 };
        if (window.Utils && !window.Utils.anonymizeEnabled) return { text: String(input), count: 0 };

        let text = String(input);
        let hits = 0;

        // 1. Сначала подставляем уже известные значения из сейфа (от длинных к коротким)
        const knownReals = Object.keys(this.state.toToken).sort((a, b) => b.length - a.length);
        for (const real of knownReals) {
            if (real.length < 3) continue;
            if (text.includes(real)) {
                const tok = this.state.toToken[real];
                const parts = text.split(real);
                hits += parts.length - 1;
                text = parts.join(tok);
            }
        }

        const sub = (re, category, groupIdx = 0) => {
            text = text.replace(re, (...args) => {
                const full = args[0];
                const val = groupIdx > 0 ? args[groupIdx] : full;
                if (!val || val.startsWith('[')) return full;
                const tok = this.getOrCreateToken(category, val);
                hits++;
                if (groupIdx === 2) return args[1] + tok;
                return tok;
            });
        };

        // 2. Юрлица (ООО «Ромашка», АО "Вектор" и т.п.)
        sub(/(?<![А-ЯЁа-яёA-Za-z0-9_])(?:ООО|АО|ПАО|ЗАО|ОДО|НКО|ФГУП|МУП)\s*(?:«[^»\r\n]{2,80}»|"[^"\r\n]{2,80}"|'[^'\r\n]{2,80}')/g, 'КОМПАНИЯ');

        // 3. ИП (полное ФИО или с инициалами)
        sub(/(?<![А-ЯЁа-яёA-Za-z0-9_])ИП\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+){1,2}(?![А-ЯЁа-яёA-Za-z0-9_])|(?<![А-ЯЁа-яёA-Za-z0-9_])ИП\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.\s*[А-ЯЁ]\./g, 'ИП');

        // 4. Реквизиты с контекстом (ИНН, КПП, ОГРНИП, ОГРН, БИК, р/с, к/с)
        sub(/((?<![А-ЯЁа-яёA-Za-z0-9_])ИНН\s*[:№#]?\s*)(\d{10}|\d{12})(?!\d)/gi, 'ИНН', 2);
        sub(/((?<![А-ЯЁа-яёA-Za-z0-9_])КПП\s*[:№#]?\s*)(\d{9})(?!\d)/gi, 'КПП', 2);
        sub(/((?<![А-ЯЁа-яёA-Za-z0-9_])ОГРНИП\s*[:№#]?\s*)(\d{15})(?!\d)/gi, 'ОГРНИП', 2);
        sub(/((?<![А-ЯЁа-яёA-Za-z0-9_])ОГРН\s*[:№#]?\s*)(\d{13})(?!\d)/gi, 'ОГРН', 2);
        sub(/((?<![А-ЯЁа-яёA-Za-z0-9_])БИК\s*[:№#]?\s*)(04\d{7})(?!\d)/gi, 'БИК', 2);
        sub(/((?<![А-ЯЁа-яёA-Za-z0-9_])(?:р\/с|к\/с|расч[её]тный\s+сч[её]т|корр\.\s*сч[её]т)\s*[:№#]?\s*)(\d{20})(?!\d)/gi, 'СЧЕТ', 2);

        // 5. Паспортные данные (серия + номер)
        sub(/(?:паспорт\s+)?(?:серия\s*)?\d{2}\s?\d{2}\s*(?:№|номер|N)\s*\d{6}(?!\d)/gi, 'ПАСПОРТ');

        // 6. Почтовый/юридический адрес с 6-значным индексом
        sub(/(?<!\d)\d{6},\s*(?:г\.|обл\.|край|респ\.|Москва|Санкт-Петербург|ул\.|пр\.|д\.|[А-ЯЁа-яё])[^\r\n;]{8,120}/g, 'АДРЕС');

        // 7. 20-значные банковские счета (407/408/301)
        sub(/(?<!\d)(?:407|408|301)\d{17}(?!\d)/g, 'СЧЕТ');

        // 8. Банковские карты (16 цифр)
        sub(/(?<!\d)(?:\d{4}[\s-]){3}\d{4}(?!\d)/g, 'КАРТА');

        // 9. Телефоны РФ/СНГ
        sub(/(?<!\d)(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}(?!\d)/g, 'ТЕЛЕФОН');

        // 10. Email
        sub(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, 'EMAIL');

        // 11. Полное ФИО во всех 6 падежах (Иванов Иван Иванович / Иванова Ивана Ивановича / Ивановой Анны Сергеевны)
        sub(/(?<![А-ЯЁа-яёA-Za-z0-9_])[А-ЯЁ][а-яё]{2,25}\s+[А-ЯЁ][а-яё]{2,20}\s+[А-ЯЁ][а-яё]{2,22}(?:(?:ов|ев)?ич(?:а|у|ем|ом|е)?|(?:ов|ев|ич|инич)н(?:а|ы|е|у|ой|ою))(?![А-ЯЁа-яёA-Za-z0-9_])/g, 'ФИО');

        // 12. Фамилия + инициалы (Петров С.Н. / Иванов И. И.)
        sub(/(?<![А-ЯЁа-яёA-Za-z0-9_])[А-ЯЁ][а-яё]{2,25}\s+[А-ЯЁ]\.\s*[А-ЯЁ]\./g, 'ФИО_КРАТ');

        return { text, count: hits };
    },

    unmask: function(input) {
        if (!input) return '';
        let text = String(input);
        const tokens = Object.keys(this.state.toReal).sort((a, b) => b.length - a.length);
        for (const tok of tokens) {
            if (text.includes(tok)) {
                text = text.split(tok).join(this.state.toReal[tok]);
            }
        }
        return text;
    },

    unmaskDeep: function(val) {
        if (typeof val === 'string') return this.unmask(val);
        if (Array.isArray(val)) return val.map(x => this.unmaskDeep(x));
        if (val && typeof val === 'object') {
            const out = {};
            for (const [k, v] of Object.entries(val)) {
                out[this.unmask(k)] = this.unmaskDeep(v);
            }
            return out;
        }
        return val;
    }
};
window.PiiVault.init();
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'RUN_PAGE_CODE' && sender.tab && sender.tab.id) {
        const tabId = sender.tab.id;
        const isRu = (chrome.i18n?.getUILanguage?.() || '').toLowerCase().startsWith('ru');
        const emptyMsg = isRu ? '✅ Выполнено в браузере (console.log пуст)' : '✅ Executed in browser (console.log empty)';
        const dbgErr = isRu ? '❌ Ошибка отладчика: ' : '❌ Debugger error: ';
        const execErr = isRu ? 'Ошибка выполнения' : 'Execution error';

        const wrappedCode = `(async () => {
            const __logs = [];
            const __origLog = console.log;
            const __origWarn = console.warn;
            const __origErr = console.error;
            const __fmt = (args) => args.map(a => {
                try { return typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a); }
                catch(e) { return String(a); }
            }).join(' ');

            console.log = (...a) => { __logs.push(__fmt(a)); __origLog.apply(console, a); };
            console.warn = (...a) => { __logs.push('⚠️ ' + __fmt(a)); __origWarn.apply(console, a); };
            console.error = (...a) => { __logs.push('❌ ' + __fmt(a)); __origErr.apply(console, a); };

            try {
                ${msg.code}
            } finally {
                console.log = __origLog;
                console.warn = __origWarn;
                console.error = __origErr;
            }
            return __logs.join('\\n') || '${emptyMsg}';
        })()`;

        chrome.debugger.attach({ tabId }, '1.3', () => {
            if (chrome.runtime.lastError) {
                sendResponse({ output: dbgErr + chrome.runtime.lastError.message });
                return;
            }
            chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
                expression: wrappedCode,
                returnByValue: true,
                awaitPromise: true
            }, (res) => {
                chrome.debugger.detach({ tabId }, () => {});
                if (res && res.exceptionDetails) {
                    const errDesc = res.exceptionDetails.exception?.description || res.exceptionDetails.text || execErr;
                    sendResponse({ output: '❌ ' + errDesc });
                } else {
                    sendResponse({ output: res?.result?.value ?? '✅ OK' });
                }
            });
        });
        return true;
    }
});

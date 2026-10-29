// Content script that runs on Sutra's own origin (see manifest matches).
// It delivers a pending capture payload into the page via window.postMessage;
// Sutra's in-app bridge (initSutraLmsCaptureBridge in src/core/app.js) opens
// the normal review-and-import modal and answers with an ack, at which point
// the payload is cleared. Payloads older than 10 minutes are dropped unposted.

(function sutraBridge() {
    const PENDING_KEY = 'sutraPendingCapture';
    const MAX_AGE_MS = 10 * 60 * 1000;
    let posting = false;

    function deliver(pending) {
        if (posting || !pending || typeof pending.text !== 'string' || !pending.text) return;
        if (Date.now() - (pending.savedAt || 0) > MAX_AGE_MS) {
            chrome.storage.local.remove(PENDING_KEY);
            return;
        }
        posting = true;
        let acked = false;
        const onAck = (event) => {
            if (event.source !== window) return;
            if (!event.data || event.data.type !== 'sutra:lms-capture-ack') return;
            acked = true;
            window.removeEventListener('message', onAck);
            chrome.storage.local.remove(PENDING_KEY);
        };
        window.addEventListener('message', onAck);
        // The app registers its listener late in boot — retry until acked.
        let tries = 0;
        const timer = setInterval(() => {
            if (acked || tries >= 60) {
                clearInterval(timer);
                posting = false;
                if (!acked) window.removeEventListener('message', onAck);
                return;
            }
            tries += 1;
            window.postMessage({ type: 'sutra:lms-capture', text: pending.text }, window.location.origin);
        }, 500);
    }

    // Case 1: payload was stored before this Sutra tab opened.
    chrome.storage.local.get(PENDING_KEY, (items) => {
        deliver(items && items[PENDING_KEY]);
    });

    // Case 2: Sutra tab was already open when the user hit "Send to Sutra".
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes[PENDING_KEY]) return;
        deliver(changes[PENDING_KEY].newValue);
    });
})();

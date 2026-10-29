/** Preview-first Web Share Target consumer backed by a temporary IndexedDB queue. */
;(function registerShareTarget(global) {
    'use strict';

    var DB_NAME = 'sutra_share_target_db';
    var DB_VERSION = 1;
    var STORE_NAME = 'pendingShares';
    var MAX_TEXT_LENGTH = 80000;
    var MAX_FILE_SIZE = 20 * 1024 * 1024;
    var MAX_TOTAL_SIZE = 30 * 1024 * 1024;
    var MAX_FILES = 8;
    var activeIds = new Set();
    var SUPPORTED_TYPES = [
        'text/plain', 'text/html', 'text/markdown', 'text/csv', 'text/calendar',
        'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.oasis.opendocument.text', 'application/rtf'
    ];
    var SUPPORTED_EXTENSIONS = /\.(?:txt|md|markdown|html?|csv|ics|pdf|png|jpe?g|webp|gif|docx|xlsx|pptx|odt|rtf)$/i;

    function text(value) { return String(value == null ? '' : value); }
    function fileSupported(file) {
        return !!file && (SUPPORTED_TYPES.indexOf(text(file.type).toLowerCase()) >= 0 || SUPPORTED_EXTENSIONS.test(text(file.name)));
    }
    function classifyPayload(payload) {
        var files = payload && Array.isArray(payload.files) ? payload.files : [];
        if (files.length) {
            var type = text(files[0].type).toLowerCase();
            if (/^image\//.test(type)) return 'image';
            if (type === 'application/pdf' || /\.pdf$/i.test(text(files[0].name))) return 'pdf';
            return fileSupported(files[0]) ? 'document' : 'unsupported';
        }
        var body = text(payload && payload.text).trim();
        var url = text(payload && payload.url).trim();
        if (url && !body) return 'url';
        if (body && /\bhttps?:\/\//.test(body)) return 'url-with-text';
        return body || text(payload && payload.title).trim() ? 'text' : 'empty';
    }
    function destinationHint(payload, kind) {
        var content = (text(payload && payload.text) + ' ' + text(payload && payload.title)).toLowerCase();
        if (kind === 'image' || kind === 'pdf' || kind === 'document') return 'note';
        if (/\b(exam|test|quiz|homework|assignment|study|review)\b/.test(content)) return 'homework';
        if (/\b(note|journal|idea|draft|brainstorm)\b/.test(content)) return 'note';
        if (/\b(task|todo|remember|remind)\b/.test(content)) return 'task';
        if (/\b(block|schedule|event|meeting|appointment)\b/.test(content)) return 'timeline';
        return 'capture';
    }
    function validatePayload(payload) {
        var files = payload && Array.isArray(payload.files) ? payload.files : [];
        if (files.length > MAX_FILES) return { ok: false, code: 'too_many_files', message: 'Share no more than ' + MAX_FILES + ' files at once.' };
        var total = 0;
        for (var index = 0; index < files.length; index += 1) {
            var file = files[index];
            if (!fileSupported(file)) return { ok: false, code: 'unsupported_type', message: '“' + text(file.name || 'This file') + '” is not a supported image, PDF, or document.' };
            if (Number(file.size) > MAX_FILE_SIZE) return { ok: false, code: 'file_too_large', message: '“' + text(file.name || 'This file') + '” is larger than the 20 MB share limit.' };
            total += Number(file.size) || 0;
        }
        if (total > MAX_TOTAL_SIZE) return { ok: false, code: 'share_too_large', message: 'The shared files exceed the 30 MB combined limit.' };
        if (text(payload && payload.text).length > MAX_TEXT_LENGTH) return { ok: false, code: 'text_too_large', message: 'Shared text exceeds the 80,000 character limit.' };
        var sourceUrl = text(payload && payload.url).trim();
        if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) return { ok: false, code: 'unsafe_url', message: 'Only http or https source links can be imported.' };
        if (classifyPayload(payload) === 'empty') return { ok: false, code: 'empty', message: 'The share did not contain text, a URL, or a supported file.' };
        return { ok: true, code: 'ready', message: '' };
    }
    function composeText(payload) {
        var parts = [];
        var title = text(payload && payload.title).trim();
        var body = text(payload && payload.text).trim();
        var url = text(payload && payload.url).trim();
        if (title) parts.push(title);
        if (body && body !== title) parts.push(body);
        if (url && body.indexOf(url) < 0) parts.push(url);
        return parts.join('\n\n').slice(0, MAX_TEXT_LENGTH);
    }
    function destinationPrefix(destination) {
        return destination === 'note' ? 'note: '
            : destination === 'homework' ? 'homework: '
            : destination === 'task' ? 'task: '
            : destination === 'timeline' ? 'block: '
            : destination === 'reminder' ? 'reminder: '
            : destination === 'review' ? 'review: '
            : '';
    }

    function openDb() {
        if (!global.indexedDB) return Promise.reject(new Error('Temporary share storage is unavailable.'));
        return new Promise(function (resolve, reject) {
            var request = global.indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = function () {
                var db = request.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    var store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                    store.createIndex('fingerprint', 'fingerprint', { unique: false });
                    store.createIndex('createdAt', 'createdAt', { unique: false });
                }
            };
            request.onsuccess = function () { resolve(request.result); };
            request.onerror = function () { reject(request.error || new Error('Could not open temporary share storage.')); };
        });
    }
    async function readPending(id) {
        var db = await openDb();
        try {
            return await new Promise(function (resolve, reject) {
                var request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id);
                request.onsuccess = function () { resolve(request.result || null); };
                request.onerror = function () { reject(request.error); };
            });
        } finally { db.close(); }
    }
    async function deletePending(id) {
        if (!id) return;
        var db = await openDb();
        try {
            await new Promise(function (resolve, reject) {
                var request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(id);
                request.onsuccess = function () { resolve(); };
                request.onerror = function () { reject(request.error); };
            });
        } finally { db.close(); }
    }
    function recordPayload(record) {
        return {
            id: text(record && record.id),
            title: text(record && record.title),
            text: text(record && record.text),
            url: text(record && record.url),
            files: Array.isArray(record && record.files) ? record.files : [],
            receivedAt: Number(record && record.createdAt) || Date.now()
        };
    }
    function cleanShareUrl() {
        if (!global.location || !global.history || typeof global.history.replaceState !== 'function') return;
        try {
            var clean = new URL(global.location.href);
            ['share_pending', 'share_error', 'share_text', 'share_title', 'share_url', 'text', 'title', 'url'].forEach(function (key) { clean.searchParams.delete(key); });
            global.history.replaceState({}, '', clean.toString());
        } catch (_) {}
    }
    function report(error, where) {
        try { if (typeof global.SutraReportError === 'function') global.SutraReportError(error, { where: where }, 'error'); } catch (_) {}
    }

    function appendText(parent, tag, value, className) {
        var node = document.createElement(tag); node.textContent = value;
        if (className) node.className = className;
        parent.appendChild(node); return node;
    }
    function appendFilePreview(parent, file, objectUrls) {
        var row = document.createElement('div'); row.className = 'sutra-share-file';
        if (/^image\//.test(text(file.type))) {
            var image = document.createElement('img');
            var objectUrl = URL.createObjectURL(file); objectUrls.push(objectUrl);
            image.src = objectUrl; image.alt = 'Preview of ' + text(file.name || 'shared image'); row.appendChild(image);
        }
        appendText(row, 'span', text(file.name || 'Shared file'), 'sutra-share-file-name');
        appendText(row, 'span', Math.max(1, Math.round((Number(file.size) || 0) / 1024)) + ' KB', 'sutra-share-file-size');
        parent.appendChild(row);
    }

    async function routeApprovedShare(payload, destination) {
        var files = payload.files || [];
        var content = composeText(payload);
        if (files.length) {
            var allText = files.every(function (file) { return /^text\//.test(text(file.type)) || /\.(?:txt|md|markdown|csv|ics|html?)$/i.test(text(file.name)); });
            if (allText && destination !== 'note' && global.SutraSmartImport && typeof global.SutraSmartImport.open === 'function') {
                var extracted = await Promise.all(files.map(function (file) { return file.text(); }));
                global.SutraSmartImport.open([destinationPrefix(destination) + content].concat(extracted).filter(Boolean).join('\n\n'));
                return true;
            }
            var importer = global.SutraDocumentImport && typeof global.SutraDocumentImport.importSharedFiles === 'function'
                ? global.SutraDocumentImport.importSharedFiles
                : (global.flowAtelier && typeof global.flowAtelier.importSharedFiles === 'function' ? global.flowAtelier.importSharedFiles : null);
            if (importer) return !!(await importer(files, { title: payload.title, text: payload.text, url: payload.url, destination: destination }));
            if (allText && global.SutraSmartImport && typeof global.SutraSmartImport.open === 'function') {
                var noteText = await Promise.all(files.map(function (file) { return file.text(); }));
                global.SutraSmartImport.open([content].concat(noteText).filter(Boolean).join('\n\n'));
                return true;
            }
            throw new Error('File import is not ready in this session. The temporary share is still available; retry after Sutra finishes loading.');
        }
        var quickCapture = global.flowAtelier && typeof global.flowAtelier.openQuickCaptureModal === 'function'
            ? global.flowAtelier.openQuickCaptureModal
            : (typeof global.openQuickCaptureModal === 'function' ? global.openQuickCaptureModal : null);
        if (!quickCapture) throw new Error('Quick Capture is not ready yet. The temporary share was not removed.');
        return quickCapture(destinationPrefix(destination) + content) !== false;
    }

    function showShareConfirmModal(payload, options) {
        if (typeof document === 'undefined') return null;
        var validation = validatePayload(payload);
        var kind = classifyPayload(payload);
        var destination = destinationHint(payload, kind);
        var objectUrls = [];
        var previousFocus = document.activeElement;
        var overlay = document.createElement('div'); overlay.className = 'sutra-share-overlay';
        overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-labelledby', 'sutraShareHeading');
        var card = document.createElement('div'); card.className = 'sutra-share-card';
        var heading = appendText(card, 'h3', 'Shared content'); heading.id = 'sutraShareHeading';
        if (payload.title) appendText(card, 'p', payload.title, 'sutra-share-title');
        if (payload.url) {
            if (/^https?:\/\//i.test(payload.url)) {
                var link = document.createElement('a'); link.href = payload.url; link.textContent = payload.url;
                link.rel = 'noopener noreferrer'; link.target = '_blank'; card.appendChild(link);
            } else appendText(card, 'p', payload.url, 'sutra-share-url-invalid');
        }
        if (payload.text) appendText(card, 'pre', payload.text.slice(0, 2000), 'sutra-share-text');
        (payload.files || []).forEach(function (file) { appendFilePreview(card, file, objectUrls); });
        var destinationLabel = document.createElement('label'); destinationLabel.textContent = 'Save to';
        var select = document.createElement('select'); select.className = 'modal-input';
        var allTextFiles = (payload.files || []).every(function (file) { return /^text\//.test(text(file.type)) || /\.(?:txt|md|markdown|csv|ics|html?)$/i.test(text(file.name)); });
        var destinations = payload.files && payload.files.length && !allTextFiles
            ? [['note', 'Notes']]
            : [['capture', 'Quick Capture'], ['note', 'Notes'], ['homework', 'Homework'], ['task', 'Tasks'], ['reminder', 'Reminders'], ['timeline', 'Timeline'], ['review', 'Review']];
        destinations.forEach(function (entry) {
            var option = document.createElement('option'); option.value = entry[0]; option.textContent = entry[1]; option.selected = entry[0] === destination; select.appendChild(option);
        });
        destinationLabel.appendChild(select); card.appendChild(destinationLabel);
        var status = appendText(card, 'p', validation.ok ? 'Review the destination before saving. Nothing has been added yet.' : validation.message, 'sutra-share-status');
        status.setAttribute('aria-live', 'polite');
        var actions = document.createElement('div'); actions.className = 'sutra-share-actions';
        var cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'sutra-share-btn-ghost'; cancel.textContent = 'Cancel';
        var apply = document.createElement('button'); apply.type = 'button'; apply.className = 'sutra-share-btn-primary'; apply.textContent = 'Save'; apply.disabled = !validation.ok;
        actions.appendChild(cancel); actions.appendChild(apply); card.appendChild(actions); overlay.appendChild(card); document.body.appendChild(overlay);
        async function close(removePending) {
            if (removePending && payload.id) {
                try { await deletePending(payload.id); } catch (error) { report(error, 'share-target.cleanup'); }
            }
            activeIds.delete(payload.id); objectUrls.forEach(function (url) { URL.revokeObjectURL(url); }); overlay.remove(); cleanShareUrl();
            if (previousFocus && typeof previousFocus.focus === 'function' && document.contains(previousFocus)) previousFocus.focus();
        }
        cancel.addEventListener('click', function () { close(true); });
        overlay.addEventListener('click', function (event) { if (event.target === overlay) close(true); });
        overlay.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') { event.preventDefault(); close(true); return; }
            if (event.key !== 'Tab') return;
            var focusable = Array.from(card.querySelectorAll('a,button:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'));
            if (!focusable.length) return;
            var first = focusable[0]; var last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        });
        apply.addEventListener('click', async function () {
            apply.disabled = true; status.textContent = 'Opening the selected Sutra workflow…';
            try {
                var routed = await routeApprovedShare(payload, select.value);
                if (!routed) throw new Error('The selected workflow did not accept the share.');
                await close(true);
            } catch (error) {
                status.textContent = error && error.message ? error.message : 'The shared content could not be opened.';
                apply.disabled = false; report(error, 'share-target.apply');
            }
        });
        cancel.focus();
        return overlay;
    }

    async function consumePending(id) {
        var safeId = text(id);
        if (!/^[a-zA-Z0-9_-]{8,100}$/.test(safeId) || activeIds.has(safeId)) return null;
        activeIds.add(safeId);
        try {
            var record = await readPending(safeId);
            if (!record) throw new Error('This temporary share is no longer available. Share it again from the source app.');
            return showShareConfirmModal(recordPayload(record), { pending: true });
        } catch (error) {
            activeIds.delete(safeId); report(error, 'share-target.consume');
            if (typeof global.showToast === 'function') global.showToast(error.message || 'Shared content could not be opened.');
            return null;
        }
    }
    function checkUrlShareParams() {
        if (!global.location) return;
        var params = new URLSearchParams(global.location.search);
        var errorCode = params.get('share_error');
        if (errorCode) {
            var errors = {
                too_many_files: 'Share no more than 8 files at once.',
                unsupported_type: 'That file type is not supported by Sutra’s Share Target.',
                file_too_large: 'A shared file exceeded the 20 MB limit.',
                share_too_large: 'The shared files exceeded the 30 MB combined limit.',
                text_too_large: 'The shared text exceeded the 80,000 character limit.',
                unsafe_url: 'Only http or https source links can be shared into Sutra.',
                empty: 'The source app did not provide any shareable content.',
                temporary_storage_unavailable: 'Sutra could not retain the shared content safely. Nothing was saved.'
            };
            if (typeof global.showToast === 'function') global.showToast(errors[errorCode] || 'The shared content could not be received.');
            cleanShareUrl();
            return;
        }
        var pending = params.get('share_pending');
        if (pending) { consumePending(pending); return; }
        var payload = { title: params.get('share_title') || params.get('title') || '', text: params.get('share_text') || params.get('text') || '', url: params.get('share_url') || params.get('url') || '', files: [] };
        if (classifyPayload(payload) !== 'empty') showShareConfirmModal(payload, { pending: false });
    }
    function isTrustedMessageOrigin(origin, sameOrigin) {
        // Defense-in-depth: only accept the ready-signal from our own origin.
        // Messages from the service worker carry an empty origin; reject any
        // non-empty cross-origin sender. (The id is also format-validated and
        // must match a stored record downstream.)
        return !origin || !sameOrigin || origin === sameOrigin;
    }
    function init() {
        checkUrlShareParams();
        if (typeof global.addEventListener === 'function') {
            global.addEventListener('message', function (event) {
                if (!event || !event.data || event.data.type !== 'SUTRA_SHARE_READY') return;
                var sameOrigin = '';
                try { sameOrigin = (global.location && global.location.origin) || ''; } catch (_) {}
                if (!isTrustedMessageOrigin(event.origin, sameOrigin)) return;
                consumePending(event.data.id);
            });
        }
    }

    var api = {
        classifyPayload: classifyPayload,
        destinationHint: destinationHint,
        validatePayload: validatePayload,
        composeText: composeText,
        showShareConfirmModal: showShareConfirmModal,
        routeApprovedShare: routeApprovedShare,
        consumePending: consumePending,
        deletePending: deletePending,
        checkUrlShareParams: checkUrlShareParams,
        isTrustedMessageOrigin: isTrustedMessageOrigin,
        MAX_TEXT_LENGTH: MAX_TEXT_LENGTH,
        MAX_FILE_SIZE: MAX_FILE_SIZE,
        MAX_TOTAL_SIZE: MAX_TOTAL_SIZE,
        MAX_FILES: MAX_FILES,
        SUPPORTED_TYPES: SUPPORTED_TYPES.slice()
    };
    global.SutraShareTarget = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
        else init();
    }
}(typeof window !== 'undefined' ? window : globalThis));

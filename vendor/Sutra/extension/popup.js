// Popup logic for Sutra LMS Capture.
//
// Flow: inject capturePageAssignments() into the active tab (activeTab grant),
// build "#sutra-import" text (the exact format Sutra's paste importer and
// bookmarklet already speak), then hand it off — either by opening/focusing a
// Sutra tab (the content script posts it into the page) or via the clipboard.

const DEFAULT_SUTRA_URL = 'https://tanujranjith.github.io/Sutra/Sutra.html';

// Runs INSIDE the LMS page. Must stay self-contained (no closures over popup
// scope). Tries the Canvas REST API first — on any Canvas page the student is
// signed in, /api/v1 answers with their real assignment list, which beats DOM
// scraping — and falls back to scanning visible assignment links (the same
// heuristic as Sutra's bookmarklet) on non-Canvas pages.
async function capturePageAssignments() {
    const pad = (n) => String(n).padStart(2, '0');
    const localDue = (iso) => {
        if (!iso) return '';
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    const cleanText = (s) => String(s || '').replace(/\s+/g, ' ').replace(/\|/g, '/').trim();

    async function canvasApi(path) {
        const res = await fetch(path, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        let text = await res.text();
        if (text.startsWith('while(1);')) text = text.slice(9);
        return JSON.parse(text);
    }

    async function captureViaCanvasApi() {
        const courses = await canvasApi('/api/v1/courses?enrollment_state=active&per_page=100');
        if (!Array.isArray(courses) || !courses.length) return null;
        const rows = [];
        for (const course of courses.slice(0, 20)) {
            if (!course || !course.id) continue;
            const courseName = cleanText(course.name || course.course_code || 'Class');
            for (const bucket of ['upcoming', 'overdue', 'undated']) {
                let assignments = [];
                try {
                    assignments = await canvasApi(`/api/v1/courses/${course.id}/assignments?bucket=${bucket}&per_page=100&order_by=due_at`);
                } catch (error) {
                    continue; // e.g. a course with assignments disabled
                }
                (Array.isArray(assignments) ? assignments : []).forEach((a) => {
                    if (!a || !a.name) return;
                    rows.push([courseName, cleanText(a.name), localDue(a.due_at), a.html_url || ''].join(' | '));
                });
            }
        }
        return rows;
    }

    function captureViaDom() {
        const seen = {};
        const rows = [];
        const course = cleanText((document.title || '').split(/[>|]/)[0]);
        document.querySelectorAll('a[href*="/assignments/"],a[href*="/quizzes/"],a[href*="/discussion_topics/"]').forEach((a) => {
            const t = cleanText(a.textContent);
            if (!t || t.length < 3 || seen[a.href]) return;
            seen[a.href] = 1;
            const box = a.closest('li,tr,div');
            const m = box && box.textContent.match(/due\s*:?\s*([A-Za-z]{3,9}\s+\d{1,2}(?:,\s*\d{4})?(?:\s+at\s+[\d: ]+(?:am|pm)?)?)/i);
            rows.push([course, t, m ? cleanText(m[1]) : '', a.href].join(' | '));
        });
        return rows;
    }

    let rows = null;
    let source = 'canvas-api';
    try {
        rows = await captureViaCanvasApi();
    } catch (error) {
        rows = null;
    }
    if (!rows || !rows.length) {
        source = 'page-links';
        rows = captureViaDom();
    }
    // De-dupe by URL (a Canvas assignment can sit in two buckets).
    const seenRow = new Set();
    rows = (rows || []).filter((r) => {
        const url = r.split(' | ')[3] || r;
        if (seenRow.has(url)) return false;
        seenRow.add(url);
        return true;
    });
    if (!rows.length) return { ok: false, error: 'No assignments found. On Canvas, any page works once you are signed in; elsewhere, open the course’s assignments page.' };
    return { ok: true, source, count: rows.length, text: '#sutra-import\n' + rows.join('\n') };
}

const statusEl = document.getElementById('status');
const previewEl = document.getElementById('preview');
const actionsEl = document.getElementById('actions');
const captureBtn = document.getElementById('captureBtn');
const sendBtn = document.getElementById('sendBtn');
const copyBtn = document.getElementById('copyBtn');

function setStatus(message, isError) {
    statusEl.textContent = message || '';
    statusEl.className = isError ? 'error' : '';
}

let capturedText = '';

captureBtn.addEventListener('click', async () => {
    captureBtn.disabled = true;
    setStatus('Capturing…');
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) throw new Error('No active tab.');
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: capturePageAssignments
        });
        const result = results && results[0] && results[0].result;
        if (!result || !result.ok) throw new Error((result && result.error) || 'Capture failed on this page.');
        capturedText = result.text;
        previewEl.value = capturedText;
        previewEl.style.display = 'block';
        actionsEl.style.display = 'block';
        setStatus(`Found ${result.count} assignment${result.count === 1 ? '' : 's'} (${result.source === 'canvas-api' ? 'Canvas' : 'page links'}).`);
    } catch (error) {
        setStatus(error && error.message ? error.message : 'Capture failed.', true);
    } finally {
        captureBtn.disabled = false;
    }
});

sendBtn.addEventListener('click', async () => {
    if (!capturedText) return;
    sendBtn.disabled = true;
    try {
        await chrome.storage.local.set({
            sutraPendingCapture: { text: capturedText, savedAt: Date.now() }
        });
        const { sutraAppUrl } = await chrome.storage.sync.get({ sutraAppUrl: DEFAULT_SUTRA_URL });
        const appUrl = sutraAppUrl || DEFAULT_SUTRA_URL;
        // Focus an existing Sutra tab when there is one; its bridge picks the
        // payload up from storage. Otherwise open a fresh tab.
        const urlPattern = appUrl.replace(/[?#].*$/, '') + '*';
        let matched = [];
        try { matched = await chrome.tabs.query({ url: urlPattern }); } catch (error) { matched = []; }
        if (matched.length && matched[0].id) {
            await chrome.tabs.update(matched[0].id, { active: true });
            if (typeof matched[0].windowId === 'number') {
                try { await chrome.windows.update(matched[0].windowId, { focused: true }); } catch (error) { /* non-critical */ }
            }
        } else {
            await chrome.tabs.create({ url: appUrl });
        }
        setStatus('Sent — review the rows in Sutra.');
        window.close();
    } catch (error) {
        setStatus(error && error.message ? error.message : 'Could not open Sutra.', true);
        sendBtn.disabled = false;
    }
});

copyBtn.addEventListener('click', async () => {
    if (!capturedText) return;
    try {
        await navigator.clipboard.writeText(capturedText);
        setStatus('Copied. In Sutra: Command palette → "Import homework (paste)…", then paste.');
    } catch (error) {
        setStatus('Copy failed — select the preview text and copy manually.', true);
    }
});

document.getElementById('optionsLink').addEventListener('click', (event) => {
    event.preventDefault();
    chrome.runtime.openOptionsPage();
});

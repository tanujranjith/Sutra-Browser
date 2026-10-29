// Review tab — spaced repetition + active recall, Quizlet-style.
//
// View-state machine: 'library' (deck grid) → 'deck' (deck detail with cards
// table + study buttons) → 'study' (active session with one of five modes).
//
// Five study modes:
//   1. Flashcards — reveal then SM-2 grade Again/Hard/Good/Easy.
//   2. Learn      — adaptive multiple-choice with mastery tracking.
//   3. Write      — type the answer, fuzzy-compare, retry on miss.
//   4. Test       — fixed-length mixed-format quiz with score + review.
//   5. Match      — timed pair-up grid; best time stored per deck.
//
// All state lives in the global `reviewWorkspace` binding from app.js so every
// addition flows through persistAppData → buildWorkspaceExportPayload →
// importWorkspacePayload (verified by round-trip-check.mjs).
(function () {
    const DECK_COLORS = ['#d8c4a1', '#9ec1ff', '#9eddc1', '#f4b860', '#c19eff', '#ffb0b0', '#84d6c8', '#7aa2f7'];
    const MIN_EASE = 1.3;
    const STARTING_EASE = 2.5;
    const WEAK_LAPSE_THRESHOLD = 3;
    const STUDY_MODES = ['flashcards', 'learn', 'write', 'test', 'match'];
    const MASTERY_LEVELS = ['new', 'learning', 'familiar', 'mastered'];

    let reviewUiBound = false;
    let viewState = {
        view: 'library',         // 'library' | 'deck' | 'study' | 'create'
        deckId: null,
        session: null,           // active session object (with _queue and _mode-specific state)
        librarySearch: '',
        libraryFilter: 'all',    // 'all' | 'starred' | 'archived'
        deckTab: 'cards',        // 'cards' | 'add' | 'stats'
        editingCardId: null,
        addCardOpen: false,
        deckFilter: { search: '', mastery: 'all', starredOnly: false },
        // Create-set draft buffer for the polished create panel.
        createDraft: null,
        // Flashcards UI state (set-level toggles).
        flashcards: { shuffled: true, swapped: false }
    };

    // ------------------------------------------------------------------
    // Utilities
    // ------------------------------------------------------------------
    function makeId(prefix) {
        try {
            if (typeof generateId === 'function') return `${prefix}_${generateId()}`;
        } catch (err) { /* fall through */ }
        return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    }

    function nowIso() { return new Date().toISOString(); }

    function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
    function endOfToday() { const d = new Date(); d.setHours(23, 59, 59, 999); return d; }
    function daysFromNow(days) { const d = startOfToday(); d.setDate(d.getDate() + Math.round(days || 0)); return d.toISOString(); }

    function shuffle(arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function fuzzyEqual(a, b, exact) {
        const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
        const na = norm(a);
        const nb = norm(b);
        if (!na || !nb) return false;
        if (exact) return na === nb;
        if (na === nb) return true;
        // Allow ignoring trailing punctuation and articles.
        const stripPunct = (s) => s.replace(/[.,!?;:'"`]/g, '').replace(/^(the|a|an)\s+/, '').trim();
        return stripPunct(na) === stripPunct(nb);
    }

    function safeWorkspace() {
        if (typeof reviewWorkspace === 'undefined' || !reviewWorkspace) return null;
        if (!Array.isArray(reviewWorkspace.decks)) reviewWorkspace.decks = [];
        if (!Array.isArray(reviewWorkspace.items)) reviewWorkspace.items = [];
        if (!Array.isArray(reviewWorkspace.sessions)) reviewWorkspace.sessions = [];
        if (!reviewWorkspace.settings || typeof reviewWorkspace.settings !== 'object') {
            reviewWorkspace.settings = {
                dailyLimit: 30, newItemsPerDay: 10, interleaveDecks: true,
                showAnswerMode: 'manual', defaultStudyMode: 'flashcards',
                learnRequiresExact: false, testQuestionCount: 20,
                testQuestionTypes: ['written', 'mc', 'tf'], matchPairCount: 6,
                shuffleCards: true, frontSide: 'prompt'
            };
        }
        return reviewWorkspace;
    }

    function persist() {
        try { if (typeof persistAppData === 'function') persistAppData(); } catch (err) { /* non-critical */ }
    }

    function notify(msg) {
        try { if (typeof showToast === 'function') showToast(msg); } catch (err) { /* non-critical */ }
    }

    // ------------------------------------------------------------------
    // Custom Atelier modal — replaces window.prompt / window.confirm so
    // every dialog inside the Review tab uses the app's own UI.
    // Usage:
    //   reviewConfirm({ title, message, danger, confirmLabel }).then(ok => ...)
    //   reviewBulkImport(deckId)  // shows the import textarea modal
    //   reviewDestroyConfirm(...) // alias for danger destructive prompts
    // ------------------------------------------------------------------
    let activeReviewModal = null;
    let reviewModalKeyBound = false;

    function ensureReviewModalRoot() {
        let host = document.getElementById('reviewModalRoot');
        if (!host) {
            host = document.createElement('div');
            host.id = 'reviewModalRoot';
            host.className = 'review-modal-root';
            // SutraModalManager picks this up (Tab-trap, scroll-lock, focus
            // restoration) but must NOT handle Escape — this module owns Escape
            // (and Ctrl/Cmd+Enter) via reviewModalKeyHandler with cancel callbacks.
            host.setAttribute('data-sutra-no-escape', 'true');
            document.body.appendChild(host);
        }
        if (!reviewModalKeyBound) {
            reviewModalKeyBound = true;
            document.addEventListener('keydown', reviewModalKeyHandler);
        }
        return host;
    }

    function reviewModalKeyHandler(event) {
        if (!activeReviewModal) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            const cb = activeReviewModal.onCancel;
            dismissReviewModal();
            if (typeof cb === 'function') cb();
            return;
        }
        if (event.key === 'Enter') {
            // For textarea modals, only Ctrl/Cmd+Enter submits.
            const isTextarea = activeReviewModal.kind === 'bulk';
            if (isTextarea && !(event.ctrlKey || event.metaKey)) return;
            // For prompt modals where focus is in input, allow plain Enter.
            const target = event.target;
            const inOurInput = target && target.classList && (target.classList.contains('review-modal-input') || target.classList.contains('review-modal-textarea'));
            if (activeReviewModal.kind === 'confirm' || inOurInput) {
                event.preventDefault();
                submitReviewModal();
            }
        }
    }

    function showReviewModal(opts) {
        const host = ensureReviewModalRoot();
        // Register the trigger before rendering or autofocus can move it.
        // The shared manager remains the sole owner of restoration.
        host.__sutraReturnFocus = document.activeElement;
        activeReviewModal = Object.assign({
            kind: 'confirm',         // 'confirm' | 'prompt' | 'bulk'
            title: '',
            message: '',
            defaultValue: '',
            placeholder: '',
            confirmLabel: 'Confirm',
            cancelLabel: 'Cancel',
            danger: false,
            onConfirm: () => {},
            onCancel: () => {}
        }, opts || {});
        renderReviewModal();
    }

    function dismissReviewModal() {
        activeReviewModal = null;
        renderReviewModal();
    }

    function submitReviewModal() {
        if (!activeReviewModal) return;
        const cb = activeReviewModal.onConfirm;
        const input = document.querySelector('#reviewModalRoot .review-modal-input, #reviewModalRoot .review-modal-textarea');
        const value = input ? input.value : '';
        dismissReviewModal();
        if (typeof cb === 'function') cb(value);
    }

    function cancelReviewModal() {
        if (!activeReviewModal) return;
        const cb = activeReviewModal.onCancel;
        dismissReviewModal();
        if (typeof cb === 'function') cb();
    }

    function renderReviewModal() {
        const host = ensureReviewModalRoot();
        if (!activeReviewModal) {
            host.innerHTML = '';
            host.classList.remove('is-visible');
            host.removeAttribute('aria-hidden');
            if (window.SutraModalManager) window.SutraModalManager.sync();
            return;
        }
        const m = activeReviewModal;
        const titleId = 'reviewModalTitle';
        const messageHtml = m.message ? `<div class="review-modal-message">${escapeHtml(m.message).replace(/\n/g, '<br>')}</div>` : '';
        let inputHtml = '';
        if (m.kind === 'prompt') {
            inputHtml = `<input type="text" class="review-modal-input" placeholder="${escapeHtml(m.placeholder || '')}" value="${escapeHtml(m.defaultValue || '')}" />`;
        } else if (m.kind === 'bulk') {
            inputHtml = `<textarea class="review-modal-textarea" rows="9" placeholder="${escapeHtml(m.placeholder || '')}" spellcheck="false">${escapeHtml(m.defaultValue || '')}</textarea>`;
        }
        host.innerHTML = `
            <div class="review-modal-backdrop" data-review-modal-action="cancel" aria-hidden="true"></div>
            <div class="review-modal-card" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
                ${m.title ? `<header class="review-modal-head"><h2 class="review-modal-title" id="${titleId}">${escapeHtml(m.title)}</h2><button type="button" class="review-modal-close" data-review-modal-action="cancel" aria-label="Close">×</button></header>` : ''}
                <div class="review-modal-body">
                    ${messageHtml}
                    ${inputHtml}
                </div>
                <footer class="review-modal-actions">
                    <button type="button" class="review-btn-ghost" data-review-modal-action="cancel">${escapeHtml(m.cancelLabel)}</button>
                    <button type="button" class="review-btn-primary${m.danger ? ' review-btn-danger-solid' : ''}" data-review-modal-action="confirm">${escapeHtml(m.confirmLabel)}</button>
                </footer>
            </div>
        `;
        host.classList.add('is-visible');
        if (window.SutraModalManager) window.SutraModalManager.sync();
        host.querySelectorAll('[data-review-modal-action]').forEach(btn => {
            btn.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                const action = btn.getAttribute('data-review-modal-action');
                if (action === 'confirm') submitReviewModal();
                else cancelReviewModal();
            });
        });
        // Auto-focus: input if present, else the confirm button.
        setTimeout(() => {
            const input = host.querySelector('.review-modal-input, .review-modal-textarea');
            if (input) {
                try { input.focus(); input.select && input.select(); } catch (err) { /* non-critical */ }
            } else {
                const confirmBtn = host.querySelector('[data-review-modal-action="confirm"]');
                if (confirmBtn) try { confirmBtn.focus(); } catch (err) { /* non-critical */ }
            }
        }, 30);
    }

    function reviewConfirm(opts) {
        return new Promise(resolve => {
            showReviewModal({
                kind: 'confirm',
                title: (opts && opts.title) || 'Are you sure?',
                message: opts && opts.message,
                confirmLabel: (opts && opts.confirmLabel) || 'Confirm',
                cancelLabel: (opts && opts.cancelLabel) || 'Cancel',
                danger: !!(opts && opts.danger),
                onConfirm: () => resolve(true),
                onCancel: () => resolve(false)
            });
        });
    }

    function reviewBulkImport(deckId) {
        const example = 'Mitochondria\tThe powerhouse of the cell\nPhotosynthesis - converts light to chemical energy';
        showReviewModal({
            kind: 'bulk',
            title: 'Bulk import cards',
            message: 'Paste cards, one per line — works with Quizlet, Anki text exports, and CSV. Separators auto-detected: Tab, " - ", " = ", or comma. Use {{double braces}} in the prompt for a cloze (fill-in-the-blank). For Anki .apkg, export from Anki via File → Export → "Notes in Plain Text (.txt)" first.',
            placeholder: example,
            confirmLabel: 'Import cards',
            cancelLabel: 'Cancel',
            onConfirm: (raw) => {
                const count = bulkImportCards(deckId, raw);
                notify(count ? `Imported ${count} card${count === 1 ? '' : 's'}.` : 'Nothing imported.');
                if (count) {
                    viewState.view = 'deck';
                    viewState.deckId = deckId;
                    render();
                }
            }
        });
    }

    // ------------------------------------------------------------------
    // Data accessors
    // ------------------------------------------------------------------
    function getDecks(includeArchived) {
        const ws = safeWorkspace();
        if (!ws) return [];
        return includeArchived ? ws.decks.slice() : ws.decks.filter(d => !d.archived);
    }

    function getDeck(deckId) {
        const ws = safeWorkspace();
        if (!ws) return null;
        return ws.decks.find(d => d.id === deckId) || null;
    }

    function getItems(deckId) {
        const ws = safeWorkspace();
        if (!ws) return [];
        return deckId ? ws.items.filter(i => i.deckId === deckId) : ws.items.slice();
    }

    function isDue(item) {
        if (!item || !item.nextReviewAt) return true;
        try { return new Date(item.nextReviewAt).getTime() <= endOfToday().getTime(); }
        catch (err) { return true; }
    }

    function isOverdue(item) {
        if (!item || !item.nextReviewAt) return false;
        try { return new Date(item.nextReviewAt).getTime() < startOfToday().getTime(); }
        catch (err) { return false; }
    }

    function getDueItems(deckId) {
        const ws = safeWorkspace();
        if (!ws) return [];
        const decks = new Set(getDecks(false).map(d => d.id));
        return ws.items.filter(i => decks.has(i.deckId) && isDue(i) && (!deckId || i.deckId === deckId));
    }

    function getOverdueItems() {
        const ws = safeWorkspace();
        if (!ws) return [];
        const decks = new Set(getDecks(false).map(d => d.id));
        return ws.items.filter(i => decks.has(i.deckId) && isOverdue(i));
    }

    function getReviewedThisWeek() {
        const ws = safeWorkspace();
        if (!ws) return 0;
        const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        return ws.sessions.reduce((sum, s) => {
            const ended = s.endedAt ? new Date(s.endedAt).getTime() : 0;
            return sum + ((ended >= weekAgo) ? (s.totalReviewed || (s.itemResults || []).length) : 0);
        }, 0);
    }

    function getWeakCards() {
        const ws = safeWorkspace();
        if (!ws) return [];
        return ws.items
            .filter(i => (i.lapses || 0) >= WEAK_LAPSE_THRESHOLD)
            .sort((a, b) => (b.lapses || 0) - (a.lapses || 0))
            .slice(0, 12);
    }

    function getReviewStreak() {
        const ws = safeWorkspace();
        if (!ws || !ws.sessions.length) return 0;
        const dayKeys = new Set();
        ws.sessions.forEach(s => {
            const ended = s.endedAt || s.startedAt;
            if (ended) dayKeys.add(String(ended).slice(0, 10));
        });
        let streak = 0;
        const cursor = startOfToday();
        for (let i = 0; i < 365; i += 1) {
            const k = cursor.toISOString().slice(0, 10);
            if (!dayKeys.has(k)) {
                if (i === 0) { cursor.setDate(cursor.getDate() - 1); continue; }
                break;
            }
            streak += 1;
            cursor.setDate(cursor.getDate() - 1);
        }
        return streak;
    }

    function getDeckMastery(deckId) {
        const items = getItems(deckId);
        const counts = { new: 0, learning: 0, familiar: 0, mastered: 0 };
        items.forEach(i => {
            const m = MASTERY_LEVELS.includes(i.mastery) ? i.mastery : 'new';
            counts[m] += 1;
        });
        return counts;
    }

    function masteryPercent(counts) {
        const total = (counts.new || 0) + (counts.learning || 0) + (counts.familiar || 0) + (counts.mastered || 0);
        if (!total) return 0;
        return Math.round(((counts.familiar * 0.6) + counts.mastered) / total * 100);
    }

    // ------------------------------------------------------------------
    // Mutators
    // ------------------------------------------------------------------
    function createDeck(input) {
        const ws = safeWorkspace();
        if (!ws) return null;
        const name = String(input && input.name || '').trim();
        if (!name) return null;
        const deck = {
            id: makeId('deck'),
            name,
            description: String(input && input.description || ''),
            subject: String(input && input.subject || ''),
            sourceType: String(input && input.sourceType || ''),
            sourceId: input && input.sourceId ? String(input.sourceId) : null,
            color: DECK_COLORS[ws.decks.length % DECK_COLORS.length],
            archived: false,
            studyMode: 'flashcards',
            lastStudiedAt: null,
            bestMatchTimeMs: null,
            createdAt: nowIso(),
            updatedAt: nowIso()
        };
        ws.decks.push(deck);
        persist();
        return deck;
    }

    function updateDeck(deckId, patch) {
        const deck = getDeck(deckId);
        if (!deck) return null;
        Object.assign(deck, patch || {}, { updatedAt: nowIso() });
        persist();
        return deck;
    }

    function deleteDeck(deckId) {
        const ws = safeWorkspace();
        if (!ws) return false;
        const before = ws.decks.length;
        ws.decks = ws.decks.filter(d => d.id !== deckId);
        const removed = ws.decks.length < before;
        ws.items = ws.items.filter(i => i.deckId !== deckId);
        persist();
        return removed;
    }

    function setDeckArchived(deckId, archived) {
        updateDeck(deckId, { archived: !!archived });
    }

    function createItem(input) {
        const ws = safeWorkspace();
        if (!ws) return null;
        const deckId = String(input && input.deckId || '').trim();
        if (!deckId || !getDeck(deckId)) return null;
        const prompt = String(input && input.prompt || '').trim();
        if (!prompt) return null;
        const tags = Array.isArray(input && input.tags)
            ? input.tags.map(t => String(t).trim()).filter(Boolean)
            : String(input && input.tags || '').split(',').map(t => t.trim()).filter(Boolean);
        const item = {
            id: makeId('item'),
            deckId,
            prompt,
            answer: String(input && input.answer || ''),
            hint: String(input && input.hint || ''),
            imageUrl: String(input && input.imageUrl || ''),
            audioUrl: String(input && input.audioUrl || ''),
            occludeImage: !!(input && input.occludeImage),
            starred: !!(input && input.starred),
            mastery: 'new',
            correctCount: 0,
            incorrectCount: 0,
            studyTimeSeconds: 0,
            tags,
            sourceType: String(input && input.sourceType || ''),
            sourceId: input && input.sourceId ? String(input.sourceId) : null,
            sourceNoteId: input && input.sourceNoteId ? String(input.sourceNoteId) : null,
            sourceApClassId: input && input.sourceApClassId ? String(input.sourceApClassId) : null,
            sourceAssignmentId: input && input.sourceAssignmentId ? String(input.sourceAssignmentId) : null,
            sourceProjectId: input && input.sourceProjectId ? String(input.sourceProjectId) : null,
            difficulty: String(input && input.difficulty || 'medium'),
            status: 'new',
            nextReviewAt: nowIso(),
            lastReviewedAt: null,
            intervalDays: 0,
            ease: STARTING_EASE,
            repetitions: 0,
            lapses: 0,
            createdAt: nowIso(),
            updatedAt: nowIso()
        };
        ws.items.push(item);
        persist();
        return item;
    }

    function updateItem(itemId, patch) {
        const ws = safeWorkspace();
        if (!ws) return null;
        const item = ws.items.find(i => i.id === itemId);
        if (!item) return null;
        Object.assign(item, patch || {}, { updatedAt: nowIso() });
        persist();
        return item;
    }

    function deleteItem(itemId) {
        const ws = safeWorkspace();
        if (!ws) return;
        ws.items = ws.items.filter(i => i.id !== itemId);
        persist();
    }

    // Duress/permanent note deletion must not leave flashcards derived from
    // that note behind. Removes decks (and their items/sessions) whose
    // source is the deleted note, plus any card that still points at it.
    function purgeNoteContent(noteIds) {
        const ws = safeWorkspace();
        if (!ws) return { failed: true };
        const ids = new Set((Array.isArray(noteIds) ? noteIds : []).map(id => String(id || '').trim()).filter(Boolean));
        if (!ids.size) return { decks: 0, items: 0, sessions: 0 };
        const removedDeckIds = new Set();
        const decksBefore = ws.decks.length;
        ws.decks = ws.decks.filter(deck => {
            const fromNote = String(deck && deck.sourceType || '') === 'note'
                && (ids.has(String(deck.sourceId || '')) || ids.has(String(deck.sourceNoteId || '')));
            if (fromNote) removedDeckIds.add(String(deck.id));
            return !fromNote;
        });
        const itemsBefore = ws.items.length;
        ws.items = ws.items.filter(item => {
            if (removedDeckIds.has(String(item && item.deckId || ''))) return false;
            if (ids.has(String(item && item.sourceNoteId || ''))) return false;
            if (String(item && item.sourceType || '') === 'note' && ids.has(String(item && item.sourceId || ''))) return false;
            return true;
        });
        const sessionsBefore = ws.sessions.length;
        ws.sessions = ws.sessions.filter(session => {
            const decks = Array.isArray(session && session.deckIds) ? session.deckIds : [];
            return !decks.some(deckId => removedDeckIds.has(String(deckId)));
        });
        const removed = {
            decks: decksBefore - ws.decks.length,
            items: itemsBefore - ws.items.length,
            sessions: sessionsBefore - ws.sessions.length
        };
        if (removed.decks || removed.items || removed.sessions) {
            try { persist(); } catch (err) { return { failed: true, removed }; }
        }
        return removed;
    }

    function toggleStar(itemId) {
        const ws = safeWorkspace();
        if (!ws) return;
        const item = ws.items.find(i => i.id === itemId);
        if (!item) return;
        item.starred = !item.starred;
        item.updatedAt = nowIso();
        persist();
    }

    function decodeBasicEntities(s) {
        return String(s || '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&amp;/g, '&');
    }

    // Minimal RFC-4180-ish single-row CSV parser (handles "quoted, cells" and "").
    function parseCsvRow(line) {
        const out = [];
        let cur = '';
        let q = false;
        for (let i = 0; i < line.length; i += 1) {
            const c = line[i];
            if (q) {
                if (c === '"') {
                    if (line[i + 1] === '"') { cur += '"'; i += 1; } else { q = false; }
                } else { cur += c; }
            } else if (c === '"') { q = true; }
            else if (c === ',') { out.push(cur); cur = ''; }
            else { cur += c; }
        }
        out.push(cur);
        return out.map(s => s.trim());
    }

    // One import line -> {prompt, answer}. Adds quoted-CSV support and HTML-entity
    // decoding on top of splitCardLine, so Quizlet, Anki text exports, and CSV
    // all import cleanly. Cloze cards ({{...}}) need no special handling — the
    // braces are preserved in the prompt and rendered at study time.
    function parseImportLine(line) {
        if (/^\s*"/.test(line) && line.indexOf(',') !== -1) {
            const cells = parseCsvRow(line);
            if (cells.length >= 2 && cells[0]) {
                return { prompt: decodeBasicEntities(cells[0]), answer: decodeBasicEntities(cells.slice(1).join(', ')) };
            }
        }
        const c = splitCardLine(line, false);
        return { prompt: decodeBasicEntities(c.prompt), answer: decodeBasicEntities(c.answer) };
    }

    // Build a self-contained, offline HTML flashcard viewer for a deck — a file
    // a student can share with anyone (no account, no app needed). Cards travel
    // as escaped JSON inside the file; cloze prompts render their blanks.
    function buildShareableDeckHtml(deck, items) {
        const esc = (s) => String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        const cards = (items || []).map(it => ({
            prompt: String(it.prompt || ''),
            answer: String(it.answer || ''),
            cloze: hasCloze(it.prompt),
            image: (it.imageUrl && /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]{1,2800000}$/i.test(String(it.imageUrl))) ? String(it.imageUrl) : ''
        }));
        const data = JSON.stringify(cards).replace(/</g, '\\u003c');
        const title = esc(deck && deck.name ? deck.name : 'Flashcards');
        return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; object-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Flashcards</title>
<style>
:root{--bg:#0f1216;--card:#1b212b;--fg:#eef1f6;--muted:#9aa3b2;--accent:#6fa7ff;}
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:var(--bg);color:var(--fg);min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;}
h1{font-size:1.1rem;color:var(--muted);font-weight:600;margin:0 0 16px}
.card{background:var(--card);border-radius:16px;padding:32px;max-width:640px;width:100%;min-height:240px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;cursor:pointer;box-shadow:0 10px 40px rgba(0,0,0,.35);}
.face{font-size:1.3rem;line-height:1.5}.ey{font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:10px}
.cloze{display:inline-block;min-width:2.4em;border-bottom:2px solid var(--accent);color:var(--accent);font-weight:700;margin:0 2px}.fill{color:var(--accent);font-weight:700}
img{max-width:100%;max-height:240px;border-radius:10px;margin-top:14px}
.bar{display:flex;gap:10px;align-items:center;margin-top:18px}
button{background:var(--card);color:var(--fg);border:1px solid #2a313d;border-radius:10px;padding:8px 16px;font-size:.95rem;cursor:pointer}
button:hover{border-color:var(--accent)}.count{color:var(--muted);font-size:.85rem;min-width:64px;text-align:center}
.hint{color:var(--muted);font-size:.8rem;margin-top:10px}
</style></head><body>
<h1>${title}</h1>
<button class="card" id="card" type="button" aria-label="Flip flashcard"></button>
<div class="bar"><button id="prev" type="button">← Prev</button><span class="count" id="count"></span><button id="next" type="button">Next →</button></div>
<div class="hint">Click the card to flip · ${cards.length} card${cards.length === 1 ? '' : 's'} · made with Sutra</div>
<script>
var CARDS=${data};var i=0,showBack=false;
function text(tag,cls,value){var el=document.createElement(tag);if(cls)el.className=cls;el.textContent=String(value==null?'':value);return el}
function appendCloze(el,value,reveal){var source=String(value==null?'':value),re=/\\{\\{([^}]+)\\}\\}/g,last=0,match;while((match=re.exec(source))){el.appendChild(document.createTextNode(source.slice(last,match.index)));el.appendChild(text('span',reveal?'fill':'cloze',reveal?match[1]:'[…]'));last=re.lastIndex}el.appendChild(document.createTextNode(source.slice(last)))}
function appendImage(el,src){if(!src)return;var img=document.createElement('img');img.alt='';img.src=src;el.appendChild(img)}
function render(){var c=CARDS[i]||{prompt:'',answer:''};var el=document.getElementById('card');el.replaceChildren();el.appendChild(text('div','ey',showBack?'Answer':'Prompt'));var face=text('div','face','');if(c.cloze)appendCloze(face,c.prompt,showBack);else face.textContent=showBack?(c.answer||'(no answer)'):c.prompt;el.appendChild(face);if(showBack||!c.cloze)appendImage(el,c.image);document.getElementById('count').textContent=(i+1)+' / '+CARDS.length;}
function flip(){showBack=!showBack;render()}
function next(){if(i<CARDS.length-1){i++;showBack=false;render()}}
function prev(){if(i>0){i--;showBack=false;render()}}
document.getElementById('card').addEventListener('click',flip);document.getElementById('prev').addEventListener('click',prev);document.getElementById('next').addEventListener('click',next);
document.addEventListener('keydown',function(e){if(e.key===' '){e.preventDefault();flip()}else if(e.key==='ArrowRight')next();else if(e.key==='ArrowLeft')prev()});
render();
<\/script></body></html>`;
    }

    function exportShareableDeck(deckId) {
        const deck = getDeck(deckId);
        if (!deck) { notify('Open a set to share it.'); return; }
        const items = getItems(deckId);
        if (!items.length) { notify('This set has no cards to share yet.'); return; }
        try {
            const html = buildShareableDeckHtml(deck, items);
            const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const safeName = String(deck.name || 'flashcards').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 60) || 'flashcards';
            a.href = url; a.download = safeName + '_flashcards.html';
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1500);
            notify('Shareable flashcard file downloaded.');
        } catch (err) { console.warn('share deck failed', err); notify('Could not build the share file.'); }
    }

    function bulkImportCards(deckId, raw) {
        const ws = safeWorkspace();
        if (!ws || !getDeck(deckId)) return 0;
        const text = String(raw || '');
        if (!text.trim()) return 0;
        // Auto-detect separator (tab / " - " / " = " / comma / quoted CSV).
        // Lines starting with "#" are skipped: Anki's plain-text export prefixes
        // directive/comment lines (e.g. "#separator:tab", "#html:true") with #.
        const lines = text.split(/\r?\n/);
        let count = 0;
        lines.forEach(rawLine => {
            const line = rawLine.trim();
            if (!line || /^#/.test(line)) return;
            const card = parseImportLine(line);
            if (!card.prompt) return;
            createItem({ deckId, prompt: card.prompt, answer: card.answer });
            count += 1;
        });
        return count;
    }

    // ------------------------------------------------------------------
    // SM-2-lite scheduling (Flashcards mode)
    // ------------------------------------------------------------------
    function applyGrade(item, grade) {
        if (!item) return item;
        const safeEase = Math.max(MIN_EASE, parseFloat(item.ease) || STARTING_EASE);
        const reps = Math.max(0, parseInt(item.repetitions, 10) || 0);
        let nextInterval;
        let nextEase = safeEase;
        let nextReps = reps;
        let lapses = Math.max(0, parseInt(item.lapses, 10) || 0);
        let status = item.status || 'new';
        let mastery = item.mastery || 'new';
        if (grade === 'again') {
            nextInterval = 1; nextEase = Math.max(MIN_EASE, safeEase - 0.2);
            nextReps = 0; lapses += 1; status = 'lapsed'; mastery = 'learning';
        } else if (grade === 'hard') {
            nextInterval = reps === 0 ? 1 : Math.max(1, Math.round((parseFloat(item.intervalDays) || 1) * 1.2));
            nextEase = Math.max(MIN_EASE, safeEase - 0.15);
            nextReps = reps + 1; status = 'reviewing'; mastery = 'learning';
        } else if (grade === 'easy') {
            nextInterval = reps === 0 ? 4 : Math.max(1, Math.round((parseFloat(item.intervalDays) || 1) * safeEase * 1.3));
            nextEase = safeEase + 0.15;
            nextReps = reps + 1; status = 'reviewing';
            mastery = nextReps >= 3 ? 'mastered' : 'familiar';
        } else {
            // 'good' default
            nextInterval = reps === 0 ? 1 : (reps === 1 ? 3 : Math.max(1, Math.round((parseFloat(item.intervalDays) || 1) * safeEase)));
            nextReps = reps + 1; status = nextReps >= 3 ? 'reviewing' : 'learning';
            mastery = nextReps >= 4 ? 'mastered' : (nextReps >= 2 ? 'familiar' : 'learning');
        }
        item.intervalDays = nextInterval;
        item.ease = nextEase;
        item.repetitions = nextReps;
        item.lapses = lapses;
        item.status = status;
        item.mastery = mastery;
        item.lastReviewedAt = nowIso();
        item.nextReviewAt = daysFromNow(nextInterval);
        item.updatedAt = nowIso();
        return item;
    }

    // ------------------------------------------------------------------
    // Mastery promotion (Learn / Write / Test modes)
    // ------------------------------------------------------------------
    function promoteMastery(item, correct) {
        if (!item) return item;
        const idx = MASTERY_LEVELS.indexOf(item.mastery || 'new');
        if (correct) {
            item.correctCount = (item.correctCount || 0) + 1;
            const next = Math.min(idx + 1, MASTERY_LEVELS.length - 1);
            item.mastery = MASTERY_LEVELS[next];
            // Light SR boost — bump the spaced-repetition interval too.
            const reps = (item.repetitions || 0) + 1;
            item.repetitions = reps;
            const ease = Math.max(MIN_EASE, parseFloat(item.ease) || STARTING_EASE);
            item.intervalDays = Math.max(1, Math.round((parseFloat(item.intervalDays) || 1) * ease));
            item.nextReviewAt = daysFromNow(item.intervalDays);
            item.status = item.mastery === 'mastered' ? 'reviewing' : 'learning';
        } else {
            item.incorrectCount = (item.incorrectCount || 0) + 1;
            const next = Math.max(0, idx - 1);
            item.mastery = MASTERY_LEVELS[next];
            item.lapses = (item.lapses || 0) + 1;
            item.repetitions = 0;
            item.intervalDays = 1;
            item.nextReviewAt = daysFromNow(1);
            item.status = 'lapsed';
        }
        item.lastReviewedAt = nowIso();
        item.updatedAt = nowIso();
        return item;
    }

    // ------------------------------------------------------------------
    // Sessions
    // ------------------------------------------------------------------
    function startSession(opts) {
        const ws = safeWorkspace();
        if (!ws) return null;
        const session = {
            id: makeId('session'),
            startedAt: nowIso(),
            endedAt: null,
            deckIds: (opts && Array.isArray(opts.deckIds)) ? opts.deckIds.map(String) : [],
            mode: (opts && opts.mode) || 'flashcards',
            itemResults: [],
            totalReviewed: 0,
            againCount: 0, hardCount: 0, goodCount: 0, easyCount: 0,
            correctCount: 0, incorrectCount: 0,
            score: 0, totalQuestions: 0, timeMs: 0,
            linkedFocusSessionId: opts && opts.linkedFocusSessionId ? String(opts.linkedFocusSessionId) : null,
            createdAt: nowIso()
        };
        try { window.SutraActivation && window.SutraActivation.record('review'); } catch (e) { /* non-critical */ }
        return session;
    }

    function endSession(session) {
        const ws = safeWorkspace();
        if (!ws || !session) return;
        session.endedAt = nowIso();
        session.totalReviewed = (session.itemResults || []).length;
        // Strip transient _ fields before persisting.
        const persisted = {};
        Object.keys(session).forEach(k => { if (!k.startsWith('_')) persisted[k] = session[k]; });
        ws.sessions.unshift(persisted);
        if (ws.sessions.length > 200) ws.sessions.length = 200;
        // Track deck.lastStudiedAt and best match time.
        (session.deckIds || []).forEach(deckId => {
            const deck = ws.decks.find(d => d.id === deckId);
            if (!deck) return;
            deck.lastStudiedAt = nowIso();
            if (session.mode === 'match' && session.timeMs > 0) {
                if (!deck.bestMatchTimeMs || session.timeMs < deck.bestMatchTimeMs) {
                    deck.bestMatchTimeMs = session.timeMs;
                }
            }
        });
        persist();
    }

    function recordResult(session, itemId, grade) {
        if (!session) return;
        session.itemResults.push({ itemId, grade, reviewedAt: nowIso(), intervalDays: 0 });
        if (grade === 'again') session.againCount += 1;
        else if (grade === 'hard') session.hardCount += 1;
        else if (grade === 'easy') session.easyCount += 1;
        else if (grade === 'good') session.goodCount += 1;
        else if (grade === 'correct') session.correctCount += 1;
        else if (grade === 'incorrect') session.incorrectCount += 1;
    }

    // ------------------------------------------------------------------
    // Source picker (for create/edit forms)
    // ------------------------------------------------------------------
    function buildSourceOptions() {
        const opts = [{ value: '', label: 'No source' }];
        try {
            if (Array.isArray(typeof pages !== 'undefined' ? pages : [])) {
                pages.slice(0, 30).forEach(page => {
                    if (!page || !page.id) return;
                    opts.push({ value: `note:${page.id}`, label: `Note: ${page.title || 'Untitled'}` });
                });
            }
        } catch (err) { /* non-critical */ }
        try {
            const aps = (typeof apStudyWorkspace !== 'undefined' ? apStudyWorkspace : null) || {};
            (Array.isArray(aps.subjects) ? aps.subjects : []).slice(0, 20).forEach(s => {
                if (!s || !s.id) return;
                opts.push({ value: `apClass:${s.id}`, label: `AP: ${s.name || 'Subject'}` });
            });
        } catch (err) { /* non-critical */ }
        try {
            if (typeof localStorage !== 'undefined') {
                const homework = window.SutraHomeworkStore && window.SutraHomeworkStore.getSnapshot
                    ? window.SutraHomeworkStore.getSnapshot()
                    : { courses: [] };
                const courses = homework.courses;
                (Array.isArray(courses) ? courses : []).slice(0, 12).forEach(c => {
                    if (!c || !c.id) return;
                    opts.push({ value: `course:${c.id}`, label: `Class: ${c.name || 'Class'}` });
                });
            }
        } catch (err) { /* non-critical */ }
        return opts;
    }

    function applySourceSelection(value) {
        const out = { sourceType: '', sourceId: null, sourceNoteId: null, sourceApClassId: null, sourceProjectId: null };
        if (!value) return out;
        const idx = value.indexOf(':');
        if (idx === -1) return out;
        const kind = value.slice(0, idx);
        const id = value.slice(idx + 1);
        if (kind === 'note') { out.sourceType = 'note'; out.sourceNoteId = id; out.sourceId = id; }
        else if (kind === 'apClass') { out.sourceType = 'apClass'; out.sourceApClassId = id; out.sourceId = id; }
        else if (kind === 'course') { out.sourceType = 'course'; out.sourceProjectId = id; out.sourceId = id; }
        return out;
    }

    // ------------------------------------------------------------------
    // Review-card generation (Phase 2 #8)
    // Turn pasted material, notes, AP units, or assistant responses into
    // candidate cards that the student reviews and edits in the existing
    // create-set table before saving. Pure + deterministic — no AI, no
    // network. Linked source metadata rides on the card's existing source
    // fields, so nothing new persists and the .sutra round-trip is unchanged.
    // ------------------------------------------------------------------
    function normalizeCardKey(text) {
        return String(text || '')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .replace(/[\s'"“”‘’.,;:!?()\[\]\-]+$/g, '')
            .trim();
    }

    // Split a single line into a {prompt, answer} pair. Shared by bulk
    // import (allowColon=false, preserves legacy behavior exactly) and the
    // generator (allowColon=true, also recognizes "Term: definition").
    function splitCardLine(line, allowColon) {
        if (line.includes('\t')) {
            const parts = line.split('\t');
            return { prompt: parts[0].trim(), answer: parts.slice(1).join(' ').trim() };
        }
        if (line.includes(' - ')) {
            const idx = line.indexOf(' - ');
            return { prompt: line.slice(0, idx).trim(), answer: line.slice(idx + 3).trim() };
        }
        if (line.includes(' = ')) {
            const idx = line.indexOf(' = ');
            return { prompt: line.slice(0, idx).trim(), answer: line.slice(idx + 3).trim() };
        }
        if (allowColon) {
            const m = line.match(/^(.{1,80}?):\s+(.+)$/);
            if (m) return { prompt: m[1].trim(), answer: m[2].trim() };
        }
        if (line.includes(',')) {
            const idx = line.indexOf(',');
            return { prompt: line.slice(0, idx).trim(), answer: line.slice(idx + 1).trim() };
        }
        return { prompt: line.trim(), answer: '' };
    }

    function generateReviewCandidates(raw, options) {
        const opts = options || {};
        const max = Number.isFinite(opts.max) ? opts.max : 200;
        const out = [];
        const seen = new Set();
        String(raw || '').split(/\r?\n/).forEach(rawLine => {
            if (out.length >= max) return;
            // Strip common bullet / numbering prefixes ("- ", "* ", "1. ", "2) ").
            const line = rawLine.trim().replace(/^(?:[-*•]|\d{1,3}[.)])\s+/, '').trim();
            if (!line) return;
            const card = splitCardLine(line, true);
            if (!card.prompt) return;
            const key = normalizeCardKey(card.prompt);
            if (!key || seen.has(key)) return; // intra-batch de-dupe
            seen.add(key);
            out.push({ prompt: card.prompt, answer: card.answer });
        });
        return out;
    }

    // Flag candidates whose prompt already exists. Scope defaults to every
    // deck so the warning catches cross-set duplicates; pass deckId to narrow.
    function markDuplicateCandidates(candidates, options) {
        const opts = options || {};
        const existing = new Set();
        (opts.deckId ? getItems(opts.deckId) : getItems()).forEach(it => {
            const k = normalizeCardKey(it.prompt);
            if (k) existing.add(k);
        });
        let duplicates = 0;
        const rows = (Array.isArray(candidates) ? candidates : []).map(c => {
            const isDup = existing.has(normalizeCardKey(c.prompt));
            if (isDup) duplicates += 1;
            return { prompt: c.prompt, answer: c.answer, duplicate: isDup };
        });
        return { rows, duplicates };
    }

    // Open the create-set editor pre-filled with generated rows so the
    // student can edit, drop duplicates, and confirm before anything saves.
    // Always builds a NEW-set draft (deckId stays null) to avoid the
    // edit-mode full-sync that would delete a deck's existing cards.
    function openReviewGenerator(options) {
        const opts = options || {};
        const candidates = generateReviewCandidates(opts.rawText || opts.text || '', { max: opts.max });
        const marked = markDuplicateCandidates(candidates, { deckId: opts.dedupeDeckId || null });
        const rows = marked.rows.length
            ? marked.rows.map(c => ({ rowId: makeId('row'), prompt: c.prompt, answer: c.answer, duplicate: !!c.duplicate }))
            : [makeBlankCreateRow(), makeBlankCreateRow(), makeBlankCreateRow()];
        viewState.createDraft = {
            deckId: null,
            title: String(opts.title || ''),
            description: String(opts.description || ''),
            subject: String(opts.subject || ''),
            source: String(opts.source || ''),
            rows,
            error: '',
            generated: true,
            dupCount: marked.duplicates
        };
        viewState.view = 'create';
        try { if (typeof window.setActiveView === 'function') window.setActiveView('review'); } catch (err) { /* non-critical */ }
        if (!reviewUiBound) { try { initReviewWorkspaceUI(); } catch (err) { /* non-critical */ } }
        render();
        try {
            const titleEl = document.getElementById('reviewCreateTitle');
            if (titleEl) titleEl.focus();
        } catch (err) { /* non-critical */ }
        return { total: marked.rows.length, duplicates: marked.duplicates };
    }

    function removeDuplicateDraftRows() {
        const draft = viewState.createDraft;
        if (!draft) return;
        captureCreateDraftInputs();
        draft.rows = draft.rows.filter(r => !r.duplicate);
        if (!draft.rows.length) draft.rows.push(makeBlankCreateRow());
        draft.dupCount = 0;
    }

    // In-view entry: parse the paste box into rows, de-duping against both the
    // current draft and saved decks, and append them to the editable table.
    function appendGeneratedRowsFromText(rawText) {
        const draft = viewState.createDraft;
        if (!draft) return { added: 0 };
        captureCreateDraftInputs();
        const inDraft = new Set(draft.rows.map(r => normalizeCardKey(r.prompt)).filter(Boolean));
        const fresh = generateReviewCandidates(rawText).filter(c => {
            const k = normalizeCardKey(c.prompt);
            if (!k || inDraft.has(k)) return false;
            inDraft.add(k);
            return true;
        });
        const marked = markDuplicateCandidates(fresh, { deckId: draft.deckId || null });
        const newRows = marked.rows.map(c => ({ rowId: makeId('row'), prompt: c.prompt, answer: c.answer, duplicate: !!c.duplicate }));
        const kept = draft.rows.filter(r => String(r.prompt || '').trim() || String(r.answer || '').trim());
        draft.rows = kept.concat(newRows);
        if (!draft.rows.length) draft.rows.push(makeBlankCreateRow());
        draft.generated = true;
        draft.dupCount = draft.rows.filter(r => r.duplicate).length;
        return { added: newRows.length, duplicates: marked.duplicates };
    }

    // ------------------------------------------------------------------
    // Rendering — top-level dispatcher
    // ------------------------------------------------------------------
    function render() {
        const mount = document.getElementById('reviewMount');
        if (!mount) return;
        mount.dataset.viewState = viewState.view;
        if (viewState.view === 'study' && viewState.session) {
            renderStudyView(mount);
        } else if (viewState.view === 'create') {
            renderCreateView(mount);
        } else if (viewState.view === 'deck' && viewState.deckId) {
            renderDeckView(mount);
        } else if (viewState.view === 'analytics') {
            renderAnalyticsView(mount);
        } else {
            renderLibraryView(mount);
        }
    }

    // The 5 visible mode tiles surfaced on the set-detail page. The 5th
    // ('review-due') is a synthetic action (filters queue to onlyDue cards).
    // STUDY_MODES stays untouched so import/export round-trip is preserved
    // and the smoke check's literal-substring assertion still passes.
    const PRIMARY_MODE_TILES = ['flashcards', 'write', 'test', 'match', 'review-due'];
    function tileLabel(tile) {
        switch (tile) {
            case 'flashcards': return 'Flashcards';
            case 'write':      return 'Learn';
            case 'test':       return 'Test';
            case 'match':      return 'Match';
            case 'review-due': return 'Review Due';
            case 'learn':      return 'Quick MC';
            default:           return modeLabel(tile);
        }
    }
    function tileDescription(tile) {
        switch (tile) {
            case 'flashcards': return 'Flip and grade with spaced repetition.';
            case 'write':      return 'Type the answer and check yourself.';
            case 'test':       return 'A short mixed quiz with a final score.';
            case 'match':      return 'Pair prompt and answer tiles fast.';
            case 'review-due': return 'Run only the cards due today.';
            case 'learn':      return 'Quick multiple-choice rounds.';
            default:           return modeDescription(tile);
        }
    }
    function tileGlyph(tile) {
        switch (tile) {
            case 'flashcards': return '⌘';
            case 'write':      return '✎';
            case 'test':       return '✓';
            case 'match':      return '◇';
            case 'review-due': return '↻';
            case 'learn':      return '◉';
            default:           return '·';
        }
    }

    // ------------------------------------------------------------------
    // Library view (deck grid)
    // ------------------------------------------------------------------
    function renderLibraryView(mount) {
        const ws = safeWorkspace();
        if (!ws) { mount.innerHTML = ''; return; }
        const allActiveDecks = getDecks(false);
        const archivedDecks = ws.decks.filter(d => d.archived);
        const due = getDueItems().length;
        const overdue = getOverdueItems().length;
        const week = getReviewedThisWeek();
        const weakCards = getWeakCards();
        const weakDeckIds = new Set(weakCards.map(c => c.deckId));
        const totalCards = ws.items.length;
        const streak = getReviewStreak();
        const dueDeckCount = new Set(getDueItems().map(i => i.deckId)).size;

        const search = String(viewState.librarySearch || '').toLowerCase().trim();
        const matchesSearch = (deck) => {
            if (!search) return true;
            if (String(deck.name || '').toLowerCase().includes(search)) return true;
            if (String(deck.description || '').toLowerCase().includes(search)) return true;
            if (String(deck.subject || '').toLowerCase().includes(search)) return true;
            // Also match by card prompt/answer/tag.
            const cards = getItems(deck.id);
            return cards.some(c =>
                String(c.prompt || '').toLowerCase().includes(search)
                || String(c.answer || '').toLowerCase().includes(search)
                || (c.tags || []).join(' ').toLowerCase().includes(search));
        };

        // Build the filtered "All sets" pool for the active filter tab.
        let mainPool = (viewState.libraryFilter === 'archived' ? archivedDecks : allActiveDecks).slice();
        if (viewState.libraryFilter === 'starred') {
            const starredDeckIds = new Set(ws.items.filter(i => i.starred).map(i => i.deckId));
            mainPool = mainPool.filter(d => starredDeckIds.has(d.id));
        }
        mainPool = mainPool.filter(matchesSearch);

        // Recent sets: studied within the last 14 days, max 6.
        const recentDecks = allActiveDecks
            .filter(d => d.lastStudiedAt)
            .filter(matchesSearch)
            .sort((a, b) => String(b.lastStudiedAt || '').localeCompare(String(a.lastStudiedAt || '')))
            .slice(0, 6);

        // Needs work: active decks that contain weak cards, max 6.
        const needsWorkDecks = allActiveDecks
            .filter(d => weakDeckIds.has(d.id))
            .filter(matchesSearch)
            .slice(0, 6);

        const heroSubtitle = due === 0
            ? 'Nothing due right now. Add cards or pick a set to practice.'
            : `${due} card${due === 1 ? '' : 's'} ready across ${dueDeckCount} set${dueDeckCount === 1 ? '' : 's'}${overdue ? ` • ${overdue} overdue` : ''}.`;

        const noDecks = ws.decks.length === 0;

        mount.innerHTML = `
            <header class="review-page-header">
                <div class="review-page-title-block">
                    <div class="eyebrow">Review</div>
                    <h1 class="review-page-title">Study sets</h1>
                    <p class="review-page-subtitle">Practice cards, test recall, and keep weak topics in rotation.</p>
                </div>
                <div class="review-page-actions">
                    <button type="button" class="review-btn-primary" data-review-action="open-create-set">＋ Create set</button>
                    <button type="button" class="review-btn-ghost" data-review-action="open-generate">✨ Generate cards</button>
                    <button type="button" class="review-btn-ghost" data-review-action="quick-create-card">＋ Add card</button>
                    <button type="button" class="review-btn-ghost" data-review-action="open-analytics">Analytics</button>
                </div>
                <div class="review-page-search-row">
                    <label class="review-search-field" aria-label="Search study sets">
                        <span class="review-search-icon" aria-hidden="true">⌕</span>
                        <input type="search" id="reviewLibrarySearch" class="review-search-input" placeholder="Search sets, cards, or tags…" value="${escapeHtml(viewState.librarySearch)}" autocomplete="off" />
                    </label>
                </div>
            </header>

            <div class="review-library-body">
            ${noDecks ? `
                <section class="review-empty-hero">
                    <div class="review-empty-hero-icon" aria-hidden="true">✦</div>
                    <h2>Build your first study set</h2>
                    <p>Group flashcards by topic, then practice with Flashcards, Learn, Test, or Match.</p>
                    <button type="button" class="review-btn-primary" data-review-action="open-create-set">Create your first set</button>
                </section>
            ` : `
                <section class="review-hero-row" aria-label="Today summary">
                    <article class="review-hero-due${due > 0 ? ' has-due' : ''}">
                        <div class="review-hero-due-label">Due today</div>
                        <div class="review-hero-due-count">${due}</div>
                        <div class="review-hero-due-meta">${escapeHtml(heroSubtitle)}</div>
                        <div class="review-hero-due-actions">
                            <button type="button" class="review-btn-primary review-hero-due-cta" data-review-action="study-all-due" data-mode="flashcards" ${due === 0 ? 'disabled aria-disabled="true"' : ''}>Start review →</button>
                            ${due > 0 ? `<button type="button" class="review-btn-ghost" data-review-action="study-all-due" data-mode="write">Type instead</button>` : ''}
                        </div>
                    </article>
                    <div class="review-hero-stats">
                        <div class="review-hero-stat"><div class="review-hero-stat-label">Streak</div><div class="review-hero-stat-value">${streak}<span class="review-hero-stat-suffix">d</span></div></div>
                        <div class="review-hero-stat"><div class="review-hero-stat-label">This week</div><div class="review-hero-stat-value">${week}</div></div>
                        <div class="review-hero-stat"><div class="review-hero-stat-label">Weak cards</div><div class="review-hero-stat-value">${weakCards.length}</div></div>
                        <div class="review-hero-stat"><div class="review-hero-stat-label">Total sets</div><div class="review-hero-stat-value">${allActiveDecks.length}</div></div>
                    </div>
                </section>

                ${recentDecks.length > 0 ? `
                <section class="review-section" aria-label="Recent sets">
                    <header class="review-section-header">
                        <h2>Recent</h2>
                        <span class="review-section-count">${recentDecks.length}</span>
                    </header>
                    <div class="review-set-grid">
                        ${recentDecks.map(deck => renderDeckCard(deck)).join('')}
                    </div>
                </section>
                ` : ''}

                ${needsWorkDecks.length > 0 ? `
                <section class="review-section" aria-label="Needs work">
                    <header class="review-section-header">
                        <h2>Needs work</h2>
                        <span class="review-section-count">${needsWorkDecks.length}</span>
                    </header>
                    <div class="review-set-grid">
                        ${needsWorkDecks.map(deck => renderDeckCard(deck)).join('')}
                    </div>
                </section>
                ` : ''}

                <section class="review-section" aria-label="All sets">
                    <header class="review-section-header">
                        <h2>${viewState.libraryFilter === 'archived' ? 'Archived sets' : (viewState.libraryFilter === 'starred' ? 'Starred sets' : 'All sets')}</h2>
                        <div class="review-section-tabs" role="tablist" aria-label="Filter sets">
                            ${['all', 'starred', 'archived'].map(tab => `
                                <button type="button" role="tab" aria-selected="${viewState.libraryFilter === tab ? 'true' : 'false'}" class="review-section-tab${viewState.libraryFilter === tab ? ' active' : ''}" data-review-filter="${tab}">${tab.charAt(0).toUpperCase() + tab.slice(1)}</button>
                            `).join('')}
                        </div>
                    </header>
                    ${mainPool.length === 0 ? `
                        <div class="review-empty-row-card">
                            <h3>${viewState.libraryFilter === 'archived' ? 'No archived sets' : (search ? 'Nothing matches that search' : 'No sets in this filter')}</h3>
                            <p>${search ? 'Try clearing the search or switching filters.' : 'Create a set or switch back to the All tab.'}</p>
                            ${!search ? '<button type="button" class="review-btn-primary" data-review-action="open-create-set">＋ Create set</button>' : ''}
                        </div>
                    ` : `
                        <div class="review-set-grid">
                            ${mainPool.map(deck => renderDeckCard(deck)).join('')}
                        </div>
                    `}
                </section>

                ${ws.sessions.length > 0 ? `
                <section class="review-section review-history-section" aria-label="Recent sessions">
                    <header class="review-section-header">
                        <h2>Recent sessions</h2>
                        <span class="review-section-count">${streak}-day streak</span>
                    </header>
                    <div class="review-history-list">
                        ${ws.sessions.slice(0, 5).map(s => renderHistoryRow(s)).join('')}
                    </div>
                </section>
                ` : ''}
            `}
            </div>
        `;
        bindLibraryEvents(mount);
    }

    function renderDeckCard(deck) {
        const cards = getItems(deck.id);
        const dueCount = getDueItems(deck.id).length;
        const mastery = getDeckMastery(deck.id);
        const total = cards.length || 1;
        const masteryPct = masteryPercent(mastery);
        const colorVar = `--review-set-accent: ${deck.color || '#d8c4a1'};`;
        const subjectChip = deck.subject ? `<span class="review-set-card-subject">${escapeHtml(deck.subject)}</span>` : '';
        const lastStudiedLabel = deck.archived
            ? 'Archived'
            : (deck.lastStudiedAt
                ? `Studied ${new Date(deck.lastStudiedAt).toLocaleDateString()}`
                : 'Not studied yet');
        const studyDisabled = cards.length === 0;
        return `
            <article class="review-set-card${deck.archived ? ' is-archived' : ''}${dueCount > 0 ? ' has-due' : ''}" style="${colorVar}" data-deck-id="${escapeHtml(deck.id)}">
                <button type="button" class="review-set-card-body" data-review-action="open-deck" data-deck-id="${escapeHtml(deck.id)}" aria-label="Open set ${escapeHtml(deck.name)}">
                    <div class="review-set-card-head">
                        <h3 class="review-set-card-title">${escapeHtml(deck.name)}</h3>
                        ${dueCount > 0 ? `<span class="review-set-card-due-badge" aria-label="${dueCount} cards due">${dueCount} due</span>` : ''}
                    </div>
                    ${deck.description ? `<p class="review-set-card-desc">${escapeHtml(deck.description)}</p>` : ''}
                    <div class="review-set-card-meta">
                        <span>${cards.length} card${cards.length === 1 ? '' : 's'}</span>
                        <span>${escapeHtml(lastStudiedLabel)}</span>
                        ${subjectChip}
                    </div>
                    <div class="review-mastery-bar" aria-label="Mastery: ${masteryPct}%">
                        <span class="mb-new" style="width: ${(mastery.new / total * 100)}%"></span>
                        <span class="mb-learning" style="width: ${(mastery.learning / total * 100)}%"></span>
                        <span class="mb-familiar" style="width: ${(mastery.familiar / total * 100)}%"></span>
                        <span class="mb-mastered" style="width: ${(mastery.mastered / total * 100)}%"></span>
                    </div>
                </button>
                <div class="review-set-card-footer">
                    <button type="button" class="review-set-card-study" data-review-action="study" data-deck-id="${escapeHtml(deck.id)}" data-mode="flashcards" ${studyDisabled ? 'disabled aria-disabled="true"' : ''}>${dueCount > 0 ? 'Study due →' : 'Study →'}</button>
                    <button type="button" class="review-set-card-icon-btn" data-review-action="toggle-archive" data-deck-id="${escapeHtml(deck.id)}" aria-label="${deck.archived ? 'Unarchive set' : 'Archive set'}" title="${deck.archived ? 'Unarchive set' : 'Archive set'}">${deck.archived ? '↺' : '🗄'}</button>
                </div>
            </article>
        `;
    }

    function renderHistoryRow(session) {
        const when = session.endedAt ? new Date(session.endedAt) : new Date(session.startedAt || Date.now());
        const date = when.toLocaleString();
        const total = session.totalReviewed || (session.itemResults || []).length;
        const modeLbl = modeLabel(session.mode || 'flashcards');
        const summary = (() => {
            if (session.mode === 'test' || session.mode === 'match') {
                return `${Math.round(session.score || 0)}% · ${total} questions${session.timeMs ? ' · ' + formatDuration(session.timeMs) : ''}`;
            }
            return `${total} reviewed · A${session.againCount || 0} H${session.hardCount || 0} G${session.goodCount || 0} E${session.easyCount || 0}`;
        })();
        return `
            <div class="review-history-row">
                <div class="review-history-meta">
                    <div class="review-history-date">${escapeHtml(date)}</div>
                    <span class="review-mode-tag">${escapeHtml(modeLbl)}</span>
                </div>
                <div class="review-history-summary">${escapeHtml(summary)}</div>
            </div>
        `;
    }

    // ------------------------------------------------------------------
    // Analytics view
    // ------------------------------------------------------------------
    // ------------------------------------------------------------------
    // Retention analytics helpers (read-only over existing SM-2 data)
    // ------------------------------------------------------------------
    function analyticsDateKey(d) {
        const dt = new Date(d);
        if (isNaN(dt.getTime())) return '';
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    }

    // Cards reviewed per day across the last `days` days (from session history).
    function getDailyReviewSeries(days) {
        const ws = safeWorkspace();
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const byDay = {};
        ((ws && ws.sessions) || []).forEach(s => {
            const key = analyticsDateKey(s.startedAt || s.endedAt);
            if (!key) return;
            const n = s.totalReviewed || (Array.isArray(s.itemResults) ? s.itemResults.length : 0) || 0;
            byDay[key] = (byDay[key] || 0) + n;
        });
        const out = [];
        for (let i = days - 1; i >= 0; i -= 1) {
            const d = new Date(today); d.setDate(today.getDate() - i);
            const key = analyticsDateKey(d);
            out.push({ key, label: d.toLocaleDateString(undefined, { weekday: 'short' }), count: byDay[key] || 0 });
        }
        return out;
    }

    // Cards due on each of the next `days` days, plus a count already overdue.
    function getDueForecast(days) {
        const ws = safeWorkspace();
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const byDay = {};
        let overdue = 0;
        ((ws && ws.items) || []).forEach(it => {
            if (!it || !it.nextReviewAt) return;
            const d = new Date(it.nextReviewAt);
            if (isNaN(d.getTime())) return;
            d.setHours(0, 0, 0, 0);
            if (d < today) { overdue += 1; return; }
            const key = analyticsDateKey(d);
            byDay[key] = (byDay[key] || 0) + 1;
        });
        const series = [];
        for (let i = 0; i < days; i += 1) {
            const d = new Date(today); d.setDate(today.getDate() + i);
            const key = analyticsDateKey(d);
            series.push({ key, label: i === 0 ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short' }), count: byDay[key] || 0 });
        }
        return { series, overdue };
    }

    // Recall retention: share of graded cards answered Good or Easy.
    function getRetentionRate() {
        const ws = safeWorkspace();
        let good = 0; let total = 0;
        ((ws && ws.sessions) || []).forEach(s => {
            good += (s.goodCount || 0) + (s.easyCount || 0);
            total += (s.againCount || 0) + (s.hardCount || 0) + (s.goodCount || 0) + (s.easyCount || 0);
        });
        return { rate: total ? Math.round((good / total) * 100) : 0, graded: total };
    }

    // Minimal dependency-free inline-SVG bar chart. Returns developer-authored
    // markup injected through the existing analytics template (raw innerHTML),
    // never through the user-HTML sanitizer (which would strip <svg>).
    function renderSparkBars(series, fillClass, ariaLabel) {
        const w = 100; const h = 40; const n = series.length || 1;
        const max = Math.max(1, ...series.map(s => s.count));
        const gap = 1.4;
        const bw = (w - gap * (n - 1)) / n;
        let bars = '';
        let labels = '';
        series.forEach((s, i) => {
            const bh = s.count ? Math.max(1.5, (s.count / max) * (h - 12)) : 0.6;
            const x = i * (bw + gap);
            const y = h - bh - 8;
            bars += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${bw.toFixed(2)}" height="${bh.toFixed(2)}" rx="0.7" class="${fillClass}"><title>${escapeHtml(s.label)}: ${s.count}</title></rect>`;
            if (n <= 14) labels += `<text x="${(x + bw / 2).toFixed(2)}" y="${h - 1}" text-anchor="middle" class="sutra-spark-label">${escapeHtml(String(s.label).slice(0, 2))}</text>`;
        });
        return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="sutra-spark" role="img" aria-label="${escapeHtml(ariaLabel || 'chart')}">${bars}${labels}</svg>`;
    }

    function renderAnalyticsView(mount) {
        const ws = safeWorkspace();
        if (!ws) { mount.innerHTML = ''; return; }
        const activitySeries = getDailyReviewSeries(14);
        const forecast = getDueForecast(7);
        const retention = getRetentionRate();
        const forecastTotal = forecast.series.reduce((sum, d) => sum + d.count, 0) + forecast.overdue;
        const allDecks = getDecks(false);
        const totalCards = ws.items.length;
        const mastery = { new: 0, learning: 0, familiar: 0, mastered: 0 };
        ws.items.forEach(i => {
            const m = MASTERY_LEVELS.includes(i.mastery) ? i.mastery : 'new';
            mastery[m] = (mastery[m] || 0) + 1;
        });
        const streak = getReviewStreak();
        const week = getReviewedThisWeek();
        const weakCards = getWeakCards();
        const totalSessions = ws.sessions.length;
        const masteredCount = mastery.mastered || 0;
        const totalMax = totalCards || 1;

        mount.innerHTML = `
            <header class="review-analytics-header">
                <div>
                    <div class="eyebrow">Review</div>
                    <h1>Analytics</h1>
                </div>
                <button type="button" class="review-back-btn" data-review-action="back-to-library">← Back to sets</button>
            </header>
            <div class="review-analytics-body">
                <div class="review-analytics-grid">
                    <div class="review-analytics-stat">
                        <div class="review-analytics-stat-label">Total Cards</div>
                        <div class="review-analytics-stat-value">${totalCards}</div>
                        <div class="review-analytics-stat-sub">across ${allDecks.length} set${allDecks.length === 1 ? '' : 's'}</div>
                    </div>
                    <div class="review-analytics-stat">
                        <div class="review-analytics-stat-label">Mastered</div>
                        <div class="review-analytics-stat-value">${masteredCount}</div>
                        <div class="review-analytics-stat-sub">${totalCards ? Math.round(masteredCount / totalCards * 100) : 0}% mastery rate</div>
                    </div>
                    <div class="review-analytics-stat">
                        <div class="review-analytics-stat-label">Study Streak</div>
                        <div class="review-analytics-stat-value">${streak}<span style="font-size:1rem;color:var(--text-muted)"> d</span></div>
                        <div class="review-analytics-stat-sub">days in a row</div>
                    </div>
                    <div class="review-analytics-stat">
                        <div class="review-analytics-stat-label">This Week</div>
                        <div class="review-analytics-stat-value">${week}</div>
                        <div class="review-analytics-stat-sub">cards reviewed</div>
                    </div>
                    <div class="review-analytics-stat">
                        <div class="review-analytics-stat-label">Sessions</div>
                        <div class="review-analytics-stat-value">${totalSessions}</div>
                        <div class="review-analytics-stat-sub">total sessions</div>
                    </div>
                    <div class="review-analytics-stat">
                        <div class="review-analytics-stat-label">Weak Cards</div>
                        <div class="review-analytics-stat-value">${weakCards.length}</div>
                        <div class="review-analytics-stat-sub">need extra review</div>
                    </div>
                    <div class="review-analytics-stat">
                        <div class="review-analytics-stat-label">Retention</div>
                        <div class="review-analytics-stat-value">${retention.rate}<span style="font-size:1rem;color:var(--text-muted)">%</span></div>
                        <div class="review-analytics-stat-sub">${retention.graded ? 'recalled Good or Easy' : 'no graded reviews yet'}</div>
                    </div>
                    <div class="review-analytics-stat">
                        <div class="review-analytics-stat-label">Due Soon</div>
                        <div class="review-analytics-stat-value">${forecastTotal}</div>
                        <div class="review-analytics-stat-sub">${forecast.overdue ? `${forecast.overdue} overdue + ` : ''}next 7 days</div>
                    </div>
                </div>

                <div class="review-analytics-section">
                    <div class="review-analytics-section-title">Review activity — last 14 days</div>
                    <div class="review-analytics-chart">${renderSparkBars(activitySeries, 'sutra-spark-bar', 'Cards reviewed per day, last 14 days')}</div>
                </div>

                <div class="review-analytics-section">
                    <div class="review-analytics-section-title">Upcoming review load — next 7 days</div>
                    ${forecast.overdue ? `<div class="review-analytics-forecast-note">${forecast.overdue} card${forecast.overdue === 1 ? '' : 's'} overdue right now — clear these first.</div>` : ''}
                    <div class="review-analytics-chart">${renderSparkBars(forecast.series, 'sutra-spark-bar-due', 'Cards due per day, next 7 days')}</div>
                </div>

                <div class="review-analytics-section">
                    <div class="review-analytics-section-title">Mastery breakdown</div>
                    <div class="review-analytics-mastery-bar">
                        ${[['new', 'New'], ['learning', 'Learning'], ['familiar', 'Familiar'], ['mastered', 'Mastered']].map(([key, label]) => `
                            <div class="review-analytics-mastery-row">
                                <div class="review-analytics-mastery-label">${label}</div>
                                <div class="review-analytics-bar-track"><div class="review-analytics-bar-fill bar-fill-${key}" style="width:${Math.round((mastery[key] || 0) / totalMax * 100)}%"></div></div>
                                <div class="review-analytics-mastery-count">${mastery[key] || 0}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>

                ${ws.sessions.length ? `
                <div class="review-analytics-section">
                    <div class="review-analytics-section-title">Recent sessions</div>
                    <div class="review-analytics-sessions-list">
                        ${ws.sessions.slice(0, 8).map(s => renderHistoryRow(s)).join('')}
                    </div>
                </div>
                ` : ''}

                ${weakCards.length ? `
                <div class="review-analytics-section">
                    <div class="review-analytics-section-title">Weak cards — review these</div>
                    <div class="review-analytics-weak-list">
                        ${weakCards.map(c => `
                            <div class="review-analytics-weak-card">
                                <div class="review-analytics-weak-card-prompt">${escapeHtml(c.prompt)}</div>
                                ${c.answer ? `<div class="review-analytics-weak-card-answer">${escapeHtml(c.answer)}</div>` : ''}
                                <div class="review-analytics-weak-card-meta">
                                    <span class="review-mastery-chip mastery-${c.mastery || 'new'}">${c.mastery || 'new'}</span>
                                    <span class="review-lapse-chip">${c.lapses || 0} lapse${(c.lapses || 0) === 1 ? '' : 's'}</span>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
                ` : ''}
            </div>
        `;
        bindCommonActions(mount);
    }

    function modeLabel(mode) {
        switch (mode) {
            case 'flashcards': return 'Flashcards';
            case 'learn': return 'Quick MC';
            case 'write': return 'Learn';
            case 'test': return 'Test';
            case 'match': return 'Match';
            default: return mode;
        }
    }

    function formatDuration(ms) {
        const s = Math.round(Math.max(0, ms) / 1000);
        const m = Math.floor(s / 60);
        const sec = s % 60;
        return m ? `${m}m ${sec}s` : `${sec}s`;
    }

    function bindLibraryEvents(mount) {
        const search = mount.querySelector('#reviewLibrarySearch');
        if (search) {
            search.addEventListener('input', () => {
                viewState.librarySearch = search.value;
                // Re-render list area only.
                renderLibraryView(mount);
                const newSearch = mount.querySelector('#reviewLibrarySearch');
                if (newSearch) {
                    newSearch.focus();
                    newSearch.setSelectionRange(newSearch.value.length, newSearch.value.length);
                }
            });
        }
        mount.querySelectorAll('[data-review-filter]').forEach(btn => {
            btn.addEventListener('click', () => {
                viewState.libraryFilter = btn.getAttribute('data-review-filter') || 'all';
                render();
            });
        });
        bindCommonActions(mount);
    }

    // ------------------------------------------------------------------
    // Deck detail view
    // ------------------------------------------------------------------
    function renderDeckView(mount) {
        const deck = getDeck(viewState.deckId);
        if (!deck) { viewState.view = 'library'; render(); return; }
        const cards = getItems(deck.id);
        const filtered = filterDeckCards(cards);
        const mastery = getDeckMastery(deck.id);
        const total = cards.length || 1;
        const masteryPct = masteryPercent(mastery);
        const dueCount = getDueItems(deck.id).length;
        const sourceOptions = buildSourceOptions();
        const colorVar = `--review-set-accent: ${escapeHtml(deck.color || '#d8c4a1')};`;
        const isEmpty = cards.length === 0;
        const lastStudiedLabel = deck.lastStudiedAt
            ? `Last studied ${new Date(deck.lastStudiedAt).toLocaleDateString()}`
            : 'Not studied yet';
        const showAddDrawer = !!viewState.addCardOpen || !!viewState.editingCardId;
        const editingCard = viewState.editingCardId
            ? (safeWorkspace().items || []).find(i => i.id === viewState.editingCardId)
            : null;
        const sourceValue = editingCard
            ? (editingCard.sourceNoteId ? `note:${editingCard.sourceNoteId}` :
                editingCard.sourceApClassId ? `apClass:${editingCard.sourceApClassId}` :
                editingCard.sourceProjectId ? `course:${editingCard.sourceProjectId}` : '')
            : '';

        mount.innerHTML = `
            <header class="review-set-header" style="${colorVar}">
                <div class="review-set-header-top">
                    <button type="button" class="review-back-btn" data-review-action="back-to-library">← All sets</button>
                    <div class="review-set-header-actions">
                        <button type="button" class="review-btn-ghost" data-review-action="open-edit-set" data-deck-id="${escapeHtml(deck.id)}">Edit set</button>
                        <button type="button" class="review-btn-primary review-set-add-card-btn" data-review-action="open-add-card-drawer" data-deck-id="${escapeHtml(deck.id)}">＋ Card</button>
                        <button type="button" class="review-btn-ghost" data-review-action="open-bulk-import" data-deck-id="${escapeHtml(deck.id)}">Bulk import</button>
                        <button type="button" class="review-btn-ghost" data-review-action="share-deck" data-deck-id="${escapeHtml(deck.id)}" title="Export a self-contained flashcard file to share">Share</button>
                        <button type="button" class="review-btn-ghost" data-review-action="toggle-archive" data-deck-id="${escapeHtml(deck.id)}">${deck.archived ? 'Unarchive' : 'Archive'}</button>
                        <button type="button" class="review-btn-ghost review-btn-danger" data-review-action="delete-deck" data-deck-id="${escapeHtml(deck.id)}">Delete</button>
                    </div>
                </div>
                <div class="review-set-header-titleblock">
                    <h1 class="review-set-title">${escapeHtml(deck.name)}</h1>
                    <p class="review-set-subtitle">
                        <span>${cards.length} card${cards.length === 1 ? '' : 's'}</span>
                        ${dueCount > 0 ? `<span class="review-set-due-pill">${dueCount} due</span>` : '<span>0 due</span>'}
                        <span>${escapeHtml(lastStudiedLabel)}</span>
                        <span>${masteryPct}% mastery</span>
                        ${deck.subject ? `<span class="review-set-subject-pill">${escapeHtml(deck.subject)}</span>` : ''}
                    </p>
                    ${deck.description ? `<p class="review-set-description">${escapeHtml(deck.description)}</p>` : ''}
                </div>
                <div class="review-mastery-bar" aria-label="Mastery: ${masteryPct}%">
                    <span class="mb-new" style="width: ${(mastery.new / total * 100)}%"></span>
                    <span class="mb-learning" style="width: ${(mastery.learning / total * 100)}%"></span>
                    <span class="mb-familiar" style="width: ${(mastery.familiar / total * 100)}%"></span>
                    <span class="mb-mastered" style="width: ${(mastery.mastered / total * 100)}%"></span>
                </div>
                <div class="review-mastery-legend">
                    <span><span class="legend-swatch swatch-new"></span> New ${mastery.new}</span>
                    <span><span class="legend-swatch swatch-learning"></span> Learning ${mastery.learning}</span>
                    <span><span class="legend-swatch swatch-familiar"></span> Familiar ${mastery.familiar}</span>
                    <span><span class="legend-swatch swatch-mastered"></span> Mastered ${mastery.mastered}</span>
                </div>
            </header>

            <section class="review-set-modes" aria-label="Study modes">
                <div class="review-set-modes-grid">
                    ${PRIMARY_MODE_TILES.map(tile => {
                        const disabled = isEmpty || (tile === 'review-due' && dueCount === 0);
                        const action = tile === 'review-due' ? 'study-deck-due' : 'study';
                        const mode = tile === 'review-due' ? 'flashcards' : tile;
                        const sub = tile === 'review-due' ? `${dueCount} card${dueCount === 1 ? '' : 's'} due` : '';
                        return `
                            <button type="button" class="review-mode-tile mode-${tile}" data-review-action="${action}" data-deck-id="${escapeHtml(deck.id)}" data-mode="${mode}" ${disabled ? 'disabled aria-disabled="true"' : ''}>
                                <div class="review-mode-tile-glyph" aria-hidden="true">${tileGlyph(tile)}</div>
                                <div class="review-mode-tile-text">
                                    <div class="review-mode-tile-title">${escapeHtml(tileLabel(tile))}</div>
                                    <div class="review-mode-tile-desc">${escapeHtml(tileDescription(tile))}${sub ? ` · ${escapeHtml(sub)}` : ''}</div>
                                </div>
                            </button>
                        `;
                    }).join('')}
                </div>
                <div class="review-set-modes-extras">
                    <button type="button" class="review-btn-ghost" data-review-action="study" data-deck-id="${escapeHtml(deck.id)}" data-mode="learn" ${isEmpty ? 'disabled' : ''}>Quick MC</button>
                    <button type="button" class="review-btn-ghost" data-review-action="reset-progress" data-deck-id="${escapeHtml(deck.id)}">Reset progress</button>
                    <button type="button" class="review-btn-ghost" data-review-action="shuffle-cards" data-deck-id="${escapeHtml(deck.id)}">Shuffle order</button>
                </div>
            </section>

            <section class="review-set-cards-panel" aria-label="Cards in set">
                <header class="review-set-cards-header">
                    <div>
                        <div class="eyebrow">Cards</div>
                        <h2>${filtered.length} of ${cards.length}</h2>
                    </div>
                    <div class="review-set-cards-filters">
                        <input type="search" id="reviewDeckCardSearch" class="review-search-input review-search-input--inline" placeholder="Search cards…" value="${escapeHtml(viewState.deckFilter.search)}" />
                        <select id="reviewDeckMasteryFilter" class="review-select">
                            <option value="all"${viewState.deckFilter.mastery === 'all' ? ' selected' : ''}>All mastery</option>
                            ${MASTERY_LEVELS.map(m => `<option value="${m}"${viewState.deckFilter.mastery === m ? ' selected' : ''}>${m.charAt(0).toUpperCase() + m.slice(1)}</option>`).join('')}
                        </select>
                        <label class="review-checkbox">
                            <input type="checkbox" id="reviewDeckStarredOnly" ${viewState.deckFilter.starredOnly ? 'checked' : ''} />
                            <span>Starred only</span>
                        </label>
                    </div>
                </header>

                ${isEmpty ? `
                    <div class="review-cards-empty">
                        <h3>This set has no cards yet</h3>
                        <p>Add cards individually or paste a list of pairs.</p>
                        <div class="review-cards-empty-actions">
                            <button type="button" class="review-btn-primary" data-review-action="open-add-card-drawer" data-deck-id="${escapeHtml(deck.id)}">＋ Add cards</button>
                            <button type="button" class="review-btn-ghost" data-review-action="open-bulk-import" data-deck-id="${escapeHtml(deck.id)}">Bulk import</button>
                        </div>
                    </div>
                ` : (filtered.length === 0
                    ? `<div class="review-empty-row">No cards match those filters. Try clearing the search or filters.</div>`
                    : `<ul class="review-cards-table" role="list">${filtered.map(card => renderCardRow(card)).join('')}</ul>`)
                }
            </section>

            ${showAddDrawer ? `
            <aside class="review-card-drawer" role="dialog" aria-modal="false" aria-label="${editingCard ? 'Edit card' : 'Add card'}">
                <div class="review-card-drawer-head">
                    <h3>${editingCard ? 'Edit card' : 'Add a new card'}</h3>
                    <button type="button" class="review-card-drawer-close" data-review-action="close-card-drawer" aria-label="Close">×</button>
                </div>
                <form id="reviewCardForm" class="review-card-form" autocomplete="off" data-card-id="${escapeHtml(viewState.editingCardId || '')}">
                    <div class="review-card-form-grid">
                        <label class="review-field"><span>Term / Prompt</span>
                            <textarea id="reviewCardPrompt" rows="3" required placeholder="What do you want to remember?"></textarea>
                        </label>
                        <label class="review-field"><span>Definition / Answer</span>
                            <textarea id="reviewCardAnswer" rows="3" placeholder="Definition, answer, or memory cue"></textarea>
                        </label>
                    </div>
                    <div class="review-card-form-grid">
                        <label class="review-field"><span>Hint (optional)</span>
                            <input id="reviewCardHint" type="text" placeholder="Short hint shown in Learn mode" />
                        </label>
                        <label class="review-field"><span>Tags</span>
                            <input id="reviewCardTags" type="text" placeholder="Comma-separated" />
                        </label>
                    </div>
                    <div class="review-card-image-field">
                        <span class="review-field-span">Image (optional)</span>
                        <div class="review-card-image-controls">
                            <input type="file" id="reviewCardImageInput" accept="image/png,image/jpeg,image/webp,image/gif" />
                            <button type="button" class="review-btn-ghost" id="reviewCardImageClear" hidden>Remove</button>
                            <label class="review-checkbox"><input type="checkbox" id="reviewCardOcclude" /><span>Hide until flip</span></label>
                        </div>
                        <div class="review-card-image-stage" id="reviewCardImageStage" hidden>
                            <img id="reviewCardImagePreview" alt="card image preview" />
                        </div>
                        <p class="review-card-image-hint">Upload or paste an image. "Hide until flip" covers it on the front (image occlusion) and reveals it on the back.</p>
                    </div>
                    <label class="review-field"><span>Source (optional)</span>
                        <select id="reviewCardSource" class="review-select">${sourceOptions.map(o => `<option value="${escapeHtml(o.value)}"${sourceValue === o.value ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select>
                    </label>
                    <div class="review-card-form-actions">
                        <label class="review-checkbox"><input type="checkbox" id="reviewCardStarred" /><span>Star</span></label>
                        <div class="review-card-form-actions-spacer"></div>
                        ${editingCard ? `<button type="button" class="review-btn-ghost" data-review-action="cancel-edit">Cancel</button>` : `<button type="button" class="review-btn-ghost" data-review-action="close-card-drawer">Cancel</button>`}
                        <button type="submit" class="review-btn-primary">${editingCard ? 'Save card' : 'Add card'}</button>
                    </div>
                </form>
            </aside>
            ` : ''}
        `;

        // Pre-fill form when editing.
        if (editingCard) {
            const promptEl = mount.querySelector('#reviewCardPrompt');
            const answerEl = mount.querySelector('#reviewCardAnswer');
            const hintEl = mount.querySelector('#reviewCardHint');
            const tagsEl = mount.querySelector('#reviewCardTags');
            const starEl = mount.querySelector('#reviewCardStarred');
            if (promptEl) promptEl.value = editingCard.prompt || '';
            if (answerEl) answerEl.value = editingCard.answer || '';
            if (hintEl) hintEl.value = editingCard.hint || '';
            if (tagsEl) tagsEl.value = (editingCard.tags || []).join(', ');
            if (starEl) starEl.checked = !!editingCard.starred;
        }

        setupCardImageField(mount, editingCard);
        bindDeckEvents(mount, deck);

        // Auto-focus the prompt field whenever the drawer opens.
        if (showAddDrawer) {
            setTimeout(() => {
                const promptEl = mount.querySelector('#reviewCardPrompt');
                if (promptEl) try { promptEl.focus(); } catch (err) { /* non-critical */ }
            }, 30);
        }
    }

    // Downscale an image (File or data URL) to a bounded data URL so cards stay
    // small enough to round-trip in the workspace backup.
    function downscaleImageToDataUrl(source, maxDim, cb) {
        const img = new Image();
        img.onload = function () {
            try {
                let w = img.naturalWidth || img.width;
                let h = img.naturalHeight || img.height;
                if (!w || !h) { cb(typeof source === 'string' ? source : ''); return; }
                const scale = Math.min(1, maxDim / Math.max(w, h));
                w = Math.round(w * scale); h = Math.round(h * scale);
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);
                cb(canvas.toDataURL('image/jpeg', 0.85));
            } catch (e) { cb(typeof source === 'string' ? source : ''); }
        };
        img.onerror = function () { cb(''); };
        if (typeof source === 'string') { img.src = source; }
        else {
            const reader = new FileReader();
            reader.onload = function () { img.src = String(reader.result || ''); };
            reader.onerror = function () { cb(''); };
            reader.readAsDataURL(source);
        }
    }

    function setupCardImageField(mount, editingCard) {
        const input = mount.querySelector('#reviewCardImageInput');
        const stage = mount.querySelector('#reviewCardImageStage');
        const preview = mount.querySelector('#reviewCardImagePreview');
        const clearBtn = mount.querySelector('#reviewCardImageClear');
        const occludeCk = mount.querySelector('#reviewCardOcclude');
        const form = mount.querySelector('#reviewCardForm');
        if (!stage || !preview || !form) return;

        const showImage = (dataUrl) => {
            if (dataUrl) {
                preview.src = dataUrl;
                stage.hidden = false;
                if (clearBtn) clearBtn.hidden = false;
            } else {
                preview.removeAttribute('src');
                stage.hidden = true;
                if (clearBtn) clearBtn.hidden = true;
            }
        };

        if (editingCard && editingCard.imageUrl) showImage(editingCard.imageUrl);
        if (occludeCk && editingCard) occludeCk.checked = !!editingCard.occludeImage;

        if (input) {
            input.addEventListener('change', () => {
                const file = input.files && input.files[0];
                if (!file) return;
                downscaleImageToDataUrl(file, 1200, (dataUrl) => { if (dataUrl) showImage(dataUrl); else notify('Could not read that image.'); });
            });
        }
        if (clearBtn) clearBtn.addEventListener('click', () => showImage(''));
        // Paste an image directly into the card form.
        form.addEventListener('paste', (e) => {
            const items = e.clipboardData && e.clipboardData.items;
            if (!items) return;
            for (let i = 0; i < items.length; i += 1) {
                if (items[i].type && items[i].type.indexOf('image/') === 0) {
                    const file = items[i].getAsFile();
                    if (file) { e.preventDefault(); downscaleImageToDataUrl(file, 1200, (d) => { if (d) showImage(d); }); break; }
                }
            }
        });
    }

    function readCardImageFields(mount) {
        const preview = mount.querySelector('#reviewCardImagePreview');
        const stage = mount.querySelector('#reviewCardImageStage');
        const occludeCk = mount.querySelector('#reviewCardOcclude');
        const imageUrl = (stage && !stage.hidden && preview && preview.getAttribute('src')) ? preview.getAttribute('src') : '';
        return { imageUrl: imageUrl, occludeImage: !!(occludeCk && occludeCk.checked && imageUrl) };
    }

    function modeDescription(mode) {
        switch (mode) {
            case 'flashcards': return 'Reveal then grade Again / Hard / Good / Easy. Updates spaced-repetition.';
            case 'learn': return 'Adaptive multiple-choice. Mastery climbs as you answer correctly.';
            case 'write': return 'Type the answer. Fuzzy compare. Retry on miss.';
            case 'test': return 'Mixed-format quiz with a final score and missed-card review.';
            case 'match': return 'Timed pair-up game. Beat your best time per deck.';
            default: return '';
        }
    }

    function filterDeckCards(cards) {
        let list = cards.slice();
        const f = viewState.deckFilter;
        if (f.search) {
            const q = String(f.search).toLowerCase();
            list = list.filter(c =>
                String(c.prompt || '').toLowerCase().includes(q)
                || String(c.answer || '').toLowerCase().includes(q)
                || (c.tags || []).join(' ').toLowerCase().includes(q));
        }
        if (f.mastery !== 'all') list = list.filter(c => (c.mastery || 'new') === f.mastery);
        if (f.starredOnly) list = list.filter(c => !!c.starred);
        return list;
    }

    function renderCardRow(card) {
        const m = card.mastery || 'new';
        const tagHtml = (card.tags || []).map(t => `<span class="review-tag">${escapeHtml(t)}</span>`).join('');
        return `
            <li class="review-card-row" data-card-id="${escapeHtml(card.id)}">
                <button type="button" class="review-card-star${card.starred ? ' active' : ''}" data-review-action="toggle-star" data-card-id="${escapeHtml(card.id)}" aria-label="${card.starred ? 'Unstar card' : 'Star card'}" title="${card.starred ? 'Unstar' : 'Star'}">★</button>
                <div class="review-card-row-prompt">${escapeHtml(card.prompt)}</div>
                <div class="review-card-row-divider" aria-hidden="true"></div>
                <div class="review-card-row-answer">${card.answer ? escapeHtml(card.answer) : '<em class="review-card-row-empty">(no answer)</em>'}</div>
                <div class="review-card-row-meta">
                    <span class="review-mastery-chip mastery-${m}">${m}</span>
                    ${card.lapses ? `<span class="review-lapse-chip">${card.lapses} lapses</span>` : ''}
                    ${card.correctCount || card.incorrectCount ? `<span class="review-stat-chip">${card.correctCount || 0}✓ ${card.incorrectCount || 0}✗</span>` : ''}
                    ${tagHtml}
                    ${card.hint ? `<span class="review-stat-chip">Hint: ${escapeHtml(card.hint)}</span>` : ''}
                </div>
                <div class="review-card-row-actions">
                    <button type="button" class="review-card-row-icon-btn" data-review-action="edit-card" data-card-id="${escapeHtml(card.id)}" aria-label="Edit card" title="Edit">✎</button>
                    <button type="button" class="review-card-row-icon-btn review-card-row-icon-btn--danger" data-review-action="delete-card" data-card-id="${escapeHtml(card.id)}" aria-label="Delete card" title="Delete">×</button>
                </div>
            </li>
        `;
    }

    function bindDeckEvents(mount, deck) {
        const search = mount.querySelector('#reviewDeckCardSearch');
        if (search) search.addEventListener('input', () => { viewState.deckFilter.search = search.value; render(); restoreFocus('#reviewDeckCardSearch'); });
        const masterySel = mount.querySelector('#reviewDeckMasteryFilter');
        if (masterySel) masterySel.addEventListener('change', () => { viewState.deckFilter.mastery = masterySel.value; render(); });
        const starredCk = mount.querySelector('#reviewDeckStarredOnly');
        if (starredCk) starredCk.addEventListener('change', () => { viewState.deckFilter.starredOnly = starredCk.checked; render(); });

        const form = mount.querySelector('#reviewCardForm');
        if (form) form.addEventListener('submit', event => {
            event.preventDefault();
            const promptEl = mount.querySelector('#reviewCardPrompt');
            const answerEl = mount.querySelector('#reviewCardAnswer');
            const hintEl = mount.querySelector('#reviewCardHint');
            const tagsEl = mount.querySelector('#reviewCardTags');
            const sourceSel = mount.querySelector('#reviewCardSource');
            const starEl = mount.querySelector('#reviewCardStarred');
            const editingId = form.getAttribute('data-card-id') || '';
            const sourceData = applySourceSelection(sourceSel ? sourceSel.value : '');
            const imageData = readCardImageFields(mount);
            if (editingId) {
                updateItem(editingId, {
                    prompt: promptEl ? promptEl.value.trim() : '',
                    answer: answerEl ? answerEl.value : '',
                    hint: hintEl ? hintEl.value : '',
                    tags: (tagsEl ? tagsEl.value : '').split(',').map(t => t.trim()).filter(Boolean),
                    starred: !!(starEl && starEl.checked),
                    imageUrl: imageData.imageUrl,
                    occludeImage: imageData.occludeImage,
                    sourceType: sourceData.sourceType,
                    sourceId: sourceData.sourceId,
                    sourceNoteId: sourceData.sourceNoteId,
                    sourceApClassId: sourceData.sourceApClassId,
                    sourceProjectId: sourceData.sourceProjectId
                });
                viewState.editingCardId = null;
                viewState.addCardOpen = false;
                notify('Card updated.');
                render();
            } else {
                const item = createItem({
                    deckId: deck.id,
                    prompt: promptEl ? promptEl.value : '',
                    answer: answerEl ? answerEl.value : '',
                    hint: hintEl ? hintEl.value : '',
                    tags: tagsEl ? tagsEl.value : '',
                    starred: !!(starEl && starEl.checked),
                    imageUrl: imageData.imageUrl,
                    occludeImage: imageData.occludeImage,
                    sourceType: sourceData.sourceType,
                    sourceId: sourceData.sourceId,
                    sourceNoteId: sourceData.sourceNoteId,
                    sourceApClassId: sourceData.sourceApClassId,
                    sourceProjectId: sourceData.sourceProjectId
                });
                if (!item) { notify('Add a prompt to save the card.'); return; }
                notify('Card added.');
                // Keep the drawer open and clear the inputs so users can rapidly add cards in a row.
                viewState.addCardOpen = true;
                render();
            }
        });

        bindCommonActions(mount);
    }

    function restoreFocus(selector) {
        const mount = document.getElementById('reviewMount');
        if (!mount) return;
        const el = mount.querySelector(selector);
        if (el) {
            el.focus();
            try { el.setSelectionRange(el.value.length, el.value.length); } catch (err) { /* ignore */ }
        }
    }

    // ------------------------------------------------------------------
    // Common action dispatcher (used by library + deck views)
    // ------------------------------------------------------------------
    function bindCommonActions(mount) {
        if (mount.dataset.commonBound === 'true') return;
        mount.dataset.commonBound = 'true';
        mount.addEventListener('click', event => {
            const target = event.target instanceof Element ? event.target : null;
            if (!target) return;
            const btn = target.closest('[data-review-action]');
            if (!btn) return;
            // Safari does not focus buttons on pointer activation. Establish
            // the real trigger before a dialog captures its return-focus target.
            if (typeof btn.focus === 'function') btn.focus({ preventScroll: true });
            const action = btn.getAttribute('data-review-action');
            handleAction(action, extractActionContext(btn));
        });
    }

    function extractActionContext(element) {
        const read = (name) => element && element.getAttribute ? (element.getAttribute(name) || '') : '';
        return {
            deckId: read('data-deck-id'),
            cardId: read('data-card-id'),
            mode: read('data-mode'),
            grade: read('data-grade'),
            tileId: read('data-tile-id'),
            correct: read('data-correct'),
            answerId: read('data-answer-id'),
            pairId: read('data-pair-id'),
            questionId: read('data-question-id') || read('data-test-q'),
            choiceId: read('data-choice-id') || read('data-choice-index')
        };
    }

    function handleAction(action, ctx) {
        const ws = safeWorkspace();
        if (!ws) return;
        switch (action) {
            case 'open-deck':
                viewState.view = 'deck';
                viewState.deckId = ctx.deckId;
                viewState.deckTab = 'cards';
                viewState.editingCardId = null;
                viewState.addCardOpen = false;
                viewState.deckFilter = { search: '', mastery: 'all', starredOnly: false };
                render();
                break;
            case 'back-to-library':
                viewState.view = 'library';
                viewState.deckId = null;
                viewState.editingCardId = null;
                viewState.addCardOpen = false;
                viewState.createDraft = null;
                render();
                break;
            case 'open-analytics':
                viewState.view = 'analytics';
                render();
                break;
            case 'open-create-set': {
                const editing = ctx.deckId ? getDeck(ctx.deckId) : null;
                viewState.createDraft = startCreateDraft(editing);
                viewState.view = 'create';
                render();
                setTimeout(() => {
                    const titleEl = document.getElementById('reviewCreateTitle');
                    if (titleEl) try { titleEl.focus(); } catch (err) { /* non-critical */ }
                }, 30);
                break;
            }
            case 'open-edit-set': {
                const targetDeckId = ctx.deckId || viewState.deckId;
                if (!targetDeckId) return;
                const editing = getDeck(targetDeckId);
                if (!editing) return;
                viewState.createDraft = startCreateDraft(editing);
                viewState.view = 'create';
                render();
                break;
            }
            case 'create-add-row':
                appendCreateDraftRow();
                render();
                setTimeout(() => focusLastCreateDraftRow(), 20);
                break;
            case 'create-remove-row':
                removeCreateDraftRow(ctx.cardId);
                render();
                break;
            case 'create-remove-duplicates':
                removeDuplicateDraftRows();
                render();
                break;
            case 'open-generate': {
                const draft = startCreateDraft(null);
                draft.generateMode = true;
                draft.rows = [makeBlankCreateRow()];
                viewState.createDraft = draft;
                viewState.view = 'create';
                render();
                setTimeout(() => {
                    const el = document.getElementById('reviewGenerateInput');
                    if (el) try { el.focus(); } catch (err) { /* non-critical */ }
                }, 30);
                break;
            }
            case 'create-generate-from-text': {
                const input = document.getElementById('reviewGenerateInput');
                const text = input ? input.value : '';
                if (!String(text || '').trim()) {
                    notify('Paste some material first.');
                    return;
                }
                const res = appendGeneratedRowsFromText(text);
                render();
                notify(res.added ? `Generated ${res.added} card${res.added === 1 ? '' : 's'}. Review before saving.` : 'No new cards detected.');
                break;
            }
            case 'create-submit':
                submitCreateDraft();
                break;
            case 'create-cancel':
                viewState.createDraft = null;
                viewState.view = (viewState.deckId ? 'deck' : 'library');
                render();
                break;
            case 'quick-create-card': {
                const decksNow = getDecks(false);
                if (!decksNow.length) {
                    // Route into the polished create-set flow instead of window.prompt.
                    viewState.createDraft = startCreateDraft(null);
                    viewState.view = 'create';
                    render();
                    setTimeout(() => {
                        const titleEl = document.getElementById('reviewCreateTitle');
                        if (titleEl) try { titleEl.focus(); } catch (err) { /* non-critical */ }
                    }, 30);
                    return;
                }
                // Open last-modified deck and pop the add-card drawer.
                const recent = decksNow.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0];
                if (recent) {
                    viewState.view = 'deck';
                    viewState.deckId = recent.id;
                    viewState.editingCardId = null;
                    viewState.addCardOpen = true;
                    render();
                }
                break;
            }
            case 'toggle-archive':
                setDeckArchived(ctx.deckId, !(getDeck(ctx.deckId) || {}).archived);
                render();
                break;
            case 'share-deck':
                exportShareableDeck(ctx.deckId || viewState.deckId);
                break;
            case 'open-add-card-drawer': {
                const targetDeckId = ctx.deckId || viewState.deckId;
                if (!targetDeckId) return;
                viewState.view = 'deck';
                viewState.deckId = targetDeckId;
                viewState.editingCardId = null;
                viewState.addCardOpen = true;
                render();
                break;
            }
            case 'close-card-drawer':
                viewState.addCardOpen = false;
                viewState.editingCardId = null;
                render();
                break;
            case 'delete-deck': {
                const targetDeckId = ctx.deckId || viewState.deckId;
                if (!targetDeckId) return;
                const deck = getDeck(targetDeckId);
                if (!deck) return;
                reviewConfirm({
                    title: 'Delete this set?',
                    message: `"${deck.name}" and all of its cards will be permanently removed. This cannot be undone.`,
                    confirmLabel: 'Delete set',
                    cancelLabel: 'Keep set',
                    danger: true
                }).then(ok => {
                    if (!ok) return;
                    deleteDeck(targetDeckId);
                    viewState.view = 'library';
                    viewState.deckId = null;
                    notify('Set deleted.');
                    render();
                });
                break;
            }
            case 'reset-progress': {
                if (!ctx.deckId) return;
                reviewConfirm({
                    title: 'Reset progress for this set?',
                    message: 'Every card returns to "new" mastery. Stats and spaced-repetition scheduling will reset.',
                    confirmLabel: 'Reset progress',
                    cancelLabel: 'Keep progress',
                    danger: true
                }).then(ok => {
                    if (!ok) return;
                    const items = getItems(ctx.deckId);
                    items.forEach(item => {
                        item.mastery = 'new'; item.status = 'new';
                        item.repetitions = 0; item.lapses = 0;
                        item.intervalDays = 0; item.ease = STARTING_EASE;
                        item.correctCount = 0; item.incorrectCount = 0;
                        item.nextReviewAt = nowIso(); item.lastReviewedAt = null;
                        item.updatedAt = nowIso();
                    });
                    persist();
                    notify('Progress reset.');
                    render();
                });
                break;
            }
            case 'shuffle-cards': {
                // Shuffle stable card order in workspace items array (visual only — no schema change).
                const ws2 = safeWorkspace();
                if (!ws2) return;
                const deckCards = ws2.items.filter(i => i.deckId === ctx.deckId);
                const others = ws2.items.filter(i => i.deckId !== ctx.deckId);
                ws2.items = others.concat(shuffle(deckCards));
                persist();
                notify('Shuffled.');
                render();
                break;
            }
            case 'open-bulk-import': {
                const targetDeckId = ctx.deckId || viewState.deckId || (getDecks(false)[0] && getDecks(false)[0].id) || null;
                if (!targetDeckId) {
                    // No decks exist — route into the polished create-set flow rather than chrome prompts.
                    viewState.createDraft = startCreateDraft(null);
                    viewState.view = 'create';
                    render();
                    notify('Create a set first, then bulk-import into it.');
                    return;
                }
                reviewBulkImport(targetDeckId);
                break;
            }
            case 'edit-card':
                viewState.editingCardId = ctx.cardId;
                viewState.addCardOpen = true;
                render();
                setTimeout(() => {
                    const drawer = document.querySelector('.review-card-drawer');
                    if (drawer && drawer.scrollIntoView) drawer.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 30);
                break;
            case 'cancel-edit':
                viewState.editingCardId = null;
                viewState.addCardOpen = false;
                render();
                break;
            case 'delete-card': {
                const cardId = ctx.cardId;
                if (!cardId) return;
                const ws = safeWorkspace();
                const card = ws ? (ws.items || []).find(i => i.id === cardId) : null;
                const preview = card ? String(card.prompt || '').slice(0, 80) : '';
                reviewConfirm({
                    title: 'Delete this card?',
                    message: preview ? `"${preview}${preview.length >= 80 ? '…' : ''}" will be removed from this set.` : 'This card will be removed from this set.',
                    confirmLabel: 'Delete card',
                    cancelLabel: 'Keep card',
                    danger: true
                }).then(ok => {
                    if (!ok) return;
                    deleteItem(cardId);
                    if (viewState.editingCardId === cardId) {
                        viewState.editingCardId = null;
                        viewState.addCardOpen = false;
                    }
                    notify('Card deleted.');
                    render();
                });
                break;
            }
            case 'toggle-star':
                toggleStar(ctx.cardId);
                render();
                break;
            case 'study': {
                const targetDeckId = ctx.deckId || viewState.deckId;
                if (!targetDeckId) return;
                const targetMode = STUDY_MODES.includes(ctx.mode) ? ctx.mode : 'flashcards';
                startStudy([targetDeckId], targetMode);
                break;
            }
            case 'study-deck-due': {
                const targetDeckId = ctx.deckId || viewState.deckId;
                if (!targetDeckId) return;
                const dueItems = getDueItems(targetDeckId);
                if (!dueItems.length) { notify('No cards due in this set right now.'); return; }
                const targetMode = STUDY_MODES.includes(ctx.mode) ? ctx.mode : 'flashcards';
                startStudy([targetDeckId], targetMode, { onlyDue: true });
                break;
            }
            case 'study-all-due': {
                const dueItems = getDueItems();
                if (!dueItems.length) { notify('No cards due right now.'); return; }
                const targetMode = STUDY_MODES.includes(ctx.mode) ? ctx.mode : 'flashcards';
                const deckIds = Array.from(new Set(dueItems.map(i => i.deckId)));
                startStudy(deckIds, targetMode, { onlyDue: true });
                break;
            }
            default:
                handleStudyAction(action, ctx);
                break;
        }
    }

    // Legacy function kept as a thin alias so any future caller still works,
    // but it routes through the custom Atelier modal — no native prompt.
    function openBulkImportPrompt(deckId) {
        if (!deckId) return;
        reviewBulkImport(deckId);
    }

    // ------------------------------------------------------------------
    // Create / edit set flow (replaces window.prompt-based deck creation)
    // ------------------------------------------------------------------
    function makeBlankCreateRow() {
        return { rowId: makeId('row'), prompt: '', answer: '' };
    }

    function startCreateDraft(existingDeck) {
        if (existingDeck) {
            const cards = getItems(existingDeck.id);
            const rows = cards.length
                ? cards.map(c => ({
                    rowId: makeId('row'),
                    prompt: c.prompt || '',
                    answer: c.answer || '',
                    existingId: c.id
                }))
                : [makeBlankCreateRow(), makeBlankCreateRow(), makeBlankCreateRow()];
            return {
                deckId: existingDeck.id,
                title: existingDeck.name || '',
                description: existingDeck.description || '',
                subject: existingDeck.subject || '',
                source: existingDeck.sourceNoteId
                    ? `note:${existingDeck.sourceNoteId}`
                    : (existingDeck.sourceApClassId ? `apClass:${existingDeck.sourceApClassId}`
                    : (existingDeck.sourceProjectId ? `course:${existingDeck.sourceProjectId}` : '')),
                rows,
                error: ''
            };
        }
        return {
            deckId: null,
            title: '',
            description: '',
            subject: '',
            source: '',
            rows: [makeBlankCreateRow(), makeBlankCreateRow(), makeBlankCreateRow()],
            error: ''
        };
    }

    function appendCreateDraftRow() {
        if (!viewState.createDraft) return;
        captureCreateDraftInputs();
        viewState.createDraft.rows.push(makeBlankCreateRow());
    }

    function removeCreateDraftRow(rowId) {
        if (!viewState.createDraft) return;
        captureCreateDraftInputs();
        viewState.createDraft.rows = viewState.createDraft.rows.filter(r => r.rowId !== rowId);
        if (!viewState.createDraft.rows.length) {
            viewState.createDraft.rows.push(makeBlankCreateRow());
        }
    }

    function captureCreateDraftInputs() {
        const draft = viewState.createDraft;
        if (!draft) return;
        const titleEl = document.getElementById('reviewCreateTitle');
        const descEl = document.getElementById('reviewCreateDesc');
        const subjEl = document.getElementById('reviewCreateSubject');
        const sourceEl = document.getElementById('reviewCreateSource');
        if (titleEl) draft.title = titleEl.value;
        if (descEl) draft.description = descEl.value;
        if (subjEl) draft.subject = subjEl.value;
        if (sourceEl) draft.source = sourceEl.value;
        document.querySelectorAll('[data-create-row]').forEach(el => {
            const rowId = el.getAttribute('data-create-row');
            const row = draft.rows.find(r => r.rowId === rowId);
            if (!row) return;
            const promptEl = el.querySelector('[data-create-field="prompt"]');
            const answerEl = el.querySelector('[data-create-field="answer"]');
            if (promptEl) row.prompt = promptEl.value;
            if (answerEl) row.answer = answerEl.value;
        });
    }

    function focusLastCreateDraftRow() {
        const rows = document.querySelectorAll('[data-create-row]');
        const last = rows[rows.length - 1];
        if (!last) return;
        const promptEl = last.querySelector('[data-create-field="prompt"]');
        if (promptEl) try { promptEl.focus(); } catch (err) { /* non-critical */ }
    }

    function submitCreateDraft() {
        captureCreateDraftInputs();
        const draft = viewState.createDraft;
        if (!draft) return;
        const title = String(draft.title || '').trim();
        if (!title) {
            draft.error = 'Add a set title to continue.';
            render();
            const titleEl = document.getElementById('reviewCreateTitle');
            if (titleEl) try { titleEl.focus(); } catch (err) { /* non-critical */ }
            return;
        }
        const validRows = draft.rows.filter(r => String(r.prompt || '').trim().length > 0);
        if (!draft.deckId && !validRows.length) {
            draft.error = 'Add at least one card with a term to continue.';
            render();
            return;
        }
        const sourceData = applySourceSelection(draft.source || '');
        let deck;
        if (draft.deckId) {
            deck = updateDeck(draft.deckId, {
                name: title,
                description: draft.description || '',
                subject: draft.subject || '',
                sourceType: sourceData.sourceType,
                sourceId: sourceData.sourceId,
                sourceNoteId: sourceData.sourceNoteId,
                sourceApClassId: sourceData.sourceApClassId,
                sourceProjectId: sourceData.sourceProjectId
            });
            // Sync card rows: update existing, add new, leave others alone.
            draft.rows.forEach(row => {
                const promptText = String(row.prompt || '').trim();
                const answerText = String(row.answer || '');
                if (row.existingId) {
                    if (!promptText) {
                        deleteItem(row.existingId);
                    } else {
                        updateItem(row.existingId, { prompt: promptText, answer: answerText });
                    }
                } else if (promptText) {
                    createItem({
                        deckId: deck.id,
                        prompt: promptText,
                        answer: answerText,
                        sourceType: sourceData.sourceType,
                        sourceId: sourceData.sourceId,
                        sourceNoteId: sourceData.sourceNoteId,
                        sourceApClassId: sourceData.sourceApClassId,
                        sourceProjectId: sourceData.sourceProjectId
                    });
                }
            });
            notify('Set updated.');
        } else {
            deck = createDeck({
                name: title,
                description: draft.description || '',
                subject: draft.subject || '',
                sourceType: sourceData.sourceType,
                sourceId: sourceData.sourceId,
                sourceNoteId: sourceData.sourceNoteId,
                sourceApClassId: sourceData.sourceApClassId,
                sourceProjectId: sourceData.sourceProjectId
            });
            if (!deck) {
                draft.error = 'Could not create the set. Try again.';
                render();
                return;
            }
            validRows.forEach(row => {
                createItem({
                    deckId: deck.id,
                    prompt: String(row.prompt || '').trim(),
                    answer: String(row.answer || ''),
                    sourceType: sourceData.sourceType,
                    sourceId: sourceData.sourceId,
                    sourceNoteId: sourceData.sourceNoteId,
                    sourceApClassId: sourceData.sourceApClassId,
                    sourceProjectId: sourceData.sourceProjectId
                });
            });
            notify(`Created "${deck.name}" with ${validRows.length} card${validRows.length === 1 ? '' : 's'}.`);
        }
        viewState.createDraft = null;
        viewState.view = 'deck';
        viewState.deckId = deck.id;
        render();
    }

    function renderCreateView(mount) {
        if (!viewState.createDraft) viewState.createDraft = startCreateDraft(null);
        const draft = viewState.createDraft;
        const sourceOptions = buildSourceOptions();
        const editing = !!draft.deckId;
        const hasContent = String(draft.title || '').trim() || draft.rows.some(r => String(r.prompt || '').trim() || String(r.answer || '').trim());

        mount.innerHTML = `
            <header class="review-create-header">
                <button type="button" class="review-back-btn" data-review-action="${hasContent ? 'create-cancel' : 'back-to-library'}">← ${editing ? 'Back to set' : 'Cancel'}</button>
                <div class="review-create-header-text">
                    <div class="eyebrow">${editing ? 'Edit set' : 'New set'}</div>
                    <h1>${editing ? 'Edit study set' : 'Create a new study set'}</h1>
                    <p>Title your set, then add as many term/definition pairs as you need.</p>
                </div>
            </header>

            <form id="reviewCreateSetForm" class="review-create-form" autocomplete="off">
                <section class="review-create-meta-card">
                    <label class="review-field"><span>Set title</span>
                        <input id="reviewCreateTitle" type="text" required placeholder="e.g. Cell biology vocabulary" value="${escapeHtml(draft.title)}" />
                    </label>
                    <label class="review-field"><span>Description (optional)</span>
                        <textarea id="reviewCreateDesc" rows="2" placeholder="A short note about what this set covers">${escapeHtml(draft.description)}</textarea>
                    </label>
                    <div class="review-create-meta-row">
                        <label class="review-field"><span>Subject (optional)</span>
                            <input id="reviewCreateSubject" type="text" placeholder="e.g. Biology" value="${escapeHtml(draft.subject)}" />
                        </label>
                        <label class="review-field"><span>Source (optional)</span>
                            <select id="reviewCreateSource" class="review-select">${sourceOptions.map(o => `<option value="${escapeHtml(o.value)}"${draft.source === o.value ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select>
                        </label>
                    </div>
                </section>

                ${(draft.generateMode || draft.generated) && !draft.deckId ? `
                <section class="review-generate-panel" aria-label="Generate cards from material">
                    <label class="review-field" for="reviewGenerateInput"><span>Paste notes, a study guide, or assistant text — one item per line ("Term: definition", "Term - definition", or "Term, definition")</span></label>
                    <textarea id="reviewGenerateInput" rows="4" placeholder="Photosynthesis: the process plants use to convert light into energy&#10;Mitochondria - the powerhouse of the cell"></textarea>
                    <div class="review-generate-panel-actions">
                        <button type="button" class="review-btn-primary review-btn-small" data-review-action="create-generate-from-text">✨ Generate cards</button>
                        <span class="review-generate-hint">Cards land in the table below for review before you save.</span>
                    </div>
                </section>` : ''}

                ${draft.generated ? `<div class="review-generated-banner" role="status">
                    <span>✨ Generated ${draft.rows.filter(r => String(r.prompt || '').trim()).length} card${draft.rows.filter(r => String(r.prompt || '').trim()).length === 1 ? '' : 's'}. Review and edit before saving.</span>
                    ${draft.dupCount ? `<span class="review-dup-warning">⚠ ${draft.dupCount} possible duplicate${draft.dupCount === 1 ? '' : 's'} <button type="button" class="review-btn-ghost review-btn-small" data-review-action="create-remove-duplicates">Remove duplicates</button></span>` : ''}
                </div>` : ''}

                <section class="review-create-cards-card" aria-label="Cards builder">
                    <header class="review-create-cards-header">
                        <h2>Cards</h2>
                        <button type="button" class="review-btn-ghost" data-review-action="create-add-row">＋ Add row</button>
                    </header>
                    <div class="review-create-rows" id="reviewCreateRows">
                        ${draft.rows.map((row, idx) => `
                            <div class="review-create-row${row.duplicate ? ' is-duplicate' : ''}" data-create-row="${escapeHtml(row.rowId)}">
                                <div class="review-create-row-num">${idx + 1}${row.duplicate ? '<span class="review-dup-badge" title="A card with a similar prompt already exists">Duplicate</span>' : ''}</div>
                                <label class="review-create-field"><span>Term / Prompt</span>
                                    <textarea data-create-field="prompt" rows="2" placeholder="Term, question, or what to remember">${escapeHtml(row.prompt)}</textarea>
                                </label>
                                <label class="review-create-field"><span>Definition / Answer</span>
                                    <textarea data-create-field="answer" rows="2" placeholder="Definition or answer">${escapeHtml(row.answer)}</textarea>
                                </label>
                                <button type="button" class="review-create-row-remove" data-review-action="create-remove-row" data-card-id="${escapeHtml(row.rowId)}" aria-label="Remove row">×</button>
                            </div>
                        `).join('')}
                    </div>
                    <div class="review-create-rows-footer">
                        <button type="button" class="review-btn-ghost" data-review-action="create-add-row">＋ Add another row</button>
                    </div>
                </section>

                ${draft.error ? `<div class="review-create-error" role="alert">${escapeHtml(draft.error)}</div>` : ''}

                <div class="review-create-actions">
                    <button type="button" class="review-btn-ghost" data-review-action="${hasContent ? 'create-cancel' : 'back-to-library'}">Cancel</button>
                    <button type="submit" class="review-btn-primary">${editing ? 'Save changes' : 'Create set'}</button>
                </div>
            </form>
        `;

        const form = mount.querySelector('#reviewCreateSetForm');
        if (form) form.addEventListener('submit', event => {
            event.preventDefault();
            submitCreateDraft();
        });
        // Capture inputs into the draft as the user edits so add-row / cancel preserve typing.
        ['reviewCreateTitle', 'reviewCreateDesc', 'reviewCreateSubject', 'reviewCreateSource'].forEach(id => {
            const el = mount.querySelector(`#${id}`);
            if (!el) return;
            el.addEventListener('input', () => captureCreateDraftInputs());
            el.addEventListener('change', () => captureCreateDraftInputs());
        });
        mount.querySelectorAll('[data-create-row]').forEach(rowEl => {
            ['prompt', 'answer'].forEach(field => {
                const el = rowEl.querySelector(`[data-create-field="${field}"]`);
                if (!el) return;
                el.addEventListener('input', () => captureCreateDraftInputs());
                // Tab from last answer adds a new row for fast keyboard entry.
                if (field === 'answer') {
                    el.addEventListener('keydown', evt => {
                        if (evt.key === 'Tab' && !evt.shiftKey) {
                            const allAnswers = mount.querySelectorAll('[data-create-field="answer"]');
                            if (allAnswers[allAnswers.length - 1] === el) {
                                evt.preventDefault();
                                appendCreateDraftRow();
                                render();
                                setTimeout(() => focusLastCreateDraftRow(), 20);
                            }
                        }
                    });
                }
            });
        });
        bindCommonActions(mount);
    }

    // ==================================================================
    // Study modes
    // ==================================================================
    function startStudy(deckIds, mode, opts) {
        const deckSet = new Set(deckIds.map(String));
        let pool = (safeWorkspace().items || []).filter(i => deckSet.has(i.deckId));
        if (opts && opts.onlyDue) pool = pool.filter(isDue);
        if (!pool.length) { notify('No cards available.'); return; }
        const settings = safeWorkspace().settings || {};
        const limit = Math.max(1, parseInt(settings.dailyLimit, 10) || 30);
        const shouldShuffle = settings.shuffleCards !== false;
        const queue = (shouldShuffle ? shuffle(pool) : pool.slice()).slice(0, mode === 'match' ? Math.max(4, parseInt(settings.matchPairCount, 10) || 6) : (mode === 'test' ? Math.min(pool.length, parseInt(settings.testQuestionCount, 10) || 20) : limit));
        const session = startSession({ mode, deckIds: Array.from(deckSet) });
        session._queue = queue;
        session._index = 0;
        session._answerRevealed = false;
        session._relearnCounts = Object.create(null);
        // Mode-specific bootstrap.
        if (mode === 'learn') {
            session._learnPool = queue.slice();
            session._learnRound = [];
            buildLearnRound(session);
        } else if (mode === 'write') {
            session._writeRetry = false;
            session._lastFeedback = null;
        } else if (mode === 'test') {
            session._testQuestions = buildTestQuestions(session);
            session._testAnswers = {};
            session._testSubmitted = false;
        } else if (mode === 'match') {
            session._matchTiles = buildMatchTiles(session);
            session._matchSelected = null;
            session._matchStartTime = null;
            session._matchEndTime = null;
            session._matchMisses = 0;
        }
        viewState.view = 'study';
        viewState.session = session;
        render();
    }

    // Cloze deletions: `{{hidden}}` in a card prompt renders as a blank on the
    // front and the revealed term on the back. Returns developer-safe HTML
    // (every literal slice is escaped).
    function hasCloze(text) {
        return /\{\{[^}]+\}\}/.test(String(text || ''));
    }
    // Render an image/audio attachment on a card face, but only for safe
    // sources (data:/https:/blob:) so a hand-edited card can't smuggle a
    // dangerous URL into the face markup.
    function mediaTag(src, kind) {
        const s = String(src || '').trim();
        if (!s) return '';
        if (kind === 'image') {
            if (!/^(data:image\/|https?:|blob:)/i.test(s)) return '';
            return `<div class="review-bigcard-media"><img src="${escapeHtml(s)}" alt="card image" loading="lazy"></div>`;
        }
        if (kind === 'audio') {
            if (!/^(data:audio\/|https?:|blob:)/i.test(s)) return '';
            return `<div class="review-bigcard-media"><audio controls src="${escapeHtml(s)}"></audio></div>`;
        }
        return '';
    }
    function renderClozeHtml(text, reveal) {
        const src = String(text || '');
        let out = '';
        let last = 0;
        const re = /\{\{([^}]+)\}\}/g;
        let m;
        while ((m = re.exec(src)) !== null) {
            out += escapeHtml(src.slice(last, m.index));
            out += reveal
                ? `<span class="review-cloze-fill">${escapeHtml(m[1])}</span>`
                : '<span class="review-cloze-blank">[&hellip;]</span>';
            last = re.lastIndex;
        }
        out += escapeHtml(src.slice(last));
        return out;
    }

    // Render LaTeX math ($...$, $$...$$) and syntax-highlight fenced code in a
    // freshly-mounted container. Both helpers are optional (lazy-loaded) and
    // no-op gracefully if unavailable, so this never blocks the study UI.
    function applyRichContentRendering(el) {
        if (!el) return;
        try {
            if (window.SutraHighlight && typeof window.SutraHighlight.highlightInElement === 'function') {
                window.SutraHighlight.highlightInElement(el);
            }
        } catch (e) { /* non-critical */ }
        try {
            if (window.SutraMath && typeof window.SutraMath.renderInElement === 'function') {
                window.SutraMath.renderInElement(el);
            }
        } catch (e) { /* non-critical */ }
    }

    function renderStudyView(mount) {
        const session = viewState.session;
        if (!session) { viewState.view = 'library'; render(); return; }
        const total = (session._queue || []).length || (session._testQuestions || []).length || (session._matchTiles ? session._matchTiles.length / 2 : 0);
        const idx = session._index || 0;
        const progress = total ? Math.round(((idx) / total) * 100) : 0;
        const decks = (session.deckIds || []).map(getDeck).filter(Boolean);
        const deckNames = decks.map(d => d.name).join(' · ') || 'Multi-set';
        let body = '';
        switch (session.mode) {
            case 'flashcards': body = renderFlashcardsBody(session); break;
            case 'learn': body = renderLearnBody(session); break;
            case 'write': body = renderWriteBody(session); break;
            case 'test': body = renderTestBody(session); break;
            case 'match': body = renderMatchBody(session); break;
            default: body = '<p>Mode unsupported.</p>'; break;
        }
        // Flashcards mode gets bespoke top-bar controls (shuffle / swap / progress);
        // every other mode keeps the standard progress strip.
        const isFlashcards = session.mode === 'flashcards';
        const isComplete = (session.mode === 'flashcards' && idx >= total)
            || (session.mode === 'write' && idx >= total)
            || (session.mode === 'test' && session._testSubmitted)
            || (session.mode === 'match' && session._matchEndTime);
        const flashcardsControls = isFlashcards ? `
            <div class="review-study-toolbar-actions">
                <button type="button" class="review-study-icon-btn${viewState.flashcards.shuffled ? ' is-active' : ''}" data-review-action="flashcards-shuffle" aria-pressed="${viewState.flashcards.shuffled ? 'true' : 'false'}" title="Shuffle order">⇄ Shuffle</button>
                <button type="button" class="review-study-icon-btn${viewState.flashcards.swapped ? ' is-active' : ''}" data-review-action="flashcards-swap" aria-pressed="${viewState.flashcards.swapped ? 'true' : 'false'}" title="Show answer first">↔ Swap</button>
            </div>
        ` : '';
        mount.innerHTML = `
            <div class="review-study-shell" data-mode="${session.mode}">
                <header class="review-study-topbar">
                    <button type="button" class="review-back-btn" data-review-action="back-to-library">← Back</button>
                    <div class="review-study-topbar-title">
                        <div class="eyebrow">${escapeHtml(modeLabel(session.mode))}</div>
                        <h2>${escapeHtml(deckNames)}</h2>
                    </div>
                    <div class="review-study-topbar-progress" aria-live="polite">
                        <span>${isComplete ? total : idx + (isFlashcards && !session._answerRevealed ? 0 : 0)}<span class="review-study-progress-of"> / ${total}</span></span>
                        <div class="review-study-progress" aria-hidden="true"><span style="width:${progress}%"></span></div>
                    </div>
                    ${flashcardsControls}
                    <button type="button" class="review-btn-ghost review-study-exit" data-review-action="study-exit" aria-label="Exit study session">Exit</button>
                </header>
                <main class="review-study-body" data-mode="${session.mode}">${body}</main>
                <footer class="review-study-foot">${renderModeFooter(session)}</footer>
            </div>
        `;
        bindCommonActions(mount);
        bindStudyKeys();
        bindModeSpecificEvents(mount, session);
        applyRichContentRendering(mount);
    }

    function renderModeFooter(session) {
        switch (session.mode) {
            case 'flashcards':
                return `<small>Shortcuts: <kbd>Space</kbd> flip · <kbd>←</kbd>/<kbd>→</kbd> prev/next · <kbd>1</kbd> Again · <kbd>2</kbd> Hard · <kbd>3</kbd> Good · <kbd>4</kbd> Easy · <kbd>Esc</kbd> exit</small>`;
            case 'learn':
                return `<small>Shortcuts: <kbd>1-4</kbd> pick choice · <kbd>Esc</kbd> exit · <span class="review-pill pill-good">${session.correctCount}✓</span> <span class="review-pill pill-again">${session.incorrectCount}✗</span></small>`;
            case 'write':
                return `<small>Type the answer · <kbd>Enter</kbd> check · <kbd>Esc</kbd> exit · <span class="review-pill pill-good">${session.correctCount}✓</span> <span class="review-pill pill-again">${session.incorrectCount}✗</span></small>`;
            case 'test':
                return `<small>${session._testSubmitted ? 'Test complete' : `Answer all ${session._testQuestions ? session._testQuestions.length : 0} questions then submit`} · <kbd>Esc</kbd> exit</small>`;
            case 'match':
                return `<small>Tap prompt then matching answer · ${session._matchEndTime ? `Done in ${formatDuration(session.timeMs)}` : 'Timer starts on first tap'} · <kbd>Esc</kbd> exit</small>`;
            default: return '';
        }
    }

    // ----- Flashcards mode -----
    function renderFlashcardsBody(session) {
        const queue = session._queue || [];
        const idx = session._index || 0;
        if (idx >= queue.length) return renderFlashcardsSummary(session);
        const item = queue[idx];
        const deck = getDeck(item.deckId);
        // The "swap" toggle (per-session UI) overrides the persisted frontSide preference.
        const settings = safeWorkspace().settings || {};
        const frontPref = viewState.flashcards.swapped
            ? (settings.frontSide === 'answer' ? 'prompt' : 'answer')
            : (settings.frontSide || 'prompt');
        const front = (frontPref === 'answer' && item.answer) ? item.answer : item.prompt;
        const back = (frontPref === 'answer') ? item.prompt : (item.answer || '(no answer noted)');
        // Cloze cards (prompt contains {{...}}) blank the term on the front and
        // reveal it on the back, regardless of front-side preference.
        const cloze = hasCloze(item.prompt);
        const frontHtml = cloze ? renderClozeHtml(item.prompt, false) : escapeHtml(front);
        const backHtml = cloze ? renderClozeHtml(item.prompt, true) : escapeHtml(back);
        const safeImg = (item.imageUrl && /^(data:image\/|https?:|blob:)/i.test(String(item.imageUrl).trim())) ? String(item.imageUrl).trim() : '';
        // Image occlusion: when occludeImage is set, the image is hidden on the
        // front (flip to reveal) and shown on the back; otherwise it shows on the front.
        const imgFront = safeImg
            ? (item.occludeImage
                ? `<div class="review-bigcard-media review-occluded"><img src="${escapeHtml(safeImg)}" alt="hidden image" loading="lazy"><span class="review-occlusion-cover"><i class="fas fa-eye-slash" aria-hidden="true"></i> Hidden — flip to reveal</span></div>`
                : mediaTag(safeImg, 'image'))
            : '';
        const imgBack = (safeImg && item.occludeImage) ? mediaTag(safeImg, 'image') : '';
        const audioBack = mediaTag(item.audioUrl, 'audio');
        const tagHtml = (item.tags || []).map(t => `<span class="review-tag">${escapeHtml(t)}</span>`).join('');
        const revealed = !!session._answerRevealed;
        const atStart = idx === 0;
        const atEnd = idx >= queue.length - 1;
        return `
            <div class="review-flashcards-stage">
                <div class="review-bigcard${revealed ? ' is-flipped' : ''}" data-card-id="${escapeHtml(item.id)}">
                    <button type="button" class="review-bigcard-flip-target" data-review-action="flashcards-flip" aria-label="${revealed ? 'Show prompt' : 'Show answer'}" tabindex="0">
                        <div class="review-bigcard-inner">
                            <div class="review-bigcard-face review-bigcard-front">
                                ${deck ? `<div class="review-bigcard-deck">${escapeHtml(deck.name)}</div>` : ''}
                                <div class="review-bigcard-prompt">${frontHtml}</div>
                                ${imgFront}
                                ${item.hint ? `<div class="review-bigcard-hint">Hint: ${escapeHtml(item.hint)}</div>` : ''}
                                <div class="review-bigcard-tags">${tagHtml}</div>
                                <div class="review-bigcard-cue">Click or press Space to flip</div>
                            </div>
                            <div class="review-bigcard-face review-bigcard-back">
                                <div class="eyebrow">Answer</div>
                                <div class="review-bigcard-answer">${backHtml}</div>
                                ${imgBack}
                                ${audioBack}
                                <div class="review-bigcard-cue">Grade your recall ↓</div>
                            </div>
                        </div>
                    </button>
                </div>

                <div class="review-flashcards-controls">
                    <button type="button" class="review-flashcards-nav" data-review-action="flashcards-prev" ${atStart ? 'disabled aria-disabled="true"' : ''} aria-label="Previous card">← Previous</button>
                    <button type="button" class="review-flashcards-nav review-flashcards-flip" data-review-action="flashcards-flip" aria-label="${revealed ? 'Show prompt' : 'Show answer'}">${revealed ? 'Show prompt' : 'Show answer'}</button>
                    <button type="button" class="review-flashcards-nav" data-review-action="flashcards-next" ${atEnd ? 'disabled aria-disabled="true"' : ''} aria-label="Next card">Next →</button>
                </div>

                ${revealed ? `
                    <div class="review-grade-row" role="group" aria-label="Grade your recall">
                        <button type="button" class="review-grade-btn grade-again" data-review-action="flashcards-grade" data-grade="again"><strong>Again</strong><span>1</span></button>
                        <button type="button" class="review-grade-btn grade-hard" data-review-action="flashcards-grade" data-grade="hard"><strong>Hard</strong><span>2</span></button>
                        <button type="button" class="review-grade-btn grade-good" data-review-action="flashcards-grade" data-grade="good"><strong>Good</strong><span>3</span></button>
                        <button type="button" class="review-grade-btn grade-easy" data-review-action="flashcards-grade" data-grade="easy"><strong>Easy</strong><span>4</span></button>
                    </div>
                ` : `
                    <div class="review-flashcards-hint" aria-hidden="true">Reveal the answer to grade with Again / Hard / Good / Easy.</div>
                `}
            </div>
        `;
    }

    function renderFlashcardsSummary(session) {
        const reviewed = session.itemResults.length;
        const accuracyOk = reviewed > 0 ? Math.round(((session.goodCount + session.easyCount) / reviewed) * 100) : 0;
        // Surface up to 5 weak cards from this session (cards graded "again" the most).
        const lapseTally = {};
        (session.itemResults || []).forEach(r => {
            if (r.grade === 'again') lapseTally[r.itemId] = (lapseTally[r.itemId] || 0) + 1;
        });
        const weakIds = Object.keys(lapseTally).sort((a, b) => lapseTally[b] - lapseTally[a]).slice(0, 5);
        const ws = safeWorkspace();
        const weakCards = weakIds.map(id => (ws.items || []).find(i => i.id === id)).filter(Boolean);
        return `
            <div class="review-summary review-summary--result">
                <div class="review-summary-head">
                    <div class="eyebrow">Session complete</div>
                    <h3>${reviewed} card${reviewed === 1 ? '' : 's'} reviewed</h3>
                    <p class="review-summary-sub">${accuracyOk}% recalled comfortably (Good or Easy).</p>
                </div>
                <div class="review-grade-summary">
                    <span class="review-pill pill-again">Again ${session.againCount}</span>
                    <span class="review-pill pill-hard">Hard ${session.hardCount}</span>
                    <span class="review-pill pill-good">Good ${session.goodCount}</span>
                    <span class="review-pill pill-easy">Easy ${session.easyCount}</span>
                </div>
                ${weakCards.length ? `
                    <div class="review-summary-weak">
                        <div class="eyebrow">Needs more work</div>
                        <ul>
                            ${weakCards.map(c => `<li><strong>${escapeHtml(c.prompt)}</strong>${c.answer ? ` — ${escapeHtml(c.answer)}` : ''}</li>`).join('')}
                        </ul>
                    </div>
                ` : ''}
                <div class="review-summary-actions">
                    <button type="button" class="review-btn-primary" data-review-action="study-restart">Study again</button>
                    <button type="button" class="review-btn-ghost" data-review-action="study-save">Back to set</button>
                </div>
            </div>
        `;
    }

    // ----- Learn mode -----
    function buildLearnRound(session) {
        const ws = safeWorkspace();
        const pool = session._learnPool || [];
        // Pick up to 7 cards prioritizing low mastery.
        const ordered = pool.slice().sort((a, b) => MASTERY_LEVELS.indexOf(a.mastery || 'new') - MASTERY_LEVELS.indexOf(b.mastery || 'new'));
        session._learnRound = ordered.slice(0, 7);
        session._learnRoundIndex = 0;
    }

    function renderLearnBody(session) {
        const round = session._learnRound || [];
        const idx = session._learnRoundIndex || 0;
        if (!round.length) return renderLearnSummary(session);
        if (idx >= round.length) {
            // Refill the round from remaining low-mastery cards.
            const stillLearning = (session._learnPool || []).filter(i => i.mastery !== 'mastered');
            if (!stillLearning.length) return renderLearnSummary(session);
            session._learnPool = stillLearning;
            buildLearnRound(session);
            return renderLearnBody(session);
        }
        const item = round[idx];
        const choices = buildLearnChoices(item);
        return `
            <div class="review-learn-card">
                <div class="review-learn-prompt">${escapeHtml(item.prompt)}</div>
                ${item.hint ? `<div class="review-learn-hint">Hint: ${escapeHtml(item.hint)}</div>` : ''}
                <div class="review-learn-choices">
                    ${choices.map((c, i) => `
                        <button type="button" class="review-learn-choice" data-review-action="learn-pick" data-card-id="${escapeHtml(item.id)}" data-correct="${c.correct ? 'true' : 'false'}" data-choice-index="${i}">
                            <span class="review-learn-key">${i + 1}</span>
                            <span class="review-learn-choice-text">${escapeHtml(c.text)}</span>
                        </button>
                    `).join('')}
                </div>
                ${session._lastFeedback ? `
                    <div class="review-learn-feedback ${session._lastFeedback.correct ? 'correct' : 'incorrect'}">
                        ${session._lastFeedback.correct ? '✓ Correct' : `✗ Was: <strong>${escapeHtml(session._lastFeedback.answer)}</strong>`}
                    </div>
                ` : ''}
            </div>
        `;
    }

    function buildLearnChoices(item) {
        const ws = safeWorkspace();
        const deckCards = ws.items.filter(i => i.deckId === item.deckId && i.id !== item.id && i.answer);
        const distractors = shuffle(deckCards).slice(0, 3).map(i => ({ text: i.answer, correct: false }));
        const correct = { text: item.answer || item.prompt, correct: true };
        const out = shuffle([correct, ...distractors]);
        // If too few distractors, pad with placeholder text from prompts.
        while (out.length < 4) out.push({ text: '—', correct: false });
        return out.slice(0, 4);
    }

    function renderLearnSummary(session) {
        return `
            <div class="review-summary">
                <h3>Learn round complete</h3>
                <p>Mastered all cards in this run. <strong>${session.correctCount}</strong> correct, <strong>${session.incorrectCount}</strong> wrong.</p>
                <div class="review-summary-actions">
                    <button type="button" class="review-btn-primary" data-review-action="study-save">Save session</button>
                    <button type="button" class="review-btn-ghost" data-review-action="back-to-library">Back to library</button>
                </div>
            </div>
        `;
    }

    // ----- Write mode (surfaced as "Learn" in the UI) -----
    function renderWriteBody(session) {
        const queue = session._queue || [];
        const idx = session._index || 0;
        if (idx >= queue.length) return renderWriteSummary(session);
        const item = queue[idx];
        const feedback = session._lastFeedback;
        const showInputForm = !feedback || (feedback && feedback.correct === false && session._writeRetry);
        const showWrongActions = !!feedback && feedback.correct === false && !session._writeRetry;

        return `
            <div class="review-learn-stage">
                <div class="review-learn-card-v2">
                    <div class="eyebrow review-learn-eyebrow">Type the answer</div>
                    <div class="review-learn-prompt-v2">${escapeHtml(item.prompt)}</div>
                    ${item.hint ? `<div class="review-learn-hint-v2">Hint: ${escapeHtml(item.hint)}</div>` : ''}

                    ${feedback ? `
                        <div class="review-learn-feedback-v2 ${feedback.correct ? 'correct' : 'incorrect'}" role="status">
                            ${feedback.correct
                                ? `<span class="review-learn-feedback-icon">✓</span><span>Correct${feedback.answer ? ` — <em>${escapeHtml(feedback.answer)}</em>` : ''}</span>`
                                : `<span class="review-learn-feedback-icon">✗</span><span>The answer was <strong>${escapeHtml(feedback.answer || '(no answer)')}</strong></span>`}
                        </div>
                    ` : ''}

                    ${showInputForm ? `
                        <form id="reviewWriteForm" class="review-learn-form-v2" autocomplete="off">
                            <input type="text" id="reviewWriteInput" class="review-learn-input-v2" placeholder="Type your answer…" aria-label="Your answer" autofocus />
                            <div class="review-learn-actions-v2">
                                <button type="submit" class="review-btn-primary">Check</button>
                                <button type="button" class="review-btn-ghost" data-review-action="write-show">I don't know</button>
                                <button type="button" class="review-btn-ghost" data-review-action="write-skip">Skip</button>
                            </div>
                        </form>
                    ` : ''}

                    ${showWrongActions ? `
                        <div class="review-learn-actions-v2">
                            <button type="button" class="review-btn-primary" data-review-action="write-retry">Try again</button>
                            <button type="button" class="review-btn-ghost" data-review-action="write-iknew">I knew this</button>
                            <button type="button" class="review-btn-ghost" data-review-action="write-continue">Continue</button>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    function renderWriteSummary(session) {
        const total = session.itemResults.length;
        const accuracy = total ? Math.round((session.correctCount / total) * 100) : 0;
        const ws = safeWorkspace();
        const wrongIds = (session.itemResults || []).filter(r => r.grade === 'incorrect').map(r => r.itemId);
        const wrongCards = Array.from(new Set(wrongIds))
            .map(id => (ws.items || []).find(i => i.id === id))
            .filter(Boolean)
            .slice(0, 5);
        return `
            <div class="review-summary review-summary--result">
                <div class="review-summary-head">
                    <div class="eyebrow">Learn complete</div>
                    <h3>${accuracy}% accuracy</h3>
                    <p class="review-summary-sub">${session.correctCount} correct out of ${total}.</p>
                </div>
                ${wrongCards.length ? `
                    <div class="review-summary-weak">
                        <div class="eyebrow">Missed</div>
                        <ul>
                            ${wrongCards.map(c => `<li><strong>${escapeHtml(c.prompt)}</strong>${c.answer ? ` — ${escapeHtml(c.answer)}` : ''}</li>`).join('')}
                        </ul>
                    </div>
                ` : '<p>Nice — perfect run.</p>'}
                <div class="review-summary-actions">
                    <button type="button" class="review-btn-primary" data-review-action="study-restart">Study again</button>
                    <button type="button" class="review-btn-ghost" data-review-action="study-save">Back to set</button>
                </div>
            </div>
        `;
    }

    // ----- Test mode -----
    function buildTestQuestions(session) {
        const settings = safeWorkspace().settings || {};
        const types = (Array.isArray(settings.testQuestionTypes) ? settings.testQuestionTypes : ['written', 'mc', 'tf']).filter(Boolean);
        const count = Math.min((session._queue || []).length, parseInt(settings.testQuestionCount, 10) || 20);
        const cards = (session._queue || []).slice(0, count);
        return cards.map((item, idx) => {
            const type = types[idx % types.length];
            if (type === 'mc') {
                return { type, item, choices: buildLearnChoices(item) };
            }
            if (type === 'tf') {
                const showCorrect = Math.random() > 0.5;
                let displayedAnswer = item.answer || '';
                if (!showCorrect) {
                    const ws = safeWorkspace();
                    const others = ws.items.filter(i => i.deckId === item.deckId && i.id !== item.id && i.answer);
                    if (others.length) displayedAnswer = others[Math.floor(Math.random() * others.length)].answer;
                }
                return { type, item, displayedAnswer, expectedTrue: showCorrect };
            }
            return { type: 'written', item };
        });
    }

    function renderTestBody(session) {
        const qs = session._testQuestions || [];
        if (session._testSubmitted) return renderTestSummary(session);
        return `
            <form id="reviewTestForm" class="review-test-form">
                ${qs.map((q, i) => renderTestQuestion(q, i, session)).join('')}
                <div class="review-test-submit">
                    <button type="submit" class="review-btn-primary">Submit test</button>
                </div>
            </form>
        `;
    }

    function renderTestQuestion(q, idx, session) {
        const item = q.item;
        const stored = session._testAnswers[item.id] || {};
        if (q.type === 'mc') {
            return `
                <div class="review-test-q">
                    <div class="review-test-q-num">Q${idx + 1} · Multiple choice</div>
                    <div class="review-test-q-prompt">${escapeHtml(item.prompt)}</div>
                    <div class="review-test-q-choices">
                        ${q.choices.map((c, ci) => `
                            <label class="review-test-choice">
                                <input type="radio" name="q-${escapeHtml(item.id)}" value="${ci}" ${stored.choiceIdx === ci ? 'checked' : ''} data-test-q="${escapeHtml(item.id)}" data-correct="${c.correct ? 'true' : 'false'}" />
                                <span>${escapeHtml(c.text)}</span>
                            </label>
                        `).join('')}
                    </div>
                </div>
            `;
        }
        if (q.type === 'tf') {
            return `
                <div class="review-test-q">
                    <div class="review-test-q-num">Q${idx + 1} · True / False</div>
                    <div class="review-test-q-prompt">${escapeHtml(item.prompt)} → <strong>${escapeHtml(q.displayedAnswer || '(no answer)')}</strong></div>
                    <div class="review-test-q-choices">
                        <label class="review-test-choice"><input type="radio" name="q-${escapeHtml(item.id)}" value="true" ${stored.tfValue === 'true' ? 'checked' : ''} data-test-q="${escapeHtml(item.id)}" data-tf-expected="${q.expectedTrue ? 'true' : 'false'}" /><span>True</span></label>
                        <label class="review-test-choice"><input type="radio" name="q-${escapeHtml(item.id)}" value="false" ${stored.tfValue === 'false' ? 'checked' : ''} data-test-q="${escapeHtml(item.id)}" data-tf-expected="${q.expectedTrue ? 'true' : 'false'}" /><span>False</span></label>
                    </div>
                </div>
            `;
        }
        return `
            <div class="review-test-q">
                <div class="review-test-q-num">Q${idx + 1} · Written</div>
                <div class="review-test-q-prompt">${escapeHtml(item.prompt)}</div>
                <input type="text" class="review-test-input" data-test-q="${escapeHtml(item.id)}" data-test-written="true" placeholder="Type your answer…" value="${escapeHtml(stored.text || '')}" />
            </div>
        `;
    }

    function renderTestSummary(session) {
        const qs = session._testQuestions || [];
        const total = qs.length || 1;
        const correct = session.correctCount || 0;
        const score = Math.round((correct / total) * 100);
        const missed = qs.filter(q => {
            const stored = session._testAnswers[q.item.id] || {};
            return !stored.correct;
        });
        return `
            <div class="review-summary review-summary--result">
                <div class="review-summary-head">
                    <div class="eyebrow">Test complete</div>
                    <h3>${score}%</h3>
                    <p class="review-summary-sub">${correct} of ${total} correct</p>
                </div>
                ${missed.length ? `
                    <div class="review-summary-weak">
                        <div class="eyebrow">Missed</div>
                        <ul>
                            ${missed.slice(0, 12).map(q => `
                                <li><strong>${escapeHtml(q.item.prompt)}</strong>${q.item.answer ? ` — ${escapeHtml(q.item.answer)}` : ''}</li>
                            `).join('')}
                        </ul>
                    </div>
                ` : '<p>Perfect run.</p>'}
                <div class="review-summary-actions">
                    <button type="button" class="review-btn-primary" data-review-action="study-restart">Take it again</button>
                    <button type="button" class="review-btn-ghost" data-review-action="study-save">Back to set</button>
                </div>
            </div>
        `;
    }

    // ----- Match mode -----
    function buildMatchTiles(session) {
        const cards = (session._queue || []).slice(0, 8);
        const tiles = [];
        cards.forEach(item => {
            tiles.push({ tileId: makeId('tile'), kind: 'prompt', cardId: item.id, text: item.prompt, matched: false });
            tiles.push({ tileId: makeId('tile'), kind: 'answer', cardId: item.id, text: item.answer || '(no answer)', matched: false });
        });
        return shuffle(tiles);
    }

    function renderMatchBody(session) {
        const tiles = session._matchTiles || [];
        const matchedCount = tiles.filter(t => t.matched).length;
        const total = tiles.length;
        if (matchedCount >= total && total > 0 && session._matchEndTime) {
            return renderMatchSummary(session);
        }
        return `
            <div class="review-match-grid">
                ${tiles.map(t => `
                    <button type="button" class="review-match-tile${t.matched ? ' matched' : ''}${session._matchSelected && session._matchSelected.tileId === t.tileId ? ' selected' : ''}" data-review-action="match-pick" data-tile-id="${escapeHtml(t.tileId)}" ${t.matched ? 'disabled' : ''}>
                        <span class="review-match-kind">${t.kind === 'prompt' ? 'Q' : 'A'}</span>
                        <span class="review-match-text">${escapeHtml(t.text)}</span>
                    </button>
                `).join('')}
            </div>
        `;
    }

    function renderMatchSummary(session) {
        const time = formatDuration(session.timeMs || 0);
        const deck = getDeck((session.deckIds || [])[0]);
        const isBest = deck && deck.bestMatchTimeMs && session.timeMs <= deck.bestMatchTimeMs;
        return `
            <div class="review-summary review-summary--result">
                <div class="review-summary-head">
                    <div class="eyebrow">Match complete</div>
                    <h3>${time}</h3>
                    <p class="review-summary-sub">${session._matchMisses || 0} miss${(session._matchMisses || 0) === 1 ? '' : 'es'}${isBest ? ' • New best time' : (deck && deck.bestMatchTimeMs ? ` • Previous best: ${formatDuration(deck.bestMatchTimeMs)}` : '')}</p>
                </div>
                <div class="review-summary-actions">
                    <button type="button" class="review-btn-primary" data-review-action="study-restart">Play again</button>
                    <button type="button" class="review-btn-ghost" data-review-action="study-save">Back to set</button>
                </div>
            </div>
        `;
    }

    // ------------------------------------------------------------------
    // Mode-specific events + key bindings
    // ------------------------------------------------------------------
    let studyKeysBound = false;
    function bindStudyKeys() {
        if (studyKeysBound) return;
        studyKeysBound = true;
        document.addEventListener('keydown', studyKeyHandler);
    }

    function studyKeyHandler(event) {
        if (viewState.view !== 'study' || !viewState.session) return;
        const target = event.target;
        const inField = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
        const session = viewState.session;
        if (event.key === 'Escape') {
            event.preventDefault();
            handleStudyAction('study-exit');
            return;
        }
        if (inField) return;
        if (session.mode === 'flashcards') {
            const queue = session._queue || [];
            const idx = session._index || 0;
            if (idx >= queue.length) return; // summary screen — let normal tab nav apply
            if (event.code === 'Space') {
                event.preventDefault();
                handleStudyAction('flashcards-flip');
                return;
            }
            if (event.key === 'ArrowRight') {
                event.preventDefault();
                handleStudyAction('flashcards-next');
                return;
            }
            if (event.key === 'ArrowLeft') {
                event.preventDefault();
                handleStudyAction('flashcards-prev');
                return;
            }
            const map = { '1': 'again', '2': 'hard', '3': 'good', '4': 'easy' };
            if (session._answerRevealed && map[event.key]) {
                event.preventDefault();
                handleStudyAction('flashcards-grade', { grade: map[event.key] });
            }
        } else if (session.mode === 'learn') {
            const idx = parseInt(event.key, 10);
            if (idx >= 1 && idx <= 4) {
                event.preventDefault();
                const buttons = document.querySelectorAll('[data-review-action="learn-pick"]');
                const btn = buttons[idx - 1];
                if (btn) btn.click();
            }
        }
    }

    function bindModeSpecificEvents(mount, session) {
        if (session.mode === 'write') {
            const form = mount.querySelector('#reviewWriteForm');
            const input = mount.querySelector('#reviewWriteInput');
            if (form && input) {
                form.addEventListener('submit', event => {
                    event.preventDefault();
                    submitWriteAnswer(input.value);
                });
                setTimeout(() => { try { input.focus(); } catch (err) {} }, 30);
            }
        } else if (session.mode === 'test') {
            const form = mount.querySelector('#reviewTestForm');
            if (form) {
                form.addEventListener('submit', event => {
                    event.preventDefault();
                    submitTest();
                });
                form.addEventListener('change', event => {
                    const input = event.target;
                    if (!input || !input.dataset || !input.dataset.testQ) return;
                    const itemId = input.dataset.testQ;
                    if (!viewState.session._testAnswers[itemId]) viewState.session._testAnswers[itemId] = {};
                    if (input.type === 'radio') {
                        if (input.dataset.tfExpected != null) {
                            viewState.session._testAnswers[itemId].tfValue = input.value;
                            viewState.session._testAnswers[itemId].tfExpected = input.dataset.tfExpected === 'true';
                        } else {
                            viewState.session._testAnswers[itemId].choiceIdx = parseInt(input.value, 10);
                            viewState.session._testAnswers[itemId].choiceCorrect = input.dataset.correct === 'true';
                        }
                    }
                });
                form.addEventListener('input', event => {
                    const input = event.target;
                    if (!input || !input.dataset || !input.dataset.testWritten) return;
                    const itemId = input.dataset.testQ;
                    if (!viewState.session._testAnswers[itemId]) viewState.session._testAnswers[itemId] = {};
                    viewState.session._testAnswers[itemId].text = input.value;
                });
            }
        }
    }

    function handleStudyAction(action, ctx) {
        const session = viewState.session;
        if (!session) return;
        switch (action) {
            case 'study-exit': {
                const hasProgress = session.itemResults.length > 0 || session.correctCount > 0;
                if (!hasProgress) {
                    viewState.session = null;
                    viewState.view = 'library';
                    render();
                    return;
                }
                reviewConfirm({
                    title: 'Exit this session?',
                    message: 'Save your progress before leaving? Your reviewed cards will still update spaced-repetition either way.',
                    confirmLabel: 'Save and exit',
                    cancelLabel: 'Discard and exit'
                }).then(save => {
                    if (save) endSession(session);
                    viewState.session = null;
                    viewState.view = 'library';
                    render();
                });
                break;
            }
            case 'study-save': {
                endSession(session);
                const deckIds = (session.deckIds || []);
                viewState.session = null;
                if (deckIds.length === 1) {
                    viewState.view = 'deck';
                    viewState.deckId = deckIds[0];
                } else {
                    viewState.view = 'library';
                }
                notify('Session saved.');
                render();
                break;
            }
            case 'flashcards-reveal':
                session._answerRevealed = true;
                render();
                break;
            case 'flashcards-flip':
                session._answerRevealed = !session._answerRevealed;
                render();
                break;
            case 'flashcards-prev': {
                const i = session._index || 0;
                if (i <= 0) return;
                session._index = i - 1;
                session._answerRevealed = false;
                render();
                break;
            }
            case 'flashcards-next': {
                const i = session._index || 0;
                const queue = session._queue || [];
                if (i >= queue.length - 1) return;
                session._index = i + 1;
                session._answerRevealed = false;
                render();
                break;
            }
            case 'flashcards-shuffle':
                viewState.flashcards.shuffled = !viewState.flashcards.shuffled;
                if (viewState.flashcards.shuffled) {
                    // Shuffle remaining queue (cards not yet seen) so prior progress isn't reordered.
                    const queue = session._queue || [];
                    const i = session._index || 0;
                    const seen = queue.slice(0, i);
                    const remaining = shuffle(queue.slice(i));
                    session._queue = seen.concat(remaining);
                }
                session._answerRevealed = false;
                render();
                break;
            case 'flashcards-swap':
                viewState.flashcards.swapped = !viewState.flashcards.swapped;
                session._answerRevealed = false;
                render();
                break;
            case 'flashcards-grade':
                handleFlashcardsGrade(ctx ? ctx.grade : null);
                break;
            case 'study-restart': {
                // Restart the same mode + same deck selection, fresh queue.
                const deckIds = (session.deckIds || []).slice();
                const mode = session.mode;
                viewState.session = null;
                if (deckIds.length) startStudy(deckIds, mode);
                else { viewState.view = 'library'; render(); }
                break;
            }
            case 'learn-pick':
                handleLearnPick(ctx);
                break;
            case 'write-skip':
                submitWriteAnswer('', { skip: true });
                break;
            case 'write-show':
                submitWriteAnswer('', { reveal: true });
                break;
            case 'write-retry': {
                // Pop the just-recorded incorrect so the retry gives a clean shot.
                const queue = session._queue || [];
                const item = queue[session._index || 0];
                const last = (session.itemResults || [])[session.itemResults.length - 1];
                if (item && last && last.itemId === item.id && last.grade === 'incorrect') {
                    session.itemResults.pop();
                    session.incorrectCount = Math.max(0, (session.incorrectCount || 0) - 1);
                }
                session._lastFeedback = null;
                session._writeRetry = true;
                render();
                break;
            }
            case 'write-iknew':
                // Mark as correct, advance.
                handleWriteIKnew();
                break;
            case 'write-continue':
                // Force-advance after wrong answer feedback.
                handleWriteContinue();
                break;
            case 'match-pick':
                handleMatchPick(ctx);
                break;
            default:
                break;
        }
    }

    function handleWriteIKnew() {
        const session = viewState.session;
        if (!session) return;
        const queue = session._queue || [];
        const item = queue[session._index || 0];
        if (!item) return;
        // Replace the most recent recorded "incorrect" for this item with "correct".
        const last = (session.itemResults || []).slice().reverse().find(r => r.itemId === item.id);
        if (last && last.grade === 'incorrect') {
            last.grade = 'correct';
            session.incorrectCount = Math.max(0, (session.incorrectCount || 0) - 1);
            session.correctCount = (session.correctCount || 0) + 1;
        }
        promoteMastery(item, true);
        session._index = (session._index || 0) + 1;
        session._lastFeedback = null;
        session._writeRetry = false;
        persist();
        render();
    }

    function handleWriteContinue() {
        const session = viewState.session;
        if (!session) return;
        // The incorrect result was already recorded by submitWriteAnswer; just advance.
        session._lastFeedback = null;
        session._writeRetry = false;
        session._index = (session._index || 0) + 1;
        persist();
        render();
    }

    function handleFlashcardsGrade(grade) {
        const session = viewState.session;
        if (!session) return;
        if (!['again', 'hard', 'good', 'easy'].includes(grade)) return;
        const queue = session._queue || [];
        const item = queue[session._index || 0];
        if (!item) return;
        applyGrade(item, grade);
        recordResult(session, item.id, grade);
        if (grade === 'again') {
            const counts = session._relearnCounts || (session._relearnCounts = Object.create(null));
            const seen = Math.max(0, Number(counts[item.id]) || 0);
            // Keep an "Again" card in this active session, but cap relearning
            // appearances so one difficult card cannot create an infinite loop.
            if (seen < 2) queue.push(item);
            counts[item.id] = seen + 1;
        }
        session._index = (session._index || 0) + 1;
        session._answerRevealed = false;
        persist();
        render();
    }

    function handleLearnPick(ctx) {
        const session = viewState.session;
        if (!session) return;
        const round = session._learnRound || [];
        const item = round[session._learnRoundIndex || 0];
        if (!item) return;
        const correct = ctx && ctx.correct === true || (ctx && ctx.correct === 'true');
        // ctx is built from data-attributes which serialize to strings, so check both.
        const wasCorrect = (typeof ctx === 'object' && (ctx.correct === true || ctx.correct === 'true'));
        promoteMastery(item, wasCorrect);
        recordResult(session, item.id, wasCorrect ? 'correct' : 'incorrect');
        if (wasCorrect && item.mastery === 'mastered') {
            session._learnPool = (session._learnPool || []).filter(i => i.id !== item.id);
        }
        session._lastFeedback = { correct: wasCorrect, answer: item.answer || '' };
        session._learnRoundIndex = (session._learnRoundIndex || 0) + 1;
        session._index = (session._index || 0) + 1;
        persist();
        render();
        // Auto-clear feedback after a beat so the next round draws clean.
        setTimeout(() => {
            if (viewState.session === session) {
                session._lastFeedback = null;
                if (viewState.view === 'study') render();
            }
        }, 1100);
    }

    function submitWriteAnswer(value, opts) {
        const session = viewState.session;
        if (!session) return;
        const queue = session._queue || [];
        const item = queue[session._index || 0];
        if (!item) return;
        const settings = safeWorkspace().settings || {};
        const exact = settings.learnRequiresExact === true;
        const skip = opts && opts.skip;
        const reveal = opts && opts.reveal;
        if (skip) {
            // Skip = no result recorded (don't tank mastery for cards user just doesn't want to do).
            session._index = (session._index || 0) + 1;
            session._lastFeedback = null;
            session._writeRetry = false;
            persist();
            render();
            return;
        }
        if (reveal) {
            // "I don't know" — count as incorrect, show answer, surface action buttons.
            promoteMastery(item, false);
            recordResult(session, item.id, 'incorrect');
            session._lastFeedback = { correct: false, answer: item.answer || '', revealed: true };
            session._writeRetry = false;
            persist();
            render();
            return;
        }
        const correct = fuzzyEqual(value, item.answer, exact);
        if (correct) {
            promoteMastery(item, true);
            recordResult(session, item.id, 'correct');
            session._lastFeedback = { correct: true, answer: item.answer || '' };
            session._writeRetry = false;
            persist();
            render();
            // Auto-advance on a quick beat for correct answers.
            setTimeout(() => {
                if (viewState.session !== session || viewState.view !== 'study') return;
                session._index = (session._index || 0) + 1;
                session._lastFeedback = null;
                render();
            }, 700);
            return;
        }
        // Wrong answer — show feedback + action buttons (Try again / I knew this / Continue).
        // Record as incorrect once. submitWriteAnswer doesn't advance — user picks an action.
        promoteMastery(item, false);
        recordResult(session, item.id, 'incorrect');
        session._lastFeedback = { correct: false, answer: item.answer || '' };
        session._writeRetry = false;
        persist();
        render();
    }

    function submitTest() {
        const session = viewState.session;
        if (!session) return;
        const qs = session._testQuestions || [];
        let correct = 0;
        qs.forEach(q => {
            const item = q.item;
            const stored = session._testAnswers[item.id] || {};
            let isCorrect = false;
            if (q.type === 'mc') {
                isCorrect = stored.choiceCorrect === true;
            } else if (q.type === 'tf') {
                isCorrect = stored.tfValue && (stored.tfValue === 'true') === q.expectedTrue;
            } else {
                isCorrect = fuzzyEqual(stored.text || '', item.answer, false);
            }
            stored.correct = isCorrect;
            session._testAnswers[item.id] = stored;
            promoteMastery(item, isCorrect);
            recordResult(session, item.id, isCorrect ? 'correct' : 'incorrect');
            if (isCorrect) correct += 1;
        });
        session.correctCount = correct;
        session.incorrectCount = qs.length - correct;
        session.score = qs.length ? (correct / qs.length) * 100 : 0;
        session.totalQuestions = qs.length;
        session._testSubmitted = true;
        persist();
        render();
    }

    function handleMatchPick(ctx) {
        const session = viewState.session;
        if (!session) return;
        if (!session._matchStartTime) session._matchStartTime = Date.now();
        const tiles = session._matchTiles || [];
        const tile = tiles.find(t => t.tileId === (ctx && ctx.tileId));
        if (!tile || tile.matched) return;
        if (session._matchSelected && session._matchSelected.tileId === tile.tileId) {
            session._matchSelected = null;
            render();
            return;
        }
        if (!session._matchSelected) {
            session._matchSelected = tile;
            render();
            return;
        }
        const a = session._matchSelected;
        const b = tile;
        if (a.cardId === b.cardId && a.kind !== b.kind) {
            a.matched = true; b.matched = true;
            session._matchSelected = null;
            const item = (safeWorkspace().items || []).find(i => i.id === a.cardId);
            if (item) {
                promoteMastery(item, true);
                recordResult(session, item.id, 'correct');
            }
            const remaining = tiles.filter(t => !t.matched).length;
            if (remaining === 0) {
                session._matchEndTime = Date.now();
                session.timeMs = session._matchEndTime - session._matchStartTime;
                session.score = 100;
                session.totalQuestions = tiles.length / 2;
            }
            persist();
            render();
        } else {
            session._matchMisses = (session._matchMisses || 0) + 1;
            const aTile = document.querySelector(`[data-tile-id="${a.tileId}"]`);
            const bTile = document.querySelector(`[data-tile-id="${b.tileId}"]`);
            if (aTile) aTile.classList.add('miss');
            if (bTile) bTile.classList.add('miss');
            setTimeout(() => {
                if (aTile) aTile.classList.remove('miss');
                if (bTile) bTile.classList.remove('miss');
                session._matchSelected = null;
                if (viewState.view === 'study') render();
            }, 480);
        }
    }

    // ------------------------------------------------------------------
    // Public API
    // ------------------------------------------------------------------
    function renderReviewWorkspace() {
        const ws = safeWorkspace();
        if (ws && ws.decks.length === 0) {
            // Auto-seed an empty starter deck so the create form is usable on first paint.
            createDeck({ name: 'General', description: 'Default deck for stray cards.' });
        }
        render();
    }

    function initReviewWorkspaceUI() {
        if (reviewUiBound) return;
        reviewUiBound = true;
        // Render once; future renders are triggered by state mutations.
        render();
    }

    function getReviewTodayStats() {
        const ws = safeWorkspace();
        return {
            due: getDueItems().length,
            overdue: getOverdueItems().length,
            total: ws && Array.isArray(ws.items) ? ws.items.length : 0,
            reviewedThisWeek: getReviewedThisWeek(),
            decks: getDecks(false).length
        };
    }

    function getReviewSearchResults(query) {
        const ws = safeWorkspace();
        if (!ws) return [];
        const q = String(query || '').trim().toLowerCase();
        if (!q) return [];
        const results = [];
        ws.decks.forEach(deck => {
            const name = String(deck.name || '').toLowerCase();
            if (name.includes(q)) {
                results.push({
                    id: deck.id, type: 'review-deck',
                    title: `Deck: ${deck.name || 'Untitled'}`,
                    context: `${getItems(deck.id).length} cards`,
                    action: () => { try { if (typeof window.setActiveView === 'function') window.setActiveView('review'); openDeckById(deck.id); } catch (err) {} }
                });
            }
        });
        ws.items.forEach(item => {
            if (results.length >= 30) return;
            const prompt = String(item.prompt || '').toLowerCase();
            const answer = String(item.answer || '').toLowerCase();
            if (prompt.includes(q) || answer.includes(q)) {
                results.push({
                    id: item.id, type: 'review-card',
                    title: `Card: ${String(item.prompt || '').slice(0, 60)}`,
                    context: item.tags && item.tags.length ? item.tags.join(', ') : '',
                    action: () => { try { if (typeof window.setActiveView === 'function') window.setActiveView('review'); openDeckById(item.deckId); } catch (err) {} }
                });
            }
        });
        return results;
    }

    function openDeckById(deckId) {
        viewState.view = 'deck';
        viewState.deckId = deckId;
        render();
    }

    function startReviewSessionFromShortcut(mode) {
        try {
            if (typeof window.setActiveView === 'function') window.setActiveView('review');
            const dueItems = getDueItems();
            if (!dueItems.length) {
                notify('No cards due right now.');
                viewState.view = 'library';
                render();
                return;
            }
            const deckIds = Array.from(new Set(dueItems.map(i => i.deckId)));
            const safeMode = STUDY_MODES.includes(mode) ? mode : 'flashcards';
            startStudy(deckIds, safeMode, { onlyDue: true });
        } catch (err) { /* non-critical */ }
    }

    // Decks that belong to a given class — matched by an item's course link
    // (sourceProjectId === courseId) or by the deck's subject/name overlapping the
    // class name. Tokens shorter than 3 chars are ignored to avoid false hits.
    function matchDecksForCourse(courseRef) {
        const ws = safeWorkspace();
        if (!ws) return [];
        const courseId = courseRef && courseRef.courseId ? String(courseRef.courseId) : '';
        const name = String(courseRef && courseRef.name || '').trim().toLowerCase();
        const nameTokens = name.split(/[^a-z0-9]+/).filter(t => t.length >= 3);
        const deckIdsByItem = new Set();
        if (courseId) {
            (ws.items || []).forEach(it => { if (it && String(it.sourceProjectId || '') === courseId) deckIdsByItem.add(it.deckId); });
        }
        return getDecks(false).filter(deck => {
            if (deckIdsByItem.has(deck.id)) return true;
            const hay = `${deck.subject || ''} ${deck.name || ''}`.toLowerCase();
            if (!hay.trim()) return false;
            if (name && hay.includes(name)) return true;
            return nameTokens.some(tok => hay.includes(tok));
        }).map(d => d.id);
    }

    // How many cards are due right now for a class — lets callers (e.g. Today)
    // decide whether to show a "quiz me before <class>" shortcut at all.
    function countDueForCourse(courseRef) {
        try {
            return matchDecksForCourse(courseRef).reduce((n, id) => n + getDueItems(id).length, 0);
        } catch (err) { return 0; }
    }

    // Start a review session scoped to one class. Prefers due cards; if none are
    // due, studies the whole subject so "quiz me" never dead-ends. Returns false
    // when the class has no matching decks at all.
    function startReviewForCourse(courseRef, mode) {
        try {
            if (typeof window.setActiveView === 'function') window.setActiveView('review');
            const deckIds = matchDecksForCourse(courseRef);
            const label = (courseRef && courseRef.name) ? courseRef.name : 'that class';
            if (!deckIds.length) {
                notify(`No review decks found for ${label}.`);
                viewState.view = 'library';
                render();
                return false;
            }
            const due = deckIds.reduce((n, id) => n + getDueItems(id).length, 0);
            const safeMode = STUDY_MODES.includes(mode) ? mode : 'flashcards';
            startStudy(deckIds, safeMode, { onlyDue: due > 0 });
            return true;
        } catch (err) { return false; }
    }

    window.initReviewWorkspaceUI = initReviewWorkspaceUI;
    window.renderReviewWorkspace = renderReviewWorkspace;
    window.getReviewTodayStats = getReviewTodayStats;
    window.getReviewSearchResults = getReviewSearchResults;
    window.openReviewTab = function () { try { if (typeof window.setActiveView === 'function') window.setActiveView('review'); } catch (err) {} };
    window.startReviewSessionFromShortcut = startReviewSessionFromShortcut;
    window.startReviewForCourse = startReviewForCourse;
    window.countReviewDueForCourse = countDueForCourse;
    window.openReviewDeck = openDeckById;
    // Flow Assistant integration: expose deck creation + bulk import so the
    // assistant's create_review_deck / add_review_cards actions can succeed.
    window.createReviewDeck = function (input) {
        try { return createDeck(input || {}); } catch (err) { console.warn('createReviewDeck failed', err); return null; }
    };
    window.bulkImportReviewCards = function (deckId, raw) {
        try { return bulkImportCards(deckId, raw); } catch (err) { console.warn('bulkImportReviewCards failed', err); return 0; }
    };
    // Pure helpers exposed for the Study & Review e2e suite (no DOM side effects).
    window.SutraReviewTesting = {
        hasCloze: hasCloze,
        renderClozeHtml: renderClozeHtml,
        parseImportLine: parseImportLine,
        getRetentionRate: getRetentionRate,
        getDueForecast: getDueForecast,
        extractActionContext: (element) => extractActionContext(element),
        addCard: (input) => createItem(input || {}),
        getItems: (deckId) => getItems(deckId),
        buildShareableDeckHtml: (deck, items) => buildShareableDeckHtml(deck, items)
    };
    // Phase 2 #8: Generate Review Deck — parse material into candidate cards,
    // flag duplicates, and open the editable review table before saving.
    window.SutraReviewGen = {
        generate: function (raw, options) {
            try { return generateReviewCandidates(raw, options); } catch (err) { console.warn('SutraReviewGen.generate failed', err); return []; }
        },
        markDuplicates: function (candidates, options) {
            try { return markDuplicateCandidates(candidates, options); } catch (err) { console.warn('SutraReviewGen.markDuplicates failed', err); return { rows: [], duplicates: 0 }; }
        },
        openGenerator: function (options) {
            try { return openReviewGenerator(options); } catch (err) { console.warn('SutraReviewGen.openGenerator failed', err); return { total: 0, duplicates: 0 }; }
        }
    };
    // Lets Flow Assistant's undo path remove a deck it just created.
    window.deleteReviewDeck = function (deckId) {
        try { const removed = deleteDeck(deckId); if (typeof renderReviewWorkspace === 'function') renderReviewWorkspace(); return removed !== false; } catch (err) { console.warn('deleteReviewDeck failed', err); return false; }
    };
    // Duress/permanent note deletion purges derived Review content through
    // this seam (called by executePageDeletion's permanent branch).
    window.purgeReviewContentForNoteIds = function (noteIds) {
        try { return purgeNoteContent(noteIds); } catch (err) { console.warn('purgeReviewContentForNoteIds failed', err); return { failed: true }; }
    };
})();

/* ===========================================================================
   Sutra Daily Quotes — deterministic rotation + custom workspace quotes
   ===========================================================================
   Built-in quotes remain source-audited static data. User quotes and display
   preferences live in appData.settings.preferences.quotes, so they follow the
   canonical save/export/restore/Sync path. No browser-only shadow store.
   ========================================================================== */

/* global window, document, SutraQuoteBank */

(function (global) {
    'use strict';

    var DEFAULT_SETTINGS = {
        showInSidebar: true,
        showInCustomTabs: true,
        sourceMode: 'all',
        enabledCategories: [],
        customQuotes: []
    };
    var SUGGESTED_CATEGORIES = [
        'motivational', 'inspirational', 'self-affirmation', 'love', 'personal',
        'focus', 'resilience', 'learning', 'gratitude', 'courage'
    ];
    var managerRoot = null;
    var editingQuoteId = '';
    var manualOffset = 0;
    var manualDay = null;

    function getLocalDayNumber(date) {
        var d = date || new Date();
        return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
    }

    function seededShuffle(arr, seed) {
        var a = arr.slice();
        var s = (seed >>> 0) + 1;
        for (var i = a.length - 1; i > 0; i -= 1) {
            s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
            var j = s % (i + 1);
            var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
        }
        return a;
    }

    function pickDailyQuote(bank, dayNumber, offset) {
        if (!Array.isArray(bank) || bank.length === 0) return null;
        var shuffled = seededShuffle(bank, dayNumber);
        var index = (dayNumber + Number(offset || 0)) % shuffled.length;
        if (index < 0) index += shuffled.length;
        return shuffled[index];
    }

    function normalizeCategory(value, fallback) {
        var normalized = String(value == null ? '' : value)
            .trim()
            .toLowerCase()
            .replace(/&/g, ' and ')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 40);
        return normalized || (fallback === undefined ? 'personal' : String(fallback));
    }

    function stableQuoteId(text, author, index) {
        var hash = 2166136261;
        var input = String(text || '') + '|' + String(author || '') + '|' + String(index || 0);
        for (var cursor = 0; cursor < input.length; cursor += 1) {
            hash ^= input.charCodeAt(cursor);
            hash = Math.imul(hash, 16777619);
        }
        return 'quote_' + (hash >>> 0).toString(36) + '_' + String(index || 0);
    }

    function quoteTextKey(value) {
        return String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
    }

    function normalizeQuoteSettings(raw) {
        var source = raw && typeof raw === 'object' ? raw : {};
        var seen = {};
        var customQuotes = [];
        (Array.isArray(source.customQuotes) ? source.customQuotes : []).some(function (row, index) {
            if (customQuotes.length >= 200) return true;
            if (!row || typeof row !== 'object') return false;
            var quoteText = String(row.text || '').replace(/\s+/g, ' ').trim().slice(0, 400);
            var textKey = quoteTextKey(quoteText);
            if (!quoteText || !textKey || seen[textKey]) return false;
            seen[textKey] = true;
            var author = String(row.author || 'Personal').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Personal';
            var id = String(row.id || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80)
                || stableQuoteId(quoteText, author, index);
            customQuotes.push(Object.assign({}, row, {
                id: id,
                text: quoteText,
                author: author,
                category: normalizeCategory(row.category, 'personal'),
                createdAt: String(row.createdAt || '').slice(0, 40),
                updatedAt: String(row.updatedAt || '').slice(0, 40)
            }));
            return false;
        });

        var categories = [];
        (Array.isArray(source.enabledCategories) ? source.enabledCategories : []).forEach(function (value) {
            var category = normalizeCategory(value, '');
            if (category && categories.indexOf(category) === -1 && categories.length < 48) categories.push(category);
        });
        var mode = ['all', 'built-in', 'custom'].indexOf(String(source.sourceMode || '').toLowerCase()) >= 0
            ? String(source.sourceMode).toLowerCase() : DEFAULT_SETTINGS.sourceMode;
        return Object.assign({}, source, {
            showInSidebar: source.showInSidebar !== false,
            showInCustomTabs: source.showInCustomTabs !== false,
            sourceMode: mode,
            enabledCategories: categories,
            customQuotes: customQuotes
        });
    }

    function buildAvailableQuotes(builtIn, rawSettings, surface) {
        var settings = normalizeQuoteSettings(rawSettings);
        if (surface === 'sidebar' && !settings.showInSidebar) return [];
        if (surface === 'custom-tab' && !settings.showInCustomTabs) return [];
        var bank = [];
        if (settings.sourceMode !== 'custom') {
            (Array.isArray(builtIn) ? builtIn : []).forEach(function (quote) {
                if (!quote || !String(quote.text || '').trim()) return;
                bank.push({
                    id: String(quote.id || stableQuoteId(quote.text, quote.author, bank.length)),
                    text: String(quote.text),
                    author: String(quote.author || 'Unknown'),
                    category: normalizeCategory(quote.category, 'inspirational'),
                    source: String(quote.source || ''),
                    custom: false
                });
            });
        }
        if (settings.sourceMode !== 'built-in') {
            settings.customQuotes.forEach(function (quote) {
                bank.push({
                    id: quote.id,
                    text: quote.text,
                    author: quote.author,
                    category: quote.category,
                    source: 'Personal quote',
                    custom: true
                });
            });
        }
        if (settings.enabledCategories.length) {
            bank = bank.filter(function (quote) { return settings.enabledCategories.indexOf(quote.category) !== -1; });
        }
        var seen = {};
        return bank.filter(function (quote) {
            var key = quoteTextKey(quote.text);
            if (!key || seen[key]) return false;
            seen[key] = true;
            return true;
        });
    }

    function getSettings() {
        var raw = typeof global.getWorkspacePreference === 'function'
            ? global.getWorkspacePreference('quotes', DEFAULT_SETTINGS)
            : DEFAULT_SETTINGS;
        return normalizeQuoteSettings(raw);
    }

    function getAvailableQuotes(options) {
        var opts = options || {};
        return buildAvailableQuotes(global.SutraQuoteBank, getSettings(), opts.surface || 'sidebar');
    }

    function notifyChanged() {
        hydrate();
        try {
            global.dispatchEvent(new CustomEvent('sutra:quotes-changed', { detail: { settings: getSettings() } }));
        } catch (error) { /* non-critical */ }
        if (global.SutraCustomTabs && typeof global.SutraCustomTabs.refresh === 'function') {
            try { global.SutraCustomTabs.refresh(); } catch (error) { /* non-critical */ }
        }
    }

    function saveSettings(next) {
        var normalized = normalizeQuoteSettings(next);
        if (typeof global.setWorkspacePreference === 'function') {
            global.setWorkspacePreference('quotes', normalized, { refresh: false });
        }
        notifyChanged();
        return normalized;
    }

    function ensureSidebarActions(container) {
        var actions = container.querySelector('.daily-lock-in-quote-actions');
        if (actions) return actions;
        actions = document.createElement('span');
        actions.className = 'daily-lock-in-quote-actions';
        var next = document.createElement('button');
        next.type = 'button';
        next.className = 'daily-lock-in-quote-action';
        next.textContent = 'Another';
        next.setAttribute('aria-label', 'Show another quote');
        next.addEventListener('click', function () {
            manualOffset += 1;
            hydrate();
        });
        var manage = document.createElement('button');
        manage.type = 'button';
        manage.className = 'daily-lock-in-quote-action';
        manage.textContent = 'Manage';
        manage.setAttribute('aria-label', 'Manage quotes');
        manage.addEventListener('click', openManager);
        actions.appendChild(next);
        actions.appendChild(manage);
        container.appendChild(actions);
        return actions;
    }

    function hydrate() {
        if (typeof document === 'undefined') return;
        var container = document.getElementById('daily-lock-in-quote');
        var textEl = container && container.querySelector('.daily-lock-in-quote-text');
        var authorEl = container && container.querySelector('.daily-lock-in-quote-author');
        if (!container || !textEl || !authorEl) return;
        var settings = getSettings();
        container.hidden = !settings.showInSidebar;
        container.setAttribute('aria-hidden', settings.showInSidebar ? 'false' : 'true');
        if (!settings.showInSidebar) return;

        var dayNumber = getLocalDayNumber();
        if (manualDay !== dayNumber) { manualDay = dayNumber; manualOffset = 0; }
        var quote = pickDailyQuote(getAvailableQuotes({ surface: 'sidebar' }), dayNumber, manualOffset);
        ensureSidebarActions(container);
        if (!quote) {
            textEl.textContent = settings.sourceMode === 'custom' ? 'Add your first custom quote.' : 'No quotes match these categories.';
            authorEl.textContent = 'Open Manage to choose what appears here.';
            container.removeAttribute('data-quote-id');
            container.removeAttribute('data-quote-category');
            container.classList.add('daily-lock-in-quote--empty');
        } else {
            textEl.textContent = '"' + quote.text + '"';
            authorEl.textContent = quote.author ? '- ' + quote.author : '';
            container.setAttribute('data-quote-id', quote.id);
            container.setAttribute('data-quote-category', quote.category || '');
            container.classList.remove('daily-lock-in-quote--empty');
        }
        container.classList.remove('daily-lock-in-quote--hydrated');
        void container.offsetWidth;
        container.classList.add('daily-lock-in-quote--hydrated');
    }

    function millisecondsUntilNextLocalMidnight(date) {
        var now = date instanceof Date ? date : new Date();
        var nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
        var delay = nextMidnight.getTime() - now.getTime() + 1000;
        if (!Number.isFinite(delay)) return 60000;
        return Math.max(1000, Math.min(delay, 2147483647));
    }

    function scheduleMidnightRefresh() {
        setTimeout(function () {
            manualOffset = 0;
            hydrate();
            scheduleMidnightRefresh();
        }, millisecondsUntilNextLocalMidnight(new Date()));
    }

    function element(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function button(className, label, onClick) {
        var node = element('button', className, label);
        node.type = 'button';
        if (onClick) node.addEventListener('click', onClick);
        return node;
    }

    function categoryLabel(category) {
        return String(category || 'personal').split('-').map(function (part) {
            return part ? part.charAt(0).toUpperCase() + part.slice(1) : '';
        }).join(' ');
    }

    function allCategories(settings) {
        var categories = SUGGESTED_CATEGORIES.slice();
        (Array.isArray(global.SutraQuoteBank) ? global.SutraQuoteBank : []).forEach(function (quote) {
            var category = normalizeCategory(quote && quote.category, 'inspirational');
            if (categories.indexOf(category) === -1) categories.push(category);
        });
        settings.customQuotes.forEach(function (quote) {
            if (categories.indexOf(quote.category) === -1) categories.push(quote.category);
        });
        return categories.sort(function (a, b) { return categoryLabel(a).localeCompare(categoryLabel(b)); });
    }

    function closeManager() {
        if (!managerRoot) return;
        var closing = managerRoot;
        managerRoot = null;
        editingQuoteId = '';
        closing.classList.remove('active');
        closing.hidden = true;
        if (global.SutraModalManager && typeof global.SutraModalManager.sync === 'function') {
            try { global.SutraModalManager.sync(); } catch (error) { /* non-critical */ }
        }
        closing.remove();
    }

    function confirmQuoteDelete(quote) {
        if (typeof global.showCustomConfirmDialog === 'function') {
            return global.showCustomConfirmDialog({
                title: 'Delete custom quote?',
                message: 'Delete "' + quote.text + '"? This removes it from this workspace and synced devices.',
                confirmText: 'Delete quote',
                cancelText: 'Keep quote',
                confirmVariant: 'danger'
            });
        }
        if (typeof global.atelierConfirm === 'function') {
            return global.atelierConfirm('Delete this custom quote?', { title: 'Delete custom quote', destructive: true });
        }
        return Promise.resolve(false);
    }

    function renderManager() {
        if (!managerRoot) return;
        var content = managerRoot.querySelector('.daily-quotes-content');
        if (!content) return;
        content.replaceChildren();
        var settings = getSettings();
        var categories = allCategories(settings);

        var intro = element('p', 'daily-quotes-intro', 'Your custom quotes stay in this workspace and travel in encrypted .sutra backups and Sutra Sync. Nothing is uploaded on its own.');
        content.appendChild(intro);

        var controls = element('section', 'daily-quotes-panel');
        controls.appendChild(element('h3', 'daily-quotes-section-title', 'Where quotes appear'));
        var surfaces = element('div', 'daily-quotes-surface-grid');
        [
            { key: 'showInSidebar', label: 'Sidebar', help: 'Show a daily quote at the bottom of the workspace sidebar.' },
            { key: 'showInCustomTabs', label: 'Custom Tabs', help: 'Use this quote collection in Motivation widgets.' }
        ].forEach(function (spec) {
            var label = element('label', 'daily-quotes-surface');
            var check = document.createElement('input');
            check.type = 'checkbox';
            check.checked = settings[spec.key] !== false;
            check.addEventListener('change', function () {
                var next = getSettings();
                next[spec.key] = check.checked;
                saveSettings(next);
                renderManager();
            });
            var copy = element('span', 'daily-quotes-surface-copy');
            copy.appendChild(element('strong', '', spec.label));
            copy.appendChild(element('small', '', spec.help));
            label.appendChild(check);
            label.appendChild(copy);
            surfaces.appendChild(label);
        });
        controls.appendChild(surfaces);

        var sourceRow = element('label', 'daily-quotes-field');
        sourceRow.appendChild(element('span', 'daily-quotes-field-label', 'Quote sources'));
        var sourceSelect = document.createElement('select');
        sourceSelect.className = 'modal-input';
        sourceSelect.setAttribute('aria-label', 'Quote sources');
        [
            { value: 'all', label: 'Built-in + my quotes' },
            { value: 'custom', label: 'My quotes only' },
            { value: 'built-in', label: 'Built-in quotes only' }
        ].forEach(function (optionSpec) {
            var option = document.createElement('option');
            option.value = optionSpec.value;
            option.textContent = optionSpec.label;
            sourceSelect.appendChild(option);
        });
        sourceSelect.value = settings.sourceMode;
        sourceSelect.addEventListener('change', function () {
            var next = getSettings();
            next.sourceMode = sourceSelect.value;
            saveSettings(next);
            renderManager();
        });
        sourceRow.appendChild(sourceSelect);
        controls.appendChild(sourceRow);

        var categoryFieldset = element('fieldset', 'daily-quotes-categories');
        categoryFieldset.appendChild(element('legend', 'daily-quotes-field-label', 'Categories shown'));
        categoryFieldset.appendChild(element('p', 'daily-quotes-field-help', 'Choose the kinds of quotes that may appear. Leave every category selected to use the full collection.'));
        var categoryGrid = element('div', 'daily-quotes-category-grid');
        categories.forEach(function (category) {
            var label = element('label', 'daily-quotes-category');
            var check = document.createElement('input');
            check.type = 'checkbox';
            check.value = category;
            check.checked = settings.enabledCategories.length === 0 || settings.enabledCategories.indexOf(category) !== -1;
            check.addEventListener('change', function () {
                var checked = Array.prototype.slice.call(categoryGrid.querySelectorAll('input:checked')).map(function (input) { return input.value; });
                var next = getSettings();
                next.enabledCategories = checked.length === categories.length ? [] : checked;
                saveSettings(next);
                renderManager();
            });
            label.appendChild(check);
            label.appendChild(document.createTextNode(categoryLabel(category)));
            categoryGrid.appendChild(label);
        });
        categoryFieldset.appendChild(categoryGrid);
        controls.appendChild(categoryFieldset);
        content.appendChild(controls);

        var editor = element('section', 'daily-quotes-panel daily-quotes-editor');
        var editing = settings.customQuotes.find(function (quote) { return quote.id === editingQuoteId; }) || null;
        editor.appendChild(element('h3', 'daily-quotes-section-title', editing ? 'Edit your quote' : 'Add your own quote'));
        var textField = element('label', 'daily-quotes-field');
        textField.appendChild(element('span', 'daily-quotes-field-label', 'Quote'));
        var textInput = document.createElement('textarea');
        textInput.className = 'modal-input daily-quotes-textarea';
        textInput.maxLength = 400;
        textInput.rows = 3;
        textInput.placeholder = 'Write something you want to remember…';
        textInput.value = editing ? editing.text : '';
        textField.appendChild(textInput);
        editor.appendChild(textField);
        var detailGrid = element('div', 'daily-quotes-detail-grid');
        var authorField = element('label', 'daily-quotes-field');
        authorField.appendChild(element('span', 'daily-quotes-field-label', 'Author or attribution'));
        var authorInput = document.createElement('input');
        authorInput.className = 'modal-input';
        authorInput.maxLength = 80;
        authorInput.placeholder = 'Me, a loved one, or an author';
        authorInput.value = editing ? editing.author : 'Personal';
        authorField.appendChild(authorInput);
        detailGrid.appendChild(authorField);
        var categoryField = element('label', 'daily-quotes-field');
        categoryField.appendChild(element('span', 'daily-quotes-field-label', 'Category'));
        var categoryInput = document.createElement('input');
        categoryInput.className = 'modal-input';
        categoryInput.maxLength = 40;
        categoryInput.setAttribute('list', 'dailyQuoteCategories');
        categoryInput.placeholder = 'e.g. self-affirmation';
        categoryInput.value = editing ? editing.category : 'personal';
        var datalist = document.createElement('datalist');
        datalist.id = 'dailyQuoteCategories';
        categories.forEach(function (category) {
            var option = document.createElement('option');
            option.value = category;
            datalist.appendChild(option);
        });
        categoryField.appendChild(categoryInput);
        categoryField.appendChild(datalist);
        detailGrid.appendChild(categoryField);
        editor.appendChild(detailGrid);
        var error = element('p', 'daily-quotes-error');
        error.setAttribute('role', 'alert');
        editor.appendChild(error);
        var editorActions = element('div', 'daily-quotes-editor-actions');
        var save = button('cc-btn cc-btn-primary', editing ? 'Save changes' : 'Add quote', function () {
            var quoteText = String(textInput.value || '').replace(/\s+/g, ' ').trim();
            if (!quoteText) { error.textContent = 'Write a quote first.'; textInput.focus(); return; }
            var duplicate = settings.customQuotes.find(function (quote) {
                return quote.id !== editingQuoteId && quote.text.toLowerCase() === quoteText.toLowerCase();
            });
            if (duplicate) { error.textContent = 'That quote is already in your collection.'; textInput.focus(); return; }
            var now = new Date().toISOString();
            var next = getSettings();
            if (editing) {
                next.customQuotes = next.customQuotes.map(function (quote) {
                    return quote.id === editing.id ? {
                        id: quote.id,
                        text: quoteText,
                        author: String(authorInput.value || 'Personal').trim() || 'Personal',
                        category: normalizeCategory(categoryInput.value, 'personal'),
                        createdAt: quote.createdAt || now,
                        updatedAt: now
                    } : quote;
                });
            } else {
                var newId = (global.crypto && typeof global.crypto.randomUUID === 'function')
                    ? 'quote_' + global.crypto.randomUUID()
                    : stableQuoteId(quoteText, authorInput.value, Date.now());
                next.customQuotes.push({
                    id: newId,
                    text: quoteText,
                    author: String(authorInput.value || 'Personal').trim() || 'Personal',
                    category: normalizeCategory(categoryInput.value, 'personal'),
                    createdAt: now,
                    updatedAt: now
                });
            }
            editingQuoteId = '';
            saveSettings(next);
            renderManager();
        });
        editorActions.appendChild(save);
        if (editing) {
            editorActions.appendChild(button('cc-btn cc-btn-ghost', 'Cancel edit', function () {
                editingQuoteId = '';
                renderManager();
            }));
        }
        editor.appendChild(editorActions);
        content.appendChild(editor);

        var library = element('section', 'daily-quotes-panel daily-quotes-library');
        var libraryHead = element('div', 'daily-quotes-library-head');
        libraryHead.appendChild(element('h3', 'daily-quotes-section-title', 'My quote collection'));
        libraryHead.appendChild(element('span', 'daily-quotes-count', String(settings.customQuotes.length) + ' / 200'));
        library.appendChild(libraryHead);
        if (!settings.customQuotes.length) {
            library.appendChild(element('p', 'daily-quotes-empty', 'No custom quotes yet. Add a personal reminder, affirmation, lyric-free message, or something meaningful someone told you.'));
        } else {
            var list = element('div', 'daily-quotes-list');
            settings.customQuotes.forEach(function (quote) {
                var row = element('article', 'daily-quotes-item');
                var copy = element('div', 'daily-quotes-item-copy');
                copy.appendChild(element('blockquote', '', quote.text));
                copy.appendChild(element('p', '', '- ' + quote.author + ' · ' + categoryLabel(quote.category)));
                row.appendChild(copy);
                var actions = element('div', 'daily-quotes-item-actions');
                actions.appendChild(button('cc-btn cc-btn-ghost cc-btn-small', 'Edit', function () {
                    editingQuoteId = quote.id;
                    renderManager();
                    var input = managerRoot && managerRoot.querySelector('.daily-quotes-textarea');
                    if (input) { input.focus(); input.select(); }
                }));
                actions.appendChild(button('cc-btn cc-btn-ghost cc-btn-small daily-quotes-delete', 'Delete', function () {
                    confirmQuoteDelete(quote).then(function (confirmed) {
                        if (!confirmed) return;
                        var next = getSettings();
                        next.customQuotes = next.customQuotes.filter(function (item) { return item.id !== quote.id; });
                        if (editingQuoteId === quote.id) editingQuoteId = '';
                        saveSettings(next);
                        renderManager();
                    });
                }));
                row.appendChild(actions);
                list.appendChild(row);
            });
            library.appendChild(list);
        }
        content.appendChild(library);
    }

    function openManager(event) {
        if (typeof document === 'undefined') return false;
        if (managerRoot && managerRoot.isConnected) {
            var existing = managerRoot.querySelector('.daily-quotes-textarea');
            if (existing) existing.focus();
            return true;
        }
        editingQuoteId = '';
        var overlay = element('div', 'cw-modal-overlay daily-quotes-modal active');
        // Safari pointer clicks need not focus buttons. Give the shared modal
        // manager the actual launcher, including the sidebar Manage button.
        var trigger = event && event.currentTarget;
        overlay.__sutraReturnFocus = trigger && typeof trigger.focus === 'function'
            ? trigger : document.activeElement;
        overlay.setAttribute('data-sutra-layer', 'modal');
        overlay.setAttribute('aria-hidden', 'false');
        var card = element('div', 'cw-modal-card daily-quotes-card');
        card.setAttribute('role', 'dialog');
        card.setAttribute('aria-modal', 'true');
        card.setAttribute('aria-labelledby', 'dailyQuotesTitle');
        var head = element('header', 'cw-modal-head daily-quotes-head');
        var titleWrap = element('div');
        var title = element('h2', '', 'Quotes');
        title.id = 'dailyQuotesTitle';
        titleWrap.appendChild(title);
        titleWrap.appendChild(element('p', '', 'Build a collection that sounds like you.'));
        head.appendChild(titleWrap);
        var close = button('cw-modal-close', '×', closeManager);
        close.setAttribute('aria-label', 'Close quotes');
        close.setAttribute('data-modal-close', '');
        head.appendChild(close);
        card.appendChild(head);
        card.appendChild(element('div', 'daily-quotes-content'));
        overlay.appendChild(card);
        overlay.addEventListener('mousedown', function (event) {
            if (event.target === overlay) closeManager();
        });
        managerRoot = overlay;
        document.body.appendChild(overlay);
        renderManager();
        if (global.SutraModalManager && typeof global.SutraModalManager.sync === 'function') {
            try { global.SutraModalManager.sync(); } catch (error) { /* non-critical */ }
        }
        return true;
    }

    var SutraQuote = {
        hydrate: hydrate,
        openManager: openManager,
        closeManager: closeManager,
        pickDailyQuote: pickDailyQuote,
        getLocalDayNumber: getLocalDayNumber,
        millisecondsUntilNextLocalMidnight: millisecondsUntilNextLocalMidnight,
        normalizeSettings: normalizeQuoteSettings,
        buildAvailableQuotes: buildAvailableQuotes,
        getSettings: getSettings,
        getAvailableQuotes: getAvailableQuotes,
        saveSettings: saveSettings,
        refresh: notifyChanged
    };

    global.SutraQuote = SutraQuote;
    if (typeof module !== 'undefined' && module.exports) module.exports = SutraQuote;
    if (typeof document === 'undefined') return;

    function init() {
        hydrate();
        scheduleMidnightRefresh();
        var settingsButton = document.getElementById('openQuoteManagerBtn');
        if (settingsButton) settingsButton.addEventListener('click', openManager);
        global.addEventListener('sutra:custom-tabs-changed', hydrate);
        global.addEventListener('sutra:workspace-remote-commit', hydrate);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else setTimeout(init, 0);

}(typeof window !== 'undefined' ? window : globalThis));

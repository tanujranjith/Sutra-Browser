/*
 * NoteFlow Atelier — Local icon system runtime.
 *
 * Hydrates every Font Awesome–compatible <i class="fa-..."> element on the
 * page (including content rendered later via innerHTML) with a local SVG
 * pulled from `AtelierIconRegistry`. Once hydrated, an icon stays up to date
 * if its FA classes change.
 *
 * Goals:
 *   - 100% offline. No network, no remote fonts, no CDNs.
 *   - Drop-in replacement for the existing FA markup throughout the app.
 *   - currentColor stroke so the icon respects light/dark/themed styles.
 *   - MutationObserver-driven so dynamic templates Just Work.
 *
 * Public surface (window.AtelierIcons):
 *   getIconSvg(name, opts)      → SVG string
 *   createIconElement(name, opts) → HTMLElement (<i> wrapper around svg)
 *   resolveFromFaClass(className) → canonical name from a FA class list/array
 *   hydrate(root?)              → walk root and replace any pending fa-* icons
 *   replaceIconElement(el)      → re-render a single <i> element
 *   names                       → array of every canonical icon name
 *
 * Aliases like HomeIcon / NotesIcon / SettingsIcon are also exposed on the
 * registry as factory functions returning HTMLElements, for code that wants
 * a friendlier API:
 *   const el = AtelierIcons.HomeIcon({ size: 20, ariaLabel: 'Home' });
 */
(function (global) {
    'use strict';

    var registry = global.AtelierIconRegistry;
    if (!registry) {
        if (typeof console !== 'undefined') {
            console.warn('[AtelierIcons] icon-paths.js must load before index.js');
        }
        return;
    }

    var SVG_NS = 'http://www.w3.org/2000/svg';
    var DATA_ATTR = 'data-atelier-icon';
    var DATA_ATTR_RAW = 'data-atelier-icon-raw';

    function resolveCanonicalName(input) {
        if (!input) return '';
        var classes = [];
        if (typeof input === 'string') {
            classes = input.split(/\s+/);
        } else if (input.length != null) {
            for (var i = 0; i < input.length; i++) classes.push(input[i]);
        }
        for (var j = 0; j < classes.length; j++) {
            var cls = classes[j];
            if (!cls || registry.faNonIconClasses[cls]) continue;
            if (registry.paths[cls]) return cls;
            if (registry.faAlias[cls]) return registry.faAlias[cls];
            if (cls.indexOf('fa-') === 0) {
                // Try stripping fa- prefix (e.g., a custom registry key match).
                var stripped = cls.slice(3);
                if (registry.paths[stripped]) return stripped;
            }
        }
        return '';
    }

    function getIconSvg(name, opts) {
        opts = opts || {};
        var canonical = registry.paths[name] ? name : resolveCanonicalName(name);
        var body = canonical ? registry.paths[canonical] : '';
        if (!body) {
            // Unknown icon: render a neutral, low-key placeholder so layout stays
            // stable WITHOUT masquerading as a meaningful glyph. (This used to fall
            // back to a star outline, which read as a favourite/rating marker and
            // caused mystery stars wherever an FA class was missing from the map.)
            body = '<rect x="5" y="5" width="14" height="14" rx="3.5" opacity="0.32"/>';
            canonical = canonical || 'unknown';
        }
        var size = opts.size != null ? opts.size : '1em';
        var stroke = opts.strokeWidth != null ? opts.strokeWidth : 1.75;
        var className = 'atelier-icon' + (opts.className ? ' ' + opts.className : '');
        var ariaPart;
        if (opts.ariaLabel) {
            ariaPart = ' role="img" aria-label="' + escapeAttr(opts.ariaLabel) + '"';
        } else {
            ariaPart = ' aria-hidden="true" focusable="false"';
        }
        var sizeAttr = ' width="' + size + '" height="' + size + '"';
        return '<svg xmlns="' + SVG_NS + '" class="' + className + '" viewBox="0 0 24 24"' +
            sizeAttr +
            ' fill="none" stroke="currentColor" stroke-width="' + stroke + '"' +
            ' stroke-linecap="round" stroke-linejoin="round"' +
            ariaPart + ' data-atelier-icon-name="' + escapeAttr(canonical) + '">' +
            body +
            '</svg>';
    }

    function escapeAttr(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;');
    }

    function createIconElement(name, opts) {
        opts = opts || {};
        var wrapper = document.createElement('i');
        wrapper.className = 'atelier-icon-wrap' + (opts.wrapperClassName ? ' ' + opts.wrapperClassName : '');
        if (opts.ariaLabel) {
            wrapper.setAttribute('aria-label', opts.ariaLabel);
        } else {
            wrapper.setAttribute('aria-hidden', 'true');
        }
        wrapper.innerHTML = getIconSvg(name, opts);
        return wrapper;
    }

    function replaceIconElement(el) {
        if (!el || el.nodeType !== 1) return;
        var classList = el.classList;
        if (!classList) return;
        // Skip if it's not actually a FA icon stub.
        var hasFaClass = false;
        for (var i = 0; i < classList.length; i++) {
            if (classList[i].indexOf('fa-') === 0) { hasFaClass = true; break; }
        }
        if (!hasFaClass) return;

        var classKey = el.className;
        if (el.getAttribute(DATA_ATTR) === '1' && el.getAttribute(DATA_ATTR_RAW) === classKey) {
            return; // Already hydrated for this class set.
        }

        var canonical = resolveCanonicalName(classList);
        // Pass the resolved name (or '' → neutral placeholder). Never fall back to
        // a star — an unmapped icon should look blank, not like a favourite marker.
        var svg = getIconSvg(canonical, {
            ariaLabel: el.getAttribute('aria-label') || ''
        });
        el.innerHTML = svg;
        if (!el.hasAttribute('aria-label')) {
            el.setAttribute('aria-hidden', 'true');
        }
        el.setAttribute(DATA_ATTR, '1');
        el.setAttribute(DATA_ATTR_RAW, classKey);
    }

    function hydrate(root) {
        root = root || document;
        if (!root || typeof root.querySelectorAll !== 'function') return;
        var nodes = root.querySelectorAll('i[class*="fa-"]');
        for (var i = 0; i < nodes.length; i++) {
            replaceIconElement(nodes[i]);
        }
        // Also handle the root itself if it matches.
        if (root.nodeType === 1 && root.matches && root.matches('i[class*="fa-"]')) {
            replaceIconElement(root);
        }
    }

    var observer = null;
    function startObserver() {
        if (observer || typeof MutationObserver === 'undefined' || !document.body) return;
        observer = new MutationObserver(function (mutations) {
            for (var i = 0; i < mutations.length; i++) {
                var m = mutations[i];
                if (m.type === 'attributes' && m.target && m.target.nodeType === 1) {
                    if (m.target.tagName === 'I') replaceIconElement(m.target);
                    continue;
                }
                if (!m.addedNodes) continue;
                for (var j = 0; j < m.addedNodes.length; j++) {
                    var node = m.addedNodes[j];
                    if (!node || node.nodeType !== 1) continue;
                    if (node.tagName === 'I' && node.className && node.className.indexOf && node.className.indexOf('fa-') >= 0) {
                        replaceIconElement(node);
                    }
                    if (node.querySelectorAll) hydrate(node);
                }
            }
        });
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class']
        });
    }

    function buildNamedFactories(api) {
        var pairs = [
            ['HomeIcon', 'home'],
            ['MenuIcon', 'menu'],
            ['CloseIcon', 'close'],
            ['PlusIcon', 'plus'],
            ['MinusIcon', 'minus'],
            ['CheckIcon', 'check'],
            ['CheckCircleIcon', 'check-circle'],
            ['ChevronIcon', 'chevron-right'],
            ['ChevronDownIcon', 'chevron-down'],
            ['ChevronLeftIcon', 'chevron-left'],
            ['ChevronRightIcon', 'chevron-right'],
            ['ArrowLeftIcon', 'arrow-left'],
            ['ArrowRightIcon', 'arrow-right'],
            ['SearchIcon', 'search'],
            ['EditIcon', 'pen-edit'],
            ['PenIcon', 'pen'],
            ['SaveIcon', 'save'],
            ['TrashIcon', 'trash'],
            ['CopyIcon', 'copy'],
            ['DownloadIcon', 'download'],
            ['UploadIcon', 'upload'],
            ['ExportIcon', 'file-export'],
            ['ImportIcon', 'file-import'],
            ['SettingsIcon', 'cog'],
            ['SlidersIcon', 'sliders'],
            ['NotesIcon', 'file-lines'],
            ['StickyNoteIcon', 'note-sticky'],
            ['CalendarIcon', 'calendar'],
            ['CalendarDayIcon', 'calendar-day'],
            ['ClockIcon', 'clock'],
            ['StopwatchIcon', 'stopwatch'],
            ['HourglassIcon', 'hourglass-half'],
            ['TasksIcon', 'list-check'],
            ['ListIcon', 'list-ul'],
            ['ChartBarIcon', 'chart-bar'],
            ['ChartLineIcon', 'chart-line'],
            ['StarIcon', 'star'],
            ['StarOutlineIcon', 'star-outline'],
            ['PinIcon', 'pin'],
            ['BoltIcon', 'bolt'],
            ['BellIcon', 'bell'],
            ['FlagIcon', 'flag'],
            ['FireIcon', 'fire'],
            ['TrophyIcon', 'trophy'],
            ['AwardIcon', 'award'],
            ['MedalIcon', 'medal'],
            ['CrownIcon', 'crown'],
            ['BullseyeIcon', 'bullseye'],
            ['CompassIcon', 'compass'],
            ['ShieldIcon', 'shield'],
            ['BrainIcon', 'brain'],
            ['SeedlingIcon', 'seedling'],
            ['SpaIcon', 'spa'],
            ['DumbbellIcon', 'dumbbell'],
            ['MoonIcon', 'moon'],
            ['SunIcon', 'sun'],
            ['CloudIcon', 'cloud'],
            ['LinkIcon', 'link'],
            ['UnlinkIcon', 'unlink'],
            ['PlugIcon', 'plug'],
            ['ImageIcon', 'image'],
            ['VideoIcon', 'video'],
            ['MusicIcon', 'music'],
            ['PaletteIcon', 'palette'],
            ['GlobeIcon', 'globe'],
            ['PlayIcon', 'play'],
            ['PauseIcon', 'pause'],
            ['UndoIcon', 'undo'],
            ['RedoIcon', 'redo'],
            ['SyncIcon', 'sync'],
            ['RepeatIcon', 'repeat'],
            ['SignalIcon', 'signal'],
            ['UserIcon', 'user'],
            ['UsersIcon', 'users'],
            ['BriefcaseIcon', 'briefcase'],
            ['WalletIcon', 'wallet'],
            ['ReceiptIcon', 'receipt'],
            ['BalanceIcon', 'balance-scale'],
            ['BookIcon', 'book'],
            ['BookOpenIcon', 'book-open'],
            ['JournalIcon', 'journal'],
            ['GraduationIcon', 'graduation-cap'],
            ['CollegeIcon', 'university'],
            ['ChalkboardIcon', 'chalkboard'],
            ['CalculatorIcon', 'calculator'],
            ['DatabaseIcon', 'database'],
            ['FocusIcon', 'bullseye'],
            ['ReviewIcon', 'check-double'],
            ['WellnessIcon', 'spa'],
            ['BusinessIcon', 'briefcase'],
            ['APIcon', 'graduation-cap'],
            ['LifeIcon', 'seedling'],
            ['CommandIcon', 'terminal'],
            ['CodeIcon', 'code'],
            ['MarkdownIcon', 'markdown'],
            ['InfoIcon', 'info-circle'],
            ['WarnIcon', 'triangle-warn'],
            ['ErrorIcon', 'exclamation-circle'],
            ['SparklesIcon', 'sparkles'],
            ['MagicIcon', 'magic-wand']
        ];
        for (var i = 0; i < pairs.length; i++) {
            (function (factoryName, iconName) {
                api[factoryName] = function (opts) {
                    return createIconElement(iconName, opts);
                };
            }(pairs[i][0], pairs[i][1]));
        }
    }

    var iconNames = Object.keys(registry.paths);

    var api = {
        getIconSvg: getIconSvg,
        createIconElement: createIconElement,
        replaceIconElement: replaceIconElement,
        resolveFromFaClass: resolveCanonicalName,
        hydrate: hydrate,
        names: iconNames,
        registry: registry
    };
    buildNamedFactories(api);
    global.AtelierIcons = api;

    function init() {
        try { hydrate(document); } catch (err) {
            if (typeof console !== 'undefined') console.warn('[AtelierIcons] hydrate failed', err);
        }
        startObserver();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
}(typeof window !== 'undefined' ? window : globalThis));

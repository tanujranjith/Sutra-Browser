/* ===========================================================================
 * NoteFlow Atelier — Local Plugin System (parser + validator + sandbox bridge)
 * ---------------------------------------------------------------------------
 * Dependency-free, file://-safe module exposed as `window.SutraPlugins`.
 * `window.AtelierPlugins` remains a compatibility alias for older extensions.
 *
 * SECURITY MODEL (non-negotiable):
 *   - Plugins are LOCAL `.atelier-plugin` JSON bundles. No remote URLs, no
 *     marketplace, no remote script loaders.
 *   - Declarative contributions (commands, sidebar items, templates, styles…)
 *     are data — the host renders them; plugins never touch app internals.
 *   - Runtime code, when present, executes ONLY inside an <iframe
 *     sandbox="allow-scripts"> (NO allow-same-origin) with a restrictive CSP
 *     (default-src 'none'; connect-src 'none'): no network, no host DOM, no host
 *     storage, no cookies.
 *   - The iframe talks to the host through a constrained postMessage bridge.
 *     Every message is validated: shape, pluginId, an unguessable per-mount
 *     session token, event.source identity, an operation allowlist, and the
 *     plugin's granted permissions. The host NEVER calls functions by string
 *     name; operations route through explicit handlers.
 *   - This module uses NO eval and NO new Function.
 *
 * Persistence/UI live in src/core/app.js; this is the validation + runtime engine.
 * ======================================================================== */
(function (global) {
    'use strict';

    var SCHEMA_VERSION = 1;
    var MAX_BUNDLE_BYTES = 512 * 1024;     // 512KB cap on a single bundle
    var MAX_RUNTIME_CODE_BYTES = 256 * 1024;
    var PLUGIN_ID_RE = /^[a-z0-9]([a-z0-9._-]{1,62})[a-z0-9]$/i;
    var VERSION_RE = /^\d+\.\d+(\.\d+)?([-+][0-9A-Za-z.-]+)?$/;

    // Allowlisted permissions. Broad read/write are flagged higher-risk in the UI.
    var PERMISSIONS = Object.freeze({
        'ui.commands': { label: 'Add Command Palette commands', risk: 'low' },
        'ui.sidebar': { label: 'Add sidebar launch items', risk: 'low' },
        'ui.tabs': { label: 'Add top-tab / overflow items', risk: 'low' },
        'ui.quickActions': { label: 'Add contextual quick actions', risk: 'low' },
        'ui.styles': { label: 'Apply plugin styles', risk: 'medium' },
        'notes.readCurrent': { label: 'Read the current note', risk: 'medium' },
        'notes.create': { label: 'Create notes', risk: 'medium' },
        'notes.writeCurrent': { label: 'Modify the current note', risk: 'high' },
        'tasks.read': { label: 'Read your task list', risk: 'medium' },
        'tasks.create': { label: 'Create tasks', risk: 'medium' },
        'timeline.read': { label: 'Read timeline entries', risk: 'medium' },
        'timeline.create': { label: 'Create timeline blocks', risk: 'medium' },
        'navigation': { label: 'Navigate between views', risk: 'low' },
        'storage.local': { label: 'Store its own local data', risk: 'low' }
    });

    // Bridge operation -> required permission. The ONLY operations the host honours.
    var BRIDGE_OPS = Object.freeze({
        'command.register': 'ui.commands',
        'navigate': 'navigation',
        'note.create': 'notes.create',
        'note.readCurrent': 'notes.readCurrent',
        'note.writeCurrent': 'notes.writeCurrent',
        'task.create': 'tasks.create',
        'task.list': 'tasks.read',
        'timeline.create': 'timeline.create',
        'timeline.list': 'timeline.read',
        'storage.set': 'storage.local',
        'storage.get': 'storage.local',
        'toast': null // always allowed (host-controlled UI feedback)
    });

    function uid(prefix) {
        var r = '';
        try {
            if (global.crypto && global.crypto.getRandomValues) {
                var a = new Uint32Array(4);
                global.crypto.getRandomValues(a);
                r = a[0].toString(36) + a[1].toString(36) + a[2].toString(36) + a[3].toString(36);
            }
        } catch (e) {}
        if (!r) r = Math.floor((1 + (typeof performance !== 'undefined' && performance.now ? performance.now() : 0)) * 1e6).toString(36);
        return (prefix || 'pl_') + r;
    }
    function nowIso() { try { return new Date().toISOString(); } catch (e) { return ''; } }
    function asString(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }

    /* ---- Sanitization ----------------------------------------------------- */

    // Strip HTML-significant characters so a plugin label can never inject markup.
    function sanitizeLabel(v, max) {
        return asString(v).replace(/[<>]/g, '').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, max || 120);
    }
    // Only allow safe, non-executable URL schemes (and bare anchors). Rejects
    // javascript:, data:, vbscript:, etc.
    function sanitizeUrl(v) {
        var s = asString(v).trim();
        if (!s) return '';
        if (/^(https?:|mailto:|#|\/|\.\/)/i.test(s) && !/^javascript:/i.test(s)) return s.slice(0, 2048);
        return '';
    }

    /* ---- Manifest validation --------------------------------------------- */

    function validateManifest(raw) {
        var errors = [];
        if (!raw || typeof raw !== 'object') return { ok: false, errors: ['Bundle is not an object.'] };

        var schemaVersion = Number(raw.schemaVersion);
        if (!Number.isFinite(schemaVersion) || schemaVersion < 1) errors.push('Missing or invalid schemaVersion.');
        else if (schemaVersion > SCHEMA_VERSION) errors.push('Bundle requires a newer Sutra (schemaVersion ' + schemaVersion + ').');

        var id = asString(raw.id).trim();
        if (!id) errors.push('Missing plugin id.');
        else if (!PLUGIN_ID_RE.test(id)) errors.push('Invalid plugin id format (use letters, digits, . _ -).');

        var version = asString(raw.version).trim();
        if (!version) errors.push('Missing version.');
        else if (!VERSION_RE.test(version)) errors.push('Invalid version (expected semver-like, e.g. 1.0.0).');

        var name = sanitizeLabel(raw.name, 80);
        if (!name) errors.push('Missing plugin name.');

        var permissions = Array.isArray(raw.permissions) ? raw.permissions : [];
        var cleanPerms = [];
        permissions.forEach(function (p) {
            p = asString(p).trim();
            if (PERMISSIONS[p]) { if (cleanPerms.indexOf(p) < 0) cleanPerms.push(p); }
            else if (p) errors.push('Unknown permission: ' + sanitizeLabel(p, 40));
        });

        var runtime = raw.runtime && typeof raw.runtime === 'object' ? raw.runtime : null;
        var hasRuntime = !!(runtime && runtime.type === 'sandboxed-script' && asString(runtime.code).trim());
        if (hasRuntime && asString(runtime.code).length > MAX_RUNTIME_CODE_BYTES) {
            errors.push('Runtime code exceeds size limit.');
        }

        if (errors.length) return { ok: false, errors: errors };

        var contributions = normalizeContributions(raw.contributions);
        return {
            ok: true,
            errors: [],
            manifest: {
                schemaVersion: SCHEMA_VERSION,
                id: id,
                name: name,
                version: version,
                description: sanitizeLabel(raw.description, 400),
                author: sanitizeLabel(raw.author, 120),
                homepage: sanitizeUrl(raw.homepage),
                permissions: cleanPerms,
                contributions: contributions,
                hasRuntime: hasRuntime,
                runtime: hasRuntime ? { type: 'sandboxed-script', code: asString(runtime.code) } : null
            }
        };
    }

    function normalizeContributions(raw) {
        var c = raw && typeof raw === 'object' ? raw : {};
        function arr(v) { return Array.isArray(v) ? v : []; }
        return {
            commands: arr(c.commands).map(function (cmd) {
                return {
                    id: sanitizeLabel(cmd && cmd.id, 80),
                    label: sanitizeLabel(cmd && cmd.label, 120),
                    hint: sanitizeLabel(cmd && cmd.hint, 160),
                    action: sanitizeLabel(cmd && cmd.action, 80) // resolved by runtime/host, never eval'd
                };
            }).filter(function (cmd) { return cmd.label; }),
            sidebarItems: arr(c.sidebarItems).map(function (s) {
                return { id: sanitizeLabel(s && s.id, 80), label: sanitizeLabel(s && s.label, 120), icon: sanitizeLabel(s && s.icon, 60), action: sanitizeLabel(s && s.action, 80) };
            }).filter(function (s) { return s.label; }),
            tabItems: arr(c.tabItems).map(function (t) {
                return { id: sanitizeLabel(t && t.id, 80), label: sanitizeLabel(t && t.label, 80), action: sanitizeLabel(t && t.action, 80) };
            }).filter(function (t) { return t.label; }),
            quickActions: arr(c.quickActions).map(function (q) {
                return { id: sanitizeLabel(q && q.id, 80), label: sanitizeLabel(q && q.label, 120), action: sanitizeLabel(q && q.action, 80) };
            }).filter(function (q) { return q.label; }),
            noteTemplates: arr(c.noteTemplates).map(function (t) {
                return { id: sanitizeLabel(t && t.id, 80), name: sanitizeLabel(t && t.name, 120), icon: sanitizeLabel(t && t.icon, 60), content: asString(t && t.content).slice(0, 20000) };
            }).filter(function (t) { return t.name; }),
            settings: arr(c.settings).map(function (s) {
                return { key: sanitizeLabel(s && s.key, 60), label: sanitizeLabel(s && s.label, 120), type: ['text', 'number', 'checkbox', 'select'].indexOf(asString(s && s.type)) >= 0 ? s.type : 'text' };
            }).filter(function (s) { return s.key && s.label; }),
            styles: asString(c.styles).slice(0, 64 * 1024)
        };
    }

    // Parse a raw .atelier-plugin file body into a validated manifest.
    function parseBundle(text) {
        var body = asString(text);
        if (body.length > MAX_BUNDLE_BYTES) return { ok: false, errors: ['Bundle too large (max 512KB).'] };
        var data;
        try { data = JSON.parse(body); } catch (e) { return { ok: false, errors: ['Bundle is not valid JSON.'] }; }
        return validateManifest(data);
    }

    /* ---- Installed-plugin record (persistence shape) ---------------------- */

    function normalizeInstalledPlugin(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var v = validateManifest(raw.manifest || raw);
        if (!v.ok) {
            // Keep an unusable record so the user can inspect/remove it, but never enable.
            var m = raw.manifest && typeof raw.manifest === 'object' ? raw.manifest : {};
            return {
                manifest: { id: asString(m.id) || uid('bad_'), name: sanitizeLabel(m.name, 80) || 'Invalid plugin', version: asString(m.version), permissions: [], contributions: normalizeContributions(null), hasRuntime: false, runtime: null, schemaVersion: SCHEMA_VERSION, description: '', author: '' },
                enabled: false,
                installedAt: typeof raw.installedAt === 'string' ? raw.installedAt : nowIso(),
                updatedAt: nowIso(),
                pluginSettings: {},
                lastError: 'Invalid manifest: ' + v.errors.join('; '),
                reviewRequired: true
            };
        }
        return {
            manifest: v.manifest,
            enabled: raw.enabled === true,
            installedAt: typeof raw.installedAt === 'string' ? raw.installedAt : nowIso(),
            updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : nowIso(),
            pluginSettings: raw.pluginSettings && typeof raw.pluginSettings === 'object' ? raw.pluginSettings : {},
            lastError: typeof raw.lastError === 'string' ? raw.lastError : null,
            reviewRequired: raw.reviewRequired === true
        };
    }

    function normalizeInstalledPlugins(list) {
        return (Array.isArray(list) ? list : []).map(normalizeInstalledPlugin).filter(Boolean);
    }

    // On restore (.atelier / JSON import), every runtime-capable plugin must come
    // back DISABLED + reviewRequired so code never auto-executes on a new device.
    function markForReviewOnImport(list) {
        return normalizeInstalledPlugins(list).map(function (rec) {
            if (rec.manifest && rec.manifest.hasRuntime) { rec.enabled = false; rec.reviewRequired = true; }
            return rec;
        });
    }

    /* ---- Sandboxed runtime ------------------------------------------------ */

    function buildSandboxDocument(pluginId) {
        // The plugin's code is injected by the host AFTER load via postMessage, so
        // it is not embedded in the document string. The bootstrap exposes a
        // constrained `atelier` API and forwards calls over the bridge.
        return [
            '<!DOCTYPE html><html><head><meta charset="utf-8">',
            '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; connect-src \'none\'; img-src data:; base-uri \'none\'; form-action \'none\'">',
            '</head><body><script>',
            '(function(){',
            'var TOKEN=null,PID=' + JSON.stringify(asString(pluginId)) + ',PERMS=[],SEQ=0,PEND={},CMDS={};',
            'function send(op,payload){return new Promise(function(res,rej){var id=++SEQ;PEND[id]={res:res,rej:rej};parent.postMessage({__atelier:true,token:TOKEN,pluginId:PID,op:op,requestId:id,payload:payload},"*");});}',
            'var atelier={',
            ' registerCommand:function(c){return send("command.register",c);},',
            ' navigate:function(v){return send("navigate",{view:v});},',
            ' createNote:function(n){return send("note.create",n);},',
            ' readCurrentNote:function(){return send("note.readCurrent",{});},',
            ' writeCurrentNote:function(n){return send("note.writeCurrent",n);},',
            ' createTask:function(t){return send("task.create",t);},',
            ' listTasks:function(){return send("task.list",{});},',
            ' createTimelineBlock:function(b){return send("timeline.create",b);},',
            ' listTimeline:function(){return send("timeline.list",{});},',
            ' storageSet:function(k,v){return send("storage.set",{key:k,value:v});},',
            ' storageGet:function(k){return send("storage.get",{key:k});},',
            ' toast:function(m){return send("toast",{message:m});},',
            ' onCommand:function(id,fn){if(id&&typeof fn==="function")CMDS[String(id)]=fn;},',
            ' permissions:function(){return PERMS.slice();}',
            '};',
            'window.addEventListener("message",function(e){',
            ' var d=e.data;if(!d||d.__atelier!==true)return;',
            ' if(d.type==="init"){TOKEN=d.token;PERMS=d.permissions||[];try{if(typeof window.__pluginCode==="function"){window.__pluginCode(atelier);}}catch(err){parent.postMessage({__atelier:true,token:TOKEN,pluginId:PID,op:"__error",payload:{message:String(err&&err.message||err)}},"*");}return;}',
            ' if(d.type==="invoke"&&d.token===TOKEN&&d.commandId&&CMDS[d.commandId]){try{CMDS[d.commandId]();}catch(err){}return;}',
            ' if(d.requestId&&PEND[d.requestId]){var p=PEND[d.requestId];delete PEND[d.requestId];if(d.ok)p.res(d.result);else p.rej(new Error(d.error||"denied"));}',
            '});',
            'parent.postMessage({__atelier:true,pluginId:PID,op:"__ready"},"*");',
            '})();',
            '<\/script></body></html>'
        ].join('');
    }

    // Create a runtime host. `handlers` = {
    //   hasPermission(pluginId, perm) -> bool,
    //   onOperation(pluginId, op, payload) -> Promise(result),
    //   onError(pluginId, message)
    // }
    // Returns { mount(record), unmount(pluginId), unmountAll(), isMounted(id) }.
    function createRuntimeHost(handlers) {
        handlers = handlers || {};
        var mounts = new Map(); // pluginId -> { iframe, token, code }
        var listening = false;

        function onMessage(event) {
            var d = event.data;
            if (!d || d.__atelier !== true) return;
            var pid = asString(d.pluginId);
            var entry = mounts.get(pid);
            if (!entry) return;
            // Identity: the message MUST originate from this plugin's iframe window.
            if (event.source !== entry.iframe.contentWindow) return;

            if (d.op === '__ready') {
                // Code is embedded in srcdoc; the host only sends the session token
                // (via the iframe 'load' handler). Nothing to do on __ready.
                return;
            }
            if (d.op === '__error') {
                if (typeof handlers.onError === 'function') handlers.onError(pid, asString(d.payload && d.payload.message));
                return;
            }

            // Token + permission gated operations.
            if (d.token !== entry.token) return;
            if (!d.requestId) return;
            var op = asString(d.op);
            if (!Object.prototype.hasOwnProperty.call(BRIDGE_OPS, op)) {
                return reply(entry, d.requestId, false, null, 'Unknown operation.');
            }
            var requiredPerm = BRIDGE_OPS[op];
            if (requiredPerm && (typeof handlers.hasPermission !== 'function' || !handlers.hasPermission(pid, requiredPerm))) {
                return reply(entry, d.requestId, false, null, 'Permission denied: ' + requiredPerm);
            }
            Promise.resolve()
                .then(function () {
                    if (typeof handlers.onOperation !== 'function') throw new Error('No operation handler.');
                    return handlers.onOperation(pid, op, d.payload || {});
                })
                .then(function (result) { reply(entry, d.requestId, true, result == null ? null : result, null); })
                .catch(function (err) { reply(entry, d.requestId, false, null, asString(err && err.message || err)); });
        }

        function reply(entry, requestId, ok, result, error) {
            try {
                entry.iframe.contentWindow.postMessage({ __atelier: true, token: entry.token, requestId: requestId, ok: ok, result: result, error: error }, '*');
            } catch (e) {}
        }

        function ensureListening() {
            if (listening) return;
            global.addEventListener('message', onMessage);
            listening = true;
        }

        function mount(record) {
            if (!record || !record.manifest || !record.manifest.hasRuntime) return null;
            var pid = record.manifest.id;
            unmount(pid);
            ensureListening();
            var token = uid('tok_');
            var iframe = document.createElement('iframe');
            iframe.setAttribute('sandbox', 'allow-scripts'); // NO allow-same-origin
            iframe.setAttribute('referrerpolicy', 'no-referrer');
            iframe.setAttribute('aria-hidden', 'true');
            iframe.style.cssText = 'position:absolute;width:0;height:0;border:0;left:-9999px;top:-9999px;';
            iframe.title = 'Atelier plugin sandbox: ' + pid;

            // The plugin code is wrapped into a __pluginCode function inside the
            // document so the bootstrap can invoke it with the constrained API.
            // (No eval/new Function on the host side; the sandbox evaluates its own
            // inline script under its restrictive CSP, isolated by the sandbox attr.)
            var doc = buildSandboxWithCode(pid, record.manifest.runtime.code);
            iframe.srcdoc = doc;

            var entry = { iframe: iframe, token: token };
            mounts.set(pid, entry);
            iframe.addEventListener('load', function () {
                try {
                    iframe.contentWindow.postMessage({ __atelier: true, type: 'init', token: token, permissions: record.manifest.permissions.slice() }, '*');
                } catch (e) {}
            });
            (document.body || document.documentElement).appendChild(iframe);
            return entry;
        }

        function unmount(pid) {
            var entry = mounts.get(pid);
            if (!entry) return;
            try { if (entry.iframe && entry.iframe.parentNode) entry.iframe.parentNode.removeChild(entry.iframe); } catch (e) {}
            mounts.delete(pid);
        }
        function unmountAll() { Array.from(mounts.keys()).forEach(unmount); }
        function isMounted(pid) { return mounts.has(pid); }
        // Invoke a runtime-registered command inside the plugin's sandbox (the host
        // never runs plugin code itself — it just signals the sandbox over the bridge).
        function invoke(pid, commandId) {
            var entry = mounts.get(pid);
            if (!entry) return;
            try { entry.iframe.contentWindow.postMessage({ __atelier: true, token: entry.token, type: 'invoke', commandId: String(commandId) }, '*'); } catch (e) {}
        }

        return { mount: mount, unmount: unmount, unmountAll: unmountAll, isMounted: isMounted, invoke: invoke };
    }

    // Build the sandbox doc with the plugin code embedded as __pluginCode. The code
    // runs inside the sandboxed iframe (isolated origin, CSP-restricted, no network).
    function buildSandboxWithCode(pluginId, code) {
        var base = buildSandboxDocument(pluginId);
        // Define __pluginCode(api){ <plugin code> } just before the bootstrap IIFE.
        var wrapper = '<script>window.__pluginCode=function(atelier){"use strict";\n' + asString(code) + '\n};<\/script>';
        return base.replace('<script>(function(){', wrapper + '<script>(function(){');
    }

    var api = {
        SCHEMA_VERSION: SCHEMA_VERSION,
        MAX_BUNDLE_BYTES: MAX_BUNDLE_BYTES,
        PERMISSIONS: PERMISSIONS,
        BRIDGE_OPS: BRIDGE_OPS,
        uid: uid,
        sanitizeLabel: sanitizeLabel,
        sanitizeUrl: sanitizeUrl,
        validatePluginManifest: validateManifest,
        parseBundle: parseBundle,
        normalizeContributions: normalizeContributions,
        normalizeInstalledPlugin: normalizeInstalledPlugin,
        normalizeInstalledPlugins: normalizeInstalledPlugins,
        markForReviewOnImport: markForReviewOnImport,
        createRuntimeHost: createRuntimeHost,
        buildSandboxDocument: buildSandboxDocument
    };
    // Sutra-first public name. Keep the old name pointing to the exact same
    // object so saved workspaces and legacy integrations continue to work.
    global.SutraPlugins = api;
    global.AtelierPlugins = api;
})(typeof window !== 'undefined' ? window : this);

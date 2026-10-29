/*
 * NoteFlow Atelier — in-browser persistence & .atelier round-trip QA harness.
 * ---------------------------------------------------------------------------
 * This is a MANUAL QA tool. Open Sutra.html in a browser, open the
 * DevTools console, paste this whole file, then run:
 *
 *     await AtelierQA.run()             // non-destructive: serialize -> import -> re-serialize + IndexedDB save/load
 *     await AtelierQA.run({ wipe: true })   // DESTRUCTIVE: also wipes ALL local storage then re-imports
 *
 * It exercises the canonical wrappers exposed on window by src/core/app.js:
 *   serializeWorkspace, deserializeWorkspace, saveWorkspaceLocally,
 *   loadWorkspaceLocally, exportWorkspaceAsJson, verifyWorkspaceRoundTrip.
 *
 * `{ wipe: true }` reproduces the full product requirement:
 *   export -> clear localStorage + IndexedDB (workspace + attachments) ->
 *   import -> verify every item (incl. note images and course-file binaries)
 *   came back -> verify it persisted to IndexedDB so it survives a refresh.
 *
 * WARNING: `{ wipe: true }` deletes the workspace in THIS browser profile.
 *          Export a real .atelier backup first if you care about the data.
 */
(function (global) {
  'use strict';

  // 1x1 transparent PNG as a data: URI — stands in for a pasted note image and
  // a course-file attachment binary.
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function requireWrappers() {
    const need = [
      'serializeWorkspace', 'deserializeWorkspace', 'saveWorkspaceLocally',
      'loadWorkspaceLocally', 'verifyWorkspaceRoundTrip'
    ];
    const missing = need.filter((n) => typeof global[n] !== 'function');
    if (missing.length) {
      throw new Error('Missing window wrappers: ' + missing.join(', ') +
        ' — are you on Sutra.html with app.js loaded?');
    }
  }

  // Inject representative data covering the riskiest categories: a note with an
  // inline image, a task linked to that note, and a Course Hub file whose binary
  // lives in the separate attachments IndexedDB.
  function withTestData(basePayload) {
    const p = JSON.parse(JSON.stringify(basePayload));
    p.pages = Array.isArray(p.pages) ? p.pages : [];
    p.pages.push({
      id: 'qa-page-1', title: 'QA Image Page',
      content: '<p>hello <img src="' + PNG + '"></p>',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      spaceId: 'default'
    });
    p.tasks = Array.isArray(p.tasks) ? p.tasks : [];
    p.tasks.push({ id: 'qa-task-1', title: 'QA Task', notes: 'n', priority: 'high', difficulty: 'medium', noteId: 'qa-page-1' });
    p.courseWorkspace = (p.courseWorkspace && typeof p.courseWorkspace === 'object') ? p.courseWorkspace : {};
    p.courseWorkspace.courses = Array.isArray(p.courseWorkspace.courses) ? p.courseWorkspace.courses : [];
    if (!p.courseWorkspace.courses.some((c) => c.id === 'qa-course-1')) {
      p.courseWorkspace.courses.push({ id: 'qa-course-1', name: 'QA Course' });
    }
    p.courseWorkspace.files = Array.isArray(p.courseWorkspace.files) ? p.courseWorkspace.files : [];
    p.courseWorkspace.files.push({
      id: 'qa-file-1', name: 'syllabus.png', courseId: 'qa-course-1',
      storageType: 'indexeddb', blobKey: 'qa-blob-1', _exportBlob: PNG, missingBlob: false
    });
    return p;
  }

  function inspect(payload) {
    const pg = (payload.pages || []).find((x) => x.id === 'qa-page-1');
    const tk = (payload.tasks || []).find((x) => x.id === 'qa-task-1');
    const fl = ((payload.courseWorkspace && payload.courseWorkspace.files) || []).find((x) => x.id === 'qa-file-1');
    return {
      page: !!pg,
      imageDataUrlIntact: !!(pg && pg.content && pg.content.includes('data:image/png;base64')),
      task: !!tk,
      taskNoteLink: !!(tk && tk.noteId === 'qa-page-1'),
      courseFile: !!fl,
      courseFileBinaryEmbedded: !!(fl && fl._exportBlob && String(fl._exportBlob).startsWith('data:')),
      courseFileMissingBlobFlag: fl ? !!fl.missingBlob : null
    };
  }

  function clearStore(dbName, storeName) {
    return new Promise((res) => {
      try {
        const rq = indexedDB.open(dbName);
        rq.onsuccess = () => {
          const db = rq.result;
          if (!db.objectStoreNames.contains(storeName)) { db.close(); return res('no-store'); }
          const tx = db.transaction(storeName, 'readwrite');
          tx.objectStore(storeName).clear();
          tx.oncomplete = () => { db.close(); res('cleared'); };
          tx.onerror = () => { db.close(); res('error'); };
        };
        rq.onerror = () => res('open-error');
      } catch (e) { res('exception:' + e); }
    });
  }

  async function run(options) {
    options = options || {};
    requireWrappers();
    const report = { startedAt: new Date().toISOString(), checks: {}, pass: true };
    const fail = (k, v) => { report.checks[k] = v; if (v && v.ok === false) report.pass = false; };

    // --- Built-in self test -------------------------------------------------
    const builtIn = global.verifyWorkspaceRoundTrip();
    fail('builtInSelfTest', { ok: builtIn && builtIn.ok === true, detail: builtIn });

    // --- Serialize -> import -> re-serialize (asset + cross-link fidelity) ---
    const baseline = global.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    const rich = withTestData(baseline);
    global.deserializeWorkspace(rich);
    await sleep(400);
    const after = global.serializeWorkspace({ mode: 'full', includeSensitiveSettings: false });
    const r = inspect(after);
    fail('roundTrip', {
      ok: r.page && r.imageDataUrlIntact && r.task && r.taskNoteLink && r.courseFile && r.courseFileBinaryEmbedded && r.courseFileMissingBlobFlag === false,
      detail: r
    });

    // --- IndexedDB local persistence (Stage 1) ------------------------------
    global.saveWorkspaceLocally();
    await sleep(400);
    const loaded = await global.loadWorkspaceLocally();
    fail('indexedDbPersistence', {
      ok: !!(loaded && (loaded.pages || []).some((x) => x.id === 'qa-page-1') && (loaded.tasks || []).some((x) => x.id === 'qa-task-1') && loaded.courseWorkspace && (loaded.courseWorkspace.files || []).some((x) => x.id === 'qa-file-1')),
      detail: { loadedNotNull: !!loaded }
    });

    // --- Full wipe -> import -> persist (Stage 2, destructive) --------------
    if (options.wipe === true) {
      const EXPORT = global.serializeWorkspace({ mode: 'full', includeSensitiveSettings: false });
      try { localStorage.clear(); } catch (e) { /* ignore */ }
      const w1 = await clearStore('noteflow_atelier_db', 'workspace');
      const w2 = await clearStore('noteflow_attachments_db', 'blobs');
      const empty = await global.loadWorkspaceLocally();
      global.deserializeWorkspace(EXPORT);
      await sleep(500);
      const restored = inspect(global.serializeWorkspace({ mode: 'full', includeSensitiveSettings: false }));
      await sleep(300);
      const persisted = await global.loadWorkspaceLocally();
      fail('wipeImportRoundTrip', {
        ok: empty == null && restored.page && restored.imageDataUrlIntact && restored.task && restored.courseFile && restored.courseFileBinaryEmbedded && !!(persisted && (persisted.pages || []).some((x) => x.id === 'qa-page-1')),
        detail: { wipeWorkspace: w1, wipeAttachments: w2, afterWipeEmpty: empty == null, restored: restored, persistedAfterImport: !!(persisted && (persisted.pages || []).some((x) => x.id === 'qa-page-1')) }
      });
    }

    report.finishedAt = new Date().toISOString();
    console.log('%cAtelier QA: ' + (report.pass ? 'PASS' : 'FAIL'), 'font-weight:bold;color:' + (report.pass ? 'green' : 'red'));
    console.log(JSON.stringify(report, null, 2));
    return report;
  }

  global.AtelierQA = { run: run, PNG: PNG };
})(typeof window !== 'undefined' ? window : this);

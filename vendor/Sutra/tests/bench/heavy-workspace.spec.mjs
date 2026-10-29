import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const NOTES = Number(process.env.BENCH_NOTES || 1000);
const PASS = 'benchmark passphrase 2026';

async function settleRendering(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0)))));
}

async function completeOnboarding(page) {
  await page.evaluate(() => {
    try { window.markStudentOnboardingCompleted?.(true); } catch {}
    const overlay = document.getElementById('studentOnboardingOverlay');
    if (overlay) { overlay.hidden = true; overlay.style.setProperty('display', 'none', 'important'); }
  });
}

test('heavy workspace: real startup, render, encrypted export, import, and restore pipeline', async ({ page }) => {
  test.setTimeout(420_000);
  await page.addInitScript(() => {
    window.__benchLongTasks = [];
    try {
      new PerformanceObserver((list) => list.getEntries().forEach((entry) => window.__benchLongTasks.push({ start: entry.startTime, duration: entry.duration }))).observe({ type: 'longtask', buffered: true });
    } catch {}
  });

  const coldStart = Date.now();
  await page.goto('/Sutra.html');
  await page.waitForSelector('.app-container', { state: 'visible' });
  await page.waitForFunction(() => typeof window.serializeWorkspace === 'function' && !!window.SutraPersistenceHealth);
  await completeOnboarding(page);
  await settleRendering(page);
  const coldStartupMs = Date.now() - coldStart;

  const warmStart = Date.now();
  await page.reload();
  await page.waitForSelector('.app-container', { state: 'visible' });
  await page.waitForFunction(() => typeof window.serializeWorkspace === 'function' && !!window.SutraPersistenceHealth);
  await completeOnboarding(page);
  await settleRendering(page);
  const warmStartupMs = Date.now() - warmStart;

  const seeded = await page.evaluate(async ({ count }) => {
    const start = performance.now();
    const base = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    const iso = '2026-07-09T12:00:00.000Z';
    const para = '<p>' + 'Large offline-first Sutra note content with citations, formulas, and study context. '.repeat(42) + '</p>';
    const pages = Array.from({ length: count }, (_, i) => ({
      id: `bench-page-${i}`, title: `Bench Note ${i}`, content: para,
      blocks: i % 20 === 0 ? [{ id: `block-${i}`, type: 'htmlEmbed', html: '<section><strong>Offline embed</strong></section>' }] : [],
      tags: ['bench', `unit-${i % 12}`], createdAt: iso, updatedAt: iso
    }));
    const courses = Array.from({ length: 24 }, (_, i) => ({ id: `course-${i}`, name: `Course ${i}`, type: 'class', createdAt: iso, updatedAt: iso }));
    const homework = Array.from({ length: 1200 }, (_, i) => ({
      id: `hw-${i}`, courseId: `course-${i % courses.length}`, title: `Assignment ${i}`,
      dueDate: `2026-${String(7 + Math.floor((i % 120) / 30)).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
      dueTime: i % 3 === 0 ? '23:59' : '', done: i % 5 === 0, priority: ['low', 'medium', 'high'][i % 3],
      recurrence: i % 40 === 0 ? 'weekly' : 'none', notes: `Homework notes ${i}`, createdAt: iso, updatedAt: iso
    }));
    const plannerTasks = Array.from({ length: 800 }, (_, i) => ({ id: `task-${i}`, title: `Planner task ${i}`, dueDate: '2026-07-20', priority: 'medium', difficulty: 'medium', isActive: true, scheduleType: 'once', weeklyDays: [], estimate: 25, createdAt: iso }));
    const timeBlocks = Array.from({ length: 500 }, (_, i) => ({ id: `timeline-${i}`, name: `Study block ${i}`, title: `Study block ${i}`, date: `2026-07-${String((i % 28) + 1).padStart(2, '0')}`, start: '16:00', end: '16:45', category: 'study', homeworkId: `hw-${i % homework.length}` }));
    const reviewWorkspace = {
      decks: Array.from({ length: 10 }, (_, d) => ({ id: `deck-${d}`, name: `Deck ${d}`, cards: Array.from({ length: 250 }, (_, i) => ({ id: `card-${d}-${i}`, prompt: `Prompt ${d}-${i}`, answer: `Answer ${d}-${i}`, nextReviewAt: iso })) })),
      settings: { dailyLimit: 100 }
    };
    const plugin = { manifest: { schemaVersion: 1, id: 'bench.plugin', name: 'Bench Plugin', version: '1.0.0', permissions: [], contributions: {}, hasRuntime: false }, enabled: false, reviewRequired: true };
    const attachments = Array.from({ length: 10 }, (_, i) => ({ id: `attachment-${i}`, courseId: `course-${i}`, name: `Benchmark attachment ${i}.txt`, storageType: 'indexeddb', blobKey: `bench-attachment-${i}`, createdAt: iso }));
    const payload = {
      ...base, version: 4, pages, tasks: plannerTasks, taskOrder: plannerTasks.map((task) => task.id), timeBlocks,
      homeworkWorkspace: { schemaVersion: 2, revision: 1, courses, tasks: homework, quarantine: [] },
      reviewWorkspace,
      assistantMemory: { items: Array.from({ length: 300 }, (_, i) => ({ id: `memory-${i}`, content: `Study preference ${i}`, category: 'study_preferences', createdAt: iso })) },
      courseWorkspace: { courses, assignments: homework.slice(0, 200), resources: [], files: attachments, settings: {} },
      settings: { ...base.settings, customization: { ...(base.settings?.customization || {}), installedPlugins: [plugin], cssSnippets: [{ id: 'bench-css', name: 'Bench', css: '.bench{color:#123456}', enabled: true }] } }
    };
    window.deserializeWorkspace(payload);
    if (window.__sutraPublicBetaTestHooks?.seedCourseAttachmentBlob) {
      for (const file of attachments) {
        const data = `data:text/plain;base64,${btoa(('Attachment payload ' + file.id + ' ').repeat(400))}`;
        await window.__sutraPublicBetaTestHooks.seedCourseAttachmentBlob(file.blobKey, data);
      }
    }
    return { seedMs: Math.round(performance.now() - start), notes: pages.length, homework: homework.length, reviewCards: 2500, timeline: timeBlocks.length, attachments: attachments.length };
  }, { count: NOTES });

  const measurements = await page.evaluate(async ({ pass }) => {
    const measure = async (fn) => { const start = performance.now(); const value = await fn(); return { ms: Math.round(performance.now() - start), value }; };
    const beforeResources = performance.getEntriesByType('resource').map((entry) => entry.name);
    const disabledPackAssets = Object.values(window.SUTRA_FEATURE_MANIFEST || {})
      .filter(definition => definition && definition.defaultEnabled !== true)
      .flatMap(definition => [...(definition.scripts || []), ...(definition.styles || [])])
      .map(path => String(path).replace(/^\.\//, '').split('?')[0]);
    const disabledOptionalResources = beforeResources.filter(url => {
      const path = new URL(url).pathname.replace(/^\//, '');
      return disabledPackAssets.some(asset => path.endsWith(asset));
    }).length;

    const today = await measure(async () => { window.setActiveView('today'); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return document.querySelectorAll('#view-today [data-task-id], #view-today .task-item, #view-today .today-item').length; });
    const timeline = await measure(async () => { window.setActiveView('timeline'); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return document.querySelectorAll('#view-timeline .time-block, #view-timeline [data-block-id]').length; });
    const search = await measure(async () => {
      if (typeof window.globalSearchAll === 'function') return window.globalSearchAll('Assignment 777');
      const input = document.getElementById('globalSearchInput');
      if (input) { input.value = 'Assignment 777'; input.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => requestAnimationFrame(r)); }
      return document.querySelectorAll('.global-search-result').length;
    });
    const serialize = await measure(() => window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false }));
    const save = await measure(() => window.saveWorkspaceLocally());
    const encryptedExport = await measure(() => window.SutraEncryptedBackups.createBackupBlob(pass, { requireCompleteAttachments: true }));
    const bytes = new Uint8Array(await encryptedExport.value.blob.arrayBuffer());
    const inspect = await window.SutraEncryptedBackups.inspectEnvelope(encryptedExport.value.blob);
    const optionalLoad = await measure(() => window.SutraFeatureRegistry.configure({ assistant: true, business: true }, { benchmark: true }));
    const optionalResources = performance.getEntriesByType('resource').filter((entry) => /flow-assistant|business-workspace|assistant-view\.css/.test(entry.name));
    window.__benchEncryptedBytes = Array.from(bytes);
    return {
      todayRenderMs: today.ms, todayRows: today.value,
      timelineRenderMs: timeline.ms, timelineRows: timeline.value,
      searchMs: search.ms,
      serializeMs: serialize.ms,
      serializedBytes: JSON.stringify(serialize.value).length,
      saveMs: save.ms,
      encryptedExportMs: encryptedExport.ms,
      encryptedBytes: bytes.byteLength,
      manifestFormat: inspect.header.format,
      kdfIterations: inspect.header.kdf.iterations,
      disabledOptionalResources,
      optionalPackLoadMs: optionalLoad.ms,
      optionalResourceBytes: optionalResources.reduce((sum, entry) => sum + (entry.transferSize || entry.encodedBodySize || 0), 0),
      heapBytes: performance.memory?.usedJSHeapSize || null,
      longTasks: window.__benchLongTasks || []
    };
  }, { pass: PASS });

  const encryptedBuffer = Buffer.from(await page.evaluate(() => window.__benchEncryptedBytes));
  const importStart = Date.now();
  await page.setInputFiles('#fileInput', { name: 'heavy-benchmark.sutra', mimeType: 'application/octet-stream', buffer: encryptedBuffer });
  await page.locator('#sutraImportPassphraseInput').fill(PASS);
  await page.locator('#sutraImportPasswordSubmitBtn').click();
  await expect(page.locator('#sutraImportPasswordModal')).not.toHaveClass(/active/, { timeout: 90_000 });
  const chooser = page.locator('.sutra-modal-overlay button', { hasText: 'Restore backup' });
  if (await chooser.isVisible({ timeout: 10_000 }).catch(() => false)) await chooser.click();
  await expect.poll(() => page.evaluate(() => window.serializeWorkspace().pages.length), { timeout: 90_000 }).toBe(NOTES);
  await settleRendering(page);
  const importRestoreMs = Date.now() - importStart;

  const output = {
    generatedAt: new Date().toISOString(), notes: NOTES, ...seeded,
    coldStartupMs, warmStartupMs, timeToUsableMs: coldStartupMs,
    importRestoreMs, ...measurements,
    longTaskCount: measurements.longTasks.length,
    maxLongTaskMs: Math.round(Math.max(0, ...measurements.longTasks.map((entry) => entry.duration)))
  };
  mkdirSync('.tmp/benchmarks', { recursive: true });
  writeFileSync('.tmp/benchmarks/heavy-workspace.latest.json', JSON.stringify(output, null, 2));
  console.log('\n===== Sutra real-pipeline benchmark =====\n' + JSON.stringify(output, null, 2) + '\n=========================================\n');

  expect(output.disabledOptionalResources, 'disabled packs must not load').toBe(0);
  expect(output.manifestFormat).toBe('sutra-encrypted-envelope');
  expect(output.kdfIterations).toBe(600000);
  expect(output.coldStartupMs).toBeLessThan(20_000);
  expect(output.warmStartupMs).toBeLessThan(12_000);
  expect(output.todayRenderMs).toBeLessThan(5_000);
  expect(output.timelineRenderMs).toBeLessThan(5_000);
  expect(output.searchMs).toBeLessThan(2_000);
  expect(output.saveMs).toBeLessThan(30_000);
  expect(output.encryptedExportMs).toBeLessThan(60_000);
  expect(output.importRestoreMs).toBeLessThan(90_000);
});

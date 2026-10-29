import { expect, test } from '@playwright/test';

// Export-fidelity regression coverage. The note-document export formats used to
// depend on CDN-loaded libraries (html2pdf, html-docx-js, turndown) and a
// narrow centred wrapper, which produced blank / half-page / unformatted output
// and failed offline. The fix makes every format native and fully offline:
// - PDF  -> the browser print pipeline (real pagination, selectable text)
// - DOCX/DOC -> Word-compatible HTML with a full-page @page Section1 layout
// - HTML -> a clean standalone document
// - Markdown -> a deterministic local HTML->MD converter
// - RTF  -> a structure-preserving HTML->RTF converter
//
// These tests exercise the pure builder functions exposed on the public-beta
// test hooks (no real download is triggered) and assert that the runtime no
// longer references the old CDN export libraries.

const SAMPLE_HTML =
  '<h1>Photosynthesis</h1>' +
  '<p>Plants convert <strong>light</strong> into <em>energy</em>.</p>' +
  '<ul><li>Chlorophyll</li><li>Stomata</li></ul>' +
  '<pre><code>6CO2 + 6H2O</code></pre>' +
  '<table><tr><th>Stage</th><th>Where</th></tr><tr><td>Light</td><td>Thylakoid</td></tr></table>';

async function openApp(page) {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await page.evaluate(() => {
    try {
      if (typeof window.markStudentOnboardingCompleted === 'function') {
        window.markStudentOnboardingCompleted(true);
      }
    } catch (error) {}
    const overlay = document.getElementById('studentOnboardingOverlay');
    if (overlay) {
      overlay.classList.remove('active');
      overlay.hidden = true;
      overlay.style.setProperty('display', 'none', 'important');
    }
  });
  await page.waitForFunction(() => !!(window.__sutraPublicBetaTestHooks && window.__sutraPublicBetaTestHooks.documentExport));
}

test('Word export uses a full-page Section1 layout, not a narrow centred column', async ({ page }) => {
  await openApp(page);
  const html = await page.evaluate((body) =>
    window.__sutraPublicBetaTestHooks.documentExport.wordHtml('Photosynthesis', body), SAMPLE_HTML);

  expect(html).toContain('class="Section1"');
  expect(html).toContain('@page Section1');
  expect(html).toContain('schemas-microsoft-com:office:word');
  // The half-page bug was caused by this centred wrapper — it must be gone.
  expect(html).not.toContain('max-width:860px');
  expect(html).toContain('Photosynthesis');
  expect(html).toContain('Chlorophyll');
});

test('Standalone HTML export is clean semantic HTML with the content present', async ({ page }) => {
  await openApp(page);
  const html = await page.evaluate((body) =>
    window.__sutraPublicBetaTestHooks.documentExport.standaloneHtml('Photosynthesis', body), SAMPLE_HTML);

  expect(html).toContain('<main>');
  expect(html).toContain('Photosynthesis');
  expect(html).toContain('Thylakoid');
  // Not the Word document — no MSO section wrapper.
  expect(html).not.toContain('class="Section1"');
});

test('PDF print document remains available as the fidelity fallback', async ({ page }) => {
  await openApp(page);
  const html = await page.evaluate((body) =>
    window.__sutraPublicBetaTestHooks.documentExport.pdfPrintHtml('Photosynthesis', body), SAMPLE_HTML);

  expect(html).toContain('@page');
  expect(html).toContain('window.print()');
  expect(html).toContain('Photosynthesis');
  expect(html).not.toContain('html2pdf');
});

test('direct PDF export creates selectable paginated output from local assets', async ({ page }) => {
  await openApp(page);
  const result = await page.evaluate(async (body) => {
    const api = window.SutraPdfEngine;
    const longBody = body + '<div class="atelier-page-break"></div>' + '<p>' + 'A paragraph that remains selectable after the explicit page break. '.repeat(18) + '</p>';
    const built = await api.buildNotePdf({
      title: 'Photosynthesis direct export',
      html: longBody,
      documentBackground: {
        enabled: true,
        dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        overlayOpacity: 0.25,
        blurPx: 0
      }
    });
    const pdf = await import('/assets/vendor/pdfjs/build/pdf.min.mjs');
    pdf.GlobalWorkerOptions.workerSrc = '/assets/vendor/pdfjs/build/pdf.worker.min.mjs';
    const header = new TextDecoder().decode(built.bytes.slice(0, 5));
    const byteLength = built.bytes.byteLength;
    const document = await pdf.getDocument({ data: built.bytes.slice(), disableWorker: true }).promise;
    const text = [];
    for (let index = 1; index <= document.numPages; index += 1) {
      const page = await document.getPage(index);
      const content = await page.getTextContent();
      text.push(content.items.map(item => item.str).join(' '));
    }
    const extractedText = text.join('\n')
      .replace(/\s+([.,!?;:])/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
    return {
      header,
      pages: document.numPages,
      bytes: byteLength,
      text: extractedText,
      warnings: built.warnings
    };
  }, SAMPLE_HTML);

  expect(result.header).toBe('%PDF-');
  expect(result.bytes).toBeGreaterThan(1000);
  expect(result.pages).toBeGreaterThanOrEqual(2);
  expect(result.text).toContain('Photosynthesis direct export');
  expect(result.text).toContain('Plants convert light into energy.');
  expect(result.text).toContain('remains selectable after the explicit page break.');
  expect(result.warnings).not.toContain('An image could not be embedded because it was not a self-contained data URL.');
});

test('RTF export preserves structure (title, headings, emphasis) not just plain text', async ({ page }) => {
  await openApp(page);
  const rtf = await page.evaluate((body) =>
    window.__sutraPublicBetaTestHooks.documentExport.rtf('Photosynthesis', body), SAMPLE_HTML);

  expect(rtf.startsWith('{\\rtf1')).toBe(true);
  expect(rtf).toContain('Photosynthesis');
  // Bold runs are emitted as {\b ...} groups — proves emphasis survived.
  expect(rtf).toContain('{\\b');
  expect(rtf).toContain('Chlorophyll');
});

test('Markdown export is deterministic and offline (headings, lists, emphasis, code)', async ({ page }) => {
  await openApp(page);
  const md = await page.evaluate((body) =>
    window.__sutraPublicBetaTestHooks.documentExport.markdown(body), SAMPLE_HTML);

  expect(md).toContain('# Photosynthesis');
  expect(md).toContain('**light**');
  expect(md).toContain('*energy*');
  expect(md).toContain('- Chlorophyll');
  expect(md).toContain('- Stomata');
  expect(md).toContain('```');
  expect(md).toContain('| Stage | Where |');
});

test('runtime no longer loads CDN export libraries (html2pdf / html-docx-js / turndown)', async ({ request }) => {
  const res = await request.get('/src/core/app.js');
  expect(res.ok()).toBeTruthy();
  const source = await res.text();
  // Assert the CDN load URLs / call sites are gone — bare names may still appear
  // in explanatory comments, which is fine.
  expect(source).not.toContain('cdnjs.cloudflare.com/ajax/libs/html2pdf');
  expect(source).not.toContain('cdnjs.cloudflare.com/ajax/libs/html-docx-js');
  expect(source).not.toContain('unpkg.com/turndown');
  expect(source).not.toContain('htmlDocx.asBlob');
  expect(source).not.toMatch(/\bhtml2pdf\(\)/);
});

test('direct PDF exporter is wired as a local runtime with the print fallback', async ({ request }) => {
  const res = await request.get('/src/features/workspace/direct-pdf-export.js');
  expect(res.ok()).toBeTruthy();
  const source = await res.text();
  expect(source).toContain('assets/vendor/pdf-lib/pdf-lib.min.js');
  expect(source).toContain('assets/vendor/pdf-fontkit/fontkit.umd.min.js');
  expect(source).toContain('global.exportCurrentNoteDocument = wrappedExport');
  expect(source).toContain('print fallback');
  expect(source).not.toContain('http://');
  expect(source).not.toContain('https://');
});

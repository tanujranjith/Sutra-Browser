// Extended negative-path coverage for the .sutra encrypted envelope.
//
// The existing encrypted-backups.spec.mjs proves correct/wrong-password and two
// tamper categories end-to-end. This spec adds a comprehensive single-field tamper
// matrix (12 categories) and asserts every mutation is rejected by the real
// parser / validator / AES-GCM authentication BEFORE any plaintext is produced or
// any workspace state is applied. It exercises the production runtime path via the
// SutraEncryptedBackups programmatic surface plus one full import-flow assertion.
//
// All mutations are generated in-process from a real backup, so this test needs no
// gitignored fixtures (the same categories also exist as static files under
// security-artifacts/tampered/ for manual inspection).
import { expect, test } from '@playwright/test';

const PASS = 'correct horse battery staple';

async function completeOnboarding(page) {
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
      overlay.setAttribute('aria-hidden', 'true');
      overlay.style.setProperty('display', 'none', 'important');
      overlay.style.setProperty('pointer-events', 'none', 'important');
    }
  });
  await expect(page.locator('#studentOnboardingOverlay')).toBeHidden();
}

async function openApp(page) {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await completeOnboarding(page);
  await expect(page.locator('[data-sutra-component="brand-mark"]').first()).toBeVisible();
}

async function seedTitle(page, title) {
  await page.evaluate(async ({ title }) => {
    const base = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    const now = new Date().toISOString();
    window.deserializeWorkspace({
      ...base,
      pages: [{ id: `p-${title}`, title, content: `<p>${title}</p>`, createdAt: now, updatedAt: now }]
    });
    await window.saveWorkspaceLocally();
  }, { title });
}

async function makeValidBackup(page) {
  await seedTitle(page, 'TamperSource');
  const arr = await page.evaluate(async ({ pass }) => {
    const created = await window.SutraEncryptedBackups.createBackupBlob(pass);
    return Array.from(new Uint8Array(await created.blob.arrayBuffer()));
  }, { pass: PASS });
  return Buffer.from(arr);
}

// Re-encode an envelope from magic(8)+version(1)+u32 headerLen(BE)+header+ciphertext.
function rebuild(headerBuf, ciphertextBuf, outerVersion = 1) {
  const prefix = Buffer.alloc(13);
  prefix.write('SUTRAENC', 0, 'latin1');
  prefix[8] = outerVersion;
  prefix.writeUInt32BE(headerBuf.length, 9);
  return Buffer.concat([prefix, headerBuf, ciphertextBuf]);
}

function splitEnvelope(buf) {
  const headerLen = buf.readUInt32BE(9);
  const headerStart = 13;
  const header = JSON.parse(buf.slice(headerStart, headerStart + headerLen).toString('utf8'));
  const ciphertext = buf.slice(headerStart + headerLen);
  const headerBuf = buf.slice(headerStart, headerStart + headerLen);
  return { headerLen, header, headerBuf, ciphertext };
}

function buildTamperMatrix(buf) {
  const { header, headerBuf, ciphertext } = splitEnvelope(buf);
  const out = [];

  // 1. ciphertext tag bit flip (last byte)
  { const t = Buffer.from(buf); t[t.length - 1] ^= 0x01; out.push(['ciphertext-tag-flip', t]); }
  // 2. ciphertext mid bit flip
  { const t = Buffer.from(buf); t[13 + headerBuf.length + 50] ^= 0xff; out.push(['ciphertext-mid-flip', t]); }
  // 3. salt value mutation (length preserved)
  {
    const h = JSON.parse(JSON.stringify(header));
    const salt = Buffer.from(h.kdf.salt, 'base64'); salt[0] ^= 0xff;
    h.kdf.salt = salt.toString('base64');
    out.push(['salt-value', rebuild(Buffer.from(JSON.stringify(h)), ciphertext)]);
  }
  // 4. IV value mutation
  {
    const h = JSON.parse(JSON.stringify(header));
    const iv = Buffer.from(h.cipher.iv, 'base64'); iv[0] ^= 0xff;
    h.cipher.iv = iv.toString('base64');
    out.push(['iv-value', rebuild(Buffer.from(JSON.stringify(h)), ciphertext)]);
  }
  // 5. outer version byte
  { const t = Buffer.from(buf); t[8] = 99; out.push(['outer-version', t]); }
  // 6. header envelopeVersion
  {
    const h = JSON.parse(JSON.stringify(header)); h.envelopeVersion = 2;
    out.push(['header-version', rebuild(Buffer.from(JSON.stringify(h)), ciphertext)]);
  }
  // 7. header length huge
  { const t = Buffer.from(buf); t.writeUInt32BE(999999, 9); out.push(['headerlen-huge', t]); }
  // 8. header length zero
  { const t = Buffer.from(buf); t.writeUInt32BE(0, 9); out.push(['headerlen-zero', t]); }
  // 9. KDF iterations DoS
  {
    const h = JSON.parse(JSON.stringify(header)); h.kdf.iterations = 9000000000;
    out.push(['kdf-iterations-dos', rebuild(Buffer.from(JSON.stringify(h)), ciphertext)]);
  }
  // 10. wrong magic
  { const t = Buffer.from(buf); t.write('XXXXXXXX', 0, 'latin1'); out.push(['wrong-magic', t]); }
  // 11. truncated (drop ciphertext)
  { out.push(['truncated', buf.slice(0, 13 + headerBuf.length)]); }
  // 12. malformed header JSON
  {
    const broken = Buffer.from(headerBuf.toString('utf8').slice(0, -1) + 'X', 'utf8');
    out.push(['malformed-header-json', rebuild(broken, ciphertext)]);
  }
  return out;
}

test('every single-field .sutra tamper category is rejected before any plaintext (programmatic path)', async ({ page }) => {
  await openApp(page);
  const buf = await makeValidBackup(page);

  // Sanity: the untampered backup decrypts cleanly.
  const okBytes = Array.from(buf);
  const valid = await page.evaluate(async ({ bytes, pass }) => {
    try {
      const plain = await window.SutraEncryptedBackups.decryptEnvelopeBytes(new Uint8Array(bytes).buffer, pass);
      return plain && plain.byteLength > 0 ? 'ok' : 'empty';
    } catch (e) { return 'THREW:' + (e.name || e.message); }
  }, { bytes: okBytes, pass: PASS });
  expect(valid).toBe('ok');

  const matrix = buildTamperMatrix(buf);
  for (const [name, tampered] of matrix) {
    const result = await page.evaluate(async ({ bytes, pass }) => {
      try {
        await window.SutraEncryptedBackups.decryptEnvelopeBytes(new Uint8Array(bytes).buffer, pass);
        return 'DECRYPTED'; // must never happen for tampered input
      } catch (e) { return 'rejected'; }
    }, { bytes: Array.from(tampered), pass: PASS });
    expect(result, `tamper category "${name}" must be rejected`).toBe('rejected');
  }
});

test('tampered .sutra through the real import flow shows an error and leaves the workspace unchanged', async ({ page }) => {
  await openApp(page);
  const buf = await makeValidBackup(page);
  await seedTitle(page, 'LocalSafe');

  // header-length tamper: magic intact so it is detected as encrypted-sutra, the
  // password modal opens, and the parser must reject it on submit with no mutation.
  const tampered = Buffer.from(buf);
  tampered.writeUInt32BE(999999, 9);

  await page.setInputFiles('#fileInput', { name: 'tampered.sutra', mimeType: 'application/octet-stream', buffer: tampered });
  await expect(page.locator('#sutraImportPasswordModal')).toHaveClass(/active/);
  await page.fill('#sutraImportPassphraseInput', PASS);
  await page.locator('#sutraImportPasswordSubmitBtn').click();
  await expect(page.locator('#sutraImportPasswordError')).toContainText(/decrypt|header|backup|invalid/i);
  await expect.poll(() => page.evaluate(() => window.serializeWorkspace().pages[0].title)).toBe('LocalSafe');
});

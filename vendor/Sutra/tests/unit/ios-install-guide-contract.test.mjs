import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const shell = readFileSync(new URL('Sutra.html', root), 'utf8');
const guide = readFileSync(new URL('src/features/workspace/ios-install-guide.js', root), 'utf8');
const guideStyles = readFileSync(new URL('styles/features/ios-install-guide.css', root), 'utf8');
const mobileStyles = readFileSync(new URL('styles/responsive/mobile.css', root), 'utf8');

test('iOS install guide is wired into the app shell and skips installed PWAs', () => {
    assert.match(shell, /styles\/features\/ios-install-guide\.css\?v=/);
    assert.match(shell, /src\/features\/workspace\/ios-install-guide\.js\?v=/);
    assert.match(guide, /navigator\.standalone === true/);
    assert.match(guide, /display-mode: standalone/);
    assert.match(guide, /Share, then choose “Add to Home Screen”/);
    assert.match(guide, /SutraSafeStorage/);
});

test('phone workspace content clears the iOS top safe area', () => {
    assert.match(mobileStyles, /\.main-content\s*\{[\s\S]*?padding-top: max\(16px, env\(safe-area-inset-top, 0px\)\) !important;/);
    assert.match(guideStyles, /safe-area-inset-bottom/);
    assert.match(guideStyles, /prefers-reduced-motion/);
});

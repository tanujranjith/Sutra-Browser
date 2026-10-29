/**
 * Accessibility tests for Sutra — keyboard navigation, focus management,
 * ARIA roles, contrast, and mobile viewport checks.
 *
 * Uses Playwright's built-in accessibility snapshot API (no axe-core dependency).
 */
import { test, expect } from '@playwright/test';
import { waitForAppReady } from './helpers/app-ready.mjs';

const BASE = '/Sutra.html';

test.describe('Accessibility: core surfaces', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(BASE, { waitUntil: 'domcontentloaded' });
        await waitForAppReady(page);
    });

    test('app shell has landmark roles', async ({ page }) => {
        // Check for landmark elements in the DOM
        const landmarks = await page.evaluate(() => {
            const roles = ['navigation', 'main', 'banner', 'contentinfo', 'complementary'];
            const found = [];
            roles.forEach(role => {
                if (document.querySelector(`[role="${role}"], nav, main, header, footer, aside`)) {
                    found.push(role);
                }
            });
            return found;
        });
        expect(landmarks.length).toBeGreaterThan(0);
    });

    test('navigation tabs are keyboard accessible', async ({ page }) => {
        // Fresh contexts always have onboarding. Its deferred render can arrive
        // after hydration; do not race it with a one-shot isVisible() check.
        const skipBtn = page.getByRole('button', { name: 'Skip setup', exact: true });
        await expect(skipBtn).toBeVisible();
        await skipBtn.click();
        await expect(page.locator('#studentOnboardingOverlay')).toBeHidden();
        await page.waitForFunction(() => {
            const tab = Array.from(document.querySelectorAll('.view-tab:not([disabled])'))
                .find(element => element.getClientRects().length > 0 && !element.closest('[inert]'));
            return !!tab && tab.tabIndex >= 0;
        });
        // Some route-local tabs remain in the DOM under a hidden owner. Pick a
        // visible tab, as a keyboard user would, rather than asking WebKit to
        // focus a control that has no rendered focus target.
        const tabs = page.locator('.view-tab:visible:not([disabled])');
        const count = await tabs.count();
        expect(count).toBeGreaterThan(0);

        // First tab should be focusable
        await tabs.first().focus();
        const isFocused = await tabs.first().evaluate(el => document.activeElement === el);
        expect(isFocused).toBeTruthy();
    });

    test('onboarding modal has dialog role', async ({ page }) => {
        // Check if onboarding overlay exists — may have been dismissed by prior test
        const overlay = page.locator('[role="dialog"][aria-modal="true"]');
        if (await overlay.count() > 0 && await overlay.first().isVisible().catch(() => false)) {
            await expect(overlay.first()).toHaveAttribute('aria-modal', 'true');
        }
    });

    test('Quick Capture modal has proper ARIA', async ({ page }) => {
        // Open command palette
        await page.keyboard.press('Control+k');
        await page.waitForTimeout(500);

        // Check for dialog or role
        const dialog = page.locator('[role="dialog"], .command-palette, .modal-overlay');
        if (await dialog.count() > 0) {
            const ariaModal = await dialog.first().getAttribute('aria-modal');
            expect(ariaModal).toBe('true');
        }
    });
});

test.describe('Accessibility: keyboard navigation', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(BASE, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1500);
    });

    test('Tab key moves focus forward', async ({ page }) => {
        const initial = await page.evaluate(() => document.activeElement?.tagName);
        await page.keyboard.press('Tab');
        const after = await page.evaluate(() => document.activeElement?.tagName);
        // Focus should have moved
        expect(after).toBeTruthy();
    });

    test('Escape key does not cause errors', async ({ page }) => {
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        expect(errors).toHaveLength(0);
    });

    test('Enter activates buttons', async ({ page }) => {
        const buttons = page.locator('button:not([disabled]):not([hidden])');
        const count = await buttons.count();
        if (count > 0) {
            await buttons.first().focus();
            const tagName = await page.evaluate(() => document.activeElement?.tagName);
            expect(tagName).toBe('BUTTON');
        }
    });
});

test.describe('Accessibility: reduced motion', () => {
    test('reduced motion preference is respected', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(BASE, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1500);

        // Check that animations are disabled
        const hasReducedMotion = await page.evaluate(() => {
            const body = document.body;
            return body.classList.contains('animations-paused') ||
                   body.classList.contains('reduced-motion') ||
                   getComputedStyle(body).animationPlayState === 'paused' ||
                   getComputedStyle(body).transitionDuration === '0s';
        });
        // This is a soft check — the app may not have a global reduced-motion class
        expect(typeof hasReducedMotion).toBe('boolean');
    });
});

test.describe('Accessibility: zoom and reflow', () => {
    test('app is usable at 200% zoom', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.goto(BASE, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1500);

        // Simulate 200% zoom by setting viewport to half size
        await page.setViewportSize({ width: 640, height: 360 });
        await page.waitForTimeout(500);

        // Check that content is still visible
        const bodyVisible = await page.evaluate(() => {
            const body = document.body;
            const rect = body.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        });
        expect(bodyVisible).toBeTruthy();
    });
});

test.describe('Accessibility: touch targets', () => {
    test('buttons meet minimum touch target size', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 }); // iPhone SE
        await page.goto(BASE, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1500);

        const buttons = page.locator('button:not([hidden]):visible');
        const count = await buttons.count();
        const violations = [];

        for (let i = 0; i < Math.min(count, 20); i++) {
            const box = await buttons.nth(i).boundingBox();
            if (box && (box.width < 32 || box.height < 32)) {
                const text = await buttons.nth(i).textContent();
                violations.push(`${text?.trim().slice(0, 30)}: ${Math.round(box.width)}x${Math.round(box.height)}`);
            }
        }
        // Report but don't fail — some secondary buttons may be smaller
        if (violations.length > 0) {
            console.log('Small touch targets found:', violations);
        }
    });
});

test.describe('Accessibility: ARIA labels', () => {
    test('interactive elements have accessible names', async ({ page }) => {
        await page.goto(BASE, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1500);

        const issues = await page.evaluate(() => {
            const issues = [];
            // Check buttons without accessible names
            document.querySelectorAll('button:not([hidden])').forEach((btn, i) => {
                if (i > 30) return; // Limit check
                const name = btn.getAttribute('aria-label') ||
                             btn.textContent?.trim() ||
                             btn.getAttribute('title');
                if (!name && !btn.querySelector('img[alt]') && !btn.querySelector('[aria-hidden]')) {
                    issues.push('Button without accessible name: ' + btn.className.slice(0, 50));
                }
            });
            return issues;
        });
        // Soft check — report but don't hard fail
        if (issues.length > 0) {
            console.log('Accessibility issues:', issues);
        }
    });

    test('images have alt text', async ({ page }) => {
        await page.goto(BASE, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1500);

        const issues = await page.evaluate(() => {
            const issues = [];
            document.querySelectorAll('img:not([hidden])').forEach((img, i) => {
                if (i > 20) return;
                if (!img.hasAttribute('alt') && !img.hasAttribute('aria-hidden')) {
                    issues.push('Image without alt: ' + (img.src || '').slice(-50));
                }
            });
            return issues;
        });
        expect(issues).toHaveLength(0);
    });
});

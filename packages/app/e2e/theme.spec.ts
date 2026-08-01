/**
 * Requirement 5 — the theme toggle must flip the document's theme marker and
 * leave a working page behind (both ways), including on a phase route where a
 * themed CodeMirror/graph lives.
 */
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { expectPageAlive, waitForTrace } from './helpers';

/** Whatever the app uses to mark the theme: the class list plus data-theme. */
async function themeMarker(page: Page): Promise<string> {
  return page.evaluate(() => {
    const root = document.documentElement;
    return `${root.className}|${root.dataset['theme'] ?? ''}`;
  });
}

async function canvasColor(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

const toggle = (page: Page) =>
  page.getByRole('button', { name: /Switch to (dark|light) theme/ });

test.describe('theme toggle', () => {
  test('starts dark regardless of the OS preference, and toggles both ways', async ({ page }) => {
    // The Playwright config runs with colorScheme: 'light'. Dark is the app's
    // unconditional default for a first-time reader, so the OS preference must
    // NOT decide it — only a stored choice can.
    await page.goto('/');
    await expectPageAlive(page);

    const initialMarker = await themeMarker(page);
    const initialColor = await canvasColor(page);
    expect(initialMarker, 'dark is the default even under prefers-color-scheme: light')
      .toContain('dark');

    // → light
    await toggle(page).click();
    await expect
      .poll(async () => themeMarker(page), { message: 'the root should be back to light' })
      .not.toContain('dark');
    await expect(toggle(page)).toHaveAccessibleName(/Switch to dark theme/);
    const lightColor = await canvasColor(page);
    expect(lightColor, 'light mode should repaint the canvas').not.toBe(initialColor);
    await expectPageAlive(page);

    // → back to dark
    await toggle(page).click();
    await expect
      .poll(async () => themeMarker(page), { message: 'the root should be marked dark' })
      .toContain('dark');
    await expect.poll(async () => canvasColor(page)).toBe(initialColor);
    await expectPageAlive(page);
  });

  test('the theme survives navigation into a phase route', async ({ page }) => {
    await page.goto('/');
    // Start from light so the assertion below proves the CHOICE persisted,
    // rather than passing because dark happens to be the default.
    await toggle(page).click();
    await expect.poll(async () => themeMarker(page)).not.toContain('dark');

    await page.locator('header a[href="/syntax"]').click();
    await page.waitForURL(/\/syntax/);
    await waitForTrace(page, 1);
    await expectPageAlive(page);
    expect(await themeMarker(page), 'the chosen light theme must survive the route change')
      .not.toContain('dark');

    await toggle(page).click();
    await expect.poll(async () => themeMarker(page)).toContain('dark');
    await expectPageAlive(page);
  });
});

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
  test('switches to dark and back, and the page keeps rendering', async ({ page }) => {
    await page.goto('/');
    await expectPageAlive(page);

    const initialMarker = await themeMarker(page);
    const initialColor = await canvasColor(page);
    expect(initialMarker).not.toContain('dark');

    // → dark
    await toggle(page).click();
    await expect
      .poll(async () => themeMarker(page), { message: 'the root should be marked dark' })
      .toContain('dark');
    await expect(toggle(page)).toHaveAccessibleName(/Switch to light theme/);
    const darkColor = await canvasColor(page);
    expect(darkColor, 'dark mode should repaint the canvas').not.toBe(initialColor);
    await expectPageAlive(page);

    // → back to light
    await toggle(page).click();
    await expect
      .poll(async () => themeMarker(page), { message: 'the root should be back to light' })
      .not.toContain('dark');
    await expect
      .poll(async () => canvasColor(page))
      .toBe(initialColor);
    await expectPageAlive(page);
  });

  test('the theme survives navigation into a phase route', async ({ page }) => {
    await page.goto('/');
    await toggle(page).click();
    await expect.poll(async () => themeMarker(page)).toContain('dark');

    await page.locator('header a[href="/syntax"]').click();
    await page.waitForURL(/\/syntax/);
    await waitForTrace(page, 1);
    await expectPageAlive(page);
    expect(await themeMarker(page)).toContain('dark');

    await toggle(page).click();
    await expect.poll(async () => themeMarker(page)).not.toContain('dark');
    await expectPageAlive(page);
  });
});

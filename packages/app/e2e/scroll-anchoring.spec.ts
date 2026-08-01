/**
 * Regression: playback must not steal the reader's scroll position.
 *
 * CodeStrip keeps the current step's span visible, but `EditorView.scrollIntoView`
 * walks UP the DOM and scrolls ancestor scrollers too. The source strip is short
 * enough never to overflow internally, so every step scrolled the *window* to
 * re-centre it — a reader who scrolled down to watch the token stream fill in was
 * yanked back to the source panel on the next tick, roughly twice a second.
 */
import { test, expect } from './fixtures';
import { compileAndWaitForAllStagesOk } from './helpers';

test.describe('playback and scroll position', () => {
  test('watching the token stream during playback does not yank the page back to the source', async ({
    page,
  }) => {
    await page.goto('/');
    await compileAndWaitForAllStagesOk(page);

    // Navigate by chip: a full page load would drop the in-memory compilation.
    await page.locator('a[href="/lex"]').first().click();
    await page.locator('button', { hasText: /^Tokenize$/ }).first().click();
    await page.locator('button', { hasText: /^Tokens & symbols/ }).first().click();

    const scrubber = page.locator('[role="slider"]').first();
    await expect(scrubber).toBeVisible();

    await page.locator('button[aria-label^="Play"]').first().click();
    await expect
      .poll(async () => Number(await scrubber.getAttribute('aria-valuenow')))
      .toBeGreaterThan(0);

    // The reader scrolls down to the token stream...
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const parked = await page.evaluate(() => window.scrollY);
    expect(parked, 'page must be tall enough to scroll for this test to mean anything')
      .toBeGreaterThan(100);

    // ...and keeps watching several more steps land.
    const before = Number(await scrubber.getAttribute('aria-valuenow'));
    await expect
      .poll(async () => Number(await scrubber.getAttribute('aria-valuenow')), { timeout: 10_000 })
      .toBeGreaterThan(before + 2);

    // The scroll position is the reader's, not the app's.
    const now = await page.evaluate(() => window.scrollY);
    expect(Math.abs(now - parked)).toBeLessThan(40);
  });
});

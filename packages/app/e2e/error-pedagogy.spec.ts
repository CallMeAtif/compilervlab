/**
 * Requirement 6 — errors are teaching material, not stack traces.
 *
 * The deliberate type-error example must compile into diagnostic cards that
 * carry the rule that was broken and its position, must stop the pipeline at
 * the phase that failed, and clicking a card must highlight the offending span
 * in the editor.
 */
import { test, expect } from './fixtures';
import {
  chip,
  compile,
  expectPageAlive,
  pickExample,
  playButton,
  seekToEnd,
  setSpeed,
  stepIndex,
  waitForTrace,
} from './helpers';

test.describe('error pedagogy', () => {
  test('the deliberate type error produces cited diagnostic cards', async ({ page }) => {
    await page.goto('/');
    await pickExample(page, /type error \(deliberate\)/);
    await compile(page);

    // The failing phase reports errors; the phases downstream never ran.
    await expect(chip(page, '/semantic')).toHaveAttribute('aria-label', /has errors|error/i);
    await expect(chip(page, '/lex')).toHaveAttribute('aria-label', /up to date|complete/i);
    await expect(chip(page, '/ir')).toHaveAttribute('aria-label', /not yet compiled|pending/i);
    await expect(chip(page, '/codegen')).toHaveAttribute('aria-label', /not yet compiled|pending/i);

    const diagnostics = page.getByRole('region', { name: 'Diagnostics' });
    const cards = diagnostics.getByRole('button');
    await expect(cards).toHaveCount(2);

    // Card 1: the message, its position, AND the rule it cites.
    const pointerCard = cards.filter({ hasText: /pointer arithmetic/ });
    await expect(pointerCard).toHaveCount(1);
    await expect(pointerCard).toContainText(/line \d+:\d+/);
    await expect(pointerCard).toContainText(/no pointer arithmetic in the subset/i);

    // Card 2: use before declaration, with its rule too.
    const scopeCard = cards.filter({ hasText: /before any declaration is in scope/ });
    await expect(scopeCard).toHaveCount(1);
    await expect(scopeCard).toContainText(/declaration before use/i);

    await expectPageAlive(page);
  });

  test('clicking a diagnostic highlights the offending source span', async ({ page }) => {
    await page.goto('/');
    await pickExample(page, /type error \(deliberate\)/);
    await compile(page);

    const card = page
      .getByRole('region', { name: 'Diagnostics' })
      .getByRole('button')
      .filter({ hasText: /pointer arithmetic/ });
    await expect(card).toHaveCount(1);

    // Nothing is selected in the editor before the click.
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');

    await card.click();

    // CodeMirror puts the diagnostic's span into the document selection and
    // focuses the editor — `p + f` is the offending expression on line 8.
    await expect
      .poll(async () => page.evaluate(() => window.getSelection()?.toString() ?? ''), {
        message: 'the offending span should be selected in the editor',
      })
      .toBe('p + f');
    await expect(page.locator('.cm-editor')).toHaveClass(/cm-focused/);
    // And the selection is actually painted.
    await expect(page.locator('.cm-selectionBackground').first()).toBeVisible();
  });

  test('the semantic phase page presents the same errors as teaching cards', async ({ page }) => {
    await page.goto('/');
    await pickExample(page, /type error \(deliberate\)/);
    await compile(page);
    await chip(page, '/semantic').click();
    await page.waitForURL(/\/semantic/);

    await expectPageAlive(page);
    // The phase header carries the failure, and the route's own Errors tab
    // (badged with the count) holds the cards.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Semantic Analysis/);
    await expect(page.getByText('2 errors').first()).toBeVisible();

    await page.getByRole('tab', { name: /^Errors/ }).click();
    // The cards appear as the recorded pass reaches them, so run to the end.
    await waitForTrace(page, 10);
    await seekToEnd(page);
    await expect(page.getByText(/2 of 2 reported/)).toBeVisible();
    await expect(page.getByText(/pointer arithmetic/).first()).toBeVisible();
    await expect(page.getByText(/Rule 5: no pointer arithmetic in the subset/)).toBeVisible();
    await expect(page.getByText(/before any declaration is in scope/).first()).toBeVisible();
    await expect(page.getByText(/declaration before use/).first()).toBeVisible();
  });

  /**
   * REGRESSION GUARD — this was a real defect, fixed in `lib/useStepper.ts`.
   *
   * `DiagnosticsPane.tsx` promises "Playback stops on each error — errors are
   * pedagogical stopping points", and PLAN.md says the same, but semantic
   * playback ran straight to the last step: `isErrorEvent` recognised an error
   * step only by a `kind` containing "error", while the semantic pass emits its
   * errors as `{ kind: 'diagnostic' }` (core/src/sem/sem-events.ts). It now also
   * recognises a `diagnostic` event whose severity is `error` (warnings stay
   * advisory and do not stop playback).
   *
   * Before the fix: play at 4× from step 0 walked 2 → 25 ("1 of 2 reported") →
   * 33 ("2 of 2") → 39 and only then stopped, never pausing on either error.
   */
  test('playback stops on the error step instead of running past it', async ({ page }) => {
    await page.goto('/');
    await pickExample(page, /type error \(deliberate\)/);
    await compile(page);
    await chip(page, '/semantic').click();
    await page.waitForURL(/\/semantic/);
    await page.getByRole('tab', { name: /^Errors/ }).click();

    const total = await waitForTrace(page, 10);
    await setSpeed(page, '4');
    await playButton(page).click();

    // The first diagnostic surfaces and playback halts there — errors are
    // stopping points, not crashes (PLAN.md).
    await expect(page.getByText(/1 of 2 reported/)).toBeVisible({ timeout: 60_000 });
    await expect(playButton(page), 'playback should have stopped itself').toBeVisible();

    const stopped = await stepIndex(page);
    expect(stopped, 'it should stop before the end of the trace').toBeLessThan(total);
    // Proving it STAYED stopped needs a wait: >2 ticks at 4× (175 ms each).
    await page.waitForTimeout(1_000);
    expect(await stepIndex(page)).toBe(stopped);
  });
});

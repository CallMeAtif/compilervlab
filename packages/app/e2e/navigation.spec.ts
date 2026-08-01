/**
 * Cross-route navigation.
 *
 * The passing test here is the plain contract: the six chips move you between
 * phases and the compiled program survives. The `fixme` below it is a REAL,
 * reproducible app bug this suite found — it is written as an executable repro
 * so that whoever fixes `lib/urlState.ts` can delete the `.fixme` and watch it
 * go green.
 */
import { test, expect } from './fixtures';
import {
  PHASE_PATHS,
  chip,
  compileAndWaitForAllStagesOk,
  expectPageAlive,
  gotoPhase,
  nextButton,
  waitForTrace,
  waitForUrlSettled,
} from './helpers';

test('the top-bar chips move between all six phases and keep the compilation', async ({
  page,
}) => {
  test.slow();
  await page.goto('/');
  await compileAndWaitForAllStagesOk(page);

  for (const path of PHASE_PATHS) {
    await gotoPhase(page, path);
    await expect(page).toHaveURL(new RegExp(`${path}(\\?|$)`));
    await expectPageAlive(page);
    // The stage summary is still there, so the store survived the route swap.
    await expect(chip(page, path)).toHaveAttribute('aria-label', /up to date|complete/i);
  }
});

/**
 * REGRESSION GUARD — this was a real defect, fixed in `lib/urlState.ts` by
 * dropping a debounced write whose scheduling pathname is no longer the one on
 * screen when the timer fires.
 *
 * The defect: stepping and then immediately clicking another phase bounced you
 * straight back to the phase you left.
 *
 *   1. `?step=` is written through a 250 ms debounce (`WRITE_DEBOUNCE_MS` in
 *      packages/app/src/lib/urlState.ts), so a click on "next" leaves a timer
 *      pending.
 *   2. Clicking a phase chip pushes the new path, but the new route is a lazy
 *      chunk: React keeps the OLD route mounted while the transition suspends.
 *   3. The pending timer fires inside that still-mounted old route and calls
 *      `setSearchParams(…, { replace: true })`, which resolves against the OLD
 *      pathname — replacing the just-pushed entry. The URL goes back and the
 *      navigation is silently abandoned.
 *
 * Repro below is deterministic: delaying the next JS chunk by 900 ms makes the
 * suspended window wider than the debounce. Observed 3/3 (and intermittently in
 * the console-hygiene tour under parallel load, which is how it was found):
 * URL right after the click `/ir`, three seconds later `/semantic?step=1`,
 * with the Semantic page still on screen.
 *
 */
test('leaving a phase right after stepping does not bounce back', async ({ page }) => {
  await page.goto('/');
  await compileAndWaitForAllStagesOk(page);
  await gotoPhase(page, '/semantic');
  await waitForTrace(page, 5);

  // Make the next route's chunk slow, so its transition is still pending when
  // the debounced ?step= write fires.
  await page.route(/\/assets\/.*\.js$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 900));
    await route.continue();
  });

  await nextButton(page).click();
  await chip(page, '/ir').click();
  await expect(page).toHaveURL(/\/ir(\?|$)/);

  await waitForUrlSettled(page);
  await expect(page).toHaveURL(/\/ir(\?|$)/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Intermediate Code/);
});

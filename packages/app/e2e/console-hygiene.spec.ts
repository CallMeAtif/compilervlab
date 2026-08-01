/**
 * Requirement 7 — the browser console must stay clean.
 *
 * The guard itself lives in `fixtures.ts` and applies to EVERY test in this
 * directory; this spec adds the walk that touches everything in one session
 * (compile → all six phases → theme flip → back to the overview), which is
 * where cross-route leaks (double-mounted workers, effects firing after
 * unmount, missing keys in a list that only renders after a step) show up.
 */
import { test, expect } from './fixtures';
import {
  PHASE_PATHS,
  compileAndWaitForAllStagesOk,
  expectPageAlive,
  gotoPhase,
  nextButton,
  stepControls,
  waitForTrace,
} from './helpers';

test('a full tour of the lab leaves the console clean', async ({ page }) => {
  test.slow(); // six lazy routes, six traces, one browser

  await page.goto('/');
  await compileAndWaitForAllStagesOk(page);

  for (const path of PHASE_PATHS) {
    await gotoPhase(page, path);
    await expectPageAlive(page);
    // Touch the transport on each route: a stale effect usually screams here.
    await waitForTrace(page, 1);
    await nextButton(page).click();
    await expect(stepControls(page)).toBeVisible();
    // No wait for the debounced ?step= write here on purpose: leaving a route
    // with a write still in flight is exactly the race navigation.spec.ts
    // covers, and this tour should keep exercising it.
  }

  const themeToggle = page.getByRole('button', { name: /Switch to (dark|light) theme/ });
  await themeToggle.click();
  await themeToggle.click();

  await page.locator('header a[href="/"]').first().click();
  await page.waitForURL(/\/$/);
  await expectPageAlive(page);
  // Back on the overview the compiled program is still there.
  await expect(page.locator('main a[href="/lex"]')).toContainText(/tokens/);
});

/**
 * Requirement 4 — a pasted URL must restore the view.
 *
 * Every case is a FULL page load (not client-side navigation): the algorithm
 * selection, the phase-specific params and the `?step=` cursor all have to come
 * back from the query string alone. Each deep link is compared against the same
 * view at step 0, so "seeked" is proven by the rendering, not just the counter.
 */
import { test, expect } from './fixtures';
import {
  expectPageAlive,
  expectStep,
  stableVizText,
  stepCount,
  waitForTrace,
} from './helpers';

test.describe('deep links', () => {
  test('/lex restores the construction stage, the token class and the step', async ({
    page,
  }) => {
    // Baseline: the same view at the start of the trace.
    await page.goto('/lex?tab=constructions&algo=subset&class=intconst&step=0');
    await waitForTrace(page, 20);
    await expectStep(page, 0);
    const atStart = await stableVizText(page);

    await page.goto('/lex?tab=constructions&algo=subset&class=intconst&step=8');
    await expectPageAlive(page);
    await waitForTrace(page, 20);

    // The algorithm: the phase header tab and the construction-stage chain
    // (marked with aria-current="step") must both point at subset construction.
    await expect(
      page.getByRole('tab', { name: 'Subset construction', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
    await expect(
      page.getByRole('button', { name: /Subset construction/ }).first(),
    ).toHaveAttribute('aria-current', 'step');
    // The phase-specific param: which token class is being constructed.
    await expect(page.getByRole('radio', { name: /intconst/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    // The cursor.
    await expectStep(page, 8);
    expect(await stableVizText(page), 'the deep link did not seek anywhere').not.toBe(atStart);
  });

  test('/syntax restores the algorithm and the step', async ({ page }) => {
    await page.goto('/syntax?grammar=dragon-4.1&algo=lr0&step=0');
    await waitForTrace(page, 20);
    const atStart = await stableVizText(page);

    await page.goto('/syntax?grammar=dragon-4.1&algo=lr0&step=20');
    await expectPageAlive(page);
    const total = await waitForTrace(page, 20);
    expect(total).toBeGreaterThanOrEqual(20);

    await expect(page.getByRole('tab', { name: 'LR(0) items', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('heading', { name: 'Canonical LR(0) collection' })).toBeVisible();
    await expectStep(page, 20);
    expect(await stableVizText(page), 'the deep link did not seek anywhere').not.toBe(atStart);
    // Mid-trace, states have actually been built.
    await expect(page.locator('.react-flow__node')).not.toHaveCount(0);
  });

  test('/syntax restores an algorithm sub-view (?view=table) as well', async ({ page }) => {
    await page.goto('/syntax?grammar=dragon-4.55&algo=lr1&view=table&step=12');
    await expectPageAlive(page);
    await waitForTrace(page, 12);

    await expect(page.getByRole('tab', { name: 'LR(1) items', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('heading', { name: /Canonical LR\(1\) ACTION \/ GOTO/ })).toBeVisible();
    await expectStep(page, 12);
    expect(await stepCount(page)).toBeGreaterThan(12);
  });

  test('an out-of-range ?step= is clamped instead of breaking the view', async ({ page }) => {
    await page.goto('/syntax?grammar=dragon-4.1&algo=lr0&step=99999');
    await expectPageAlive(page);
    const total = await waitForTrace(page, 20);
    await expectStep(page, total);
  });
});

/**
 * The one honest link between the constructions and the reader's own program.
 *
 * Thompson / subset / minimization build the recognizer for a token PATTERN, so
 * they are identical for every program — that is correct and must stay correct.
 * What IS the reader's is the path: picking one of their own lexemes walks the
 * already-built DFA over it and lights that path up in the graph.
 *
 * `[data-current]` on a laid-out node and `.elk-edge-current` on an edge are
 * ElkGraph's own emphasis contract (components/viz/ElkGraph.tsx), which is why
 * they are the thing asserted on: "the drawing responded" has no ARIA form.
 */
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { compileAndWaitForAllStagesOk, gotoPhase, waitForTrace } from './helpers';

/** States and transitions the graph is currently drawing as "the current thing". */
async function highlighted(page: Page): Promise<{ nodes: number; edges: number }> {
  return page.evaluate(() => ({
    nodes: document.querySelectorAll('.react-flow__node [data-current="true"]').length,
    edges: document.querySelectorAll('.react-flow__edge.elk-edge-current').length,
  }));
}

test.describe('running your own lexeme through the constructed DFA', () => {
  test('a picked lexeme writes its walk and lights its path in the DFA', async ({ page }) => {
    await page.goto('/');
    await compileAndWaitForAllStagesOk(page);
    await gotoPhase(page, '/lex');

    await page.getByRole('tab', { name: 'DFA minimization' }).click();
    await waitForTrace(page, 1);

    // The chips are the program's own intconst lexemes (the default class).
    const chips = page.getByRole('radiogroup', { name: /lexemes from your program/ });
    await expect(chips).toBeVisible();
    const lexemes = chips.getByRole('radio');
    await expect.poll(async () => lexemes.count()).toBeGreaterThan(0);
    const first = lexemes.first();
    await expect(first).toHaveAttribute('aria-checked', 'false');

    // Nothing is walked until the reader asks for it.
    const walk = page.locator('[role="status"]').filter({ hasText: /accepted at|rejected/ });
    await expect(walk).toHaveCount(0);
    await expect.poll(async () => (await highlighted(page)).edges).toBe(0);

    await first.click();

    // The walk: state, consuming character, state — ending in an outcome.
    await expect(first).toHaveAttribute('aria-checked', 'true');
    await expect(walk.first()).toContainText(/accepted at \w+ · \d+ char/);

    // …and the same path is the current thing in the graph above.
    await expect
      .poll(async () => (await highlighted(page)).edges, {
        message: 'the picked lexeme should light its transitions in the DFA',
      })
      .toBeGreaterThan(0);
    expect((await highlighted(page)).nodes).toBeGreaterThan(1);

    // The selection is the reader's, so it is theirs to drop.
    await page.getByRole('button', { name: 'clear' }).click();
    await expect(first).toHaveAttribute('aria-checked', 'false');
    await expect(walk).toHaveCount(0);
    await expect.poll(async () => (await highlighted(page)).edges).toBe(0);
  });
});

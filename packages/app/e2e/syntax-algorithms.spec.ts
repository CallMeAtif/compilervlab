/**
 * Requirement 3 — /syntax offers ten selectable algorithms and every one of
 * them must draw a real view, not an empty pane or a crash.
 *
 * The ten are switched by CLICKING the algorithm tabs (a dead tab is exactly
 * the failure this suite exists to catch), on Grammar 4.28 — the one study
 * grammar every algorithm in the family can actually run on (Grammar 4.1 is
 * left-recursive, so the two top-down parsers correctly refuse it).
 *
 * Plus the two documented special cases on the real C grammar:
 *   • canonical LR(1) item sets → the truncation banner,
 *   • the canonical LR(1) table → the "this is why LALR exists" explanation.
 */
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import {
  expectPageAlive,
  seekToEnd,
  stepControls,
  stepCount,
  waitForTrace,
  waitForUrlSettled,
} from './helpers';

interface AlgoCase {
  /** Tab label (the accessible name of the tab button). */
  tab: string;
  /** ?algo= value the click must write. */
  param: string;
  /** What must be on screen once the view has rendered. */
  check: (page: Page) => Promise<void>;
}

const heading = (page: Page, name: string | RegExp) =>
  expect(page.getByRole('heading', { name })).toBeVisible();

const graphNodes = (page: Page) => page.locator('.react-flow__node');

const ALGORITHMS: readonly AlgoCase[] = [
  {
    tab: 'FIRST / FOLLOW',
    param: 'first-follow',
    check: async (page) => {
      await heading(page, 'FIRST sets');
      await heading(page, 'FOLLOW sets');
      await expect.poll(async () => page.getByRole('row').count()).toBeGreaterThan(5);
    },
  },
  {
    tab: 'Grammar transforms',
    param: 'transforms',
    check: async (page) => {
      await heading(page, 'Productions');
      await expect.poll(async () => page.getByRole('row').count()).toBeGreaterThan(5);
    },
  },
  {
    tab: 'LL(1) table',
    param: 'll1-table',
    check: async (page) => {
      await heading(page, 'M[A, a]');
      await heading(page, /Conflicts/);
    },
  },
  {
    tab: 'LL(1) parse',
    param: 'll1-parse',
    check: async (page) => {
      await heading(page, /Moves \(Fig 4\.21\)/);
      await heading(page, 'Parse tree');
    },
  },
  {
    tab: 'Recursive descent',
    param: 'rd',
    check: async (page) => {
      await heading(page, 'Call tree');
      await heading(page, 'Call stack');
    },
  },
  {
    tab: 'LR(0) items',
    param: 'lr0',
    check: async (page) => {
      await heading(page, 'Canonical LR(0) collection');
      await expect.poll(async () => graphNodes(page).count()).toBeGreaterThan(5);
    },
  },
  {
    tab: 'SLR(1)',
    param: 'slr',
    check: async (page) => {
      await heading(page, /SLR\(1\) ACTION \/ GOTO/);
      await heading(page, 'FOLLOW sets');
    },
  },
  {
    tab: 'LR(1) items',
    param: 'lr1',
    check: async (page) => {
      await heading(page, 'Canonical LR(1) collection');
      await expect.poll(async () => graphNodes(page).count()).toBeGreaterThan(5);
    },
  },
  {
    tab: 'LALR(1)',
    param: 'lalr',
    check: async (page) => {
      await heading(page, /Merging same-core LR\(1\) states/);
      await heading(page, /LALR\(1\) ACTION \/ GOTO/);
      await expect.poll(async () => graphNodes(page).count()).toBeGreaterThan(5);
    },
  },
  {
    tab: 'LR parse',
    param: 'lr-parse',
    check: async (page) => {
      await heading(page, /Configurations \(Fig 4\.38\)/);
      await heading(page, 'Parse forest');
    },
  },
];

test.describe('/syntax algorithm switching', () => {
  test('every one of the ten algorithms renders a real view', async ({ page }) => {
    await page.goto('/syntax?grammar=dragon-4.28');
    await expectPageAlive(page);

    for (const algo of ALGORITHMS) {
      await test.step(algo.tab, async () => {
        const tab = page.getByRole('tab', { name: algo.tab, exact: true });
        await tab.click();
        await expect(tab).toHaveAttribute('aria-selected', 'true');
        await expect(page).toHaveURL(new RegExp(`algo=${algo.param.replace(/[()]/g, '\\$&')}`));

        // Every algorithm here replays a recorded trace with real steps.
        const steps = await waitForTrace(page, 1);
        expect(steps, `${algo.tab} recorded no steps`).toBeGreaterThan(0);
        await algo.check(page);
        await expectPageAlive(page);
      });
    }
  });

  test('the algorithm survives a full-page reload of its deep link', async ({ page }) => {
    await page.goto('/syntax?grammar=dragon-4.28&algo=lalr');
    await expect(page.getByRole('tab', { name: 'LALR(1)', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('heading', { name: /LALR\(1\) ACTION \/ GOTO/ })).toBeVisible();
    await waitForTrace(page, 1);
  });
});

test.describe('/syntax on the real C grammar', () => {
  test('canonical LR(1) item sets stop at the cap and say why', async ({ page }) => {
    await page.goto('/syntax?grammar=c-subset&algo=lr1');
    await expectPageAlive(page);

    const banner = page
      .getByRole('status')
      .filter({ hasText: /Truncated at \d+ LR\(1\) states/ });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/why LALR exists/i);
    // It is a truncated but REAL trace, not an error state.
    const steps = await waitForTrace(page, 100);
    expect(steps).toBeGreaterThan(100);
    await expect(page.getByRole('heading', { name: 'Canonical LR(1) collection' })).toBeVisible();
  });

  test('the canonical LR(1) table explains itself instead of crashing', async ({ page }) => {
    await page.goto('/syntax?grammar=c-subset&algo=lr1&view=table');
    await expectPageAlive(page);

    await expect(
      page.getByText(/canonical LR\(1\) table cannot be built from a truncated collection/i),
    ).toBeVisible();
    await expect(page.getByText(/state cap/i).first()).toBeVisible();
    await expect(page.getByText(/LALR\(1\) merges the same-core states/i)).toBeVisible();
    // No trace, and therefore no transport controls — but the page is alive.
    await expect(stepControls(page)).toHaveCount(0);

    // The escape hatch it offers must actually work.
    await page.getByRole('button', { name: /Build the LALR\(1\) table instead/i }).click();
    await expect(page).toHaveURL(/algo=lalr/);
    await expect(page.getByRole('heading', { name: /LALR\(1\) ACTION \/ GOTO/ })).toBeVisible({
      timeout: 60_000,
    });
    expect(await stepCount(page)).toBeGreaterThan(0);
  });
});

/**
 * The left-recursion loop must CLOSE.
 *
 * Refusing a left-recursive grammar is correct (§4.3.3) and stays. What is not
 * acceptable is stranding the reader in the transform view with no way to parse
 * anything: the refusal offers Algorithm 4.19, the transform view plays it, and
 * at the last step it hands back a grammar the predictive parser accepts. This
 * walks the whole path and only believes it at `accept`.
 */
test.describe('/syntax left recursion → transform → a parse that accepts', () => {
  test('Grammar 4.1 refuses, Algorithm 4.19 runs, Grammar 4.28 parses to accept', async ({
    page,
  }) => {
    await page.goto('/syntax?grammar=dragon-4.1&algo=ll1-parse');
    await expectPageAlive(page);

    // 1. The refusal is still there, and says why.
    await expect(
      page.getByRole('heading', { name: 'Left recursive. No predictive parse can run on it.' }),
    ).toBeVisible();
    await expect(page.getByText(/derive themselves leftmost \(E, T\)/)).toBeVisible();
    // Nothing to step: the parser never ran.
    await expect(stepControls(page)).toHaveCount(0);

    // 2. The button's label names its destination — the transform, not a parse.
    await page.getByRole('button', { name: /^Watch Algorithm 4\.19/ }).click();
    await expect(page).toHaveURL(/algo=transforms/);
    await expect(page).toHaveURL(/from=ll1-parse/);
    await expect(page.getByRole('heading', { name: 'Productions' })).toBeVisible();
    await waitForTrace(page, 1);

    // 3. Step it to the end; only then is the rewritten grammar offered.
    await expect(page.getByRole('button', { name: /^Parse with/ })).toHaveCount(0);
    await seekToEnd(page);
    await expect(page.getByText('Transform complete')).toBeVisible();
    await expect(page.getByText('Grammar 4.28 is Grammar 4.1 after Algorithm 4.19.')).toBeVisible();

    // 4. It lands on the algorithm that refused, on a grammar that can run it.
    await page.getByRole('button', { name: /^Parse with Grammar 4\.28/ }).click();
    await expect(page).toHaveURL(/grammar=dragon-4\.28/);
    await expect(page).toHaveURL(/algo=ll1-parse/);
    // The grammar change is visible, not silent.
    await expect(page.getByRole('combobox', { name: 'Grammar' })).toContainText('Grammar 4.28');
    await expect(page.getByRole('heading', { name: /Left recursive/ })).toHaveCount(0);

    // 5. The sentence the refusal could not parse now reaches accept.
    await page.getByRole('textbox', { name: /Sentence to parse/ }).fill('id * id + id');
    await page.getByRole('button', { name: 'Parse this sentence' }).click();
    await waitForTrace(page, 1);
    await seekToEnd(page);
    await expect(page.getByRole('heading', { name: /Moves \(Fig 4\.21\)/ })).toBeVisible();
    await expect(
      page.locator('section[aria-label="Moves (Fig 4.21)"]').getByText(/accepted/),
    ).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Accepted' })).toBeVisible();
    expect(await stepCount(page)).toBe(17);

    // 6. The URL that produced it reproduces it.
    await waitForUrlSettled(page);
    const url = page.url();
    await page.goto(url);
    await expect(page.getByRole('combobox', { name: 'Grammar' })).toContainText('Grammar 4.28');
    await expect(page.getByRole('status').filter({ hasText: 'Accepted' })).toBeVisible();
  });

  test('the recursive-descent refusal returns to recursive descent', async ({ page }) => {
    await page.goto('/syntax?grammar=dragon-4.1&algo=rd');
    await expect(
      page.getByRole('heading', { name: /Left recursive\. No recursive-descent parser/ }),
    ).toBeVisible();

    await page.getByRole('button', { name: /^Watch Algorithm 4\.19/ }).click();
    await expect(page).toHaveURL(/from=rd/);
    await waitForTrace(page, 1);
    await seekToEnd(page);

    await page.getByRole('button', { name: /^Parse with Grammar 4\.28/ }).click();
    await expect(page).toHaveURL(/algo=rd/);
    await expect(page).toHaveURL(/grammar=dragon-4\.28/);
    await expect(page.getByRole('heading', { name: 'Call tree' })).toBeVisible();
    expect(await waitForTrace(page, 1)).toBeGreaterThan(0);
  });
});

/**
 * Requirement 2 — every one of the six phase routes must actually draw its
 * artifact and must be steppable.
 *
 * For each route: navigate (client-side, so the compiled program survives),
 * prove the visualization rendered REAL content (graph nodes / table rows /
 * tree nodes — never an empty container), then drive the transport: next
 * advances the counter AND redraws, prev goes back, play advances on its own
 * and then stops, reset returns to step 0 and to the step-0 picture.
 */
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import {
  compileAndWaitForAllStagesOk,
  expectPageAlive,
  expectStep,
  expectVizChanged,
  gotoPhase,
  nextButton,
  pauseButton,
  playButton,
  prevButton,
  resetButton,
  stableVizSignature,
  stableVizText,
  vizTextSignature,
  stepIndex,
  waitForTrace,
  type PhasePath,
} from './helpers';

interface PhaseCase {
  path: PhasePath;
  title: RegExp;
  /** Optional clicks to reach a view worth stepping (long enough trace). */
  prepare?: (page: Page) => Promise<void>;
  /** Proof that the artifact drawing is real, not an empty shell. */
  rendered: (page: Page) => Promise<void>;
  /** The trace behind the default view must be at least this long. */
  minSteps: number;
}

/**
 * `.react-flow__node` is React Flow's own public DOM contract (the app renders
 * automata/CFGs through it); counting them is the only way to tell "graph with
 * states" from "empty canvas".
 */
const graphNodes = (page: Page) => page.locator('.react-flow__node');

const PHASES: readonly PhaseCase[] = [
  {
    path: '/lex',
    title: /Lexical Analysis/,
    // Default tab: the regex → NFA construction for `intconst` (digit digit*).
    rendered: async (page) => {
      await expect(page.getByRole('heading', { name: /NFA under construction/i })).toBeVisible();
      // Thompson's construction for `digit digit*` is 77 states; anything
      // under ten means the graph did not render.
      await expect.poll(async () => graphNodes(page).count()).toBeGreaterThan(10);
      await expect(page.locator('main').getByText(/NFA states/i).first()).toBeVisible();
    },
    minSteps: 10,
  },
  {
    path: '/syntax',
    title: /Syntax Analysis/,
    // Default: FIRST/FOLLOW over Grammar 4.1 — two real fixpoint tables.
    rendered: async (page) => {
      await expect(page.getByRole('heading', { name: 'FIRST sets' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'FOLLOW sets' })).toBeVisible();
      await expect.poll(async () => page.getByRole('row').count()).toBeGreaterThan(5);
      // The production rail shows Grammar 4.1 itself.
      await expect(page.getByText('E → E + T', { exact: true })).toBeVisible();
    },
    minSteps: 10,
  },
  {
    path: '/semantic',
    title: /Semantic Analysis/,
    rendered: async (page) => {
      const ast = page.getByRole('region', { name: 'Annotated AST' });
      await expect(ast).toBeVisible();
      // The gcd program's AST: the two functions must be drawn as tree nodes.
      await expect(ast.getByText('fn gcd', { exact: true })).toBeVisible();
      await expect(ast.getByText('fn main', { exact: true })).toBeVisible();
      await expect
        .poll(async () => page.locator('main svg text').count())
        .toBeGreaterThan(20);
    },
    minSteps: 10,
  },
  {
    path: '/ir',
    title: /Intermediate Code/,
    rendered: async (page) => {
      await expect(page.getByRole('region', { name: 'Abstract syntax tree' })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Three-address code' })).toBeVisible();
      await expect
        .poll(async () => page.locator('main svg text').count())
        .toBeGreaterThan(20);
    },
    minSteps: 10,
  },
  {
    path: '/opt',
    title: /Optimization/,
    // The default pass (constant folding) changes nothing on this program and
    // records two steps; constant propagation is the pass with real rewrites.
    prepare: async (page) => {
      // Exact name: the phase header tab, not the pass tab whose accessible
      // name also carries its rewrite count.
      await page.getByRole('tab', { name: 'Constant propagation', exact: true }).click();
      await expect(page).toHaveURL(/algo=const-prop/);
    },
    rendered: async (page) => {
      // Flow graph of gcd: ENTRY, four blocks, EXIT.
      await expect.poll(async () => graphNodes(page).count()).toBeGreaterThan(3);
      // The before/after TAC listing.
      await expect.poll(async () => page.getByRole('row').count()).toBeGreaterThan(4);
    },
    minSteps: 3,
  },
  {
    path: '/codegen',
    title: /Code Generation/,
    rendered: async (page) => {
      await expect(
        page.getByRole('region', { name: /Quad → tile → x86-64/i }),
      ).toBeVisible();
      // One row per quad of the selected function.
      await expect.poll(async () => page.getByRole('row').count()).toBeGreaterThan(8);
    },
    minSteps: 10,
  },
];

for (const phase of PHASES) {
  test.describe(`${phase.path}`, () => {
    test(`renders its visualization and steps through its trace`, async ({ page }) => {
      await page.goto('/');
      await compileAndWaitForAllStagesOk(page);
      await gotoPhase(page, phase.path);

      await expect(page.getByRole('heading', { level: 1 })).toHaveText(phase.title);
      await expectPageAlive(page);
      if (phase.prepare) await phase.prepare(page);

      // ── the visualization is real ─────────────────────────────────────────
      const total = await waitForTrace(page, phase.minSteps);
      await phase.rendered(page);
      await expectStep(page, 0);
      const atStart = await stableVizSignature(page);
      const atStartText = await vizTextSignature(page);

      // ── next: the counter advances and the picture changes ────────────────
      // `next` walks VISIBLE cursors (the macro filter hides micro steps), so
      // the counter jumps by one or more — assert monotonic growth, not +1.
      const renderedAt = new Map<number, string>([[0, atStartText]]);
      let previous = 0;
      const clicks = Math.min(5, total);
      for (let i = 0; i < clicks; i++) {
        await nextButton(page).click();
        const before = previous;
        await expect
          .poll(async () => stepIndex(page), {
            message: `click ${i + 1} on "next" should advance the step counter`,
          })
          .toBeGreaterThan(before);
        previous = await stepIndex(page);
        renderedAt.set(previous, await stableVizText(page));
      }
      expect(previous, 'the trace should have advanced past the start').toBeGreaterThan(0);
      await expectVizChanged(page, atStart);

      // ── prev: the counter goes back and the view follows it back ──────────
      // Adjacent steps may legitimately paint the same picture, so the check is
      // "the view shows what it showed at that cursor", not "it changed".
      const beforePrev = await stepIndex(page);
      await prevButton(page).click();
      await expect
        .poll(async () => stepIndex(page), { message: '"prev" should step backwards' })
        .toBeLessThan(beforePrev);
      const backAt = await stepIndex(page);
      expect(renderedAt.has(backAt), `no recorded rendering for step ${backAt}`).toBe(true);
      await expect
        .poll(async () => vizTextSignature(page), {
          message: `stepping back to ${backAt} should restore what step ${backAt} showed`,
        })
        .toBe(renderedAt.get(backAt));

      // ── play: advances on its own, then stops when paused ─────────────────
      await resetButton(page).click();
      await expectStep(page, 0);
      await playButton(page).click();
      await expect
        .poll(async () => stepIndex(page), {
          message: 'playback should advance the step counter by itself',
          timeout: 30_000,
        })
        .toBeGreaterThanOrEqual(2);
      if (await pauseButton(page).count()) await pauseButton(page).click();
      await expect(playButton(page)).toBeVisible();
      const paused = await stepIndex(page);
      // Proving that playback STOPPED means proving a negative: wait out more
      // than two playback ticks (700 ms each at 1×) and see nothing move.
      await page.waitForTimeout(1_600);
      expect(await stepIndex(page), 'playback kept running after pause').toBe(paused);

      // ── reset: back to step 0 and back to the step-0 picture ──────────────
      await resetButton(page).click();
      await expectStep(page, 0);
      await expect
        .poll(async () => vizTextSignature(page), {
          message: 'reset should restore the initial rendering',
        })
        .toBe(atStartText);
    });
  });
}

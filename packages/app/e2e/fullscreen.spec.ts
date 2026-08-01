/**
 * Fullscreen — every diagram in the app can take over the screen, and stays
 * usable once it has.
 *
 * A hundred-state NFA or the LALR GOTO graph is unreadable in a 22rem panel,
 * so each artifact carries its own fullscreen toggle. Fullscreen hides the
 * page's trace panel, which means the artifact has to bring the transport with
 * it — otherwise it freezes at whatever step you left it on, which is exactly
 * the failure this spec is here to catch.
 *
 * What is asserted, per artifact:
 *   1. the toggle exists inline and names the artifact,
 *   2. clicking it promotes an element that FILLS the viewport,
 *   3. the fullscreen bar carries a working transport and a way back out,
 *   4. stepping from that transport advances the counter AND redraws,
 *   5. leaving fullscreen restores the inline view at the step it reached.
 *
 * Escape is deliberately NOT simulated: the browser handles that key itself
 * and a synthesised keypress never reaches it. What Escape actually does is
 * fire `fullscreenchange`, so the last case exits through `document
 * .exitFullscreen()` — the same event, the same code path in `useFullscreen`.
 */
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import {
  compileAndWaitForAllStagesOk,
  gotoPhase,
  nextButton,
  stableVizSignature,
  stepIndex,
  waitForTrace,
  type PhasePath,
} from './helpers';

const FS_CONTROLS = '[role="group"][aria-label="Fullscreen step controls"]';

/** The element the Fullscreen API promoted, and whether it covers the screen. */
async function fullscreenBox(page: Page): Promise<{ active: boolean; fills: boolean }> {
  return page.evaluate(() => {
    const el = document.fullscreenElement;
    if (!el) return { active: false, fills: false };
    const b = el.getBoundingClientRect();
    return {
      active: true,
      // Sub-pixel slack only: a fullscreen artifact that is 40px short has a
      // layout bug, one that is 0.5px short has a rounding artefact.
      fills: b.width >= window.innerWidth - 1 && b.height >= window.innerHeight - 1,
    };
  });
}

interface Case {
  path: PhasePath;
  /** Tab to open first, when the artifact is not on the route's default view. */
  tab?: RegExp;
  /** Steps to take before opening it, so the picture is not the initial state. */
  warmup?: number;
  /** The inline toggle's accessible name. */
  toggle: RegExp;
}

/**
 * One artifact per FAMILY of fullscreen host, since that is where the bugs
 * live: the graph canvas (ElkGraph), the SVG tree (TidyTree), the virtualised
 * table (VirtualTable) and the plain listing whose section head owns the
 * toggle (components/Fullscreen).
 */
const CASES: readonly Case[] = [
  // ElkGraph — the NFA the reader meets first, and the reason this exists.
  { path: '/lex', warmup: 6, toggle: /^View this diagram fullscreen$/ },
  // TidyTree — the regex parse tree on the same view.
  { path: '/lex', warmup: 6, toggle: /^View this tree fullscreen$/ },
  // VirtualTable — the LL(1) parsing table.
  { path: '/syntax', tab: /LL\(1\) table/, toggle: /^View this table fullscreen$/ },
  // A listing whose toggle lives in the section head, not over the canvas.
  { path: '/codegen', tab: /Assembly/, warmup: 4, toggle: /^View the assembly listing fullscreen$/ },
];

test.describe('fullscreen', () => {
  test('every kind of artifact opens fullscreen, steps there, and comes back', async ({
    page,
  }) => {
    await page.goto('/');
    await compileAndWaitForAllStagesOk(page);

    for (const c of CASES) {
      await test.step(`${c.path}${c.tab ? ` · ${c.tab.source}` : ''} — ${c.toggle.source}`, async () => {
        await gotoPhase(page, c.path);
        if (c.tab) {
          await page.getByRole('tab', { name: c.tab }).first().click();
        }
        await waitForTrace(page, 2);
        for (let i = 0; i < (c.warmup ?? 0); i++) await nextButton(page).click();

        const toggle = page.getByRole('button', { name: c.toggle }).first();
        await expect(toggle, 'the artifact should offer a fullscreen toggle inline').toBeVisible();

        const before = await stepIndex(page);
        const drawnBefore = await stableVizSignature(page);
        await toggle.click();

        // 2 — it actually filled the screen.
        await expect
          .poll(async () => fullscreenBox(page), {
            message: 'the artifact should fill the viewport',
          })
          .toEqual({ active: true, fills: true });

        // 3 — the bar came with it: a transport and a way out.
        const transport: Locator = page.locator(FS_CONTROLS);
        await expect(transport, 'fullscreen hides the trace panel, so the artifact must carry the transport').toBeVisible();
        const exit = page.getByRole('button', { name: 'Exit fullscreen' });
        await expect(exit, 'exactly one way out, in the bar').toHaveCount(1);

        // 4 — stepping from in there moves the artifact, not just the counter.
        await transport.getByRole('button', { name: /^Next step/ }).click();
        await expect
          .poll(async () => stepIndex(page), { message: 'the step should advance while fullscreen' })
          .toBe(before + 1);
        await expect
          .poll(async () => stableVizSignature(page), {
            message: 'the artifact should redraw for the new step, not only the counter',
          })
          .not.toBe(drawnBefore);

        // 5 — and it comes back where it was left.
        await exit.click();
        await expect
          .poll(async () => (await fullscreenBox(page)).active, {
            message: 'the exit control should leave fullscreen',
          })
          .toBe(false);
        await expect(toggle, 'the inline toggle should return').toBeVisible();
        await expect(page.locator(FS_CONTROLS)).toHaveCount(0);
        expect(await stepIndex(page), 'the inline view keeps the step it reached').toBe(before + 1);
      });
    }
  });

  test('Escape leaves fullscreen (the fullscreenchange path)', async ({ page }) => {
    await page.goto('/');
    await compileAndWaitForAllStagesOk(page);
    await gotoPhase(page, '/lex');
    await waitForTrace(page, 2);

    const toggle = page.getByRole('button', { name: /^View this diagram fullscreen$/ }).first();
    await toggle.click();
    await expect.poll(async () => (await fullscreenBox(page)).active).toBe(true);

    /*
     * Escape itself is handled by the browser, above the page, so a synthesised
     * key event cannot reach it. What it does reach us as is `fullscreenchange`
     * — the event `useFullscreen` subscribes to precisely because its own
     * click handler never runs on that path. Exiting through the API fires the
     * same event, which is what this asserts: the chrome un-does itself when
     * fullscreen ends WITHOUT our button being pressed.
     */
    await page.evaluate(() => document.exitFullscreen());
    await expect.poll(async () => (await fullscreenBox(page)).active).toBe(false);
    await expect(page.locator(FS_CONTROLS), 'the fullscreen bar must go with it').toHaveCount(0);
    await expect(toggle, 'the inline toggle must come back').toBeVisible();
  });
});

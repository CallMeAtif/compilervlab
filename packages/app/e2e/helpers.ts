/**
 * Page-object helpers shared by the smoke specs.
 *
 * Locator policy: prefer things the app cannot rename by accident —
 *   • `href` for navigation (the six phase routes are fixed paths),
 *   • ARIA roles/labels that ARE the accessibility contract (`Step controls`,
 *     `role="slider"`, `role="tab"`),
 *   • visible artifact text with real numbers in it.
 * The only class-based selectors allowed are the ones owned by a LIBRARY rather
 * than by this app's styling — `.react-flow__node`, `.cm-content` — because
 * "did the graph draw any states?" has no ARIA equivalent. No layout/DOM-shape
 * selectors, and no arbitrary sleeps: every wait is a wait-for-condition (the
 * two exceptions, both proving a negative, say so at the call site).
 */
import { expect, type Locator, type Page } from '@playwright/test';

export const PHASE_PATHS = ['/lex', '/syntax', '/semantic', '/ir', '/opt', '/codegen'] as const;
export type PhasePath = (typeof PHASE_PATHS)[number];

/** Stage chip in the persistent top bar (status lives in its aria-label). */
export function chip(page: Page, path: PhasePath): Locator {
  return page.locator(`header a[href="${path}"]`);
}

/** Cell of the overview pipeline diagram (shows the artifact summary line). */
export function pipelineCell(page: Page, path: PhasePath): Locator {
  return page.locator(`main a[href="${path}"]`);
}

/**
 * A stage is "OK" when its chip says so. The wording of the status label is the
 * app's to choose (`up to date` today), so match the family of OK words and let
 * the per-phase summary assertions carry the real weight.
 */
export const OK_STATUS = /up to date|complete|ok\b/i;
export const NOT_OK_STATUS = /has errors|not yet compiled|stale/i;

// ── Compiling ────────────────────────────────────────────────────────────────

export async function pickExample(page: Page, name: RegExp): Promise<void> {
  await page.getByRole('combobox', { name: 'Example program' }).click();
  await page.getByRole('option', { name }).click();
  await expect(page.getByRole('combobox', { name: 'Example program' })).toContainText(name);
}

/**
 * Press Compile and wait until the button is idle again.
 *
 * The button renames itself to "Compiling…" while the worker runs, so the idle
 * label coming back is the app's own "settled" signal — but the flip may not
 * have happened yet when we look, so callers must still assert an observable
 * OUTCOME (a chip status, a diagnostic) rather than trusting this alone.
 */
export async function compile(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: /^Compile$/ });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.getByRole('button', { name: /Compiling/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Compile$/ })).toBeEnabled();
}

/** Compile the currently selected example and wait for all six stages to pass. */
export async function compileAndWaitForAllStagesOk(page: Page): Promise<void> {
  await compile(page);
  for (const path of PHASE_PATHS) {
    await expect(chip(page, path)).toHaveAttribute('aria-label', OK_STATUS);
  }
}

/**
 * Wait until the address bar stops moving.
 *
 * The phase routes write `?step=` through a 250 ms debounce, so a click on a
 * transport control is followed by a URL write up to 250 ms later. Polling at
 * 300 ms intervals until two consecutive reads agree means that write has
 * landed. (It also keeps the suite clear of the pending-write navigation race
 * documented in navigation.spec.ts.)
 */
export async function waitForUrlSettled(page: Page): Promise<void> {
  const QUIET_MS = 400; // > WRITE_DEBOUNCE_MS (250) in lib/urlState.ts
  let url = page.url();
  let unchangedSince = Date.now();
  await expect
    .poll(
      async () => {
        const now = page.url();
        if (now !== url) {
          url = now;
          unchangedSince = Date.now();
        }
        return Date.now() - unchangedSince;
      },
      { intervals: [100], timeout: 15_000, message: 'the URL should stop changing' },
    )
    .toBeGreaterThanOrEqual(QUIET_MS);
}

/** Client-side navigation through the top bar (keeps the compiled program). */
export async function gotoPhase(page: Page, path: PhasePath): Promise<void> {
  await chip(page, path).click();
  await page.waitForURL(new RegExp(`${path}(\\?|$)`));
  // The phase routes are lazy chunks: wait for the route to actually mount.
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

// ── Stepper ──────────────────────────────────────────────────────────────────

export const STEP_CONTROLS = '[role="group"][aria-label="Step controls"]';

export function stepControls(page: Page): Locator {
  return page.locator(STEP_CONTROLS).first();
}

/** The scrubber thumb doubles as the step counter (aria-valuenow / -valuemax). */
export function scrubber(page: Page): Locator {
  return stepControls(page).locator('[role="slider"]');
}

/*
 * ABSOLUTE trace position, read off the controls group. The scrubber's own
 * aria-valuenow counts NAVIGABLE positions, which at macro level skips every
 * filtered micro step — so it is the wrong thing to assert a step number on.
 */
export async function stepIndex(page: Page): Promise<number> {
  return Number(await stepControls(page).getAttribute('data-step-index'));
}

export async function stepCount(page: Page): Promise<number> {
  return Number(await stepControls(page).getAttribute('data-step-total'));
}

export async function expectStep(page: Page, index: number): Promise<void> {
  await expect(stepControls(page)).toHaveAttribute('data-step-index', String(index));
}

export const nextButton = (page: Page): Locator =>
  stepControls(page).getByRole('button', { name: /^Next step/ });
export const prevButton = (page: Page): Locator =>
  stepControls(page).getByRole('button', { name: /^Previous step/ });
export const playButton = (page: Page): Locator =>
  stepControls(page).getByRole('button', { name: /^Play/ });
export const pauseButton = (page: Page): Locator =>
  stepControls(page).getByRole('button', { name: /^Pause/ });
export const resetButton = (page: Page): Locator =>
  stepControls(page).getByRole('button', { name: /^Reset/ });

/**
 * Pick a playback speed ("0.5" … "4").
 *
 * Speed, micro steps and the jump targets live behind the transport's single
 * options menu (components/StepControls.tsx), so this opens it first and closes
 * it again — the menu overlaps the artifact while it is open.
 */
export async function setSpeed(page: Page, speed: '0.5' | '1' | '2' | '4'): Promise<void> {
  const controls = stepControls(page);
  await controls.getByRole('button', { name: /^Step options/ }).click();
  const option = controls.getByRole('radio', { name: `${speed}×`, exact: true });
  await option.click();
  await expect(option).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(option).toBeHidden();
}

/** Seek to the end of the trace with the transport's own End shortcut. */
export async function seekToEnd(page: Page): Promise<void> {
  await stepControls(page).focus();
  await page.keyboard.press('End');
  await expect
    .poll(async () => stepIndex(page), { message: 'End should seek to the last step' })
    .toBe(await stepCount(page));
}

/** Wait until the step controls exist and their trace has at least `min` steps. */
export async function waitForTrace(page: Page, min = 1): Promise<number> {
  await expect(stepControls(page)).toBeVisible();
  await expect
    .poll(async () => stepCount(page), {
      message: `the trace should have at least ${min} steps`,
    })
    .toBeGreaterThanOrEqual(min);
  return stepCount(page);
}

// ── "Did the picture actually change?" ───────────────────────────────────────

/**
 * A cheap fingerprint of the rendered VISUALIZATION: the markup of <main> with
 * the transport controls, the explanation card and the aria-live announcements
 * removed. Those three change on every step by construction, so leaving them in
 * would make "the view responded to the step" unfalsifiable — the point is to
 * prove the artifact drawing itself re-rendered.
 *
 * Hashed in the page: elk/React Flow markup runs to megabytes.
 */
export async function vizSignature(page: Page): Promise<string> {
  return page.evaluate(() => {
    const main = document.querySelector('main');
    if (!main) return 'NO-MAIN';
    const clone = main.cloneNode(true) as HTMLElement;
    for (const node of clone.querySelectorAll(
      '[role="group"][aria-label="Step controls"], [aria-label="Step explanation"], [aria-live]',
    )) {
      node.remove();
    }
    const html = clone.innerHTML;
    let h = 0x811c9dc5;
    for (let i = 0; i < html.length; i++) {
      h ^= html.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return `${html.length}:${(h >>> 0).toString(16)}`;
  });
}

/**
 * The same fingerprint over rendered TEXT instead of markup.
 *
 * Markup carries mount-transient noise (Radix's `animation-duration: 0s`,
 * React Flow re-measuring edge labels), which is fine for "did it change?" but
 * useless for "did it come back?". The text is what the reader actually sees.
 */
export async function vizTextSignature(page: Page): Promise<string> {
  return page.evaluate(() => {
    const main = document.querySelector('main');
    if (!main) return 'NO-MAIN';
    const clone = main.cloneNode(true) as HTMLElement;
    for (const node of clone.querySelectorAll(
      '[role="group"][aria-label="Step controls"], [aria-label="Step explanation"], [aria-live]',
    )) {
      node.remove();
    }
    // `textContent` on the detached clone: no layout involved, so this cannot
    // perturb the page it is measuring.
    return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
  });
}

/**
 * Wait until the visualization stops changing on its own (graph layout, lazy
 * chunk, trace arriving from the worker) and return its signature. Two equal
 * consecutive reads = settled.
 */
export async function stableVizSignature(page: Page): Promise<string> {
  let previous = await vizSignature(page);
  await expect
    .poll(
      async () => {
        const current = await vizSignature(page);
        const settled = current === previous;
        previous = current;
        return settled;
      },
      { message: 'the visualization should stop re-rendering on its own', timeout: 30_000 },
    )
    .toBe(true);
  return previous;
}

/** Text-signature counterpart of `stableVizSignature`. */
export async function stableVizText(page: Page): Promise<string> {
  let previous = await vizTextSignature(page);
  await expect
    .poll(
      async () => {
        const current = await vizTextSignature(page);
        const settled = current === previous;
        previous = current;
        return settled;
      },
      { message: 'the visualization text should stop changing on its own', timeout: 30_000 },
    )
    .toBe(true);
  return previous;
}

/** Wait until the visualization renders something different from `signature`. */
export async function expectVizChanged(page: Page, signature: string): Promise<string> {
  await expect
    .poll(async () => vizSignature(page), {
      message: 'the visualization should re-render when the step changes',
      timeout: 20_000,
    })
    .not.toBe(signature);
  return vizSignature(page);
}

// ── Sanity ───────────────────────────────────────────────────────────────────

/**
 * The app has no error boundary, so a render crash unmounts everything: a live
 * heading plus real body text is the "this is not a blank page" check. The
 * console guard in fixtures.ts catches the crash itself.
 */
export async function expectPageAlive(page: Page): Promise<void> {
  await expect(page.locator('#root')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const text = (await page.locator('main').innerText()).trim();
  expect(text.length, 'the route rendered no content at all').toBeGreaterThan(200);
}

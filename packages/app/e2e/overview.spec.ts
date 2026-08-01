/**
 * Requirement 1 — the lab bench works end to end in a real browser:
 * load `/`, pick the acceptance example, press Compile, and prove the pipeline
 * reports six healthy stages whose summaries carry real artifact numbers.
 */
import { test, expect } from './fixtures';
import {
  PHASE_PATHS,
  chip,
  compile,
  compileAndWaitForAllStagesOk,
  expectPageAlive,
  NOT_OK_STATUS,
  pickExample,
  pipelineCell,
} from './helpers';

test.describe('overview', () => {
  test('loads, compiles the gcd acceptance example, and reports six OK stages', async ({
    page,
  }) => {
    await page.goto('/');
    await expectPageAlive(page);

    // Before compiling, every stage must say so — this is the control that
    // proves the "OK" assertions below are actually caused by the compile.
    for (const path of PHASE_PATHS) {
      await expect(chip(page, path)).toHaveAttribute('aria-label', /not yet compiled/i);
    }
    await pickExample(page, /gcd \(acceptance sample\)/);
    await compileAndWaitForAllStagesOk(page);

    for (const path of PHASE_PATHS) {
      await expect(chip(page, path)).not.toHaveAttribute('aria-label', NOT_OK_STATUS);
    }

    // A clean program must produce no diagnostics at all.
    await expect(
      page.getByRole('region', { name: 'Diagnostics' }).getByText(/No diagnostics/),
    ).toBeVisible();
  });

  test('the pipeline summary lines carry real artifact numbers', async ({ page }) => {
    await page.goto('/');
    await pickExample(page, /gcd \(acceptance sample\)/);
    await compileAndWaitForAllStagesOk(page);

    // The pipeline diagram is located by the routes it links to, not by its
    // heading copy — the six phase paths are the part that cannot drift.
    await expect(page.locator('main a[href="/lex"]')).toBeVisible();

    // Each stage's own artifact, counted. The numbers are asserted as ">0"
    // rather than pinned, so the suite stays a smoke test and the unit-level
    // goldens keep owning exact values.
    const expectations: ReadonlyArray<[(typeof PHASE_PATHS)[number], RegExp]> = [
      ['/lex', /(\d+) tokens · (\d+) identifiers/],
      ['/syntax', /AST · (\d+) nodes/],
      ['/semantic', /(\d+) symbols · (\d+) scopes/],
      ['/ir', /(\d+) quads · (\d+) functions?/],
      ['/opt', /(\d+) passes · (\d+) rewrites · (\d+)→(\d+) quads/],
      ['/codegen', /(\d+) asm lines · (\d+) registers? · (\d+) spills?/],
    ];

    for (const [path, pattern] of expectations) {
      const cell = pipelineCell(page, path);
      await expect(cell, `pipeline cell for ${path}`).toBeVisible();
      const text = (await cell.innerText()).replace(/\s+/g, ' ');
      const match = pattern.exec(text);
      expect(match, `${path} summary "${text}" should match ${pattern}`).not.toBeNull();
      // Every captured count must be a real number, and the leading one (the
      // artifact size) must be non-zero: "0 tokens" is a dead pipeline.
      const numbers = (match ?? []).slice(1).map(Number);
      expect(numbers.every((n) => Number.isFinite(n))).toBe(true);
      expect(numbers[0], `${path} produced an empty artifact`).toBeGreaterThan(0);
    }

    // Spot-check the counts the task calls out explicitly. `innerText` (not
    // `textContent`) so the chip label above the summary cannot run into the
    // number and defeat the word boundaries.
    const lex = await pipelineCell(page, '/lex').innerText();
    expect(lex, 'the scanner must report a plausible token count').toMatch(
      /\b(?:[1-9]\d|[1-9]\d\d+) tokens\b/,
    );
    const ir = await pipelineCell(page, '/ir').innerText();
    expect(ir, 'the IR stage must report TAC instructions').toMatch(/\b[1-9]\d* quads\b/);
    const codegen = await pipelineCell(page, '/codegen').innerText();
    expect(codegen, 'the allocator must report registers').toMatch(/\b[1-9]\d* registers?\b/);
    expect(codegen, 'the allocator must report spills').toMatch(/\b\d+ spills?\b/);
  });

  test('editing the source marks every stage stale until it is recompiled', async ({ page }) => {
    await page.goto('/');
    await compileAndWaitForAllStagesOk(page);

    await page.locator('.cm-content').click();
    await page.keyboard.type('\n// touched by the smoke suite\n');

    await expect(page.getByText(/The source changed since the last compile/)).toBeVisible();
    for (const path of PHASE_PATHS) {
      await expect(chip(page, path)).toHaveAttribute('aria-label', /stale/i);
    }

    await compile(page);
    await expect(page.getByText(/The source changed since the last compile/)).toBeHidden();
    for (const path of PHASE_PATHS) {
      await expect(chip(page, path)).not.toHaveAttribute('aria-label', NOT_OK_STATUS);
    }
  });
});

/** Per-pass input → output assertions in formatQuad syntax. */
import { describe, expect, it } from 'vitest';
import { formatQuad } from '../../src/ir/types.js';
import type { TacProgram } from '../../src/ir/types.js';
import { runConstFold } from '../../src/opt/passes/const-fold.js';
import { runConstProp } from '../../src/opt/passes/const-prop.js';
import { runCopyProp } from '../../src/opt/passes/copy-prop.js';
import { runCse } from '../../src/opt/passes/cse.js';
import { runDce } from '../../src/opt/passes/dce.js';
import { runLicm } from '../../src/opt/passes/licm.js';
import { runOptimize } from '../../src/opt/passes/pipeline.js';
import { bin, c, call, copy, fn, goto_, if_, iffalse, label, param, prog, q, ret, t, v } from './helpers.js';

const fmt = (p: TacProgram, f = 0): string[] => p.functions[f]!.quads.map((x) => formatQuad(x));

describe('const-fold (§8.5.4)', () => {
  it('evaluates constant computations, truncating int division toward zero', () => {
    const p = prog([
      fn('f', [
        bin(t(1), c(2), '+', c(3)),
        bin(t(2), c(7), '/', c(2)),
        bin(t(3), c(-7), '/', c(2)),
        bin(t(4), c(7), '%', c(2)),
        bin(t(5), c(3), '<', c(4)),
        q('neg', c(5), null, t(6)),
        q('not', c(0), null, t(7)),
        q('inttofloat', c(3), null, t(8)),
        bin(t(9), c(2.5, 'float'), '*', c(2)),
        ret(t(1)),
      ]),
    ]);
    const { result } = runConstFold(p);
    expect(fmt(result.after)).toEqual([
      't1 = 5',
      't2 = 3',
      't3 = -3',
      't4 = 1',
      't5 = 1',
      't6 = -5',
      't7 = 1',
      // Float constants keep an explicit fractional part so a widened value
      // stays distinguishable from an int one (§6.5.2 readability).
      't8 = 3.0',
      't9 = 5.0',
      'return t1',
    ]);
    expect(result.changes).toHaveLength(9);
    expect(result.changes[0]!.justification).toContain('§8.5.4');
  });

  it('never folds division or remainder by constant zero', () => {
    const p = prog([fn('f', [bin(t(1), c(1), '/', c(0)), bin(t(2), c(5), '%', c(0)), ret(t(1))])]);
    const { result, trace } = runConstFold(p);
    expect(fmt(result.after)).toEqual(['t1 = 1 / 0', 't2 = 5 % 0', 'return t1']);
    expect(result.changes).toHaveLength(0);
    const skips = trace.steps.filter((s) => s.event.kind === 'rewrite-skipped');
    expect(skips).toHaveLength(2);
  });
});

describe('const-prop (§9.2.4 reaching definitions)', () => {
  it('replaces a use only when ALL reaching definitions assign the same constant', () => {
    const x = v('x', 1);
    const p = prog([
      fn('f', [
        copy(x, c(4)), //                 0 d1: x = 4
        iffalse(v('cnd', 9), 'L1'), //    1
        bin(v('y', 2), x, '+', c(1)), //  2  only d1 reaches → y = 4 + 1
        goto_('L2'), //                   3
        label('L1'), //                   4
        copy(x, c(5)), //                 5 d3: x = 5
        label('L2'), //                   6
        bin(v('z', 3), x, '+', c(2)), //  7  d1 and d3 reach, 4 ≠ 5 → unchanged
        ret(v('z', 3)), //                8
      ]),
    ]);
    const { result } = runConstProp(p);
    expect(fmt(result.after)[2]).toBe('y = 4 + 1');
    expect(fmt(result.after)[7]).toBe('z = x + 2');
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]!.justification).toContain('§9.2.4');
  });

  it('replaces when both branches assign the SAME constant', () => {
    const x = v('x', 1);
    const p = prog([
      fn('f', [
        iffalse(v('cnd', 9), 'L1'),
        copy(x, c(7)),
        goto_('L2'),
        label('L1'),
        copy(x, c(7)),
        label('L2'),
        bin(v('z', 3), x, '*', c(2)),
        ret(v('z', 3)),
      ]),
    ]);
    const { result } = runConstProp(p);
    expect(fmt(result.after)[6]).toBe('z = 7 * 2');
  });
});

describe('copy-prop (§9.1.3)', () => {
  it('replaces x by y after x = y until either is reassigned', () => {
    const x = v('x', 1);
    const y = v('y', 2);
    const p = prog([
      fn('f', [
        copy(x, y), //                       0  x = y
        bin(v('a', 3), x, '+', v('z', 4)), //1  → a = y + z
        copy(y, c(7)), //                    2  y reassigned: copy disturbed
        bin(v('b', 5), x, '+', v('z', 4)), //3  stays b = x + z
        ret(v('a', 3)),
      ]),
    ]);
    const { result } = runCopyProp(p);
    expect(fmt(result.after)).toEqual(['x = y', 'a = y + z', 'y = 7', 'b = x + z', 'return a']);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]!.justification).toContain('§9.1.3');
  });

  it('requires the copy on ALL paths (meet = intersection)', () => {
    const x = v('x', 1);
    const y = v('y', 2);
    const p = prog([
      fn('f', [
        iffalse(v('cnd', 9), 'L1'), // one arm copies, the other does not
        copy(x, y),
        goto_('L2'),
        label('L1'),
        copy(x, c(1)),
        label('L2'),
        bin(v('a', 3), x, '+', c(2)), // copy x=y does NOT reach on all paths
        ret(v('a', 3)),
      ]),
    ]);
    const { result } = runCopyProp(p);
    expect(fmt(result.after)[6]).toBe('a = x + 2');
    expect(result.changes).toHaveLength(0);
  });
});

describe('cse (§9.1.2 via available expressions §9.2.6)', () => {
  it('reuses a single-definition temp directly', () => {
    const p = prog([
      fn(
        'f',
        [
          bin(t(1), v('b', 1), '+', v('c', 2)), // t1 = b + c
          copy(v('a', 3), t(1)),
          bin(t(2), v('b', 1), '+', v('c', 2)), // redundant
          copy(v('d', 4), t(2)),
          ret(v('d', 4)),
        ],
        2,
      ),
    ]);
    const { result } = runCse(p);
    expect(fmt(result.after)).toEqual(['t1 = b + c', 'a = t1', 't2 = t1', 'd = t2', 'return d']);
    expect(result.changes[0]!.justification).toContain('§9.1.2');
  });

  it('introduces a carrier temp when the expression reaches from two sites', () => {
    const p = prog([
      fn(
        'f',
        [
          iffalse(v('k', 9), 'L1'), //             0
          bin(v('e', 1), v('b', 2), '+', v('c', 3)), // 1 site
          goto_('L2'), //                          2
          label('L1'), //                          3
          bin(v('f', 4), v('b', 2), '+', v('c', 3)), // 4 site
          label('L2'), //                          5
          bin(v('g', 5), v('b', 2), '+', v('c', 3)), // 6 redundant at join
          ret(v('g', 5)),
        ],
        2,
      ),
    ]);
    const { result } = runCse(p);
    expect(fmt(result.after)).toEqual([
      'ifFalse k goto L1',
      't3 = b + c',
      'e = t3',
      'goto L2',
      'L1:',
      't3 = b + c',
      'f = t3',
      'L2:',
      'g = t3',
      'return g',
    ]);
  });
});

describe('dce (§9.1.4 via live variables §9.2.5)', () => {
  it('removes dead assignment chains to a fixpoint', () => {
    const p = prog([
      fn('f', [
        bin(t(1), v('a', 1), '+', v('b', 2)), // becomes dead once x is removed
        copy(v('x', 3), t(1)), //                x never used → dead
        bin(t(2), v('a', 1), '+', c(1)),
        ret(t(2)),
      ]),
    ]);
    const { result } = runDce(p);
    expect(fmt(result.after)).toEqual(['t2 = a + 1', 'return t2']);
    expect(result.changes).toHaveLength(2);
    expect(result.changes.every((ch) => ch.justification.includes('§9.1.4'))).toBe(true);
  });

  it('keeps live assignments, side-effecting instructions, and globals', () => {
    const g = v('g', 50);
    const p = prog(
      [
        fn('f', [
          copy(g, c(3)), //        global: may be read after return → stays
          bin(t(1), c(1), '+', c(2)),
          param(t(1)), //          param stays, keeps t1 live
          call('print', 1), //     call stays
          q('index-store', c(9), c(0), v('arr', 60)), // store stays
          ret(null),
        ]),
      ],
      [50],
    );
    const { result } = runDce(p);
    expect(fmt(result.after)).toEqual([
      'g = 3',
      't1 = 1 + 2',
      'param t1',
      'call print, 1',
      'arr [ 0 ] = 9',
      'return',
    ]);
    expect(result.changes).toHaveLength(0);
  });
});

describe('licm (§9.1.5 code motion over §9.6 natural loops)', () => {
  it('moves loop-invariant t2 = x + y of a while-loop to a new preheader', () => {
    const i = v('i', 1);
    const n = v('n', 2);
    const x = v('x', 3);
    const y = v('y', 4);
    const p = prog([
      fn(
        'f',
        [
          label('L1'), //               0  header B0
          bin(t(1), i, '<', n), //      1
          iffalse(t(1), 'L3'), //       2
          bin(t(2), x, '+', y), //      3  invariant; t2 dead after loop
          bin(i, i, '+', t(2)), //      4
          goto_('L1'), //               5  back edge B1→B0
          label('L3'), //               6
          ret(i), //                    7
        ],
        2,
      ),
    ]);
    const { result, trace } = runLicm(p);
    expect(fmt(result.after)).toEqual([
      'L4:',
      't2 = x + y',
      'L1:',
      't1 = i < n',
      'ifFalse t1 goto L3',
      'i = i + t2',
      'goto L1',
      'L3:',
      'return i',
    ]);
    const move = result.changes.find((ch) => ch.kind === 'move');
    expect(move).toBeDefined();
    expect(move!.justification).toContain('§9.1.5');
    // The trace shows the invariant marking and all legality checks.
    expect(trace.steps.some((s) => s.event.kind === 'licm-invariant')).toBe(true);
    const legality = trace.steps.filter((s) => s.event.kind === 'licm-legality');
    expect(legality.length).toBeGreaterThanOrEqual(4);
  });

  it('does NOT move an invariant assignment that is live after the loop from a non-dominating block', () => {
    const i = v('i', 1);
    const n = v('n', 2);
    const g = v('g', 3);
    const p = prog([
      fn(
        'f',
        [
          label('L1'), //               0  header B0 (the only exit block)
          bin(t(1), i, '<', n), //      1
          iffalse(t(1), 'L3'), //       2
          bin(g, v('x', 4), '+', v('y', 5)), // 3 invariant, but g is returned after the loop
          bin(i, i, '+', g), //         4
          goto_('L1'), //               5
          label('L3'), //               6
          ret(g), //                    7  g live after loop
        ],
        1,
      ),
    ]);
    const { result, trace } = runLicm(p);
    // B1 (the body) does not dominate the exit B0, and g is live at L3:
    // condition 1 fails, the instruction must stay in the loop.
    expect(fmt(result.after)).toEqual([
      'L1:',
      't1 = i < n',
      'ifFalse t1 goto L3',
      'g = x + y',
      'i = i + g',
      'goto L1',
      'L3:',
      'return g',
    ]);
    expect(result.changes).toHaveLength(0);
    const failed = trace.steps.find(
      (s) =>
        s.event.kind === 'licm-legality' &&
        s.event.condition === 'dominates-exits-or-dead' &&
        !s.event.ok,
    );
    expect(failed).toBeDefined();
  });
});

describe('pipeline (const-fold → const-prop → copy-prop → cse → licm → dce)', () => {
  const gcdLike = (): TacProgram => {
    const a = v('a', 1);
    const b = v('b', 2);
    return prog([
      fn(
        'gcd',
        [
          label('L1'), //           0
          bin(t(1), a, '==', b), // 1
          if_(t(1), 'L4'), //       2
          bin(t(2), a, '>', b), //  3
          iffalse(t(2), 'L2'), //   4
          bin(a, a, '-', b), //     5
          goto_('L3'), //           6
          label('L2'), //           7
          bin(b, b, '-', a), //     8
          label('L3'), //           9
          goto_('L1'), //           10
          label('L4'), //           11
          ret(a), //                12
        ],
        2,
      ),
    ]);
  };

  it('runs all passes and preserves structural invariants', () => {
    const { result } = runOptimize(gcdLike());
    expect(result.passes.map((p) => p.pass)).toEqual([
      'const-fold',
      'const-prop',
      'copy-prop',
      'cse',
      'licm',
      'dce',
    ]);
    const out = result.output.functions[0]!;
    // (1) quads renumbered 0..n-1
    out.quads.forEach((quad, idx) => expect(quad.index).toBe(idx));
    // (2) every jump target is an existing label
    const labels = new Set(
      out.quads.filter((x) => x.op === 'label').map((x) => (x.result as { name: string }).name),
    );
    for (const quad of out.quads) {
      if (quad.op === 'goto' || quad.op === 'if' || quad.op === 'iffalse' || quad.op === 'ifrel') {
        expect(labels.has((quad.result as { name: string }).name)).toBe(true);
      }
    }
    // (3) the final CFG's block partition covers all quads exactly once, in order
    const lastCfg = result.passes[result.passes.length - 1]!.cfgAfter[0]!;
    const covered = lastCfg.blocks.flatMap((blk) => blk.quadIndices);
    expect(covered).toEqual(out.quads.map((x) => x.index));
    // (4) gcd's observable structure is untouched by the pipeline
    expect(fmt(result.output)).toEqual(fmt(result.input));
  });

  it('respects the passes option (subset, still in canonical order)', () => {
    const { result } = runOptimize(gcdLike(), { passes: ['dce', 'const-fold'] });
    expect(result.passes.map((p) => p.pass)).toEqual(['const-fold', 'dce']);
  });
});

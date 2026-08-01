/** Dominators (§9.6.1), back edges (§9.6.4), natural loops (Algorithm 9.46),
 *  live variables (§9.2.5) and available expressions (§9.2.6) on small graphs. */
import { describe, expect, it } from 'vitest';
import { runFindBasicBlocks } from '../../src/opt/basic-blocks.js';
import { computeCfg, EXIT } from '../../src/opt/cfg.js';
import { runAvailableExpressions, runLiveVariables } from '../../src/opt/dataflow.js';
import { runComputeDominators, solveDominators } from '../../src/opt/dominators.js';
import { runFindLoops } from '../../src/opt/loops.js';
import { bin, c, copy, fig913, fn, goto_, iffalse, label, ret, t, v } from './helpers.js';

const cfgOf = (f: ReturnType<typeof fn>) => computeCfg(f, runFindBasicBlocks(f).result.blocks);

describe('dominators on the Fig 9.13 graph (§9.6.1)', () => {
  const cfg = cfgOf(fig913());
  const { result } = runComputeDominators(cfg);

  it('computes D(n) = {n} ∪ ∩ D(pred)', () => {
    expect(result.dom['0']).toEqual([0]);
    expect(result.dom['1']).toEqual([0, 1]);
    expect(result.dom['2']).toEqual([0, 1, 2]);
    expect(result.dom['3']).toEqual([0, 1, 3]);
  });
});

describe('back edges and natural loops (§9.6.4, Algorithm 9.46)', () => {
  const cfg = cfgOf(fig913());
  const { result } = runFindLoops(cfg, solveDominators(cfg));

  it('finds the single back edge B3 → B1 (head dominates tail)', () => {
    expect(result.backEdges).toEqual([{ from: 3, to: 1 }]);
  });

  it('accumulates the natural loop {B1, B2, B3}', () => {
    expect(result.loops).toEqual([
      { header: 1, backEdge: { from: 3, to: 1 }, body: [1, 2, 3] },
    ]);
  });
});

describe('live variables (§9.2.5, backward, meet = ∪)', () => {
  // B0: x = 1; y = 2; B0→B1: uses x, defines z; return z.
  const f = fn('lv', [
    copy(v('x', 1), c(1)),
    copy(v('y', 2), c(2)),
    bin(v('z', 3), v('x', 1), '+', c(3)),
    ret(v('z', 3)),
  ]);
  const cfg = cfgOf(f);
  const { result } = runLiveVariables(f, cfg, []);

  it('x is live into the use, y is dead everywhere', () => {
    // Single block: IN = use ∪ (OUT − def); nothing used before defined.
    expect(result.in['0']).toEqual([]);
    expect(result.out['0']).toEqual([]);
    expect(result.use['0']).toEqual([]);
    expect(result.def['0']).toEqual(['x', 'y', 'z']);
    expect(result.in[String(EXIT)]).toEqual([]);
  });

  it('across blocks, a variable used later is live out of the defining block', () => {
    const g = fn('lv2', [
      copy(v('x', 1), c(1)), //     B0
      iffalse(v('p', 9), 'L1'), //  B0 (p used before any def → live-in)
      copy(v('y', 2), v('x', 1)), // B1 uses x
      label('L1'), //               B2 (leader: jump target)
      ret(v('x', 1)), //            B2 uses x
    ]);
    const gcfg = cfgOf(g);
    const { result: r } = runLiveVariables(g, gcfg, []);
    expect(r.in['0']).toEqual(['p']);
    expect(r.out['0']).toEqual(['x']);
    expect(r.in['1']).toEqual(['x']);
    expect(r.in['2']).toEqual(['x']);
  });
});

describe('available expressions (§9.2.6, forward, meet = ∩)', () => {
  // Diamond: both arms compute b + c; the join point has it available.
  const f = fn('ae', [
    iffalse(v('k', 1), 'L1'), //      B0
    bin(v('e', 2), v('b', 3), '+', v('c', 4)), // B1
    goto_('L2'), //                   B1
    label('L1'), //                   B2
    bin(v('f', 5), v('b', 3), '+', v('c', 4)), // B2
    label('L2'), //                   B3
    bin(v('g', 6), v('b', 3), '+', v('c', 4)), // B3
  ]);
  const cfg = cfgOf(f);
  const { result } = runAvailableExpressions(f, cfg);

  it('b + c is available at the join of the diamond', () => {
    expect(result.domain).toEqual(['b + c']);
    expect(result.in['3']).toEqual(['b + c']);
    expect(result.out['1']).toEqual(['b + c']);
    expect(result.out['2']).toEqual(['b + c']);
    // Not available at entry to the arms (ENTRY contributes ∅).
    expect(result.in['1']).toEqual([]);
  });

  it('an expression is killed when an operand is redefined (x = x + z case)', () => {
    const g = fn('ae2', [
      bin(v('x', 1), v('x', 1), '+', v('z', 2)), // x = x + z: kills, does not gen
      bin(t(1), v('x', 1), '+', v('z', 2)),
    ]);
    const gcfg = cfgOf(g);
    const { result: r } = runAvailableExpressions(g, gcfg);
    // gen of the block: the second computation is downward-exposed;
    // "x + z" after the first quad is NOT available (x just changed),
    // but the block's own second evaluation re-generates it at the end.
    expect(r.gen['0']).toEqual(['x + z']);
    expect(r.kill['0']).toEqual([]);
  });
});

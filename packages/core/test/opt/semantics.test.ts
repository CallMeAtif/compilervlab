/**
 * Semantics preservation for the optimizer (§9.1.3 "Semantics-Preserving
 * Transformations"): every pass must leave the program's observable behaviour
 * — its return value, and whether it raises a runtime error — unchanged, and
 * the analyses that justify the passes must describe the real flow graph.
 * Each test here reproduces a miscompilation or a wrong analysis result.
 */
import { describe, expect, it } from 'vitest';
import { checkTraceInvariants } from '@lab/trace';
import { compile } from '../../src/compile.js';
import { runTac, TacRuntimeError } from '../../src/interp/tac.js';
import { formatQuad } from '../../src/ir/types.js';
import type { TacProgram } from '../../src/ir/types.js';
import { runFindBasicBlocks } from '../../src/opt/basic-blocks.js';
import { computeCfg, EXIT, predecessors } from '../../src/opt/cfg.js';
import { runAvailableExpressions, runLiveVariables } from '../../src/opt/dataflow.js';
import { passReducer, passStateFromResult } from '../../src/opt/opt-events.js';
import { runConstProp } from '../../src/opt/passes/const-prop.js';
import { runCse } from '../../src/opt/passes/cse.js';
import { runDce } from '../../src/opt/passes/dce.js';
import { runLicm } from '../../src/opt/passes/licm.js';
import { bin, c, copy, fn, goto_, if_, iffalse, label, lbl, prog, q, ret, t, v } from './helpers.js';

const fmt = (p: TacProgram, f = 0): string[] => p.functions[f]!.quads.map((x) => formatQuad(x));

describe('const-prop: a definition on ONE path is not "all the definitions" (§9.2.4)', () => {
  it('does not propagate a constant into a use the entry value also reaches', () => {
    // n = 1; if n == 0 goto L1; goto L2; L1: y = 7; L2: return y
    // y is 0 (uninitialized) on the taken path, so `return y` must stay.
    const p = prog([
      fn('main', [
        copy(v('n', 1), c(1)), //                          0
        q('ifrel', v('n', 1), c(0), lbl('L1'), '=='), //    1
        goto_('L2'), //                                    2
        label('L1'), //                                    3
        copy(v('y', 2), c(7)), //                          4  the only real def
        label('L2'), //                                    5
        ret(v('y', 2)), //                                 6  also reached by d0(y)
      ]),
    ]);
    expect(runTac(p).returnValue).toBe(0);
    const { result } = runConstProp(p);
    expect(fmt(result.after)[6]).toBe('return y');
    expect(runTac(result.after).returnValue).toBe(0);
  });

  it('does not propagate a constant into a use a parameter also reaches (end to end)', () => {
    const source = `int f(int a) {
    if (a == 0) {
        a = 7;
    }
    return a;
}

int main() {
    return f(5);
}
`;
    const compiled = compile(source);
    expect(compiled.diagnostics).toEqual([]);
    expect(runTac(compiled.tac!).returnValue).toBe(5);
    expect(runTac(compiled.optimized!.output).returnValue).toBe(5);
  });

  it('still propagates when every reaching definition assigns the same constant', () => {
    const p = prog([
      fn('main', [
        copy(v('x', 1), c(4)), //          0  x is defined before any use
        bin(v('y', 2), v('x', 1), '+', c(1)),
        ret(v('y', 2)),
      ]),
    ]);
    const { result } = runConstProp(p);
    expect(fmt(result.after)[1]).toBe('y = 4 + 1');
  });
});

describe('cse: a store through a pointer kills the expressions it may write (§8.5.6)', () => {
  it('does not reuse a + b across "* p = 10" when p may point at a', () => {
    const p = prog([
      fn('main', [
        q('addr', v('a', 1), null, v('p', 4)), //             p = & a
        copy(v('a', 1), c(2)),
        copy(v('b', 2), c(3)),
        bin(t(1), v('a', 1), '+', v('b', 2)), //              t1 = a + b  (= 5)
        q('deref-store', c(10), null, v('p', 4)), //          * p = 10
        bin(t(2), v('a', 1), '+', v('b', 2)), //              t2 = a + b  (= 13)
        ret(t(2)),
      ]),
    ]);
    expect(runTac(p).returnValue).toBe(13);
    const { result } = runCse(p);
    expect(fmt(result.after)[5]).toBe('t2 = a + b');
    expect(result.changes).toHaveLength(0);
    expect(runTac(result.after).returnValue).toBe(13);
  });

  it('an array store does not block reuse of an expression it cannot write', () => {
    const p = prog([
      fn('main', [
        copy(v('x', 1), c(2)),
        copy(v('y', 2), c(3)),
        bin(t(1), v('x', 1), '+', v('y', 2)), //           t1 = x + y
        q('index-store', t(1), c(0), v('arr', 5)), //      arr [ 0 ] = t1
        bin(t(2), v('x', 1), '+', v('y', 2)), //           redundant: still available
        ret(t(2)),
      ]),
    ]);
    const { result } = runCse(p);
    expect(fmt(result.after)[4]).toBe('t2 = t1');
    expect(runTac(result.after).returnValue).toBe(runTac(p).returnValue);
  });
});

describe('licm: code motion must not add a computation the original never performs (§9.5.1)', () => {
  const zeroTripLoop = (): TacProgram =>
    prog([
      fn('main', [
        copy(v('a', 1), c(6)),
        copy(v('b', 2), c(0)),
        copy(v('i', 3), c(0)),
        copy(v('s', 4), c(0)),
        label('L1'), //                                     header (the exit test)
        q('ifrel', v('i', 3), c(0), lbl('L2'), '>='), //     i >= 0 → leave at once
        bin(v('x', 5), v('a', 1), '/', v('b', 2)), //        invariant, but traps
        bin(v('s', 4), v('s', 4), '+', v('x', 5)),
        bin(v('i', 3), v('i', 3), '+', c(1)),
        goto_('L1'),
        label('L2'),
        ret(v('s', 4)),
      ]),
    ]);

  it('does not hoist a trapping division out of a loop body that may not run', () => {
    const p = zeroTripLoop();
    expect(runTac(p).returnValue).toBe(0);
    const { result, trace } = runLicm(p);
    expect(fmt(result.after)).toEqual(fmt(p));
    expect(result.changes).toHaveLength(0);
    expect(runTac(result.after).returnValue).toBe(0);
    const failed = trace.steps.find(
      (s) =>
        s.event.kind === 'licm-legality' &&
        s.event.condition === 'dominates-exits-or-dead' &&
        !s.event.ok,
    );
    expect(failed).toBeDefined();
  });

  it('still hoists the same division when its block dominates the loop exit', () => {
    // Bottom-test loop: the division is in the header block, which dominates
    // the only exit, so the original program evaluates it too.
    const p = prog([
      fn('main', [
        copy(v('a', 1), c(6)),
        copy(v('b', 2), c(0)),
        copy(v('i', 3), c(0)),
        label('L1'),
        bin(v('x', 5), v('a', 1), '/', v('b', 2)), //   traps in BOTH programs
        bin(v('i', 3), v('i', 3), '+', c(1)),
        q('ifrel', v('i', 3), c(3), lbl('L1'), '<'),
        ret(v('x', 5)),
      ]),
    ]);
    expect(() => runTac(p)).toThrow(TacRuntimeError);
    const { result } = runLicm(p);
    expect(result.changes.some((ch) => ch.kind === 'move')).toBe(true);
    expect(() => runTac(result.after)).toThrow(TacRuntimeError);
  });
});

describe('licm: the preheader is entered only from outside the loop (§9.1.5, Fig 9.6)', () => {
  it('keeps hoisted code out of the loop for a bottom-test loop', () => {
    const p = prog([
      fn('main', [
        copy(v('a', 1), c(3)), //                       0
        copy(v('i', 3), c(0)), //                       1
        copy(v('s', 4), c(0)), //                       2
        goto_('L2'), //                                 3  enter at the test
        label('L1'), //                                 4  body
        bin(t(1), v('a', 1), '*', c(2)), //             5  invariant
        bin(v('s', 4), v('s', 4), '+', t(1)), //        6
        bin(v('i', 3), v('i', 3), '+', c(1)), //        7
        label('L2'), //                                 8  header: falls in from the body
        q('ifrel', v('i', 3), c(3), lbl('L1'), '<'), // 9
        ret(v('s', 4)), //                              10
      ]),
    ]);
    const before = runTac(p);
    const recorded = runLicm(p);
    const { result } = recorded;
    // The extra "goto" is a real rewrite step, so the trace still replays.
    expect(checkTraceInvariants(recorded, passReducer, passStateFromResult)).toEqual([]);
    expect(fmt(result.after)).toEqual([
      'a = 3',
      'i = 0',
      's = 0',
      'goto L3', //        loop entry now goes through the preheader
      'L1:',
      's = s + t1',
      'i = i + 1',
      'goto L2', //        the body jumps straight to the header, skipping L3
      'L3:', //            preheader
      't1 = a * 2',
      'L2:', //            header
      'if i < 3 goto L1',
      'return s',
    ]);
    const after = runTac(result.after);
    expect(after.returnValue).toBe(before.returnValue);
    // The point of the transformation: the loop got cheaper, not costlier.
    expect(after.steps).toBeLessThan(before.steps);

    // The preheader block's only predecessors come from outside the loop.
    const f = result.after.functions[0]!;
    const cfg = computeCfg(f, runFindBasicBlocks(f).result.blocks);
    const preheader = cfg.blocks.find((b) => formatQuad(f.quads[b.leaderIndex]!) === 'L3:')!;
    const header = cfg.blocks.find((b) => formatQuad(f.quads[b.leaderIndex]!) === 'L2:')!;
    const body = cfg.blocks.find((b) => formatQuad(f.quads[b.leaderIndex]!) === 'L1:')!;
    expect(predecessors(cfg, preheader.id)).not.toContain(body.id);
    expect(predecessors(cfg, preheader.id)).not.toContain(header.id);
  });
});

describe('dce: a statement that may raise a runtime error is not side-effect free (§9.1.4)', () => {
  it('keeps a dead division by zero', () => {
    const p = prog([
      fn('main', [
        copy(v('a', 1), c(5)),
        copy(v('b', 2), c(0)),
        bin(v('x', 3), v('a', 1), '/', v('b', 2)), // x is dead, but this traps
        ret(c(0)),
      ]),
    ]);
    expect(() => runTac(p)).toThrow(TacRuntimeError);
    const { result } = runDce(p);
    expect(fmt(result.after)).toEqual(['a = 5', 'b = 0', 'x = a / b', 'return 0']);
    expect(() => runTac(result.after)).toThrow(TacRuntimeError);
  });

  it('still removes a dead division whose divisor is a non-zero constant', () => {
    const p = prog([
      fn('main', [
        copy(v('a', 1), c(5)),
        bin(v('x', 3), v('a', 1), '/', c(2)),
        ret(c(0)),
      ]),
    ]);
    const { result } = runDce(p);
    expect(fmt(result.after)).toEqual(['return 0']);
  });
});

describe('flow graph shape (§8.4.1 Algorithm 8.5, §8.4.3)', () => {
  it('gives a block that ends in a return its edge to EXIT even mid-function', () => {
    // g = 5; L1: return 0; goto L1  — the return must end its block.
    const f = fn('f', [copy(v('g', 77), c(5)), label('L1'), ret(c(0)), goto_('L1')]);
    const cfg = computeCfg(f, runFindBasicBlocks(f).result.blocks);
    expect(cfg.blocks.map((b) => b.quadIndices)).toEqual([[0], [1, 2], [3]]);
    expect(cfg.edges).toContainEqual({ from: 1, to: EXIT });
    // …so the live-variables boundary propagates backwards through it.
    const { result } = runLiveVariables(f, cfg, ['g']);
    expect(result.out['0']).toEqual(['g']);
  });

  it('emits one edge when a conditional jump targets its own fall-through block', () => {
    const f = fn('f', [
      bin(t(1), v('a', 1), '+', v('b', 2)),
      if_(t(1), 'L1'),
      label('L1'),
      copy(v('x', 3), c(1)),
      ret(v('x', 3)),
    ]);
    const cfg = computeCfg(f, runFindBasicBlocks(f).result.blocks);
    expect(cfg.edges.filter((e) => e.from === 0 && e.to === 1)).toHaveLength(1);
    expect(predecessors(cfg, 1)).toEqual([0]);
  });
});

describe('data-flow trace: the replayed state matches the step that produced it (§9.3)', () => {
  it('df-init records OUT[B] = U for an intersection problem', () => {
    const f = fn('ae', [
      iffalse(v('k', 1), 'L1'),
      bin(v('e', 2), v('b', 3), '+', v('c', 4)),
      goto_('L2'),
      label('L1'),
      bin(v('f', 5), v('b', 3), '+', v('c', 4)),
      label('L2'),
      bin(v('g', 6), v('b', 3), '+', v('c', 4)),
    ]);
    const cfg = computeCfg(f, runFindBasicBlocks(f).result.blocks);
    const { trace, result } = runAvailableExpressions(f, cfg);
    const i = trace.steps.findIndex((s) => s.event.kind === 'df-init');
    expect(i).toBeGreaterThanOrEqual(0);
    const state = trace.stateAt(i + 1);
    for (const b of cfg.blocks) expect(state.out[String(b.id)]).toEqual(result.domain);
    expect(state.out['-1']).toEqual([]);
  });
});

describe('citations: LICM does not attribute its legality rules to §9.1.5', () => {
  it('cites the sections that actually define each condition', () => {
    const p = prog([
      fn(
        'f',
        [
          label('L1'),
          bin(t(1), v('i', 1), '<', v('n', 2)),
          iffalse(t(1), 'L3'),
          bin(t(2), v('x', 3), '+', v('y', 4)),
          bin(v('i', 1), v('i', 1), '+', t(2)),
          goto_('L1'),
          label('L3'),
          ret(v('i', 1)),
        ],
        2,
      ),
    ]);
    const { trace } = runLicm(p);
    const legality = trace.steps.filter((s) => s.event.kind === 'licm-legality');
    expect(legality.length).toBeGreaterThanOrEqual(4);
    for (const s of legality) {
      expect(s.meta.cite.rule ?? '').not.toMatch(/^Move s: x =/);
    }
    const sections = new Set(legality.map((s) => s.meta.cite.section));
    expect(sections).toContain('9.5.1'); // safety of code motion
    expect(sections).toContain('9.2.4'); // reaching definitions
  });
});

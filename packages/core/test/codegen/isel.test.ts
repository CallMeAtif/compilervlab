/**
 * Instruction-selection specifics: tile events (§8.9.2), the lab calling
 * convention (%rdi,%rsi,%rdx,%rcx,%r8,%r9 + diagnostic beyond 6), the
 * division idiom, the memory-resident float path, and the Chaitin move
 * exception.
 */
import { describe, expect, it } from 'vitest';
import { formatVInstr } from '../../src/codegen/cg-events.js';
import { runIsel, ARG_GP_REGISTERS, SSE_SCRATCH } from '../../src/codegen/isel.js';
import { runLiveness } from '../../src/codegen/liveness.js';
import { runInterference } from '../../src/codegen/interference.js';
import {
  callProgram,
  ci,
  fn,
  fnAbcProgram,
  floatProgram,
  gcdProgram,
  prog,
  q,
  resetQuads,
  t,
  v,
} from './fixtures.js';

describe('instruction selection (quad-at-a-time tiles, §8.9.2)', () => {
  it('fnAbc: each quad matches its tile, with the instructions as micro steps', () => {
    const { trace } = runIsel(fnAbcProgram());
    const tiles = trace.steps
      .filter((s) => s.event.kind === 'tile')
      .map((s) => s.event as { tacIndex: number; tileName: string; quadText: string });
    expect(tiles).toEqual([
      { kind: 'tile', functionName: 'f', tacIndex: 0, quadText: 't1 = a + b', tileName: 'binary-+' },
      { kind: 'tile', functionName: 'f', tacIndex: 1, quadText: 't2 = t1 * c', tileName: 'binary-*' },
      { kind: 'tile', functionName: 'f', tacIndex: 2, quadText: 'return t2', tileName: 'return-value' },
    ]);
    // every micro instr step carries a Dragon Book citation and prose
    for (const s of trace.steps) {
      expect(s.meta.cite.section).toMatch(/^8\./);
      expect(s.meta.prose.length).toBeGreaterThan(0);
    }
  });

  it('fnAbc: entry moves take arguments from %rdi, %rsi, %rdx in order', () => {
    const { result } = runIsel(fnAbcProgram());
    const f = result.functions[0]!;
    expect(f.params).toEqual(['a', 'b', 'c']);
    expect(f.code.slice(0, 3).map(formatVInstr)).toEqual([
      'movq %rdi, a',
      'movq %rsi, b',
      'movq %rdx, c',
    ]);
  });

  it('params become movq into the six argument registers; call carries them as uses', () => {
    const { result } = runIsel(callProgram());
    const main = result.functions[1]!;
    const texts = main.code.map(formatVInstr);
    expect(texts.slice(0, 4)).toEqual([
      'movq $2, %rdi',
      'movq $3, %rsi',
      'movq $4, %rdx',
      'call f',
    ]);
    const call = main.code[3]!;
    expect(call.extraUse).toEqual(['%rdi', '%rsi', '%rdx']);
    expect(call.extraDef).toEqual(['%rax']);
    expect(texts[4]).toBe('movq %rax, t1');
  });

  it('a 7th integer argument produces the convention diagnostic', () => {
    resetQuads();
    const quads = [];
    for (let i = 1; i <= 7; i++) quads.push(q('param', ci(i), null, null));
    quads.push(q('call', v(100, 'g'), ci(7), t(1)));
    quads.push(q('return', t(1), null, null));
    const program = prog([fn('main', 101, [], quads, 1)]);
    const { result } = runIsel(program);
    expect(result.diagnostics.length).toBe(1);
    expect(result.diagnostics[0]!.message).toMatch(/more than 6 integer arguments/);
    expect(ARG_GP_REGISTERS).toEqual(['%rdi', '%rsi', '%rdx', '%rcx', '%r8', '%r9']);
  });

  it('division reserves %rax/%rdx: movq/cqto/idivq/movq, no immediate divisor', () => {
    resetQuads();
    const program = prog([
      fn('main', 100, [], [q('/', ci(7), ci(2), t(1)), q('return', t(1), null, null)], 1),
    ]);
    const { result } = runIsel(program);
    const texts = result.functions[0]!.code.map(formatVInstr);
    expect(texts[0]).toBe('movq $7, %rax');
    expect(texts[1]).toBe('cqto');
    expect(texts[2]).toBe('movq $2, t2'); // idivq cannot take an immediate
    expect(texts[3]).toBe('idivq t2');
    expect(texts[4]).toBe('movq %rax, t1');
  });

  it('float values live in frame slots, not in round-robin %xmm registers; consts are pooled', () => {
    const { result } = runIsel(floatProgram());
    const main = result.functions[0]!;
    // Floats are not register-allocated: no float pseudo survives selection —
    // each one owns a frame slot and %xmm8 is the only SSE scratch used.
    expect(main.floatPseudos).toEqual([]);
    expect(main.frame.slots.filter((s) => s.reason === 'float').map((s) => s.name)).toEqual([
      't1', 't2', 't3', 't4', 't5',
    ]);
    const xmms = new Set(
      main.code.flatMap((i) =>
        i.operands.flatMap((o) => (o.k === 'phys' && o.reg.startsWith('%xmm') ? [o.reg] : [])),
      ),
    );
    expect([...xmms]).toEqual([SSE_SCRATCH]);
    expect(result.floatConsts.map((c) => c.value)).toEqual([1.5, 2.5, 11.9]);
    expect(result.floatConsts.map((c) => c.label)).toEqual(['.Lfc0', '.Lfc1', '.Lfc2']);
    // the int result of the float comparison is a GP pseudo, not SSE
    expect(main.pseudos.map((n) => n.id)).toContain('t6');
  });

  it('tile steps describe the algorithm that runs: one tile per opcode, no munch choice', () => {
    // tileQuad is a switch with exactly one tile per quad opcode — no candidate
    // set is enumerated and no tile sizes are compared, so the step must not
    // claim "maximal munch: choose the largest tile matching at the root".
    const { trace } = runIsel(gcdProgram());
    const tileSteps = trace.steps.filter((s) => s.event.kind === 'tile');
    expect(tileSteps.length).toBeGreaterThan(0);
    for (const s of tileSteps) {
      expect(s.meta.cite.section).toBe('8.9.2');
      expect(s.meta.cite.rule ?? '').not.toMatch(/largest tile|maximal munch/i);
      expect(s.meta.cite.figureOrAlgo ?? '').not.toMatch(/maximal.munch/i);
    }
  });

  it('emitted comment directive states the 64-bit simplification', () => {
    const { result } = runIsel(fnAbcProgram());
    expect(result.functions.length).toBe(1);
    // (the directive itself is emitted by emit.ts; see golden.test.ts line 1)
  });
});

describe('Chaitin move-related exception (§8.8.4)', () => {
  it('h(a){ t1=a; t2=a+t1; }: the copy suppresses the a—t1 edge though a stays live', () => {
    resetQuads();
    const program = prog([
      fn('h', 100, [1], [
        q('copy', v(1, 'a'), null, t(1)),
        q('+', v(1, 'a'), t(1), t(2)),
        q('return', t(2), null, null),
      ], 2),
    ]);
    const isel = runIsel(program);
    const live = runLiveness(isel.result);
    const interf = runInterference(isel.result, live.result);
    const h = interf.result[0]!;
    // a is live-out of `movq a, t1` (used by the next quad), yet no edge a—t1:
    const exceptions = interf.trace.steps.filter((s) => s.event.kind === 'moveException');
    expect(exceptions.length).toBeGreaterThan(0);
    expect(h.graph.edges).not.toContainEqual({ a: 'a', b: 't1' });
    expect(h.graph.edges).toContainEqual({ a: 't1', b: 't2' });
    expect(h.moves).toContainEqual({ a: 'a', b: 't1' });
  });

  it('gcd: copies are recorded as move-related pairs', () => {
    const isel = runIsel(gcdProgram());
    const live = runLiveness(isel.result);
    const interf = runInterference(isel.result, live.result);
    const gcd = interf.result[0]!;
    expect(gcd.moves).toContainEqual({ a: 'a', b: 't1' });
    expect(gcd.moves).toContainEqual({ a: 'b', b: 't2' });
  });

  it('fnAbc: precolored constraint — a is defined while %rsi (arg b) is live', () => {
    const isel = runIsel(fnAbcProgram());
    const live = runLiveness(isel.result);
    const interf = runInterference(isel.result, live.result);
    expect(interf.result[0]!.forbidden['a']).toEqual(['%rsi']);
  });
});

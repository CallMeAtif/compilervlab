/**
 * Trace invariants + determinism for every recorded IR-gen trace:
 *  - replay-equals-artifact, keyframe consistency, citation/prose presence
 *    (checkTraceInvariants from @lab/trace);
 *  - two recordings on the same input are event-identical;
 *  - reducer-state details: label table, active backpatch lists drain to
 *    empty, and the current-node highlight follows enter-node events.
 */
import { describe, expect, it } from 'vitest';
import { checkTraceInvariants, deepEqual } from '@lab/trace';
import { runIrGen } from '../../src/ir/gen.js';
import { irGenReducer, projectIrGenState } from '../../src/ir/ir-events.js';
import { allFixtures, whileProgram } from './programs.js';

describe('ir gen trace invariants', () => {
  for (const fix of allFixtures) {
    it(`checkTraceInvariants: ${fix.name}`, () => {
      const { ast, sem } = fix.build();
      const recorded = runIrGen(ast, sem);
      const violations = checkTraceInvariants(recorded, irGenReducer, projectIrGenState);
      expect(violations).toEqual([]);
      expect(recorded.trace.truncated).toBe(false);
    });
  }

  for (const fix of allFixtures) {
    it(`determinism: ${fix.name} — two recordings are event-identical`, () => {
      const { ast, sem } = fix.build();
      const r1 = runIrGen(ast, sem);
      const r2 = runIrGen(ast, sem);
      expect(r1.trace.length).toBe(r2.trace.length);
      expect(deepEqual([...r1.trace.steps], [...r2.trace.steps])).toBe(true);
      expect(deepEqual(r1.result, r2.result)).toBe(true);
      // a rebuilt fixture (fresh ids) also produces the identical trace
      const { ast: a3, sem: s3 } = fix.build();
      const r3 = runIrGen(a3, s3);
      expect(deepEqual([...r1.trace.steps], [...r3.trace.steps])).toBe(true);
    });
  }
});

describe('ir gen reducer state (UI contract)', () => {
  it('final state has the label table and no active backpatch lists', () => {
    const { ast, sem } = whileProgram.build();
    const recorded = runIrGen(ast, sem);
    const final = recorded.trace.final();
    expect(final.activeLists).toEqual([]);
    expect(final.currentFunc).toBeNull();
    expect(final.currentAstNode).toBeNull();
    const f = final.functions[0]!;
    expect(f.labels).toEqual([
      { name: 'L1', instr: 0 },
      { name: 'L2', instr: 3 },
      { name: 'L3', instr: 7 },
    ]);
    expect(f.tempCount).toBe(1);
  });

  it('mid-trace state shows unfilled jumps and live backpatch lists', () => {
    const { ast, sem } = whileProgram.build();
    const recorded = runIrGen(ast, sem);
    const { trace } = recorded;
    // find the state right after the falselist "goto _" makelist
    const idx = trace.findIndex(
      (s) => s.event.kind === 'makelist' && s.event.role === 'falselist',
    );
    expect(idx).toBeGreaterThan(-1);
    const mid = trace.stateAt(idx + 1);
    expect(mid.currentFunc).toBe('f');
    const lists = mid.activeLists;
    expect(lists.some((l) => l.role === 'truelist')).toBe(true);
    expect(lists.some((l) => l.role === 'falselist')).toBe(true);
    // the goto quad's target is still unfilled at this point
    const gotoQuad = mid.functions[0]!.quads.find((q) => q.op === 'goto');
    expect(gotoQuad?.result).toBeNull();
  });

  it('every step cites the Dragon Book and explains itself', () => {
    const { ast, sem } = whileProgram.build();
    const { trace } = runIrGen(ast, sem);
    for (const s of trace.steps) {
      expect(s.meta.cite.section).toMatch(/^6\./);
      expect(s.meta.prose.length).toBeGreaterThan(10);
      expect(['macro', 'micro']).toContain(s.meta.level);
    }
    // named sections exist for the scrubber
    const sections = trace.sections().map((s) => s.name);
    expect(sections).toContain('globals');
    expect(sections).toContain('f()');
  });

  it('emit-quad micro steps carry provenance to their AST node and instruction', () => {
    const { ast, sem } = whileProgram.build();
    const { trace } = runIrGen(ast, sem);
    for (const s of trace.steps) {
      const ev = s.event;
      if (ev.kind !== 'emit-quad') continue;
      expect(s.meta.level).toBe('micro');
      const refs = s.meta.irRefs ?? [];
      expect(refs.some((r) => r.kind === 'tacInstr' && r.id === ev.quad.index)).toBe(true);
      expect(refs.some((r) => r.kind === 'astNode' && r.id === ev.quad.astNodeId)).toBe(true);
      expect(s.meta.groupId).toBe(`n${ev.quad.astNodeId}`);
    }
  });
});

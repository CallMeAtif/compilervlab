/**
 * Golden: LALR construction for Grammar 4.55 must merge I3/I6, I4/I7, I8/I9
 * (book names I36, I47, I89) and reproduce the Fig 4.43 table; the grammar of
 * Example 4.58 must exhibit the reduce/reduce conflicts introduced by merging.
 */
import { describe, expect, it } from 'vitest';
import { checkTraceInvariants } from '@lab/trace';
import { cGrammar, grammar455 } from '../../src/csubset/grammar-def.js';
import { augment, grammarFromRules } from '../../src/grammar/grammar.js';
import { drain, actionToString, type LrAction } from '../../src/grammar/lr-events.js';
import { lr1Table } from '../../src/grammar/lr1-items.js';
import { lalrReducer, lalrRun, type LalrResult } from '../../src/grammar/lalr.js';
import { fmtLr1StateMerged } from './helpers.js';

const ag455 = augment(grammar455());

/** Display an action with the merged-state NAME as shift target (book style). */
function disp(r: LalrResult, a: LrAction): string {
  return a.type === 'shift' ? `s${r.states[a.to]!.name}` : actionToString(a);
}

describe('LALR for Grammar 4.55 (Fig 4.43)', () => {
  const rec = lalrRun(grammar455());
  const r = rec.result;

  it('merges exactly the same-core pairs I36, I47, I89', () => {
    expect(r.lr1StateCount).toBe(10);
    expect(r.states.map((s) => s.name)).toEqual(['0', '1', '2', '36', '47', '5', '89']);
    expect(r.states[3]!.sources).toEqual([3, 6]);
    expect(r.states[4]!.sources).toEqual([4, 7]);
    expect(r.states[6]!.sources).toEqual([8, 9]);
  });

  it('unions the lookaheads of merged states', () => {
    expect(fmtLr1StateMerged(ag455, r.states[3]!)).toEqual([
      'K C → c · C, c/d/$',
      '  C → · c C, c/d/$',
      '  C → · d, c/d/$',
    ]);
    expect(fmtLr1StateMerged(ag455, r.states[4]!)).toEqual(['K C → d ·, c/d/$']);
    expect(fmtLr1StateMerged(ag455, r.states[6]!)).toEqual(['K C → c C ·, c/d/$']);
  });

  it('highlights the lookahead unions in the merge events', () => {
    const merge36 = rec.trace.steps.find(
      (s) => s.event.kind === 'lalr/merge' && s.event.state.name === '36',
    )!;
    expect(merge36.meta.prose).toContain('I3 and I6');
    if (merge36.event.kind === 'lalr/merge') {
      expect(merge36.event.merged).toBe(true);
      const u = merge36.event.lookaheadUnions.find((x) => x.core === 'C → c · C')!;
      expect(u.union).toEqual(['c', 'd', '$']);
      expect(u.parts).toEqual([
        { source: 3, las: ['c', 'd'] },
        { source: 6, las: ['$'] },
      ]);
    }
  });

  it('matches the Fig 4.43 table cell-for-cell (by merged-state name)', () => {
    const table: Record<string, Record<string, string>> = {};
    const gotoTable: Record<string, Record<string, string>> = {};
    for (const st of r.states) {
      table[st.name] = Object.fromEntries(
        Object.entries(r.action[st.id]!).map(([k, a]) => [k, disp(r, a)]),
      );
      gotoTable[st.name] = Object.fromEntries(
        Object.entries(r.goto[st.id]!).map(([k, to]) => [k, r.states[to]!.name]),
      );
    }
    expect(table).toEqual({
      '0': { c: 's36', d: 's47' },
      '1': { $: 'acc' },
      '2': { c: 's36', d: 's47' },
      '36': { c: 's36', d: 's47' },
      '47': { c: 'r3', d: 'r3', $: 'r3' },
      '5': { $: 'r1' },
      '89': { c: 'r2', d: 'r2', $: 'r2' },
    });
    expect(gotoTable).toEqual({
      '0': { S: '1', C: '2' },
      '1': {},
      '2': { C: '5' },
      '36': { C: '89' },
      '47': {},
      '5': {},
      '89': {},
    });
    expect(r.conflicts).toEqual([]);
  });

  it('numbers table rows by the merged-state names throughout the trace', () => {
    const proseOf = (kind: string) =>
      rec.trace.steps.filter((s) => s.event.kind === kind).map((s) => s.meta.prose);
    const tableProse = [
      ...proseOf('table/row'),
      ...proseOf('table/action'),
      ...proseOf('table/goto'),
    ];
    // Fig 4.43's rows are 0,1,2,36,47,5,89 — an internal id (here 3,4,6) must
    // never appear as a row/target number next to a book name.
    expect(tableProse.some((p) => p.includes('ACTION[47, c] = r3'))).toBe(true);
    expect(tableProse.some((p) => p.includes('ACTION[0, c] = s36'))).toBe(true);
    expect(tableProse.some((p) => p.includes('GOTO(36, C) = 89'))).toBe(true);
    const names = r.states.map((s) => s.name);
    for (const p of tableProse) {
      for (const m of p.matchAll(/(?:ACTION\[|GOTO\[|GOTO\(|Fill row )(\d+)/g)) {
        expect(names).toContain(m[1]!);
      }
    }
  });

  it('satisfies the trace invariants', () => {
    expect(checkTraceInvariants(rec, lalrReducer, (x) => x)).toEqual([]);
  });

  it('is deterministic', () => {
    const rec2 = lalrRun(grammar455());
    expect(JSON.stringify(rec2.trace.steps)).toBe(JSON.stringify(rec.trace.steps));
  });
});

describe('merged-state names stay unambiguous beyond one-digit collections', () => {
  it('separates the source ids when concatenation would be unreadable', () => {
    const r = lalrRun(cGrammar()).result;
    expect(r.lr1StateCount).toBeGreaterThan(10);
    const merged = r.states.filter((s) => s.sources.length > 1);
    expect(merged.length).toBeGreaterThan(0);
    for (const s of merged) {
      // The name must parse back to exactly the states it stands for.
      expect(s.name.split(',').map(Number)).toEqual(s.sources);
    }
    for (const s of r.states) {
      if (s.sources.length === 1) expect(s.name).toBe(String(s.sources[0]));
    }
    expect(new Set(r.states.map((s) => s.name)).size).toBe(r.states.length);
  });

  it('keeps the book spelling (I36) while every id is a single digit', () => {
    const r = lalrRun(grammar455()).result;
    expect(r.states.map((s) => s.name)).toEqual(['0', '1', '2', '36', '47', '5', '89']);
  });
});

describe('reduce/reduce conflicts introduced by merging (Example 4.58)', () => {
  const g458 = grammarFromRules(
    'Dragon 4.58',
    ['S -> a A d | b B d | a B e | b A e', 'A -> c', 'B -> c'],
    ['a', 'b', 'c', 'd', 'e'],
  );

  it('the grammar is LR(1): the canonical table has no conflicts', () => {
    expect(drain(lr1Table(g458)).conflicts).toEqual([]);
  });

  it('merging {A → c·}/{B → c·} states creates reduce/reduce conflicts on d and e', () => {
    const rec = lalrRun(g458);
    const conflicts = rec.result.conflicts;
    expect(conflicts.length).toBe(2);
    expect(conflicts.map((c) => c.symbol)).toEqual(['d', 'e']);
    for (const c of conflicts) {
      expect(c.kind).toBe('reduce/reduce');
      expect(c.resolution).toBeNull();
      expect(c.actions.every((a) => a.type === 'reduce')).toBe(true);
    }
    const step = rec.trace.steps.find((s) => s.event.kind === 'table/conflict')!;
    expect(step.meta.prose).toContain('introduced by the merge');
    expect(step.meta.prose).toContain('not LALR(1)');
    expect(checkTraceInvariants(rec, lalrReducer, (x) => x)).toEqual([]);
  });
});

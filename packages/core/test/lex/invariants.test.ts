/**
 * Trace invariants (replay ≡ artifact, keyframe consistency, citations/prose)
 * and determinism (two runs are event-identical) for all four lex traces.
 */
import { describe, expect, it } from 'vitest';
import { checkTraceInvariants, type StepRecord } from '@lab/trace';
import { cat, lit, oneOf, resetRegexIds, star } from '../../src/csubset/regex.js';
import { runMinimize } from '../../src/lex/minimize.js';
import {
  minimizeReducer,
  projectDfa,
  projectMinDfa,
  projectNfa,
  projectScan,
  scanReducer,
  subsetReducer,
  thompsonReducer,
} from '../../src/lex/reducers.js';
import { runScan } from '../../src/lex/scanner.js';
import { runSubsetConstruction } from '../../src/lex/subset-construction.js';
import { runThompson } from '../../src/lex/thompson.js';
import { toMultiNfa } from '../../src/lex/types.js';

function fig334Regex() {
  resetRegexIds();
  return cat(star(oneOf('ab')), lit('abb'));
}

const SAMPLE_SOURCE = [
  'int main() {',
  '  float f = 12.5; // sum',
  "  char c = '\\n';",
  '  /* block',
  '     comment */',
  '  if (f >= 2.0 && c != 0) { return 1; }',
  '  @ 12 . 5',
  '  return 0;',
  '}',
].join('\n');

describe('trace invariants (checkTraceInvariants)', () => {
  it('thompson trace satisfies all invariants', () => {
    const rec = runThompson(fig334Regex());
    expect(checkTraceInvariants(rec, thompsonReducer, projectNfa)).toEqual([]);
  });

  it('subset-construction trace satisfies all invariants', () => {
    const nfa = runThompson(fig334Regex()).result;
    const rec = runSubsetConstruction(toMultiNfa(nfa));
    expect(checkTraceInvariants(rec, subsetReducer, projectDfa)).toEqual([]);
  });

  it('minimize trace satisfies all invariants', () => {
    const nfa = runThompson(fig334Regex()).result;
    const dfa = runSubsetConstruction(toMultiNfa(nfa)).result;
    const rec = runMinimize(dfa);
    expect(checkTraceInvariants(rec, minimizeReducer, projectMinDfa)).toEqual([]);
  });

  it('minimize trace satisfies invariants on a partial DFA (dead state path)', () => {
    resetRegexIds();
    // abb alone: the subset DFA is partial (no b from start, no a mid-pattern)
    const nfa = runThompson(lit('abb')).result;
    const dfa = runSubsetConstruction(toMultiNfa(nfa)).result;
    const rec = runMinimize(dfa);
    expect(checkTraceInvariants(rec, minimizeReducer, projectMinDfa)).toEqual([]);
    expect(rec.result.states.map((s) => s.id)).not.toContain('∅');
  });

  it('scan trace satisfies all invariants (including error paths)', () => {
    const rec = runScan(SAMPLE_SOURCE);
    expect(checkTraceInvariants(rec, scanReducer, projectScan)).toEqual([]);
    expect(rec.result.errors.length).toBeGreaterThan(0); // exercises the error events
  });

  it('scan trace satisfies invariants on unterminated-comment and charconst errors', () => {
    for (const src of ['a /* open', "'x", "''", "'ab'", '|']) {
      const rec = runScan(src);
      expect(checkTraceInvariants(rec, scanReducer, projectScan)).toEqual([]);
    }
  });

  it('every step of every trace is macro, or micro with a groupId', () => {
    const traces: Array<ReadonlyArray<StepRecord<{ kind: string }>>> = [
      runThompson(fig334Regex()).trace.steps,
      runScan(SAMPLE_SOURCE).trace.steps,
    ];
    const nfa = runThompson(fig334Regex()).result;
    const dfa = runSubsetConstruction(toMultiNfa(nfa));
    traces.push(dfa.trace.steps, runMinimize(dfa.result).trace.steps);
    for (const steps of traces) {
      for (const s of steps) {
        if (s.meta.level === 'micro') expect(s.meta.groupId, `${s.event.kind} @${s.index}`).toBeTruthy();
        expect(s.meta.cite.section).toMatch(/^3\./);
      }
    }
  });
});

describe('determinism: two runs produce identical event sequences', () => {
  const stepsJson = (steps: ReadonlyArray<unknown>) => JSON.stringify(steps);

  it('thompson', () => {
    const a = runThompson(fig334Regex()).trace.steps;
    const b = runThompson(fig334Regex()).trace.steps;
    expect(stepsJson(a)).toEqual(stepsJson(b));
  });

  it('subset construction', () => {
    const mk = () => runSubsetConstruction(toMultiNfa(runThompson(fig334Regex()).result)).trace.steps;
    expect(stepsJson(mk())).toEqual(stepsJson(mk()));
  });

  it('minimize', () => {
    const mk = () =>
      runMinimize(runSubsetConstruction(toMultiNfa(runThompson(fig334Regex()).result)).result).trace.steps;
    expect(stepsJson(mk())).toEqual(stepsJson(mk()));
  });

  it('scan', () => {
    const a = runScan(SAMPLE_SOURCE).trace.steps;
    const b = runScan(SAMPLE_SOURCE).trace.steps;
    expect(stepsJson(a)).toEqual(stepsJson(b));
  });
});

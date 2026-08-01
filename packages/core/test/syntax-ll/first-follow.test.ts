import { describe, expect, it } from 'vitest';
import { grammar41, grammar428 } from '../../src/csubset/grammar-def.js';
import { EPSILON } from '../../src/grammar/grammar.js';
import {
  firstFollow,
  firstFollowReducer,
  firstOfString,
  runFirstFollow,
} from '../../src/grammar/first-follow.js';
import { expectInvariants, expectSameTrace, sorted } from './helpers.js';

describe('FIRST/FOLLOW — Grammar 4.28 (Example 4.30)', () => {
  const { first, follow } = firstFollow(grammar428());

  it('FIRST(E) = FIRST(T) = FIRST(F) = { (, id }', () => {
    expect(first['E']).toEqual(sorted(['(', 'id']));
    expect(first['T']).toEqual(sorted(['(', 'id']));
    expect(first['F']).toEqual(sorted(['(', 'id']));
  });

  it("FIRST(E') = { +, ε } and FIRST(T') = { *, ε }", () => {
    expect(first["E'"]).toEqual(sorted(['+', EPSILON]));
    expect(first["T'"]).toEqual(sorted(['*', EPSILON]));
  });

  it("FOLLOW(E) = FOLLOW(E') = { ), $ }", () => {
    expect(follow['E']).toEqual(sorted([')', '$']));
    expect(follow["E'"]).toEqual(sorted([')', '$']));
  });

  it("FOLLOW(T) = FOLLOW(T') = { +, ), $ }", () => {
    expect(follow['T']).toEqual(sorted(['+', ')', '$']));
    expect(follow["T'"]).toEqual(sorted(['+', ')', '$']));
  });

  it('FOLLOW(F) = { +, *, ), $ }', () => {
    expect(follow['F']).toEqual(sorted(['+', '*', ')', '$']));
  });
});

describe('FIRST/FOLLOW — Grammar 4.1', () => {
  const { first, follow } = firstFollow(grammar41());

  it('FIRST sets', () => {
    expect(first['E']).toEqual(sorted(['(', 'id']));
    expect(first['T']).toEqual(sorted(['(', 'id']));
    expect(first['F']).toEqual(sorted(['(', 'id']));
  });

  it('FOLLOW sets', () => {
    expect(follow['E']).toEqual(sorted(['+', ')', '$']));
    expect(follow['T']).toEqual(sorted(['+', '*', ')', '$']));
    expect(follow['F']).toEqual(sorted(['+', '*', ')', '$']));
  });
});

describe('firstOfString', () => {
  const g = grammar428();
  const { first } = firstFollow(g);

  it("FIRST(T E') = { (, id }", () => {
    expect(firstOfString(g, first, ['T', "E'"])).toEqual(sorted(['(', 'id']));
  });

  it("FIRST(E' T') includes ε only if all nullable", () => {
    expect(firstOfString(g, first, ["E'", "T'"])).toEqual(sorted(['+', '*', EPSILON]));
    expect(firstOfString(g, first, ["E'", 'F'])).toEqual(sorted(['+', '(', 'id']));
  });

  it('FIRST(ε-string) = { ε } and terminals are their own FIRST', () => {
    expect(firstOfString(g, first, [])).toEqual([EPSILON]);
    expect(firstOfString(g, first, ['+', 'E'])).toEqual(['+']);
  });
});

describe('FIRST/FOLLOW — trace quality', () => {
  it('every addition event carries a justification and production', () => {
    const rec = runFirstFollow(grammar428());
    const adds = rec.trace.steps.filter(
      (s) => s.event.kind === 'ff.first.add' || s.event.kind === 'ff.follow.add',
    );
    expect(adds.length).toBeGreaterThan(0);
    for (const s of adds) {
      const ev = s.event as { justification: string };
      expect(ev.justification).toMatch(/rule/);
      expect(s.meta.cite.section).toBe('4.4.2');
      expect(s.meta.cite.rule).toBeTruthy();
    }
  });

  it('has pass-boundary macro steps and FIRST/FOLLOW sections', () => {
    const rec = runFirstFollow(grammar428());
    const passes = rec.trace.steps.filter((s) => s.event.kind === 'ff.pass');
    expect(passes.length).toBeGreaterThanOrEqual(2);
    const sections = rec.trace.sections().map((s) => s.name);
    expect(sections).toContain('FIRST');
    expect(sections).toContain('FOLLOW');
  });

  it('satisfies the trace invariants (4.28 and 4.1)', () => {
    for (const g of [grammar428(), grammar41()]) {
      expectInvariants(runFirstFollow(g), firstFollowReducer, (r) => r);
    }
  });

  it('is deterministic: two recordings are event-identical', () => {
    expectSameTrace(runFirstFollow(grammar428()), runFirstFollow(grammar428()));
    expectSameTrace(runFirstFollow(grammar41()), runFirstFollow(grammar41()));
  });
});

import { describe, expect, it } from 'vitest';
import { grammar41, grammar428 } from '../../src/csubset/grammar-def.js';
import { grammarFromRules } from '../../src/grammar/grammar.js';
import { ll1ParseReducer, ll1ParseSteps, runLL1Parse } from '../../src/grammar/ll1-parse.js';
import { expectInvariants, expectSameTrace } from './helpers.js';

describe('predictive parse — Fig 4.21 moves for "id + id * id" (Grammar 4.28)', () => {
  const rec = runLL1Parse(grammar428(), ['id', '+', 'id', '*', 'id']);
  const final = rec.trace.final();

  it('accepts the input', () => {
    expect(final.status).toBe('accepted');
    expect(final.error).toBeNull();
    expect(final.notes).toEqual([]); // no conflict cells were consulted
  });

  it('reproduces the moves table row for row', () => {
    // Fig 4.21, with columns MATCHED / STACK (top first) / INPUT / ACTION.
    const rows: Array<[string, string, string, string]> = [
      ['', 'E $', 'id + id * id $', ''],
      ['', "T E' $", 'id + id * id $', "output E → T E'"],
      ['', "F T' E' $", 'id + id * id $', "output T → F T'"],
      ['', "id T' E' $", 'id + id * id $', 'output F → id'],
      ['id', "T' E' $", '+ id * id $', 'match id'],
      ['id', "E' $", '+ id * id $', "output T' → ε"],
      ['id', "+ T E' $", '+ id * id $', "output E' → + T E'"],
      ['id +', "T E' $", 'id * id $', 'match +'],
      ['id +', "F T' E' $", 'id * id $', "output T → F T'"],
      ['id +', "id T' E' $", 'id * id $', 'output F → id'],
      ['id + id', "T' E' $", '* id $', 'match id'],
      ['id + id', "* F T' E' $", '* id $', "output T' → * F T'"],
      ['id + id *', "F T' E' $", 'id $', 'match *'],
      ['id + id *', "id T' E' $", 'id $', 'output F → id'],
      ['id + id * id', "T' E' $", '$', 'match id'],
      ['id + id * id', "E' $", '$', "output T' → ε"],
      ['id + id * id', '$', '$', "output E' → ε"],
      ['id + id * id', '$', '$', 'accept'],
    ];
    expect(final.log.length).toBe(rows.length);
    final.log.forEach((row, i) => {
      const [matched, stack, input, action] = rows[i]!;
      expect(row, `row ${i}`).toEqual({ matched, stack, input, action });
    });
  });

  it('builds the parse tree incrementally, attaching children on expand', () => {
    const root = final.nodes[0]!;
    expect(root.symbol).toBe('E');
    expect(root.children.map((c) => final.nodes[c]!.symbol)).toEqual(['T', "E'"]);
    // ε leaves exist for the ε-productions used (T' → ε twice, E' → ε once)
    const epsLeaves = final.nodes.filter((n) => n.symbol === 'ε');
    expect(epsLeaves.length).toBe(3);
    // every non-root node is referenced by exactly one parent
    const refs = final.nodes.flatMap((n) => n.children);
    expect(refs.length).toBe(final.nodes.length - 1);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it('every expand step records its production and cites Algorithm 4.34', () => {
    for (const s of rec.trace.steps) {
      if (s.event.kind !== 'll1p.expand') continue;
      expect(s.event.production.id).toBeGreaterThanOrEqual(0);
      expect(s.meta.cite.figureOrAlgo).toContain('Algorithm 4.34');
      expect(s.meta.irRefs?.some((r) => r.kind === 'production')).toBe(true);
    }
  });
});

describe('predictive parse — errors', () => {
  it('empty table cell: reports the expected set from the table row', () => {
    const rec = runLL1Parse(grammar428(), ['+', 'id']);
    const final = rec.trace.final();
    expect(final.status).toBe('error');
    expect(final.error!.found).toBe('+');
    expect(final.error!.expected).toEqual(['(', 'id']); // row E of Fig 4.17
    expect(final.error!.message).toContain('M[E, +]');
  });

  it('terminal mismatch: expected the stack-top terminal', () => {
    // "( id" leaves ) on the stack when the input runs out
    const rec = runLL1Parse(grammar428(), ['(', 'id']);
    const final = rec.trace.final();
    expect(final.status).toBe('error');
    expect(final.error!.expected).toEqual([')']);
    expect(final.error!.found).toBe('$');
  });

  it('trailing input after a complete derivation is rejected', () => {
    const rec = runLL1Parse(grammar428(), ['id', ')']);
    const final = rec.trace.final();
    expect(final.status).toBe('error');
    expect(final.error!.expected).toEqual(['$']);
  });
});

describe('predictive parse — conflict notes describe the choice actually made', () => {
  /** The note text and the cite of the (single) ll1p.note step of a parse. */
  function noteOf(g: Parameters<typeof runLL1Parse>[0], input: string[]) {
    const rec = runLL1Parse(g, input);
    const step = rec.trace.steps.find((s) => s.event.kind === 'll1p.note')!;
    expect(step, 'a conflict cell should have produced a note').toBeDefined();
    return { message: rec.trace.final().notes[0]!, cite: step.meta.cite };
  }

  it('FIRST + FOLLOW cell: reports the Example 4.33 resolution and cites §4.4.3', () => {
    // Example 4.33 itself: S → i E t S S' | a ; S' → e S | ε ; E → b
    const g = grammarFromRules(
      'dangling else (4.33)',
      ["S -> i E t S S' | a", "S' -> e S | ε", 'E -> b'],
      ['i', 't', 'e', 'a', 'b'],
    );
    const { message, cite } = noteOf(g, ['i', 'b', 't', 'a', 'e', 'a']);
    expect(cite.section).toBe('4.4.3');
    expect(message).toMatch(/S' → e S/);
    expect(message).toMatch(/consumes the lookahead e/);
    expect(message).toMatch(/Example 4\.33/);
  });

  it('FIRST case listed second: the note names the entry actually chosen, not the first', () => {
    // M[A, a] = [A → ε (FOLLOW), A → a (FIRST)]; the parser uses A → a.
    const g = grammarFromRules('first-after-follow', ['S -> A a', 'A -> ε | a'], ['a']);
    const { message } = noteOf(g, ['a', 'a']);
    expect(message).toMatch(/choosing A → a\b/);
    expect(message).not.toMatch(/first-listed/);
  });

  it('two FIRST-case entries plus an ε-entry: only the ε-entry is the FOLLOW-case one', () => {
    // M[A, a] = [A → a X (FIRST), A → a Y (FIRST), A → ε (FOLLOW)]. Example 4.33
    // settles FIRST against FOLLOW but says nothing about A → a X vs A → a Y, so
    // the rival FIRST-case entry must not be lumped in with the ε-entry.
    const g = grammarFromRules(
      'mixed-case',
      ['S -> A a', 'A -> a X | a Y | ε', 'X -> x', 'Y -> y'],
      ['a', 'x', 'y'],
    );
    const { message, cite } = noteOf(g, ['a', 'x', 'a']);
    expect(cite.section).toBe('4.4.3');
    expect(message).toMatch(/holds 3 productions/);
    expect(message).toMatch(/choosing A → a X\b/);
    // the ε-entry, and only it, is described as the FOLLOW-case alternative
    expect(message).toMatch(/FOLLOW-case entry \(A → ε\)/);
    expect(message).not.toMatch(/FOLLOW-case entr(?:y|ies) \([^)]*A → a Y/);
    // the other FIRST-case alternative is reported as the arbitrary tie-break it is
    expect(message).toMatch(/other FIRST-case entry \(A → a Y\) also consumes a/);
    expect(message).toMatch(/first-listed/);
  });

  it('two FOLLOW-case entries: does not claim the chosen entry consumes input', () => {
    const g = grammarFromRules('two-eps', ['S -> A c', 'A -> B | C', 'B -> ε', 'C -> ε'], ['c']);
    const { message, cite } = noteOf(g, ['c']);
    expect(cite.section).toBe('4.4.3');
    expect(message).toMatch(/A → B/);
    expect(message).toMatch(/FOLLOW case/);
    expect(message).toMatch(/first-listed/);
    expect(message).not.toMatch(/consumes the lookahead c/);
    expect(message).not.toMatch(/nearest|closest/);
  });

  it('two FIRST-case entries: reports an arbitrary tie-break, not the dangling-else story', () => {
    const g = grammarFromRules('common-prefix', ['S -> a X | a Y', 'X -> x', 'Y -> y'], [
      'a',
      'x',
      'y',
    ]);
    const { message, cite } = noteOf(g, ['a', 'x']);
    expect(cite.section).toBe('4.4.3');
    expect(message).toMatch(/FIRST case/);
    expect(message).toMatch(/first-listed/);
    expect(message).not.toMatch(/else|then/);
  });

  it('never cites §4.8.2 (the LR shift/reduce dangling-else section) for an LL(1) conflict', () => {
    const grammars: Array<[Parameters<typeof runLL1Parse>[0], string[]]> = [
      [grammarFromRules('two-eps', ['S -> A c', 'A -> B | C', 'B -> ε', 'C -> ε'], ['c']), ['c']],
      [
        grammarFromRules('common-prefix', ['S -> a X | a Y', 'X -> x', 'Y -> y'], ['a', 'x', 'y']),
        ['a', 'x'],
      ],
      [grammarFromRules('first-after-follow', ['S -> A a', 'A -> ε | a'], ['a']), ['a', 'a']],
    ];
    for (const [g, input] of grammars) {
      const rec = runLL1Parse(g, input);
      for (const s of rec.trace.steps) {
        expect(s.meta.cite.section, `${g.name}`).not.toBe('4.8.2');
      }
      for (const n of rec.trace.final().notes) expect(n).not.toMatch(/4\.8\.2/);
    }
  });
});

describe('predictive parse — divergence guard (§4.3.3)', () => {
  // Grammar 4.1 is left recursive: M[E, id] selects E → E + T, which pops E and
  // pushes it back without consuming input.
  const diverging = () => runLL1Parse(grammar41(), ['id', '*', 'id', '+', 'id']);

  it('terminates instead of looping forever', () => {
    const gen = ll1ParseSteps(grammar41(), ['id', '*', 'id', '+', 'id']);
    let n = 0;
    let it = gen.next();
    while (!it.done && n < 5_000) {
      n++;
      it = gen.next();
    }
    expect(it.done).toBe(true);
    expect(n).toBeLessThan(5_000);
  });

  it('ends with a divergence diagnostic that names left recursion and Algorithm 4.19', () => {
    const rec = diverging();
    const final = rec.trace.final();
    expect(final.status).toBe('error');
    expect(final.error!.kind).toBe('divergence');
    expect(final.error!.expected).toEqual([]);
    expect(final.error!.message).toMatch(/left-recursive/);
    const last = rec.trace.steps[rec.trace.steps.length - 1]!;
    expect(last.event.kind).toBe('ll1p.diverged');
    expect(last.meta.cite.section).toBe('4.3.3');
    expect(last.meta.cite.figureOrAlgo).toBe('Algorithm 4.19');
    expect(final.log[final.log.length - 1]!.action).toMatch(/^stopped: /);
  });

  it('the truncated run still satisfies the replay invariants and is deterministic', () => {
    expectInvariants(diverging(), ll1ParseReducer, (r) => r);
    expectSameTrace(diverging(), diverging());
  });

  it('never fires on a parse that terminates normally', () => {
    for (const input of [['id', '+', 'id', '*', 'id'], ['+', 'id'], ['(', 'id']]) {
      const rec = runLL1Parse(grammar428(), input);
      expect(rec.trace.steps.some((s) => s.event.kind === 'll1p.diverged')).toBe(false);
      expect(rec.trace.final().error?.kind ?? 'syntax').toBe('syntax');
    }
  });
});

describe('predictive parse — trace quality', () => {
  it('satisfies the trace invariants (accepting and erroring runs)', () => {
    const g = grammar428();
    expectInvariants(runLL1Parse(g, ['id', '+', 'id', '*', 'id']), ll1ParseReducer, (r) => r);
    expectInvariants(runLL1Parse(g, ['+', 'id']), ll1ParseReducer, (r) => r);
  });

  it('is deterministic', () => {
    const g = grammar428();
    expectSameTrace(
      runLL1Parse(g, ['id', '+', 'id', '*', 'id']),
      runLL1Parse(g, ['id', '+', 'id', '*', 'id']),
    );
  });
});

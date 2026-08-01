import { describe, expect, it } from 'vitest';
import { grammar428 } from '../../src/csubset/grammar-def.js';
import { rdReducer, runRecursiveDescent } from '../../src/grammar/recursive-descent.js';
import { expectInvariants, expectSameTrace } from './helpers.js';

describe('recursive descent — "id + id * id" with Grammar 4.28', () => {
  const rec = runRecursiveDescent(grammar428(), ['id', '+', 'id', '*', 'id']);
  const final = rec.trace.final();

  it('accepts and consumes the whole input', () => {
    expect(final.status).toBe('accepted');
    expect(final.pos).toBe(5);
    expect(final.notes).toEqual([]); // grammar 4.28 is LL(1): no ambiguity notes
  });

  it('grows a call tree rooted at E matching the derivation', () => {
    const root = final.nodes[0]!;
    expect(root.symbol).toBe('E');
    expect(root.status).toBe('done');
    expect(root.production).toBe(0); // E → T E'
    expect(root.children.map((c) => final.nodes[c]!.symbol)).toEqual(['T', "E'"]);
    // every nonterminal call node finished
    for (const n of final.nodes) {
      expect(n.status === 'active', `node ${n.id} (${n.symbol}) still active`).toBe(false);
    }
    // the leaves, in creation order, spell the matched sentence plus ε choices
    const leaves = final.nodes.filter((n) => n.status === 'leaf').map((n) => n.symbol);
    expect(leaves.filter((s) => s !== 'ε')).toEqual(['id', '+', 'id', '*', 'id']);
  });

  it('call events are macro steps; each selection is justified by the lookahead', () => {
    let calls = 0;
    for (const s of rec.trace.steps) {
      if (s.event.kind === 'rd.call') {
        calls++;
        expect(s.meta.level).toBe('macro');
        expect(s.meta.cite.section).toBe('4.4.1');
      }
      if (s.event.kind === 'rd.select') {
        expect(s.event.justification).toMatch(/FIRST|FOLLOW/);
        expect(s.meta.groupId).toBe(`rd-${s.event.node}`);
      }
    }
    expect(calls).toBe(11); // one call per production used in the derivation (Fig 4.21 has 11 outputs)
  });
});

describe('recursive descent — errors', () => {
  it('no production predicts the lookahead', () => {
    const rec = runRecursiveDescent(grammar428(), ['+', 'id']);
    const final = rec.trace.final();
    expect(final.status).toBe('error');
    expect(final.error!.found).toBe('+');
    expect(final.error!.expected).toEqual(['(', 'id']); // FIRST(E)
  });

  it('terminal mismatch inside a body', () => {
    const rec = runRecursiveDescent(grammar428(), ['(', 'id']);
    const final = rec.trace.final();
    expect(final.status).toBe('error');
    expect(final.error!.expected).toEqual([')']);
    expect(final.error!.found).toBe('$');
  });

  it('trailing input after the start procedure returns', () => {
    const rec = runRecursiveDescent(grammar428(), ['id', ')']);
    const final = rec.trace.final();
    expect(final.status).toBe('error');
    expect(final.error!.expected).toEqual(['$']);
    expect(final.error!.found).toBe(')');
  });
});

describe('recursive descent — trace quality', () => {
  it('satisfies the trace invariants (accepting and erroring runs)', () => {
    const g = grammar428();
    expectInvariants(runRecursiveDescent(g, ['id', '+', 'id', '*', 'id']), rdReducer, (r) => r);
    expectInvariants(runRecursiveDescent(g, ['+', 'id']), rdReducer, (r) => r);
  });

  it('is deterministic', () => {
    const g = grammar428();
    expectSameTrace(
      runRecursiveDescent(g, ['id', '+', 'id', '*', 'id']),
      runRecursiveDescent(g, ['id', '+', 'id', '*', 'id']),
    );
  });
});

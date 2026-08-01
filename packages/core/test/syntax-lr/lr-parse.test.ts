/**
 * Golden: the LR driver (Algorithm 4.44) on the Fig 4.37 SLR table must
 * reproduce the Fig 4.38 configuration sequence for "id * id + id" row-for-row.
 */
import { describe, expect, it } from 'vitest';
import { checkTraceInvariants } from '@lab/trace';
import { grammar41 } from '../../src/csubset/grammar-def.js';
import { drain } from '../../src/grammar/lr-events.js';
import { slrTable } from '../../src/grammar/slr-table.js';
import { lrParseReducer, lrParseRun, type ParseInputSym } from '../../src/grammar/lr-parse.js';

const g = grammar41();
const table = drain(slrTable(g));
const input = (terms: string[]): ParseInputSym[] => terms.map((term) => ({ term }));

describe('LR parsing of id * id + id (Fig 4.38)', () => {
  const rec = lrParseRun(g, table, input(['id', '*', 'id', '+', 'id']));

  it('accepts and reproduces the fourteen configurations row-for-row', () => {
    expect(rec.result.accepted).toBe(true);
    expect(rec.result.log).toEqual([
      { stack: '0', symbols: '', input: 'id*id+id$', action: 'shift' },
      { stack: '0 5', symbols: 'id', input: '*id+id$', action: 'reduce by F → id' },
      { stack: '0 3', symbols: 'F', input: '*id+id$', action: 'reduce by T → F' },
      { stack: '0 2', symbols: 'T', input: '*id+id$', action: 'shift' },
      { stack: '0 2 7', symbols: 'T *', input: 'id+id$', action: 'shift' },
      { stack: '0 2 7 5', symbols: 'T * id', input: '+id$', action: 'reduce by F → id' },
      { stack: '0 2 7 10', symbols: 'T * F', input: '+id$', action: 'reduce by T → T * F' },
      { stack: '0 2', symbols: 'T', input: '+id$', action: 'reduce by E → T' },
      { stack: '0 1', symbols: 'E', input: '+id$', action: 'shift' },
      { stack: '0 1 6', symbols: 'E +', input: 'id$', action: 'shift' },
      { stack: '0 1 6 5', symbols: 'E + id', input: '$', action: 'reduce by F → id' },
      { stack: '0 1 6 3', symbols: 'E + F', input: '$', action: 'reduce by T → F' },
      { stack: '0 1 6 9', symbols: 'E + T', input: '$', action: 'reduce by E → E + T' },
      { stack: '0 1', symbols: 'E', input: '$', action: 'accept' },
    ]);
  });

  it('grows the parse tree bottom-up: one root labelled E, five leaves', () => {
    const { nodes, roots } = rec.result;
    expect(roots.length).toBe(1);
    const root = nodes[roots[0]!]!;
    expect(root.symbol).toBe('E');
    expect(nodes.filter((n) => n.tokenIndex !== null).length).toBe(5);
    // E → E + T at the top: children are [E, +, T]
    expect(root.children.map((c) => nodes[c]!.symbol)).toEqual(['E', '+', 'T']);
  });

  it('satisfies the trace invariants', () => {
    expect(checkTraceInvariants(rec, lrParseReducer, (r) => r)).toEqual([]);
  });

  it('is deterministic', () => {
    const rec2 = lrParseRun(g, table, input(['id', '*', 'id', '+', 'id']));
    expect(JSON.stringify(rec2.trace.steps)).toBe(JSON.stringify(rec.trace.steps));
  });
});

describe('LR parsing errors', () => {
  it('reports the expected-terminal set from the current ACTION row', () => {
    const rec = lrParseRun(g, table, input(['id', '+', ')']));
    const r = rec.result;
    expect(r.accepted).toBe(false);
    expect(r.error).not.toBeNull();
    expect(r.error!.found).toBe(')');
    // State 6 (after E +) shifts only ( and id — declaration order: ( before id.
    expect(r.error!.expected).toEqual(['(', 'id']);
    const errStep = rec.trace.steps[rec.trace.steps.length - 1]!;
    expect(errStep.event.kind).toBe('parse/error');
    expect(errStep.meta.prose).toContain('syntax error');
    expect(rec.result.log[rec.result.log.length - 1]!.action).toBe('error');
  });

  it('rejects empty input with an error at $', () => {
    const rec = lrParseRun(g, table, []);
    expect(rec.result.accepted).toBe(false);
    expect(rec.result.error!.found).toBe('$');
  });
});

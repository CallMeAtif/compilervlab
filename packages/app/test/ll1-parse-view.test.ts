/**
 * Guards for the two app-side halves of the predictive-parse view: the moves
 * table must label the stack column with the orientation core actually renders
 * (Fig 4.21 — top of stack leftmost), and the worker registry must return from
 * 'syntax.ll1-parse' even on a left-recursive grammar, which the React view
 * blocks but the registry does not.
 *
 * The header is asserted against the file text because the view needs a DOM to
 * render and this suite runs under the node environment.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { grammar428 } from '@lab/core/csubset/grammar-def.js';
import {
  ll1ParseReducer,
  runLL1Parse,
  type LL1ParseEvent,
  type LL1ParseState,
} from '@lab/core/grammar/ll1-parse.js';
import { traceFromSerialized } from '@lab/trace';
import { buildTrace } from '../src/worker/registry';

const VIEW = new URL('../src/routes/syntax/views/Ll1ParseView.tsx', import.meta.url);

describe('Ll1ParseView moves table', () => {
  it('labels the stack column top-first, the way renderRow emits it', () => {
    const row = runLL1Parse(grammar428(), ['id', '+', 'id', '*', 'id']).trace.final().log[1]!;
    // Fig 4.21 row 1: stack is T E' $ — T is the top and it comes FIRST.
    expect(row.stack).toBe("T E' $");
    expect(row.stack.split(' ')[0]).toBe('T');
    expect(row.stack.split(' ').at(-1)).toBe('$');

    const src = readFileSync(VIEW, 'utf8');
    const header = /\{ key: 'stack', header: '([^']+)'/u.exec(src)?.[1];
    expect(header, 'stack column header not found').toBeDefined();
    expect(header).not.toMatch(/top last/iu);
    expect(header).toMatch(/top (?:→|first)/iu);
  });
});

describe('trace registry — syntax.ll1-parse on a left-recursive grammar', () => {
  it('returns a finished trace instead of hanging the worker', () => {
    const res = buildTrace({
      kind: 'syntax.ll1-parse',
      params: { grammarId: 'dragon-4.1', source: 'id * id + id' },
    });
    expect(res.trace).not.toBeNull();
    const steps = res.trace!.steps;
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.length).toBeLessThan(5_000);
    expect(steps[steps.length - 1]!.event.kind).toBe('ll1p.diverged');
    // buildTrace hands back the worker-boundary payload, so replay it the way
    // the UI does before asking for the final state.
    const final = traceFromSerialized<LL1ParseState, LL1ParseEvent>(
      res.trace!,
      ll1ParseReducer,
    ).final();
    expect(final.status).toBe('error');
    expect(final.error!.kind).toBe('divergence');
  });
});

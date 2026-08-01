/**
 * Thompson's construction — the McNaughton-Yamada-Thompson algorithm
 * (Algorithm 3.23, §3.7.4): syntax-directed over the regex AST, one basis or
 * induction case per node.
 *
 * State numbering reproduces the book's worked example exactly (Fig 3.34 for
 * (a|b)*abb): union/star allocate their new start state before their operands
 * are built and their accepting state right after; concatenation merges the
 * accepting state of N(s) with the start state of N(t), so the right operand
 * allocates no new start. With sequential allocation this yields states 0-10
 * with the book's ε-edge structure.
 *
 * The states, edges and numbering of the finished automaton are fixed by the
 * regex; which intermediate fragments the trace shows is not — concatenation is
 * associative, so N(s(tu)) and N((st)u) are the same machine built in a
 * different order. Example 3.24's r7/r9/r11 are the fragments of the fully
 * left-associated ((((a|b)*a)b)b).
 */

import type { Citation, Recorded, StepMeta, Steps } from '@lab/trace';
import { record } from '@lab/trace';
import type { RegexAst } from '../csubset/regex.js';
import type { ThompsonEvent } from './events.js';
import {
  initialThompsonState,
  thompsonReducer,
  type ThompsonState,
} from './reducers.js';
import type { Nfa, NfaEdge } from './types.js';

const CITE = (rule: string): Citation => ({
  section: '3.7.4',
  figureOrAlgo: 'Algorithm 3.23',
  rule,
});

const meta = (prose: string, rule: string): StepMeta => ({
  cite: CITE(rule),
  prose,
  level: 'macro',
  section: 'Thompson construction',
});

interface Frag {
  start: number;
  end: number;
}

export function* thompson(regex: RegexAst): Steps<ThompsonEvent, Nfa> {
  let next = 0;
  const states: number[] = [];
  const edges: NfaEdge[] = [];

  const newState = (): number => {
    const s = next++;
    states.push(s);
    return s;
  };
  const addEdge = (from: number, to: number, label: string | null): NfaEdge => {
    const e = { from, to, label };
    edges.push(e);
    return e;
  };

  /**
   * Build N(node). When `inheritedStart` is set, this sub-NFA is the right
   * operand of a concatenation: its start state IS the left operand's
   * accepting state (Algorithm 3.23 merges them), so no new start is created.
   */
  function* build(node: RegexAst, inheritedStart: number | null): Steps<ThompsonEvent, Frag> {
    switch (node.kind) {
      case 'char': {
        const start = inheritedStart ?? newState();
        const end = newState();
        const edge = addEdge(start, end, node.ch);
        yield [
          {
            kind: 'leafChar',
            regexNodeId: node.id,
            ch: node.ch,
            start,
            end,
            createdStates: inheritedStart === null ? [start, end] : [end],
            createdEdges: [edge],
          },
          meta(
            `Basis for input symbol '${node.ch}': new NFA with start ${start} —${node.ch}→ accepting ${end}.`,
            `basis: for subexpression a build N(a) with a single a-transition from a new start to a new accepting state`,
          ),
        ];
        return { start, end };
      }
      case 'epsilon': {
        const start = inheritedStart ?? newState();
        const end = newState();
        const edge = addEdge(start, end, null);
        yield [
          {
            kind: 'leafEpsilon',
            regexNodeId: node.id,
            start,
            end,
            createdStates: inheritedStart === null ? [start, end] : [end],
            createdEdges: [edge],
          },
          meta(
            `Basis for ε: new NFA with start ${start} —ε→ accepting ${end}.`,
            `basis: for expression ε build N(ε) with a single ε-transition from a new start to a new accepting state`,
          ),
        ];
        return { start, end };
      }
      case 'concat': {
        const left = yield* build(node.left, inheritedStart);
        const right = yield* build(node.right, left.end);
        yield [
          {
            kind: 'concat',
            regexNodeId: node.id,
            start: left.start,
            end: right.end,
            mergedState: left.end,
            createdStates: [],
            createdEdges: [],
          },
          meta(
            `Induction N(st): merge the accepting state ${left.end} of N(s) with the start state of N(t); ` +
              `the result runs from ${left.start} to ${right.end}.`,
            `induction: for st, the start state of N(s) becomes the start of N(st); the accepting state of N(s) is merged with the start state of N(t)`,
          ),
        ];
        return { start: left.start, end: right.end };
      }
      case 'union': {
        const start = inheritedStart ?? newState();
        const left = yield* build(node.left, null);
        const right = yield* build(node.right, null);
        const end = newState();
        const created = [
          addEdge(start, left.start, null),
          addEdge(start, right.start, null),
          addEdge(left.end, end, null),
          addEdge(right.end, end, null),
        ];
        yield [
          {
            kind: 'union',
            regexNodeId: node.id,
            start,
            end,
            leftStart: left.start,
            leftEnd: left.end,
            rightStart: right.start,
            rightEnd: right.end,
            createdStates: inheritedStart === null ? [start, end] : [end],
            createdEdges: created,
          },
          meta(
            `Induction N(s|t): new start ${start} with ε-edges to ${left.start} and ${right.start}; ` +
              `ε-edges from ${left.end} and ${right.end} to new accepting state ${end}.`,
            `induction: for s|t, add a new start with ε-transitions to the starts of N(s) and N(t) and a new accepting state with ε-transitions from their accepting states`,
          ),
        ];
        return { start, end };
      }
      case 'star': {
        const start = inheritedStart ?? newState();
        const inner = yield* build(node.inner, null);
        const end = newState();
        const created = [
          addEdge(start, inner.start, null),
          addEdge(inner.end, inner.start, null),
          addEdge(start, end, null),
          addEdge(inner.end, end, null),
        ];
        yield [
          {
            kind: 'star',
            regexNodeId: node.id,
            start,
            end,
            innerStart: inner.start,
            innerEnd: inner.end,
            createdStates: inheritedStart === null ? [start, end] : [end],
            createdEdges: created,
          },
          meta(
            `Induction N(s*): new start ${start} and accepting ${end}; ε-edges ${start}→${inner.start} (enter), ` +
              `${inner.end}→${inner.start} (loop), ${start}→${end} (skip), ${inner.end}→${end} (exit).`,
            `induction: for s*, add a new start and accepting state with ε-transitions allowing zero or more passes through N(s)`,
          ),
        ];
        return { start, end };
      }
    }
  }

  const top = yield* build(regex, null);
  yield [
    { kind: 'complete', start: top.start, accept: top.end, numStates: states.length },
    meta(
      `Construction complete: ${states.length} states, start ${top.start}, accepting ${top.end}. ` +
        `N(r) has at most twice as many states as r has symbols and operators.`,
      `N(r) has one start state and one accepting state; each step adds at most two states`,
    ),
  ];

  return { states, edges, start: top.start, accept: top.end };
}

/** Convenience: record a Thompson construction trace. */
export function runThompson(
  regex: RegexAst,
  id = 'lex.thompson',
): Recorded<ThompsonState, ThompsonEvent, Nfa> {
  return record(() => thompson(regex), initialThompsonState(), thompsonReducer, { id });
}

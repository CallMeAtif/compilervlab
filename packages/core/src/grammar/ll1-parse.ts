/**
 * Table-driven predictive parsing — Algorithm 4.34 / Fig 4.19 (§4.4.4), traced.
 *
 * Explicit stack with $ at the bottom and the start symbol on top. Moves:
 * expand (pop nonterminal, push production body reversed), match (pop
 * terminal, advance input), accept, error (with the expected set read off the
 * table row). The UI state carries the stack, the remaining input, a move log
 * matching Fig 4.21 row-for-row, and an incrementally grown parse tree
 * (children attached on expand).
 *
 * Multiply-defined cells (non-LL(1) grammars) are resolved by ll1Resolve and
 * narrated with the rule that actually justifies the choice; grammars the
 * algorithm cannot terminate on are stopped by the divergence guard below.
 */
import { record, type Recorded, type Reducer, type StepMeta, type Steps } from '@lab/trace';
import { EOF, EPSILON, isNonterminal, formatProduction, type Grammar, type Production } from './grammar.js';
import { firstFollowSteps } from './first-follow.js';
import {
  ll1Resolve,
  ll1RowExpected,
  ll1TableSteps,
  type LL1Resolution,
  type LL1Table,
} from './ll1-table.js';
import { drain, formatSymbols } from './ll-util.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface LL1ParseTreeNode {
  id: number;
  symbol: string; // grammar symbol, or ε for an epsilon leaf
  children: number[];
}

/** One row of the Fig 4.21 moves table. */
export interface LL1MoveRow {
  matched: string; // terminals consumed so far, space-joined
  stack: string; // top-first, ending with $
  input: string; // remaining input, ending with $
  action: string; // '' | 'output A → α' | 'match a' | 'accept' | 'error: …'
}

export interface LL1ParseError {
  /**
   * 'syntax' — the sentence is not in the language (Algorithm 4.34's error
   * exits). 'divergence' — the parser was stopped because it was not making
   * progress; the sentence may well be fine, the grammar is not usable
   * top-down (§4.3.3).
   */
  kind: 'syntax' | 'divergence';
  message: string;
  expected: string[]; // sorted expected terminals (empty for 'divergence')
  found: string;
  pos: number; // index into the input token sequence ($ = input.length)
}

export interface LL1ParseState {
  input: string[]; // terminal names, without the trailing $
  stack: Array<{ sym: string; node: number | null }>; // index 0 = bottom ($)
  pos: number;
  nodes: LL1ParseTreeNode[]; // nodes[id] has that id (ids are creation order)
  log: LL1MoveRow[];
  status: 'running' | 'accepted' | 'error';
  error: LL1ParseError | null;
  notes: string[]; // conflict-resolution notes (non-LL(1) cells)
}

export type LL1ParseResult = LL1ParseState;

export type LL1ParseEvent =
  | {
      kind: 'll1p.expand';
      production: { id: number; lhs: string; rhs: string[] };
      node: number; // tree node being expanded (was on top of the stack)
      children: number[]; // ids of the created child nodes (one ε leaf if rhs = ε)
      lookahead: string;
    }
  | { kind: 'll1p.match'; terminal: string; pos: number }
  | { kind: 'll1p.accept' }
  | { kind: 'll1p.error'; message: string; expected: string[]; found: string; pos: number }
  | { kind: 'll1p.diverged'; message: string; moves: number; found: string; pos: number }
  | { kind: 'll1p.note'; message: string };

// ── Conflict narration ───────────────────────────────────────────────────────

/**
 * Describe the choice {@link ll1Resolve} actually made in a multiply-defined
 * cell, and name the rule that justifies it. A multiply-defined M[A, a] means
 * the grammar is not LL(1) (§4.4.3); only the FIRST-vs-FOLLOW case has a
 * textbook resolution (Example 4.33), so the other shapes must be reported as
 * the arbitrary tie-breaks they are rather than as the dangling-else story.
 */
function conflictNote(
  g: Grammar,
  A: string,
  a: string,
  res: LL1Resolution,
): { message: string; rule: string } {
  const show = (e: { prod: number }): string => formatProduction(g.productions[e.prod]!);
  const head = `M[${A}, ${a}] holds ${res.cell.length} productions (LL(1) conflict); `;
  if (res.rule === 'consumes-lookahead') {
    // The cell holds at least one FIRST-case and at least one FOLLOW-case
    // entry. Example 4.33 only settles FIRST against FOLLOW; if several
    // FIRST-case entries are present it does not say which of them to take,
    // so that leftover tie-break has to be reported as the tie-break it is.
    const eps = res.cell.filter((e) => e.via === 'follow');
    const rivals = res.cell.filter((e) => e !== res.entry && e.via === 'first');
    const chosen = rivals.length === 0 ? 'the FIRST-case entry' : 'a FIRST-case entry';
    const overs =
      eps.length > 1
        ? `the FOLLOW-case entries (${eps.map(show).join(', ')}), which would derive ε instead`
        : `the FOLLOW-case entry (${eps.map(show).join(', ')}), which would derive ε instead`;
    const leftover =
      rivals.length === 0
        ? ''
        : ` The other FIRST-case ${rivals.length > 1 ? 'entries' : 'entry'} ` +
          `(${rivals.map(show).join(', ')}) also consume${rivals.length > 1 ? '' : 's'} ${a}, and ` +
          `Example 4.33 does not choose among those — the grammar is not LL(1) at ${A} (§4.4.3), ` +
          `so this parser simply takes the first-listed of them.`;
    return {
      message:
        head +
        `choosing ${show(res.entry)} — ${chosen}, which consumes the lookahead ${a}, ` +
        `over ${overs}. That is the ` +
        `Example 4.33 resolution (§4.4.3); in the dangling-else grammar it associates each else ` +
        `with the closest previous then.` +
        leftover,
      rule:
        'Example 4.33: on a FIRST/FOLLOW conflict cell, choose the entry that consumes the ' +
        'lookahead over the ε-entry',
    };
  }
  const via = res.cell.every((e) => e.via === 'first') ? 'first' : 'follow';
  const why =
    via === 'first'
      ? `every entry was added by the FIRST case, so each alternative can begin with ${a}` +
        ` (left factoring, §4.3.4, is what removes such a conflict)`
      : `every entry was added by the FOLLOW case, so each alternative derives ε and none of them` +
        ` consumes ${a} — Example 4.33's "prefer the entry that consumes the lookahead" does not apply`;
  return {
    message:
      head +
      `${why}. The book gives no rule for choosing here — the grammar is simply not LL(1) at ` +
      `${A} (§4.4.3) — so this parser breaks the tie by taking the first-listed entry, ` +
      `${show(res.entry)}, and the other alternative${res.cell.length > 2 ? 's are' : ' is'} ` +
      `unreachable at this cell.`,
    rule:
      'A multiply-defined entry means the grammar is not LL(1) (§4.4.3); no book rule selects ' +
      'among entries of the same case, so the parser takes the first-listed one',
  };
}

// ── Rendering helpers (Fig 4.21 columns) ─────────────────────────────────────

function renderRow(
  input: readonly string[],
  pos: number,
  stack: ReadonlyArray<{ sym: string }>,
  action: string,
): LL1MoveRow {
  return {
    matched: input.slice(0, pos).join(' '),
    stack: [...stack].reverse().map((e) => e.sym).join(' '),
    input: [...input.slice(pos), EOF].join(' '),
    action,
  };
}

// ── Reducer ──────────────────────────────────────────────────────────────────

export function initialLL1ParseState(g: Grammar, input: readonly string[]): LL1ParseState {
  const stack = [
    { sym: EOF, node: null },
    { sym: g.start, node: 0 },
  ];
  return {
    input: [...input],
    stack,
    pos: 0,
    nodes: [{ id: 0, symbol: g.start, children: [] }],
    log: [renderRow(input, 0, stack, '')],
    status: 'running',
    error: null,
    notes: [],
  };
}

export const ll1ParseReducer: Reducer<LL1ParseState, LL1ParseEvent> = (s, ev) => {
  switch (ev.kind) {
    case 'll1p.expand': {
      const rhs = ev.production.rhs;
      const childSyms = rhs.length === 0 ? [EPSILON] : rhs;
      const nodes = s.nodes.map((n) =>
        n.id === ev.node ? { ...n, children: [...ev.children] } : n,
      );
      ev.children.forEach((cid, k) => {
        nodes.push({ id: cid, symbol: childSyms[k]!, children: [] });
      });
      const stack = s.stack.slice(0, -1);
      for (let k = rhs.length - 1; k >= 0; k--) {
        stack.push({ sym: rhs[k]!, node: ev.children[k]! });
      }
      const action = `output ${ev.production.lhs} → ${formatSymbols(rhs)}`;
      return {
        ...s,
        stack,
        nodes,
        log: [...s.log, renderRow(s.input, s.pos, stack, action)],
      };
    }
    case 'll1p.match': {
      const stack = s.stack.slice(0, -1);
      const pos = s.pos + 1;
      return {
        ...s,
        stack,
        pos,
        log: [...s.log, renderRow(s.input, pos, stack, `match ${ev.terminal}`)],
      };
    }
    case 'll1p.accept':
      return {
        ...s,
        status: 'accepted',
        log: [...s.log, renderRow(s.input, s.pos, s.stack, 'accept')],
      };
    case 'll1p.error':
      return {
        ...s,
        status: 'error',
        error: {
          kind: 'syntax',
          message: ev.message,
          expected: ev.expected,
          found: ev.found,
          pos: ev.pos,
        },
        log: [...s.log, renderRow(s.input, s.pos, s.stack, `error: ${ev.message}`)],
      };
    case 'll1p.diverged':
      return {
        ...s,
        status: 'error',
        error: {
          kind: 'divergence',
          message: ev.message,
          expected: [],
          found: ev.found,
          pos: ev.pos,
        },
        log: [...s.log, renderRow(s.input, s.pos, s.stack, `stopped: ${ev.message}`)],
      };
    case 'll1p.note':
      return { ...s, notes: [...s.notes, ev.message] };
  }
};

// ── Divergence guard ─────────────────────────────────────────────────────────

/**
 * Algorithm 4.34's loop only terminates on a grammar that can be parsed top
 * down. On a left-recursive grammar M[A, a] can select A → A α, which pops A
 * and pushes it straight back without consuming input, so the loop runs
 * forever and the move log grows without bound (§4.3.3 — the reason Algorithm
 * 4.19 exists). The UI refuses such grammars, but the worker registry and
 * every direct caller of {@link ll1ParseSteps} would hang, so the generator
 * bounds itself and ends with an `ll1p.diverged` diagnostic instead.
 *
 * Both bounds are far above what a terminating parse needs: it makes one move
 * per parse-tree node plus one per token, and the stack only ever holds the
 * yet-to-be-derived tail of the sentence.
 */
export function ll1ParseLimits(input: readonly string[]): { moves: number; stack: number } {
  const n = input.length + 1;
  return { moves: Math.max(2_000, 400 * n), stack: Math.max(200, 40 * n) };
}

// ── The traced algorithm ─────────────────────────────────────────────────────

export function* ll1ParseSteps(
  g: Grammar,
  input: readonly string[],
  table?: LL1Table,
): Steps<LL1ParseEvent, LL1ParseResult> {
  const tbl = table ?? drain(ll1TableSteps(g, drain(firstFollowSteps(g)))).table;
  let state = initialLL1ParseState(g, input);

  function* step(ev: LL1ParseEvent, meta: StepMeta): Steps<LL1ParseEvent, void> {
    yield [ev, meta];
    state = ll1ParseReducer(state, ev);
  }

  const cite = { section: '4.4.4', figureOrAlgo: 'Algorithm 4.34, Fig 4.19' };
  const section = 'Predictive parse';

  const limits = ll1ParseLimits(input);
  let moves = 0;

  while (state.status === 'running') {
    const top = state.stack[state.stack.length - 1]!;
    const a = state.pos < state.input.length ? state.input[state.pos]! : EOF;
    const tokenRef = { kind: 'token' as const, id: state.pos };

    if (moves >= limits.moves || state.stack.length > limits.stack) {
      const why =
        state.stack.length > limits.stack
          ? `the stack grew past ${limits.stack} symbols`
          : `${limits.moves} moves were made`;
      const message =
        `the predictive parser is not making progress (${why}) — it was stopped. ` +
        `A nonterminal is being expanded into itself without consuming input, which is what a ` +
        `left-recursive grammar does to any top-down parser (§4.3.3); eliminate the left ` +
        `recursion (Algorithm 4.19) before parsing predictively.`;
      yield* step(
        { kind: 'll1p.diverged', message, moves, found: a, pos: state.pos },
        {
          cite: { section: '4.3.3', figureOrAlgo: 'Algorithm 4.19' },
          prose: message,
          level: 'macro',
          section,
          irRefs: [tokenRef],
        },
      );
      break;
    }
    moves++;

    if (top.sym === EOF) {
      if (a === EOF) {
        yield* step(
          { kind: 'll1p.accept' },
          {
            cite,
            prose: 'The stack holds only $ and the input is exhausted — the parse succeeds.',
            level: 'macro',
            section,
          },
        );
      } else {
        yield* step(
          {
            kind: 'll1p.error',
            message: `stack is empty ($ on top) but input still has ${a}`,
            expected: [EOF],
            found: a,
            pos: state.pos,
          },
          {
            cite,
            prose: `The stack has been emptied down to $ but the input still holds ${a}: the sentence continues past a complete derivation, so it is rejected.`,
            level: 'macro',
            section,
            irRefs: [tokenRef],
          },
        );
      }
    } else if (!isNonterminal(g, top.sym)) {
      if (top.sym === a) {
        yield* step(
          { kind: 'll1p.match', terminal: a, pos: state.pos },
          {
            cite,
            prose: `The terminal ${a} on top of the stack matches the lookahead: pop it and advance the input.`,
            level: 'macro',
            section,
            irRefs: [tokenRef],
          },
        );
      } else {
        yield* step(
          {
            kind: 'll1p.error',
            message: `expected ${top.sym} but found ${a}`,
            expected: [top.sym],
            found: a,
            pos: state.pos,
          },
          {
            cite,
            prose: `The terminal ${top.sym} on top of the stack does not match the lookahead ${a}: the derivation built so far demands ${top.sym} here, so this is a syntax error.`,
            level: 'macro',
            section,
            irRefs: [tokenRef],
          },
        );
      }
    } else {
      const cell = tbl[top.sym]?.[a] ?? [];
      if (cell.length === 0) {
        const expected = ll1RowExpected(tbl, top.sym);
        yield* step(
          {
            kind: 'll1p.error',
            message: `no entry in M[${top.sym}, ${a}]; expected one of {${expected.join(', ')}}`,
            expected,
            found: a,
            pos: state.pos,
          },
          {
            cite,
            prose: `M[${top.sym}, ${a}] is empty: no production for ${top.sym} can begin with (or be followed by) ${a}. The row for ${top.sym} only has entries under {${expected.join(', ')}}, so one of those was expected.`,
            level: 'macro',
            section,
            irRefs: [tokenRef],
          },
        );
      } else {
        const res = ll1Resolve(tbl, top.sym, a)!;
        if (cell.length > 1) {
          const note = conflictNote(g, top.sym, a, res);
          yield* step(
            { kind: 'll1p.note', message: note.message },
            {
              cite: { section: '4.4.3', rule: note.rule },
              prose: note.message,
              level: 'micro',
              section,
            },
          );
        }
        const entry = res.entry;
        const p: Production = g.productions[entry.prod]!;
        const childCount = p.rhs.length === 0 ? 1 : p.rhs.length;
        const children: number[] = [];
        for (let k = 0; k < childCount; k++) children.push(state.nodes.length + k);
        yield* step(
          {
            kind: 'll1p.expand',
            production: { id: p.id, lhs: p.lhs, rhs: [...p.rhs] },
            node: top.node!,
            children,
            lookahead: a,
          },
          {
            cite,
            prose: `Top of stack ${p.lhs} is a nonterminal and the lookahead is ${a}; M[${p.lhs}, ${a}] = ${formatProduction(p)}, so pop ${p.lhs}, output the production, and push its body ${formatSymbols(p.rhs)} reversed (leftmost symbol on top).`,
            level: 'macro',
            section,
            irRefs: [{ kind: 'production', id: p.id }, tokenRef],
          },
        );
      }
    }
  }

  return state;
}

// ── Conveniences ─────────────────────────────────────────────────────────────

export function runLL1Parse(
  g: Grammar,
  input: readonly string[],
  table?: LL1Table,
  id = 'syntax.ll1-parse',
): Recorded<LL1ParseState, LL1ParseEvent, LL1ParseResult> {
  const tbl = table ?? drain(ll1TableSteps(g, drain(firstFollowSteps(g)))).table;
  return record(
    () => ll1ParseSteps(g, input, tbl),
    initialLL1ParseState(g, input),
    ll1ParseReducer,
    { id },
  );
}

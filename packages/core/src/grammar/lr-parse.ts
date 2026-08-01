/**
 * The LR parsing algorithm — Algorithm 4.44 (§4.6.3), the driver of Fig 4.36 —
 * generic over any ACTION/GOTO table (SLR, canonical LR(1), or LALR: "the
 * driver is the same, only the table changes").
 *
 * The trace's UI state is a Fig 4.38-style configuration sequence: the state
 * stack, the grammar-symbols column, the remaining input, an action log
 * (one row per move, pre-move configuration), and a growing parse forest
 * where each reduce attaches the popped subtrees as children.
 */
import type { Recorded, Reducer, SourceSpan, StepMeta, Steps } from '@lab/trace';
import { record } from '@lab/trace';
import { EOF, formatProduction, type Grammar } from './grammar.js';
import { sortTerminals } from './lr-first.js';
import {
  actionToString,
  describeAction,
  type LrAction,
  type LrConflictJson,
} from './lr-events.js';

/** Structural table shape — satisfied by SlrResult, Lr1TableResult, LalrResult. */
export interface LrTableLike {
  action: Array<Record<string, LrAction>>;
  goto: Array<Record<string, number>>;
  /** Conflicts recorded while the table was built. A blank ACTION cell named
   *  here is CONFLICTED — the construction refused to pick one of two
   *  contradictory actions — not an ordinary error entry, and the driver says
   *  so instead of blaming the input (§4.6.4, §4.8.2). */
  conflicts?: LrConflictJson[];
}

/** One input symbol; `term` is a terminal of the grammar. Extra fields carry
 *  token provenance when parsing a real token stream. */
export interface ParseInputSym {
  term: string;
  lexeme?: string;
  tokenIndex?: number;
  span?: SourceSpan;
}

/** Parse-tree node (concrete syntax). Leaves have tokenIndex/lexeme; internal
 *  nodes carry the production they were reduced by. */
export interface PtNodeJson {
  id: number;
  symbol: string;
  prod: number | null;
  tokenIndex: number | null;
  lexeme: string | null;
  children: number[];
}

/** One row of the Fig 4.38 configuration table (pre-move configuration). */
export interface LrConfigRow {
  stack: string;
  symbols: string;
  input: string;
  action: string;
}

export interface LrParseUiState {
  /** Input including the appended $ endmarker. */
  input: ParseInputSym[];
  stack: number[];
  symbols: string[];
  /** Number of input symbols consumed. */
  cursor: number;
  nodes: PtNodeJson[];
  /** Roots of the current parse forest, oldest first. */
  roots: number[];
  log: LrConfigRow[];
  done: boolean;
  accepted: boolean;
  error: {
    state: number;
    found: string;
    expected: string[];
    tokenIndex: number | null;
  } | null;
}

export type LrParseResult = LrParseUiState;

export type LrParseEvent =
  | { kind: 'parse/init'; input: ParseInputSym[]; startState: number }
  | {
      kind: 'parse/shift';
      from: number;
      to: number;
      sym: ParseInputSym;
      tokenIndex: number;
      row: LrConfigRow;
    }
  | {
      kind: 'parse/reduce';
      prod: number;
      lhs: string;
      rhsLen: number;
      /** States popped, top first. */
      popped: number[];
      /** State exposed after popping. */
      uncovered: number;
      /** GOTO[uncovered, lhs] — the state pushed. */
      to: number;
      row: LrConfigRow;
    }
  | { kind: 'parse/accept'; row: LrConfigRow }
  | {
      kind: 'parse/error';
      state: number;
      found: string;
      expected: string[];
      tokenIndex: number | null;
      row: LrConfigRow;
    };

export function lrParseInitial(): LrParseUiState {
  return {
    input: [],
    stack: [],
    symbols: [],
    cursor: 0,
    nodes: [],
    roots: [],
    log: [],
    done: false,
    accepted: false,
    error: null,
  };
}

export const lrParseReducer: Reducer<LrParseUiState, LrParseEvent> = (s, e) => {
  switch (e.kind) {
    case 'parse/init':
      return {
        ...lrParseInitial(),
        input: e.input.map((x) => ({ ...x })),
        stack: [e.startState],
      };
    case 'parse/shift': {
      const id = s.nodes.length;
      const leaf: PtNodeJson = {
        id,
        symbol: e.sym.term,
        prod: null,
        tokenIndex: e.sym.tokenIndex ?? e.tokenIndex,
        lexeme: e.sym.lexeme ?? e.sym.term,
        children: [],
      };
      return {
        ...s,
        stack: [...s.stack, e.to],
        symbols: [...s.symbols, e.sym.term],
        cursor: s.cursor + 1,
        nodes: [...s.nodes, leaf],
        roots: [...s.roots, id],
        log: [...s.log, e.row],
      };
    }
    case 'parse/reduce': {
      const id = s.nodes.length;
      const children = e.rhsLen === 0 ? [] : s.roots.slice(-e.rhsLen);
      const node: PtNodeJson = {
        id,
        symbol: e.lhs,
        prod: e.prod,
        tokenIndex: null,
        lexeme: null,
        children,
      };
      const keep = e.rhsLen === 0 ? s.roots : s.roots.slice(0, -e.rhsLen);
      const stackKeep = e.rhsLen === 0 ? s.stack : s.stack.slice(0, -e.rhsLen);
      const symKeep = e.rhsLen === 0 ? s.symbols : s.symbols.slice(0, -e.rhsLen);
      return {
        ...s,
        stack: [...stackKeep, e.to],
        symbols: [...symKeep, e.lhs],
        nodes: [...s.nodes, node],
        roots: [...keep, id],
        log: [...s.log, e.row],
      };
    }
    case 'parse/accept':
      return { ...s, done: true, accepted: true, log: [...s.log, e.row] };
    case 'parse/error':
      return {
        ...s,
        done: true,
        error: {
          state: e.state,
          found: e.found,
          expected: [...e.expected],
          tokenIndex: e.tokenIndex,
        },
        log: [...s.log, e.row],
      };
  }
};

/**
 * Pure generator: run the LR driver of Fig 4.36 on `input` (WITHOUT the $
 * endmarker — it is appended here). `grammar` is the ORIGINAL grammar: reduce
 * events only ever name original productions (the augmented S' → S is
 * subsumed by accept), and its declaration order sorts expected-terminal sets.
 */
export function* lrParse(
  grammar: Grammar,
  table: LrTableLike,
  input: ParseInputSym[],
): Steps<LrParseEvent, LrParseResult> {
  const cite = { section: '4.6.3', figureOrAlgo: 'Algorithm 4.44 (Fig 4.36)' };
  let st = lrParseInitial();
  const apply = (e: LrParseEvent) => {
    st = lrParseReducer(st, e);
    return e;
  };

  const full: ParseInputSym[] = [...input.map((x) => ({ ...x })), { term: EOF }];
  yield [
    apply({ kind: 'parse/init', input: full, startState: 0 }),
    {
      cite,
      prose: `Initialize the LR driver: state stack holds the start state 0, the input pointer is at the first symbol, and the endmarker $ is appended to the input.`,
      level: 'macro',
      section: 'Parse',
    } satisfies StepMeta,
  ];

  const remainingStr = () =>
    st.input
      .slice(st.cursor)
      .map((x) => x.lexeme ?? x.term)
      .join('');
  const rowOf = (action: string): LrConfigRow => ({
    stack: st.stack.join(' '),
    symbols: st.symbols.join(' '),
    input: remainingStr(),
    action,
  });

  for (;;) {
    const s = st.stack[st.stack.length - 1]!;
    const a = st.input[st.cursor]!;
    const act = table.action[s]?.[a.term];
    if (act === undefined) {
      const expected = sortTerminals(grammar, Object.keys(table.action[s] ?? {}));
      const row = rowOf('error');
      const span = a.span;
      const clashes = (table.conflicts ?? []).filter(
        (c) => c.state === s && c.symbol === a.term && c.resolution === null,
      );
      const clash = clashes[0];
      const clashProse = clash
        ? `ACTION[${s}, ${a.term}] is blank because the table construction found a ${clash.kind} conflict there — ${clash.actions
            .map((c, k) => `${describeAction(grammar, c)} (from ${clash.items[k] ?? '?'})`)
            .join(' vs ')} — and refused to let item order pick one of them. The parse cannot continue: the table is defective on this cell, not the input.`
        : `ACTION[${s}, ${a.term}] is empty — syntax error: found '${a.lexeme ?? a.term}' but in this configuration the parser can only continue with one of {${expected.join(', ')}}.`;
      yield [
        apply({
          kind: 'parse/error',
          state: s,
          found: a.term,
          expected,
          tokenIndex: a.tokenIndex ?? null,
          row,
        }),
        {
          cite: clash
            ? { section: '4.6.4', rule: 'a cell claimed by two contradictory actions is a conflict, not an error entry' }
            : { section: '4.6.3', rule: 'a blank ACTION entry signals a syntax error' },
          prose: clashProse,
          level: 'macro',
          section: 'Parse',
          ...(span ? { srcSpans: [span] } : {}),
          ...(a.tokenIndex !== undefined ? { irRefs: [{ kind: 'token' as const, id: a.tokenIndex }] } : {}),
        },
      ];
      return st;
    }
    switch (act.type) {
      case 'shift': {
        const row = rowOf('shift');
        yield [
          apply({
            kind: 'parse/shift',
            from: s,
            to: act.to,
            sym: { ...a },
            tokenIndex: st.cursor,
            row,
          }),
          {
            cite,
            prose: `ACTION[${s}, ${a.term}] = s${act.to}: shift '${a.lexeme ?? a.term}' onto the stack, push state ${act.to}, and advance the input pointer.`,
            level: 'macro',
            section: 'Parse',
            ...(a.span ? { srcSpans: [a.span] } : {}),
            ...(a.tokenIndex !== undefined ? { irRefs: [{ kind: 'token' as const, id: a.tokenIndex }] } : {}),
          },
        ];
        break;
      }
      case 'reduce': {
        const p = grammar.productions[act.prod];
        if (!p) throw new Error(`reduce by unknown production ${act.prod}`);
        const rhsLen = p.rhs.length;
        const popped = rhsLen === 0 ? [] : [...st.stack.slice(-rhsLen)].reverse();
        const uncovered = st.stack[st.stack.length - 1 - rhsLen]!;
        const to = table.goto[uncovered]?.[p.lhs];
        if (to === undefined) throw new Error(`missing GOTO[${uncovered}, ${p.lhs}]`);
        const row = rowOf(`reduce by ${formatProduction(p)}`);
        yield [
          apply({
            kind: 'parse/reduce',
            prod: p.id,
            lhs: p.lhs,
            rhsLen,
            popped,
            uncovered,
            to,
            row,
          }),
          {
            cite,
            prose: `ACTION[${s}, ${a.term}] = r${p.id + 1}: reduce by ${formatProduction(p)} — pop ${rhsLen} state(s) exposing ${uncovered}, push GOTO[${uncovered}, ${p.lhs}] = ${to}; the popped subtrees become children of a new ${p.lhs} node.`,
            level: 'macro',
            section: 'Parse',
            irRefs: [{ kind: 'production', id: p.id }],
          },
        ];
        break;
      }
      case 'accept': {
        const row = rowOf('accept');
        yield [
          apply({ kind: 'parse/accept', row }),
          {
            cite,
            prose: `ACTION[${s}, $] = accept (${actionToString(act)}): the stack holds the start symbol and the input is exhausted — parsing succeeded.`,
            level: 'macro',
            section: 'Parse',
          },
        ];
        return st;
      }
    }
  }
}

/** Convenience: record an LR parse trace. */
export function lrParseRun(
  grammar: Grammar,
  table: LrTableLike,
  input: ParseInputSym[],
  opts?: { id?: string },
): Recorded<LrParseUiState, LrParseEvent, LrParseResult> {
  return record(() => lrParse(grammar, table, input), lrParseInitial(), lrParseReducer, {
    id: opts?.id ?? 'syntax.lr-parse',
  });
}

/**
 * Predictive parsing table construction — Algorithm 4.31 (§4.4.3), traced.
 *
 * For each production A → α: add A → α to M[A, a] for every terminal
 * a ∈ FIRST(α); if ε ∈ FIRST(α), add it to M[A, b] for every b ∈ FOLLOW(A)
 * (including $). A cell holding two or more productions is an LL(1) conflict,
 * emitted as an educational event explaining why the prediction sets overlap.
 * Golden: Fig 4.17 for Grammar 4.28.
 */
import { record, type Recorded, type Reducer, type StepMeta, type Steps } from '@lab/trace';
import { EPSILON, formatProduction, type Grammar } from './grammar.js';
import {
  firstFollowSteps,
  firstOfString,
  type FirstFollowResult,
} from './first-follow.js';
import { drain, formatSymbols, sortSet } from './ll-util.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface LL1Entry {
  prod: number; // production id
  via: 'first' | 'follow'; // which case of Algorithm 4.31 inserted it
}

/** M[A][a] = list of entries in insertion order (a well-cell has exactly one). */
export type LL1Table = Record<string, Record<string, LL1Entry[]>>;

export interface LL1Conflict {
  nonterminal: string;
  terminal: string;
  entries: LL1Entry[]; // every production the finished cell holds
  explanation: string;
}

export interface LL1TableResult {
  table: LL1Table;
  conflicts: LL1Conflict[];
}

export type LL1TableState = LL1TableResult;

export type LL1TableEvent =
  | { kind: 'll1.production'; production: number; firstAlpha: string[] }
  | {
      kind: 'll1.insert';
      nonterminal: string;
      terminal: string;
      production: number;
      via: 'first' | 'follow';
      justification: string;
    }
  | {
      kind: 'll1.conflict';
      nonterminal: string;
      terminal: string;
      entries: LL1Entry[];
      explanation: string;
    };

// ── Reducer ──────────────────────────────────────────────────────────────────

/**
 * Record `c` as the conflict of cell M[nonterminal, terminal], replacing any
 * earlier (shorter) report of the same cell so the list holds one entry per
 * multiply-defined cell, with its final contents.
 */
function upsertConflict(conflicts: readonly LL1Conflict[], c: LL1Conflict): LL1Conflict[] {
  const next: LL1Conflict = {
    nonterminal: c.nonterminal,
    terminal: c.terminal,
    entries: c.entries,
    explanation: c.explanation,
  };
  const i = conflicts.findIndex(
    (x) => x.nonterminal === c.nonterminal && x.terminal === c.terminal,
  );
  if (i < 0) return [...conflicts, next];
  const out = [...conflicts];
  out[i] = next;
  return out;
}

export function initialLL1TableState(g: Grammar): LL1TableState {
  const table: LL1Table = {};
  for (const nt of g.nonterminals) table[nt] = {};
  return { table, conflicts: [] };
}

export const ll1TableReducer: Reducer<LL1TableState, LL1TableEvent> = (state, ev) => {
  switch (ev.kind) {
    case 'll1.insert': {
      const row = state.table[ev.nonterminal] ?? {};
      const cell = row[ev.terminal] ?? [];
      if (cell.some((e) => e.prod === ev.production)) return state;
      return {
        ...state,
        table: {
          ...state.table,
          [ev.nonterminal]: {
            ...row,
            [ev.terminal]: [...cell, { prod: ev.production, via: ev.via }],
          },
        },
      };
    }
    case 'll1.conflict':
      // One multiply-defined entry M[A, a] is ONE conflict (§4.4.3): a third
      // insertion into an already-conflicting cell re-reports the same cell
      // with a longer entry list, it does not open a second conflict.
      return { ...state, conflicts: upsertConflict(state.conflicts, ev) };
    default:
      return state; // 'll1.production' is a narration-only macro step
  }
};

// ── The traced algorithm ─────────────────────────────────────────────────────

export function* ll1TableSteps(
  g: Grammar,
  ff: FirstFollowResult,
): Steps<LL1TableEvent, LL1TableResult> {
  const table: LL1Table = {};
  for (const nt of g.nonterminals) table[nt] = {};
  let conflicts: LL1Conflict[] = [];

  const caseOf = (e: LL1Entry, A: string, a: string): string => {
    const p = g.productions[e.prod]!;
    return e.via === 'first'
      ? `${a} ∈ FIRST(${formatSymbols(p.rhs)})`
      : `${formatSymbols(p.rhs)} ⇒* ε and ${a} ∈ FOLLOW(${A})`;
  };

  function* insert(
    A: string,
    a: string,
    prodId: number,
    via: 'first' | 'follow',
    justification: string,
  ): Steps<LL1TableEvent, void> {
    const row = table[A]!;
    const cell = (row[a] ??= []);
    if (cell.some((e) => e.prod === prodId)) return; // set semantics: already present
    cell.push({ prod: prodId, via });
    yield [
      { kind: 'll1.insert', nonterminal: A, terminal: a, production: prodId, via, justification },
      {
        cite: {
          section: '4.4.3',
          figureOrAlgo: 'Algorithm 4.31',
          rule:
            via === 'first'
              ? 'For each terminal a in FIRST(α), add A → α to M[A, a]'
              : 'If ε ∈ FIRST(α), add A → α to M[A, b] for each b in FOLLOW(A)',
        },
        prose: `Add ${formatProduction(g.productions[prodId]!)} to M[${A}, ${a}]: ${justification}.`,
        level: 'micro',
        groupId: `prod-${prodId}`,
        section: 'Predictive parsing table',
        irRefs: [{ kind: 'production', id: prodId }],
      },
    ];
    if (cell.length >= 2) {
      const entries = cell.map((e) => ({ ...e }));
      const listed = entries
        .map((e) => `${formatProduction(g.productions[e.prod]!)} (${caseOf(e, A, a)})`)
        .join(' and ');
      const explanation =
        `Cell M[${A}, ${a}] now holds ${entries.length} productions: ${listed}. ` +
        `Their prediction sets overlap at ${a}, so with one token of lookahead a predictive parser ` +
        `cannot decide which production to use — the grammar is not LL(1) at ${A} (§4.4.3).`;
      conflicts = upsertConflict(conflicts, {
        nonterminal: A,
        terminal: a,
        entries,
        explanation,
      });
      yield [
        { kind: 'll1.conflict', nonterminal: A, terminal: a, entries, explanation },
        {
          cite: {
            section: '4.4.3',
            rule: 'LL(1) condition: FIRST/FOLLOW prediction sets of alternatives must be disjoint',
          },
          prose: explanation,
          level: 'macro',
          section: 'Predictive parsing table',
          irRefs: entries.map((e) => ({ kind: 'production' as const, id: e.prod })),
        },
      ];
    }
  }

  for (const p of g.productions) {
    const firstAlpha = firstOfString(g, ff.first, p.rhs);
    yield [
      { kind: 'll1.production', production: p.id, firstAlpha },
      {
        cite: { section: '4.4.3', figureOrAlgo: 'Algorithm 4.31' },
        prose: `Consider production ${formatProduction(p)}: FIRST(${formatSymbols(p.rhs)}) = {${firstAlpha.join(', ')}}.`,
        level: 'macro',
        groupId: `prod-${p.id}`,
        section: 'Predictive parsing table',
        irRefs: [{ kind: 'production', id: p.id }],
      },
    ];
    for (const a of firstAlpha) {
      if (a === EPSILON) continue;
      yield* insert(
        p.lhs,
        a,
        p.id,
        'first',
        `${a} ∈ FIRST(${formatSymbols(p.rhs)}) (Algorithm 4.31, FIRST case)`,
      );
    }
    if (firstAlpha.includes(EPSILON)) {
      for (const b of ff.follow[p.lhs] ?? []) {
        yield* insert(
          p.lhs,
          b,
          p.id,
          'follow',
          `ε ∈ FIRST(${formatSymbols(p.rhs)}) and ${b} ∈ FOLLOW(${p.lhs}) (Algorithm 4.31, FOLLOW case)`,
        );
      }
    }
  }

  return { table, conflicts };
}

// ── Lookup helpers (shared with the parsers) ─────────────────────────────────

/** Why {@link ll1Resolve} picked the entry it picked out of a table cell. */
export type LL1ResolutionRule =
  /** The cell is single-valued — the LL(1) case, no choice was made. */
  | 'sole-entry'
  /**
   * Multiply-defined cell holding both a FIRST-case and a FOLLOW-case entry:
   * take the FIRST-case one, i.e. the production that consumes the lookahead
   * rather than the one that derives ε. This is the resolution of Example 4.33
   * (§4.4.3), which in the dangling-else grammar associates each else with the
   * closest previous then.
   */
  | 'consumes-lookahead'
  /**
   * Multiply-defined cell whose entries all came from the same case, so
   * nothing distinguishes them on this lookahead: the book gives no rule and
   * the grammar simply is not LL(1) here. The parser breaks the tie by taking
   * the first-listed entry so that it can keep going.
   */
  | 'first-listed';

export interface LL1Resolution {
  entry: LL1Entry; // the chosen entry
  index: number; // its position within the cell
  cell: LL1Entry[]; // the whole cell, in insertion order
  rule: LL1ResolutionRule;
}

/**
 * Resolve a table cell to a single production, reporting *why* that entry was
 * chosen. See {@link LL1ResolutionRule}; callers that narrate the choice must
 * use `rule` rather than assuming a fixed story.
 */
export function ll1Resolve(table: LL1Table, nt: string, a: string): LL1Resolution | null {
  const cell = table[nt]?.[a];
  if (!cell || cell.length === 0) return null;
  const firstCase = cell.findIndex((e) => e.via === 'first');
  const index = firstCase >= 0 ? firstCase : 0;
  const rule: LL1ResolutionRule =
    cell.length === 1
      ? 'sole-entry'
      : firstCase >= 0 && cell.some((e) => e.via === 'follow')
        ? 'consumes-lookahead'
        : 'first-listed';
  return { entry: cell[index]!, index, cell: [...cell], rule };
}

/** The production {@link ll1Resolve} selects for M[nt, a] (null if the cell is empty). */
export function ll1Lookup(table: LL1Table, nt: string, a: string): LL1Entry | null {
  return ll1Resolve(table, nt, a)?.entry ?? null;
}

/** Sorted terminals for which row M[nt, ·] has an entry (the "expected set"). */
export function ll1RowExpected(table: LL1Table, nt: string): string[] {
  const row = table[nt] ?? {};
  return sortSet(Object.keys(row).filter((t) => (row[t] ?? []).length > 0));
}

// ── Conveniences ─────────────────────────────────────────────────────────────

/** Untraced table construction (drains generators; identical result). */
export function ll1Table(g: Grammar): LL1TableResult {
  return drain(ll1TableSteps(g, drain(firstFollowSteps(g))));
}

export function runLL1Table(
  g: Grammar,
  id = 'syntax.ll1-table',
): Recorded<LL1TableState, LL1TableEvent, LL1TableResult> {
  const ff = drain(firstFollowSteps(g));
  return record(() => ll1TableSteps(g, ff), initialLL1TableState(g), ll1TableReducer, { id });
}

/**
 * Shared vocabulary of the LR family: item / transition / action JSON shapes,
 * deterministic formatting helpers, and the common ACTION/GOTO table
 * construction (used by SLR — Algorithm 4.46, canonical LR(1) — Algorithm
 * 4.56, and LALR — Algorithm 4.59, which differ only in where the reduce
 * lookaheads come from).
 *
 * Everything here is plain JSON: no Map/Set/class instances inside events or
 * reduced states.
 */
import type { Citation, StepMeta, Steps } from '@lab/trace';
import { EOF, type Grammar } from './grammar.js';
import { ntSet } from './lr-first.js';

// ── Items, transitions, actions ──────────────────────────────────────────────

/** LR(0) item [A → α·β]; `kernel` per §4.6.2 (dot not at left end, or S'→·S). */
export interface Lr0ItemJson {
  prod: number; // production id in the AUGMENTED grammar
  dot: number;
  kernel: boolean;
}

/** LR(1) item [A → α·β, a] (§4.7.2); `la` is a terminal or '$'. */
export interface Lr1ItemJson {
  prod: number;
  dot: number;
  la: string;
  kernel: boolean;
}

export interface LrTransitionJson {
  from: number;
  symbol: string;
  to: number;
}

export type LrAction =
  | { type: 'shift'; to: number }
  | { type: 'reduce'; prod: number }
  | { type: 'accept' };

export interface LrConflictJson {
  state: number;
  symbol: string;
  /** 'accept/reduce' is the reduce/reduce-family clash against the augmented
   *  production [S' → S ·]: no shift is involved. */
  kind: 'shift/reduce' | 'reduce/reduce' | 'accept/reduce';
  /** The two contradictory demands on this cell, in discovery order. Unless
   *  `resolution` says otherwise the cell is left BLANK: which of the two was
   *  registered first is an artefact of item-discovery order and must never
   *  decide the table. */
  actions: LrAction[];
  /** Formatted items justifying each action, aligned with `actions`. */
  items: string[];
  /** Non-null when the construction resolved the conflict (dangling else). */
  resolution: { action: LrAction; reason: string } | null;
}

// ── Formatting (used in prose, goldens, and the UI) ─────────────────────────

/** "E → E · + T" — the dotted body of an item. */
export function formatDotted(g: Grammar, prod: number, dot: number): string {
  const p = g.productions[prod];
  if (!p) throw new Error(`no production ${prod}`);
  const parts = [...p.rhs.slice(0, dot), '·', ...p.rhs.slice(dot)];
  return `${p.lhs} → ${parts.join(' ')}`;
}

export function formatLr0Item(g: Grammar, item: { prod: number; dot: number }): string {
  return `[${formatDotted(g, item.prod, item.dot)}]`;
}

export function formatLr1Item(
  g: Grammar,
  item: { prod: number; dot: number; la: string },
): string {
  return `[${formatDotted(g, item.prod, item.dot)}, ${item.la}]`;
}

/**
 * Compact action notation matching the book's tables: s5 / r4 / acc.
 * NOTE our production ids are 0-based with the augmented production appended
 * last, while the book numbers the original productions from 1 — hence the
 * `prod + 1` in the r-notation (r4 = reduce by production (4)).
 */
export function actionToString(a: LrAction): string {
  switch (a.type) {
    case 'shift':
      return `s${a.to}`;
    case 'reduce':
      return `r${a.prod + 1}`;
    case 'accept':
      return 'acc';
  }
}

export function actionsEqual(a: LrAction, b: LrAction): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'shift' && b.type === 'shift') return a.to === b.to;
  if (a.type === 'reduce' && b.type === 'reduce') return a.prod === b.prod;
  return true; // both accept
}

/**
 * Classify two contradictory demands on one ACTION cell. `accept` only ever
 * claims ACTION[i, $], and no grammar symbol '$' can be shifted, so a clash
 * involving accept is always against a reduction — an accept/reduce conflict
 * (of the reduce/reduce family: accept IS the reduction by S' → S), never a
 * shift/reduce one.
 */
export function conflictKind(a: LrAction, b: LrAction): LrConflictJson['kind'] {
  if (a.type === 'accept' || b.type === 'accept') return 'accept/reduce';
  if (a.type === 'reduce' && b.type === 'reduce') return 'reduce/reduce';
  return 'shift/reduce';
}

/**
 * Verbose action description for prose. `stateName` renames the shift target
 * for tables whose rows carry display names (LALR's merged states); it
 * defaults to the internal id.
 */
export function describeAction(
  g: Grammar,
  a: LrAction,
  stateName: (id: number) => string = String,
): string {
  switch (a.type) {
    case 'shift':
      return `shift and go to state ${stateName(a.to)}`;
    case 'reduce': {
      const p = g.productions[a.prod]!;
      return `reduce by ${p.lhs} → ${p.rhs.length === 0 ? 'ε' : p.rhs.join(' ')}`;
    }
    case 'accept':
      return 'accept';
  }
}

// ── Shared ACTION/GOTO table construction ────────────────────────────────────

export type TableAlgo = 'slr' | 'lr1' | 'lalr';

export type TableEvent =
  | { kind: 'table/start'; algo: TableAlgo; grammarName: string; numStates: number }
  | { kind: 'table/follow'; nonterminal: string; follow: string[] }
  | { kind: 'table/row'; state: number }
  | { kind: 'table/action'; state: number; symbol: string; action: LrAction }
  | { kind: 'table/goto'; state: number; nonterminal: string; to: number }
  | { kind: 'table/conflict'; conflict: LrConflictJson };

/** The reduced-state fields every table-building trace maintains. */
export interface TableFields {
  grammarName: string;
  /** FOLLOW sets (emitted by SLR only; empty record otherwise). */
  follow: Record<string, string[]>;
  /** ACTION[state][terminal or '$']. A cell claimed by two contradictory
   *  actions is left EMPTY unless the construction resolved the conflict
   *  (dangling else, §4.8.2): which of the two actions happened to be
   *  registered first is an artefact of item-discovery order and must never
   *  decide the table. An empty cell with a matching entry in `conflicts` is
   *  therefore "conflicted", not "error". */
  action: Array<Record<string, LrAction>>;
  goto: Array<Record<string, number>>;
  conflicts: LrConflictJson[];
}

/** True iff an earlier conflict on this very cell was RESOLVED (§4.8.2): a
 *  later unresolved clash must not withdraw that deliberate entry. */
function cellWasResolved(
  conflicts: readonly LrConflictJson[],
  state: number,
  symbol: string,
): boolean {
  return conflicts.some((c) => c.state === state && c.symbol === symbol && c.resolution !== null);
}

/** Pure reducer for the shared table events, generic over richer states. */
export function reduceTableEvent<S extends TableFields>(s: S, e: TableEvent): S {
  switch (e.kind) {
    case 'table/start':
      return { ...s, grammarName: e.grammarName };
    case 'table/follow':
      return { ...s, follow: { ...s.follow, [e.nonterminal]: [...e.follow] } };
    case 'table/row':
      return { ...s, action: [...s.action, {}], goto: [...s.goto, {}] };
    case 'table/action': {
      const action = s.action.map((row, i) =>
        i === e.state ? { ...row, [e.symbol]: e.action } : row,
      );
      return { ...s, action };
    }
    case 'table/goto': {
      const goto = s.goto.map((row, i) =>
        i === e.state ? { ...row, [e.nonterminal]: e.to } : row,
      );
      return { ...s, goto };
    }
    case 'table/conflict': {
      const c = e.conflict;
      const action = s.action.map((row, i) => {
        if (i !== c.state) return row;
        if (c.resolution) return { ...row, [c.symbol]: c.resolution.action };
        // Unresolved: withdraw the entry so the cell is CONFLICTED rather than
        // holding whichever action happened to be registered first. An earlier
        // §4.8.2 resolution on the same cell still stands.
        if (cellWasResolved(s.conflicts, c.state, c.symbol)) return row;
        const rest = { ...row };
        delete rest[c.symbol];
        return rest;
      });
      return { ...s, action, conflicts: [...s.conflicts, c] };
    }
  }
}

/** What a conflict note may look at besides the kind of the clash. */
export interface ConflictContext {
  state: number;
  /** The lookahead the two actions fight over. */
  symbol: string;
  /** True for the §4.8.2 dangling-else SHAPE: a complete item [A → γ ·] sits
   *  next to [A → γ · X δ] where X is the very symbol of the clash, so one
   *  body is a proper prefix of the other. */
  danglingElseShape: boolean;
}

export interface TableBuildInputs {
  algo: TableAlgo;
  /** Augmented grammar; its last production is S' → S. */
  ag: Grammar;
  states: Array<{ id: number; items: Array<Lr0ItemJson | Lr1ItemJson> }>;
  transition: (from: number, symbol: string) => number | undefined;
  /** Terminals on which to reduce by `item` in `state` (SLR: FOLLOW(A);
   *  LR(1)/LALR: the item's own lookahead). Deterministically ordered. */
  reduceLookaheads: (stateId: number, item: Lr0ItemJson | Lr1ItemJson) => string[];
  /** Prose fragment justifying a reduce entry on lookahead `la`. */
  reduceWhy: (stateId: number, item: Lr0ItemJson | Lr1ItemJson, la: string) => string;
  cite: Citation;
  /** Educational note appended to conflict prose (per-algorithm). It must
   *  depend on the KIND of clash — a shift/reduce example explains nothing
   *  about a reduce/reduce one — and may use `ctx` to recognise the
   *  dangling-else shape, whose cause is ambiguity rather than the coarseness
   *  of the table-construction method. */
  conflictNote: (kind: LrConflictJson['kind'], ctx: ConflictContext) => string;
  /** Resolve if-else shift/reduce conflicts by shifting (§4.8.2). */
  resolveDanglingElseByShift: boolean;
  section: string;
  formatItem: (item: Lr0ItemJson | Lr1ItemJson) => string;
  /** Display name of a table row for PROSE only (events keep internal ids).
   *  LALR passes the book's merged-state names so a trace never mixes "state 4"
   *  with "I47" for the same row; defaults to the internal id. */
  stateName?: (id: number) => string;
}

export interface BuiltTable {
  action: Array<Record<string, LrAction>>;
  goto: Array<Record<string, number>>;
  conflicts: LrConflictJson[];
}

/**
 * Fill ACTION/GOTO from a collection of item sets. Iterates states in id
 * order; within a state, items in their stored (deterministic) order; reduce
 * lookaheads in the caller-supplied order; GOTO entries over nonterminals in
 * declaration order. This is the common core of Algorithms 4.46 / 4.56 / 4.59.
 */
export function* buildTableSteps(inp: TableBuildInputs): Steps<TableEvent, BuiltTable> {
  const { ag, cite } = inp;
  const nts = ntSet(ag);
  const augProdId = ag.productions.length - 1;
  const action: Array<Record<string, LrAction>> = [];
  const gotoT: Array<Record<string, number>> = [];
  const conflicts: LrConflictJson[] = [];
  /** Every DISTINCT action demanded of a cell, with the item that justified it,
   *  in discovery order. Copies of an item that differ only in a lookahead
   *  irrelevant to the action (a shift item split by lookahead in LR(1)/LALR)
   *  demand the same action and are recorded once. */
  const demands: Array<Record<string, Array<{ action: LrAction; item: string }>>> = [];
  /** Conflict kinds already reported per cell — one record per (cell, kind). */
  const reported: Array<Record<string, Set<LrConflictJson['kind']>>> = [];
  const name = inp.stateName ?? String;
  /** Action in book notation, with shift targets under the display naming. */
  const actionText = (a: LrAction): string =>
    a.type === 'shift' ? `s${name(a.to)}` : actionToString(a);

  const meta = (
    prose: string,
    level: 'macro' | 'micro',
    groupId: string,
    extraCite?: Citation,
  ): StepMeta => ({
    cite: extraCite ?? cite,
    prose,
    level,
    groupId,
    section: inp.section,
  });

  for (const st of inp.states) {
    const i = st.id;
    action.push({});
    gotoT.push({});
    demands.push({});
    reported.push({});
    const groupId = `${inp.algo}:row:${i}`;
    yield [
      { kind: 'table/row', state: i },
      meta(
        `Fill row ${name(i)} of the parsing table from the items of state ${name(i)}: shift entries from terminal transitions, reduce entries from complete items, then GOTO entries from nonterminal transitions.`,
        'macro',
        groupId,
      ),
    ];

    for (const item of st.items) {
      const p = ag.productions[item.prod]!;
      if (item.dot < p.rhs.length) {
        const a = p.rhs[item.dot]!;
        if (nts.has(a)) continue; // handled by GOTO below
        const to = inp.transition(i, a);
        if (to === undefined) throw new Error(`missing GOTO(${i}, ${a})`);
        const desired: LrAction = { type: 'shift', to };
        const itemStr = inp.formatItem(item);
        const why = `item ${itemStr} has terminal '${a}' after the dot and GOTO(${name(i)}, ${a}) = ${name(to)}, so ACTION[${name(i)}, ${a}] = s${name(to)}`;
        yield* setCell(i, a, desired, why, itemStr);
      } else if (item.prod === augProdId) {
        // [S' → S ·] (with lookahead $ in LR(1)/LALR): accept.
        const desired: LrAction = { type: 'accept' };
        const itemStr = inp.formatItem(item);
        yield* setCell(
          i,
          EOF,
          desired,
          `item ${itemStr} is the complete augmented production, so ACTION[${name(i)}, $] = accept`,
          itemStr,
        );
      } else {
        const itemStr = inp.formatItem(item);
        for (const la of inp.reduceLookaheads(i, item)) {
          const desired: LrAction = { type: 'reduce', prod: item.prod };
          const why = `item ${itemStr} is complete and ${inp.reduceWhy(i, item, la)}, so ACTION[${name(i)}, ${la}] = r${item.prod + 1} (reduce by ${p.lhs} → ${p.rhs.length === 0 ? 'ε' : p.rhs.join(' ')})`;
          yield* setCell(i, la, desired, why, itemStr);
        }
      }
    }

    // GOTO entries: nonterminals in declaration order (skip the augmented start).
    for (const nt of ag.nonterminals) {
      if (nt === ag.start) continue;
      const to = inp.transition(i, nt);
      if (to === undefined) continue;
      gotoT[i]![nt] = to;
      yield [
        { kind: 'table/goto', state: i, nonterminal: nt, to },
        meta(
          `GOTO(${name(i)}, ${nt}) = ${name(to)} in the automaton, so GOTO[${name(i)}, ${nt}] = ${name(to)} — after a reduction to ${nt} in state ${name(i)} the parser pushes state ${name(to)}.`,
          'micro',
          groupId,
        ),
      ];
    }
  }

  return { action, goto: gotoT, conflicts };

  /**
   * Place `desired` into ACTION[i][sym]. A demand that repeats an action the
   * cell was already asked for is silently skipped (this is what collapses the
   * many lookahead-split copies of one shift item into a single demand);
   * a genuinely different action is a conflict against EVERY action already
   * demanded of the cell, and one record is emitted per (cell, conflict kind)
   * — so a cell claimed by a shift and two different reductions reports both
   * the shift/reduce and the (merge-introduced) reduce/reduce conflict.
   */
  function* setCell(
    i: number,
    sym: string,
    desired: LrAction,
    why: string,
    itemStr: string,
  ): Steps<TableEvent, void> {
    const row = action[i]!;
    const groupId = `${inp.algo}:row:${i}`;
    const seen = (demands[i]![sym] ??= []);
    if (seen.some((d) => actionsEqual(d.action, desired))) return; // same demand again
    const prior = [...seen];
    seen.push({ action: desired, item: itemStr });
    if (prior.length === 0) {
      row[sym] = desired;
      yield [
        { kind: 'table/action', state: i, symbol: sym, action: desired },
        meta(`ACTION[${name(i)}, ${sym}] = ${actionText(desired)}: ${why}.`, 'micro', groupId),
      ];
      return;
    }
    const kinds = (reported[i]![sym] ??= new Set());
    for (const other of prior) {
      const kind = conflictKind(other.action, desired);
      if (kinds.has(kind)) continue; // this cell already reported this kind
      kinds.add(kind);
      yield* emitConflict(i, sym, other, { action: desired, item: itemStr }, kind, groupId);
    }
  }

  function* emitConflict(
    i: number,
    sym: string,
    a: { action: LrAction; item: string },
    b: { action: LrAction; item: string },
    kind: LrConflictJson['kind'],
    groupId: string,
  ): Steps<TableEvent, void> {
    const row = action[i]!;
    const shiftAction =
      a.action.type === 'shift' ? a.action : b.action.type === 'shift' ? b.action : null;
    const reduceAction =
      a.action.type === 'reduce' ? a.action : b.action.type === 'reduce' ? b.action : null;
    const danglingElseShape =
      kind === 'shift/reduce' &&
      reduceAction !== null &&
      hasPrefixExtension(st(i), reduceAction.prod, sym);
    let resolution: LrConflictJson['resolution'] = null;
    let citeOverride: Citation | undefined;
    if (inp.resolveDanglingElseByShift && sym === 'else' && danglingElseShape && shiftAction) {
      resolution = {
        action: shiftAction,
        reason:
          "dangling else (§4.8.2): shifting 'else' attaches it to the closest previous unmatched 'if', which is the conventional resolution",
      };
      citeOverride = { section: '4.8.2', rule: 'resolve the if-else shift/reduce conflict in favor of shifting' };
    } else if (danglingElseShape) {
      // Unresolved, but the CAUSE is the ambiguity of the grammar, not the
      // approximation the table-construction method uses — cite §4.8.2.
      citeOverride = {
        section: '4.8.2',
        rule: 'the dangling-else conflict comes from the ambiguity of the grammar, not from the lookahead approximation',
      };
    }
    const conflict: LrConflictJson = {
      state: i,
      symbol: sym,
      kind,
      actions: [a.action, b.action],
      items: [a.item, b.item],
      resolution,
    };
    conflicts.push(conflict);
    if (resolution) {
      row[sym] = resolution.action;
    } else if (!cellWasResolved(conflicts, i, sym)) {
      // Neither demand may win by accident of item-discovery order: withdraw
      // the entry so the cell is conflicted (see TableFields.action).
      delete row[sym];
    }
    const clash = `${kind} conflict in state ${name(i)} on '${sym}': ${describeAction(ag, a.action, name)} (from ${a.item}) vs ${describeAction(ag, b.action, name)} (from ${b.item})`;
    const tail = resolution
      ? ` Resolved in favor of the shift: else must pair with the nearest unmatched if (§4.8.2).`
      : ` ACTION[${name(i)}, ${sym}] is therefore left blank — neither action may win by accident of item order. ${inp.conflictNote(kind, { state: i, symbol: sym, danglingElseShape })}`;
    yield [
      { kind: 'table/conflict', conflict },
      meta(`${clash}.${tail}`, 'macro', groupId, citeOverride),
    ];
  }

  function st(i: number): Array<Lr0ItemJson | Lr1ItemJson> {
    return inp.states[i]!.items;
  }

  /** True iff reducing by `prod` (A → γ) clashes with a co-resident item
   *  [A → γ · sym δ]: the body of `prod` is a proper prefix of another body of
   *  the same nonterminal, extended by the very symbol of the clash. With
   *  sym = 'else' this is literally the dangling-else shape of §4.8.2. */
  function hasPrefixExtension(
    items: Array<Lr0ItemJson | Lr1ItemJson>,
    reduceProd: number,
    sym: string,
  ): boolean {
    const p1 = ag.productions[reduceProd]!;
    return items.some((it) => {
      if (it.prod === reduceProd) return false;
      const p2 = ag.productions[it.prod]!;
      return (
        p2.lhs === p1.lhs &&
        it.dot === p1.rhs.length &&
        p2.rhs.length > p1.rhs.length &&
        p2.rhs[p1.rhs.length] === sym &&
        p1.rhs.every((s, k) => p2.rhs[k] === s)
      );
    });
  }
}

/** Run a Steps generator to completion, discarding events (used where a
 *  construction is needed as an ingredient of another traced algorithm). */
export function drain<E, R>(steps: Steps<E, R>): R {
  let it = steps.next();
  while (!it.done) it = steps.next();
  return it.value;
}

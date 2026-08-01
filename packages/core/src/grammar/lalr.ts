/**
 * LALR(1) table construction by merging same-core LR(1) states — §4.7.4,
 * Algorithm 4.59 ("an easy, but space-consuming LALR table construction").
 *
 * The canonical LR(1) collection is built untraced (it has its own trace in
 * lr1-items.ts); this trace shows (1) which Ii/Ij merge into which LALR state
 * with their lookahead unions, (2) the remapped GOTO transitions, and (3) the
 * table construction, where reduce/reduce conflicts introduced by the merge
 * are detected and explained. Merged states keep the book's concatenated
 * names (I3 ∪ I6 = I36, as in Fig 4.43).
 */
import type { Recorded, Reducer, Steps } from '@lab/trace';
import { record } from '@lab/trace';
import { augment, type Grammar } from './grammar.js';
import { sortTerminals } from './lr-first.js';
import {
  buildTableSteps,
  drain,
  formatDotted,
  formatLr1Item,
  reduceTableEvent,
  type Lr1ItemJson,
  type LrTransitionJson,
  type TableEvent,
  type TableFields,
} from './lr-events.js';
import { lr1Items, Lr1StateCapError } from './lr1-items.js';

export interface MergedStateJson {
  id: number;
  /** Book-style name: the concatenated ids of the merged LR(1) states ("36"). */
  name: string;
  /** LR(1) state ids merged into this LALR state, ascending. */
  sources: number[];
  /** Union items: cores in first-source order, lookaheads in terminal order. */
  items: Lr1ItemJson[];
}

export interface LalrUiState extends TableFields {
  lr1StateCount: number;
  states: MergedStateJson[];
  transitions: LrTransitionJson[];
}

export type LalrResult = LalrUiState;

export type LalrEvent =
  | { kind: 'lalr/start'; grammarName: string; lr1StateCount: number }
  | {
      kind: 'lalr/merge';
      state: MergedStateJson;
      /** True when more than one LR(1) state shares this core. */
      merged: boolean;
      /** Per-core lookahead provenance: which source contributed which las. */
      lookaheadUnions: Array<{
        core: string;
        union: string[];
        parts: Array<{ source: number; las: string[] }>;
      }>;
    }
  | { kind: 'lalr/transition'; from: number; symbol: string; to: number }
  | TableEvent;

export function lalrInitial(): LalrUiState {
  return {
    grammarName: '',
    lr1StateCount: 0,
    states: [],
    transitions: [],
    follow: {},
    action: [],
    goto: [],
    conflicts: [],
  };
}

export const lalrReducer: Reducer<LalrUiState, LalrEvent> = (s, e) => {
  switch (e.kind) {
    case 'lalr/start':
      return { ...s, grammarName: e.grammarName, lr1StateCount: e.lr1StateCount };
    case 'lalr/merge':
      return {
        ...s,
        states: [
          ...s.states,
          {
            id: e.state.id,
            name: e.state.name,
            sources: [...e.state.sources],
            items: e.state.items.map((it) => ({ ...it })),
          },
        ],
      };
    case 'lalr/transition':
      return {
        ...s,
        transitions: [...s.transitions, { from: e.from, symbol: e.symbol, to: e.to }],
      };
    default:
      return reduceTableEvent(s, e);
  }
};

export interface LalrOpts {
  /** Cap on the intermediate canonical LR(1) collection (default 20000). */
  maxLr1States?: number;
  /** Resolve if-else shift/reduce conflicts by shifting (§4.8.2) — used by the
   *  pipeline parser; off by default so study grammars show raw conflicts. */
  resolveDanglingElseByShift?: boolean;
}

/** Pure generator: LALR(1) states and table for `grammar` per Algorithm 4.59. */
export function* lalrSteps(grammar: Grammar, opts?: LalrOpts): Steps<LalrEvent, LalrResult> {
  const ag = augment(grammar);
  const maxLr1States = opts?.maxLr1States ?? 20000;
  const coll = drain(lr1Items(grammar, { maxStates: maxLr1States }));
  if (coll.truncated) {
    throw new Lr1StateCapError(
      'cannot build the LALR(1) table',
      grammar.name,
      coll.states.length,
      maxLr1States,
    );
  }

  const artifact = lalrInitial();
  artifact.grammarName = grammar.name;
  artifact.lr1StateCount = coll.states.length;

  yield [
    { kind: 'lalr/start', grammarName: grammar.name, lr1StateCount: coll.states.length },
    {
      cite: { section: '4.7.4', figureOrAlgo: 'Algorithm 4.59' },
      prose: `LALR construction begins from the ${coll.states.length} canonical LR(1) states: states with the same core (the same set of first components) will be merged, unioning their lookaheads.`,
      level: 'macro',
      section: 'Merge',
    },
  ];

  // ── Group LR(1) states by core ────────────────────────────────────────────
  const coreKeyOf = (items: Lr1ItemJson[]) =>
    [...new Set(items.map((it) => `${it.prod}.${it.dot}`))].sort().join(',');
  const groupOf = new Map<string, number>(); // core key → merged id
  const groups: number[][] = []; // merged id → source LR(1) ids (ascending)
  for (const st of coll.states) {
    const key = coreKeyOf(st.items);
    const gid = groupOf.get(key);
    if (gid === undefined) {
      groupOf.set(key, groups.length);
      groups.push([st.id]);
    } else {
      groups[gid]!.push(st.id);
    }
  }
  const mergedIdOfSource = new Map<number, number>();
  groups.forEach((sources, gid) => sources.forEach((s) => mergedIdOfSource.set(s, gid)));

  /**
   * Book name of a merged state. The book writes I3 ∪ I6 as I36, which is only
   * readable — and only unambiguous — while every LR(1) state id is a single
   * digit (Fig 4.43's grammar has ten states). Past that, concatenation is
   * unreadable and can collide (sources [1,23] and [12,3] both give "123", and
   * a merge of I3/I6 would clash with a plain state I36), so the ids are
   * separated by commas instead.
   */
  function mergedName(sources: number[]): string {
    if (sources.length === 1) return String(sources[0]);
    return coll.states.length <= 10 ? sources.join('') : sources.join(',');
  }

  // ── Emit merged states ────────────────────────────────────────────────────
  for (let gid = 0; gid < groups.length; gid++) {
    const sources = groups[gid]!;
    const firstSrc = coll.states[sources[0]!]!;
    // Distinct cores in first-source item order (closure order is core-stable).
    const coreOrder: Array<{ prod: number; dot: number; kernel: boolean }> = [];
    const seenCore = new Set<string>();
    for (const it of firstSrc.items) {
      const ck = `${it.prod}.${it.dot}`;
      if (!seenCore.has(ck)) {
        seenCore.add(ck);
        coreOrder.push({ prod: it.prod, dot: it.dot, kernel: it.kernel });
      }
    }
    const items: Lr1ItemJson[] = [];
    const lookaheadUnions: Array<{
      core: string;
      union: string[];
      parts: Array<{ source: number; las: string[] }>;
    }> = [];
    for (const core of coreOrder) {
      const parts: Array<{ source: number; las: string[] }> = [];
      const union = new Set<string>();
      for (const src of sources) {
        const las = coll.states[src]!.items
          .filter((it) => it.prod === core.prod && it.dot === core.dot)
          .map((it) => it.la);
        parts.push({ source: src, las: sortTerminals(ag, las) });
        for (const la of las) union.add(la);
      }
      const unionSorted = sortTerminals(ag, union);
      for (const la of unionSorted) {
        items.push({ prod: core.prod, dot: core.dot, la, kernel: core.kernel });
      }
      lookaheadUnions.push({
        core: formatDotted(ag, core.prod, core.dot),
        union: unionSorted,
        parts,
      });
    }
    const merged: MergedStateJson = {
      id: gid,
      name: mergedName(sources),
      sources: [...sources],
      items,
    };
    artifact.states.push(merged);
    const isMerge = sources.length > 1;
    const unionText = lookaheadUnions
      .filter((u) => u.union.length > 0)
      .map((u) => `[${u.core}, ${u.union.join('/')}]`)
      .join('; ');
    yield [
      {
        kind: 'lalr/merge',
        state: {
          id: merged.id,
          name: merged.name,
          sources: [...merged.sources],
          items: merged.items.map((it) => ({ ...it })),
        },
        merged: isMerge,
        lookaheadUnions,
      },
      {
        cite: { section: '4.7.4', figureOrAlgo: 'Algorithm 4.59', rule: 'find all sets having the same core and replace them by their union' },
        prose: isMerge
          ? `${sources.map((s) => `I${s}`).join(' and ')} share the same core, so they merge into LALR state I${merged.name} with unioned lookaheads: ${unionText}.`
          : `I${sources[0]} has a unique core, so it is carried over unchanged as LALR state I${merged.name}.`,
        level: 'macro',
        section: 'Merge',
        groupId: `lalr:merge:${merged.name}`,
      },
    ];
  }

  // ── Remap transitions ─────────────────────────────────────────────────────
  // The GOTO of merged states is well defined: same-core states have
  // same-core successors, so all sources agree on the merged target.
  const srcTrans = new Map<string, number>();
  for (const t of coll.transitions) srcTrans.set(`${t.from} ${t.symbol}`, t.to);
  const symbolOrder = [...ag.nonterminals, ...ag.terminals];
  const mergedTrans = new Map<string, number>();
  for (let gid = 0; gid < groups.length; gid++) {
    for (const x of symbolOrder) {
      let target: number | undefined;
      for (const src of groups[gid]!) {
        const t = srcTrans.get(`${src} ${x}`);
        if (t === undefined) continue;
        const m = mergedIdOfSource.get(t)!;
        if (target === undefined) target = m;
        else if (target !== m) {
          throw new Error(`LALR merge produced inconsistent GOTO(${gid}, ${x})`);
        }
      }
      if (target === undefined) continue;
      mergedTrans.set(`${gid} ${x}`, target);
      artifact.transitions.push({ from: gid, symbol: x, to: target });
      yield [
        { kind: 'lalr/transition', from: gid, symbol: x, to: target },
        {
          cite: { section: '4.7.4', rule: 'GOTO(J, X) of a union J is the union of the (same-core) GOTOs of its members' },
          prose: `GOTO(I${artifact.states[gid]!.name}, ${x}) = I${artifact.states[target]!.name}: every merged member's ${x}-successor has the same core, so the transition is well defined on the merged states.`,
          level: 'micro',
          groupId: `lalr:goto:${gid}`,
          section: 'Merge',
        },
      ];
    }
  }

  // ── Table construction over the merged states ─────────────────────────────
  yield [
    { kind: 'table/start', algo: 'lalr', grammarName: grammar.name, numStates: groups.length },
    {
      cite: { section: '4.7.4', figureOrAlgo: 'Algorithm 4.59' },
      prose: `Construct ACTION/GOTO from the ${groups.length} merged states exactly as for canonical LR(1) (Algorithm 4.56); merging cannot introduce shift/reduce conflicts, but it can introduce reduce/reduce conflicts.`,
      level: 'macro',
      section: 'Table',
    },
  ];

  const built = yield* buildTableSteps({
    algo: 'lalr',
    ag,
    states: artifact.states.map((s) => ({ id: s.id, items: s.items })),
    transition: (from, sym) => mergedTrans.get(`${from} ${sym}`),
    reduceLookaheads: (_state, item) => [(item as Lr1ItemJson).la],
    reduceWhy: (state, item) =>
      `'${(item as Lr1ItemJson).la}' is in its (unioned) lookahead set in merged state I${artifact.states[state]!.name}`,
    cite: { section: '4.7.4', figureOrAlgo: 'Algorithm 4.59' },
    conflictNote: (kind) => {
      if (kind === 'reduce/reduce') {
        return 'This reduce/reduce conflict was introduced by the merge: in the canonical LR(1) collection those lookaheads lived in different same-core states, and unioning them made two complete items claim the same lookahead (Example 4.58 of §4.7.4 shows the same effect). The grammar is LR(1) but not LALR(1).';
      }
      if (kind === 'accept/reduce') {
        return 'The augmented item [S′ → S ·, $] wants to accept while a complete item wants to reduce on $ — no shift is involved, and one lookahead cannot decide between finishing the parse and reducing again.';
      }
      return 'A shift/reduce conflict here cannot have been introduced by merging (the shift depends only on the core); it exists in the canonical LR(1) table as well.';
    },
    resolveDanglingElseByShift: opts?.resolveDanglingElseByShift ?? false,
    section: 'Table',
    formatItem: (it) => formatLr1Item(ag, it as Lr1ItemJson),
    stateName: (id) => artifact.states[id]!.name,
  });

  artifact.action = built.action;
  artifact.goto = built.goto;
  artifact.conflicts = built.conflicts;
  return artifact;
}

/** Convenience: record the LALR construction trace. */
export function lalrRun(
  grammar: Grammar,
  opts?: LalrOpts & { id?: string },
): Recorded<LalrUiState, LalrEvent, LalrResult> {
  return record(() => lalrSteps(grammar, opts), lalrInitial(), lalrReducer, {
    id: opts?.id ?? 'syntax.lalr',
  });
}

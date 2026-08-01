/**
 * The subset construction (Algorithm 3.20, §3.7.1): convert an NFA to a DFA
 * whose states are sets of NFA states. ε-closure is computed with the stack
 * algorithm of Fig 3.33. D-states are named A, B, C, … in creation order and
 * unmarked states are processed FIFO, so on the NFA of Fig 3.34 the trace
 * reproduces Fig 3.36 (the five D-states) and Fig 3.37 (Dtran) exactly.
 *
 * One representation choice: when move(T, a) = ∅, Fig 3.32 as printed would add
 * the empty set to Dstates as the dead state. The resulting DFA is kept partial
 * here — Dtran[T, a] stays undefined, the convention §3.9.6 itself adopts when
 * it eliminates the dead state of a minimized DFA and the one §3.8.3's scanner
 * simulation needs to recognise "no next state". The step is still traced
 * ('emptyMove'), so nothing the book's loop does is silently skipped.
 */

import type { Citation, Recorded, StepMeta, Steps } from '@lab/trace';
import { record } from '@lab/trace';
import type { SubsetEvent } from './events.js';
import { initialSubsetState, subsetReducer, type SubsetState } from './reducers.js';
import {
  dstateName,
  sortedNums,
  type Dfa,
  type DfaAccept,
  type DfaState,
  type DtranEntry,
  type MultiNfa,
  type NfaAccept,
} from './types.js';

const ALGO: Citation = {
  section: '3.7.1',
  figureOrAlgo: 'Algorithm 3.20',
  rule: 'while there is an unmarked state T in Dstates: mark T; for each input symbol a, U := ε-closure(move(T, a)); add U to Dstates if new; Dtran[T, a] := U',
};

const ECLOSURE: Citation = {
  section: '3.7.1',
  figureOrAlgo: 'Fig 3.33',
  rule: 'push all states of T onto stack; while stack not empty: pop t; for each u with an ε-edge from t not yet in ε-closure(T), add u and push it',
};

const setStr = (xs: number[]): string => `{${xs.join(', ')}}`;

/**
 * @param traced When false, no events are constructed or yielded — same
 * algorithm, same result, used for the scanner's one-time combined-DFA build
 * (the combined machine would otherwise emit ~10^6 ε-closure micro events).
 */
export function* subsetConstruction(nfa: MultiNfa, traced = true): Steps<SubsetEvent, Dfa> {
  // Adjacency in edge-creation order (deterministic).
  const epsAdj = new Map<number, number[]>();
  const symAdj = new Map<number, Array<{ label: string; to: number }>>();
  for (const e of nfa.edges) {
    if (e.label === null) {
      const l = epsAdj.get(e.from);
      if (l) l.push(e.to);
      else epsAdj.set(e.from, [e.to]);
    } else {
      const l = symAdj.get(e.from);
      if (l) l.push({ label: e.label, to: e.to });
      else symAdj.set(e.from, [{ label: e.label, to: e.to }]);
    }
  }
  const alphabet = [...new Set(nfa.edges.map((e) => e.label).filter((l): l is string => l !== null))].sort();
  const acceptOf = new Map<number, NfaAccept>(nfa.accepts.map((a) => [a.state, a]));

  if (traced)
    yield [
      { kind: 'init', alphabet, nfaStart: nfa.start },
      {
        cite: ALGO,
        prose: `Input alphabet {${alphabet.join(', ')}} collected from the NFA's labeled edges; NFA start state is ${nfa.start}.`,
        level: 'macro',
        section: 'Start state',
      },
    ];

  /** Highest-priority (lowest number) token among a set's accepting NFA states. */
  const acceptFor = (set: number[]): DfaAccept | null => {
    let best: NfaAccept | null = null;
    for (const s of set) {
      const a = acceptOf.get(s);
      if (a && (best === null || a.priority < best.priority)) best = a;
    }
    return best === null ? null : { token: best.token, priority: best.priority };
  };

  function* eclosure(
    input: number[],
    groupId: string,
    context: string,
    section: string,
  ): Steps<SubsetEvent, number[]> {
    const closure = new Set(input);
    const stack = [...input];
    if (traced)
      yield [
        { kind: 'eclosureInit', input: [...input], stack: [...stack], closure: sortedNums(closure), context },
        {
          cite: ECLOSURE,
          prose: `Compute ε-closure(${setStr(input)}) for ${context}: initialize the closure to the set itself and push all its states onto the stack.`,
          level: 'micro',
          groupId,
          section,
        },
      ];
    while (stack.length > 0) {
      const t = stack.pop()!;
      if (traced)
        yield [
          { kind: 'eclosurePop', state: t, stack: [...stack] },
          {
            cite: ECLOSURE,
            prose: `Pop state ${t} from the stack and examine its ε-edges.`,
            level: 'micro',
            groupId,
            section,
          },
        ];
      for (const u of epsAdj.get(t) ?? []) {
        if (!closure.has(u)) {
          closure.add(u);
          stack.push(u);
          if (traced)
            yield [
              { kind: 'eclosureAdd', state: u, via: t, stack: [...stack], closure: sortedNums(closure) },
              {
                cite: ECLOSURE,
                prose: `State ${u} is reachable from ${t} by an ε-edge and not yet in the closure: add it and push it.`,
                level: 'micro',
                groupId,
                section,
              },
            ];
        }
      }
    }
    return sortedNums(closure);
  }

  const move = (set: number[], a: string): number[] => {
    const out = new Set<number>();
    for (const s of set) {
      for (const e of symAdj.get(s) ?? []) if (e.label === a) out.add(e.to);
    }
    return sortedNums(out);
  };

  const states: DfaState[] = [];
  const trans: DtranEntry[] = [];
  const key2idx = new Map<string, number>();

  const addState = (nfaStates: number[], isStart: boolean): DfaState => {
    const id = dstateName(states.length);
    const st: DfaState = { id, nfaStates, accept: acceptFor(nfaStates) };
    key2idx.set(nfaStates.join(','), states.length);
    states.push(st);
    return st;
  };

  const startSet = yield* eclosure([nfa.start], 'eclosure:start', 'the start state', 'Start state');
  const startState = addState(startSet, true);
  if (traced)
    yield [
      {
      kind: 'dstateCreated',
      id: startState.id,
      nfaStates: [...startSet],
      accept: startState.accept,
      isStart: true,
    },
    {
      cite: ALGO,
      prose:
        `The start state of the DFA is ${startState.id} = ε-closure({${nfa.start}}) = ${setStr(startSet)}, added to Dstates unmarked.` +
        (startState.accept ? ` It contains an accepting NFA state, so ${startState.id} accepts ${startState.accept.token}.` : ''),
      level: 'macro',
      groupId: 'eclosure:start',
      section: 'Start state',
    },
  ];

  // FIFO worklist over unmarked D-states, in creation order.
  for (let i = 0; i < states.length; i++) {
    const st = states[i]!;
    const section = `Process ${st.id}`;
    if (traced)
      yield [
        { kind: 'dstateMarked', id: st.id },
      {
        cite: ALGO,
        prose: `${st.id} = ${setStr(st.nfaStates)} is the first unmarked state in Dstates: mark it and compute its transition on each input symbol.`,
        level: 'macro',
        section,
      },
    ];
    for (const a of alphabet) {
      const moved = move(st.nfaStates, a);
      if (moved.length === 0) {
        // Fig 3.32 computes U = ε-closure(move(T, a)) = ∅ here and would add the
        // empty set as a D-state. A DFA state from which no accepting state is
        // reachable is the dead state; this lab keeps it out of Dstates and
        // leaves Dtran[T, a] undefined instead — the same convention §3.9.6 uses
        // when it eliminates the dead state of a minimized DFA, and the one the
        // scanner's simulation (§3.8.3) needs to detect "no next state".
        // Record the step so the omission is visible in the trace.
        if (traced)
          yield [
            { kind: 'emptyMove', from: st.id, symbol: a },
            {
              cite: ALGO,
              prose:
                `move(${st.id}, ${a}) = ∅, so U = ε-closure(∅) = ∅ — the dead state. ` +
                `Dtran[${st.id}, ${a}] is left undefined instead of pointing at a D-state for ∅ ` +
                `(minimization adds ∅ back when Algorithm 3.39 needs a total transition function).`,
              level: 'macro',
              section,
            },
          ];
        continue;
      }
      const gid = `eclosure:${st.id}:${a}`;
      const clo = yield* eclosure(moved, gid, `move(${st.id}, ${a}) = ${setStr(moved)}`, section);
      const key = clo.join(',');
      let toId: string;
      const existing = key2idx.get(key);
      if (existing === undefined) {
        const created = addState(clo, false);
        toId = created.id;
        if (traced)
          yield [
            {
            kind: 'dstateCreated',
            id: created.id,
            nfaStates: [...clo],
            accept: created.accept,
            isStart: false,
          },
          {
            cite: ALGO,
            prose:
              `U = ε-closure(move(${st.id}, ${a})) = ${setStr(clo)} is not yet in Dstates: add it unmarked as ${created.id}.` +
              (created.accept ? ` It contains an accepting NFA state, so ${created.id} accepts ${created.accept.token}.` : ''),
            level: 'macro',
            groupId: gid,
            section,
          },
        ];
      } else {
        toId = states[existing]!.id;
      }
      trans.push({ from: st.id, symbol: a, to: toId });
      if (traced)
        yield [
          { kind: 'dtranSet', from: st.id, symbol: a, to: toId },
        {
          cite: ALGO,
          prose: `Dtran[${st.id}, ${a}] := ${toId}${existing !== undefined ? ` (the set ${setStr(clo)} is already in Dstates as ${toId})` : ''}.`,
          level: 'macro',
          groupId: gid,
          section,
        },
      ];
    }
  }

  if (traced)
    yield [
      { kind: 'complete', numStates: states.length },
    {
      cite: ALGO,
      prose: `No unmarked states remain: the subset construction is complete with ${states.length} D-states.`,
      level: 'macro',
      section: 'Done',
    },
  ];

  return { states, start: states[0]!.id, alphabet, trans };
}

/** Convenience: record a subset-construction trace. */
export function runSubsetConstruction(
  nfa: MultiNfa,
  id = 'lex.subset-construction',
): Recorded<SubsetState, SubsetEvent, Dfa> {
  return record(() => subsetConstruction(nfa), initialSubsetState(), subsetReducer, { id });
}

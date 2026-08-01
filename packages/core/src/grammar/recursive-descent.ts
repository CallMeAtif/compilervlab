/**
 * Predictive recursive-descent parsing (§4.4.1 procedures, production
 * selection by FIRST/FOLLOW per §4.4.3), traced.
 *
 * One procedure per nonterminal (Fig 4.13 shape): on call, the lookahead
 * selects the production whose prediction set contains it (FIRST(α), plus
 * FOLLOW(A) when α ⇒* ε). Events: call (macro), select, match, return, error.
 * UI state: the growing call tree plus the current input position. Runs on any
 * grammar whose choices FIRST/FOLLOW can discriminate — i.e. the LL(1)-
 * transformed grammars; residual conflicts are resolved first-listed /
 * longest-match with an explanatory note event.
 */
import { record, type Recorded, type Reducer, type StepMeta, type Steps } from '@lab/trace';
import { EOF, EPSILON, isNonterminal, formatProduction, productionsFor, type Grammar, type Production } from './grammar.js';
import { firstFollowSteps, firstOfString, type FirstFollowResult } from './first-follow.js';
import { drain, formatSymbols, sortSet } from './ll-util.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface RDNode {
  id: number;
  symbol: string; // nonterminal (call), terminal (leaf), or ε
  children: number[];
  status: 'active' | 'done' | 'leaf';
  production: number | null; // selected production id, for call nodes
}

export interface RDError {
  message: string;
  expected: string[];
  found: string;
  pos: number;
}

export interface RDState {
  input: string[];
  pos: number;
  nodes: RDNode[]; // nodes[id] has that id (creation order)
  status: 'running' | 'accepted' | 'error';
  error: RDError | null;
  notes: string[];
}

export type RDResult = RDState;

export type RDEvent =
  | { kind: 'rd.call'; nonterminal: string; node: number; parent: number | null }
  | {
      kind: 'rd.select';
      node: number;
      production: { id: number; lhs: string; rhs: string[] };
      lookahead: string;
      justification: string;
    }
  | { kind: 'rd.match'; terminal: string; pos: number; node: number; parent: number }
  | { kind: 'rd.return'; nonterminal: string; node: number }
  | { kind: 'rd.note'; message: string }
  | { kind: 'rd.error'; message: string; expected: string[]; found: string; pos: number; node: number }
  | { kind: 'rd.accept' };

// ── Reducer ──────────────────────────────────────────────────────────────────

export function initialRDState(input: readonly string[]): RDState {
  return { input: [...input], pos: 0, nodes: [], status: 'running', error: null, notes: [] };
}

export const rdReducer: Reducer<RDState, RDEvent> = (s, ev) => {
  switch (ev.kind) {
    case 'rd.call': {
      const nodes = s.nodes.map((n) =>
        n.id === ev.parent ? { ...n, children: [...n.children, ev.node] } : n,
      );
      nodes.push({ id: ev.node, symbol: ev.nonterminal, children: [], status: 'active', production: null });
      return { ...s, nodes };
    }
    case 'rd.select': {
      let nodes = s.nodes.map((n) =>
        n.id === ev.node ? { ...n, production: ev.production.id } : n,
      );
      if (ev.production.rhs.length === 0) {
        // ε-production: attach an ε leaf so the call tree shows the choice
        const leafId = nodes.length;
        nodes = nodes.map((n) =>
          n.id === ev.node ? { ...n, children: [...n.children, leafId] } : n,
        );
        nodes.push({ id: leafId, symbol: EPSILON, children: [], status: 'leaf', production: null });
      }
      return { ...s, nodes };
    }
    case 'rd.match': {
      const nodes = s.nodes.map((n) =>
        n.id === ev.parent ? { ...n, children: [...n.children, ev.node] } : n,
      );
      nodes.push({ id: ev.node, symbol: ev.terminal, children: [], status: 'leaf', production: null });
      return { ...s, nodes, pos: s.pos + 1 };
    }
    case 'rd.return': {
      const nodes = s.nodes.map((n) =>
        n.id === ev.node ? { ...n, status: 'done' as const } : n,
      );
      return { ...s, nodes };
    }
    case 'rd.note':
      return { ...s, notes: [...s.notes, ev.message] };
    case 'rd.error':
      return {
        ...s,
        status: 'error',
        error: { message: ev.message, expected: ev.expected, found: ev.found, pos: ev.pos },
      };
    case 'rd.accept':
      return { ...s, status: 'accepted' };
  }
};

// ── The traced algorithm ─────────────────────────────────────────────────────

export function* recursiveDescentSteps(
  g: Grammar,
  input: readonly string[],
  ff?: FirstFollowResult,
): Steps<RDEvent, RDResult> {
  const sets = ff ?? drain(firstFollowSteps(g));
  let state = initialRDState(input);

  function* step(ev: RDEvent, meta: StepMeta): Steps<RDEvent, void> {
    yield [ev, meta];
    state = rdReducer(state, ev);
  }

  const la = (): string => (state.pos < state.input.length ? state.input[state.pos]! : EOF);

  /** Prediction set of A → α: FIRST(α) − {ε} ∪ (FOLLOW(A) if ε ∈ FIRST(α)). */
  const predict = (p: Production): string[] => {
    const fa = firstOfString(g, sets.first, p.rhs);
    const out = fa.filter((x) => x !== EPSILON);
    if (fa.includes(EPSILON)) {
      for (const b of sets.follow[p.lhs] ?? []) if (!out.includes(b)) out.push(b);
    }
    return sortSet(out);
  };

  function* callNT(nt: string, parent: number | null): Generator<[RDEvent, StepMeta], boolean, void> {
    const nodeId = state.nodes.length;
    const group = `rd-${nodeId}`;
    yield* step(
      { kind: 'rd.call', nonterminal: nt, node: nodeId, parent },
      {
        cite: { section: '4.4.1', figureOrAlgo: 'Fig 4.13' },
        prose: `Call the procedure for ${nt}${parent === null ? ' (the start symbol)' : ''}: a recursive-descent parser has one procedure per nonterminal, and expanding ${nt} means calling it.`,
        level: 'macro',
        groupId: group,
        section: 'Recursive descent',
      },
    );

    const a = la();
    const prods = productionsFor(g, nt);
    const candidates = prods.filter((p) => predict(p).includes(a));

    if (candidates.length === 0) {
      const expected = sortSet(prods.flatMap((p) => predict(p)));
      yield* step(
        {
          kind: 'rd.error',
          message: `in ${nt}: no production is predicted on lookahead ${a}; expected one of {${expected.join(', ')}}`,
          expected,
          found: a,
          pos: state.pos,
          node: nodeId,
        },
        {
          cite: { section: '4.4.3', rule: 'A production A → α is selected on lookahead a iff a ∈ FIRST(α), or α ⇒* ε and a ∈ FOLLOW(A)' },
          prose: `No production for ${nt} predicts the lookahead ${a}: the union of the prediction sets of all ${nt}-productions is {${expected.join(', ')}}, so one of those terminals was expected here.`,
          level: 'macro',
          groupId: group,
          section: 'Recursive descent',
          irRefs: [{ kind: 'token', id: state.pos }],
        },
      );
      return false;
    }

    if (candidates.length > 1) {
      const msg =
        `${candidates.length} productions of ${nt} predict lookahead ${a} (${candidates
          .map((p) => formatProduction(p))
          .join('; ')}): the grammar is not LL(1) here. Choosing the one whose FIRST set contains ${a} ` +
        `(longest match — for dangling-else this binds the else to the nearest if, §4.8.2), first-listed otherwise.`;
      yield* step(
        { kind: 'rd.note', message: msg },
        {
          cite: { section: '4.8.2', rule: 'Resolve the ambiguity in favor of consuming the lookahead (shift-like choice)' },
          prose: msg,
          level: 'micro',
          groupId: group,
          section: 'Recursive descent',
        },
      );
    }
    const chosen =
      candidates.find((p) =>
        firstOfString(g, sets.first, p.rhs).some((x) => x !== EPSILON && x === a),
      ) ?? candidates[0]!;
    const viaFirst = firstOfString(g, sets.first, chosen.rhs).includes(a);
    const justification = viaFirst
      ? `lookahead ${a} ∈ FIRST(${formatSymbols(chosen.rhs)})`
      : `${formatSymbols(chosen.rhs)} ⇒* ε and ${a} ∈ FOLLOW(${nt})`;
    yield* step(
      {
        kind: 'rd.select',
        node: nodeId,
        production: { id: chosen.id, lhs: chosen.lhs, rhs: [...chosen.rhs] },
        lookahead: a,
        justification,
      },
      {
        cite: { section: '4.4.3', rule: 'Select A → α on lookahead a when a ∈ FIRST(α), or α ⇒* ε and a ∈ FOLLOW(A)' },
        prose: `Select ${formatProduction(chosen)} because ${justification}; the procedure body for this alternative now processes ${formatSymbols(chosen.rhs)} left to right.`,
        level: 'micro',
        groupId: group,
        section: 'Recursive descent',
        irRefs: [{ kind: 'production', id: chosen.id }, { kind: 'token', id: state.pos }],
      },
    );

    for (const sym of chosen.rhs) {
      if (isNonterminal(g, sym)) {
        const ok = yield* callNT(sym, nodeId);
        if (!ok) return false;
      } else {
        const cur = la();
        if (cur !== sym) {
          yield* step(
            {
              kind: 'rd.error',
              message: `in ${nt}: expected ${sym} but found ${cur}`,
              expected: [sym],
              found: cur,
              pos: state.pos,
              node: nodeId,
            },
            {
              cite: { section: '4.4.1', figureOrAlgo: 'Fig 4.13', rule: 'if Xi is a terminal and Xi = current input symbol then advance, else error' },
              prose: `The body of ${formatProduction(chosen)} demands the terminal ${sym} next, but the input holds ${cur}: syntax error.`,
              level: 'macro',
              groupId: group,
              section: 'Recursive descent',
              irRefs: [{ kind: 'token', id: state.pos }],
            },
          );
          return false;
        }
        yield* step(
          { kind: 'rd.match', terminal: sym, pos: state.pos, node: state.nodes.length, parent: nodeId },
          {
            cite: { section: '4.4.1', figureOrAlgo: 'Fig 4.13', rule: 'if Xi is a terminal and Xi = current input symbol then advance the input' },
            prose: `Match the terminal ${sym} against the input and advance past it.`,
            level: 'micro',
            groupId: group,
            section: 'Recursive descent',
            irRefs: [{ kind: 'token', id: state.pos }],
          },
        );
      }
    }

    yield* step(
      { kind: 'rd.return', nonterminal: nt, node: nodeId },
      {
        cite: { section: '4.4.1', figureOrAlgo: 'Fig 4.13' },
        prose: `The body of ${nt} is fully processed: return from its procedure (the subtree under ${nt} is complete).`,
        level: 'micro',
        groupId: group,
        section: 'Recursive descent',
      },
    );
    return true;
  }

  const ok = yield* callNT(g.start, null);
  if (ok) {
    const a = la();
    if (a === EOF) {
      yield* step(
        { kind: 'rd.accept' },
        {
          cite: { section: '4.4.1' },
          prose: 'The start procedure returned successfully and the whole input is consumed — the sentence is accepted.',
          level: 'macro',
          section: 'Recursive descent',
        },
      );
    } else {
      yield* step(
        {
          kind: 'rd.error',
          message: `parsing of ${g.start} finished but input still has ${a}`,
          expected: [EOF],
          found: a,
          pos: state.pos,
          node: 0,
        },
        {
          cite: { section: '4.4.1' },
          prose: `The start procedure returned but the input still holds ${a}: a complete derivation was found for a prefix only, so the sentence is rejected.`,
          level: 'macro',
          section: 'Recursive descent',
          irRefs: [{ kind: 'token', id: state.pos }],
        },
      );
    }
  }

  return state;
}

// ── Conveniences ─────────────────────────────────────────────────────────────

export function runRecursiveDescent(
  g: Grammar,
  input: readonly string[],
  ff?: FirstFollowResult,
  id = 'syntax.recursive-descent',
): Recorded<RDState, RDEvent, RDResult> {
  const sets = ff ?? drain(firstFollowSteps(g));
  return record(
    () => recursiveDescentSteps(g, input, sets),
    initialRDState(input),
    rdReducer,
    { id },
  );
}

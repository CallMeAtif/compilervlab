/**
 * Automaton → ElkGraph adapters.
 *
 * Two rules govern everything here (PLAN.md layout-stability):
 *  • the node/edge SET handed to <ElkGraph> is always the *final* automaton, so
 *    ELK lays it out exactly once; stepping only moves ids between the
 *    `visitedIds` / `currentNodeIds` sets;
 *  • node `label` and `kind` are part of ElkGraph's structural hash, so they
 *    must not depend on the step. Anything that changes per step (partition
 *    group, current token) goes into `reactNode`, which is not hashed.
 *
 * DFA transitions are merged per state pair and their symbols condensed into
 * ranges ("0–9"), because the C-subset classes have alphabets of 10–63 symbols
 * and one edge per symbol would be unreadable as well as slow.
 */
import type { ElkGraphEdge, ElkGraphNode } from '../../components/viz/ElkGraph';
import type { DfaState, DtranEntry, NfaEdge } from '@lab/core/lex/types.js';

export const EPSILON = 'ε';

/** Printable form of one input symbol. */
export function showSymbol(ch: string): string {
  if (ch === ' ') return '␣';
  if (ch === '\n') return '\\n';
  if (ch === '\t') return '\\t';
  if (ch === '\r') return '\\r';
  return ch;
}

/**
 * "0123456789" → "0–9"; "abcxyz" → "a–c, x–z". Runs shorter than three symbols
 * are listed literally, matching how the book writes character classes.
 */
export function condenseSymbols(symbols: readonly string[], maxLen = 26): string {
  const single = [...new Set(symbols)]
    .filter((s) => s.length === 1)
    .sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!);
  const multi = [...new Set(symbols)].filter((s) => s.length !== 1);

  const parts: string[] = [];
  let i = 0;
  while (i < single.length) {
    let j = i;
    while (
      j + 1 < single.length &&
      single[j + 1]!.codePointAt(0)! === single[j]!.codePointAt(0)! + 1
    ) {
      j++;
    }
    const run = j - i + 1;
    if (run >= 3) {
      parts.push(`${showSymbol(single[i]!)}–${showSymbol(single[j]!)}`);
    } else {
      for (let k = i; k <= j; k++) parts.push(showSymbol(single[k]!));
    }
    i = j + 1;
  }
  parts.push(...multi.map(showSymbol));

  const text = parts.join(', ');
  if (text.length <= maxLen) return text;
  // Never lie about the alphabet: say how many symbols were folded away.
  let acc = '';
  let shown = 0;
  for (const p of parts) {
    if (acc.length + p.length + 2 > maxLen) break;
    acc = acc === '' ? p : `${acc}, ${p}`;
    shown++;
  }
  return `${acc} +${parts.length - shown}`;
}

/** Stable node `kind` (hashed by ElkGraph, so it may not change per step). */
export function automatonNodeKind(isStart: boolean, isAccept: boolean): string {
  if (isStart && isAccept) return 'start-accept';
  if (isStart) return 'start';
  if (isAccept) return 'accept';
  return 'state';
}

// ── NFA ─────────────────────────────────────────────────────────────────────

/** Edge id of NFA edge #i — edges are revealed in creation order. */
export const nfaEdgeId = (i: number): string => `n${i}`;

export interface AutomatonGraph {
  nodes: ElkGraphNode[];
  edges: ElkGraphEdge[];
}

/**
 * Above these sizes ELK's layered layout plus one DOM node per state stops
 * being interactive (the `id` DFA has 117 states and 7 361 transitions — the
 * character-class expansion never merges two transitions into one edge), so
 * the drawing goes behind an explicit opt-in.
 */
export const GRAPH_NODE_LIMIT = 120;
export const GRAPH_EDGE_LIMIT = 520;

export function isHeavyGraph(g: AutomatonGraph): boolean {
  return g.nodes.length > GRAPH_NODE_LIMIT || g.edges.length > GRAPH_EDGE_LIMIT;
}

export function nfaGraph(
  states: readonly number[],
  edges: readonly NfaEdge[],
  start: number | null,
  accept: number | null,
  decorate?: (state: number) => ElkGraphNode['reactNode'],
): AutomatonGraph {
  return {
    nodes: states.map((s) => ({
      id: String(s),
      label: String(s),
      kind: automatonNodeKind(s === start, s === accept),
      reactNode: decorate?.(s),
    })),
    edges: edges.map((e, i) => ({
      id: nfaEdgeId(i),
      source: String(e.from),
      target: String(e.to),
      label: e.label === null ? EPSILON : showSymbol(e.label),
    })),
  };
}

// ── DFA ─────────────────────────────────────────────────────────────────────

export const dfaEdgeId = (from: string, to: string): string => `d:${from}->${to}`;

/**
 * Ceiling on a DRAWN transition label — the full condensed set goes to the
 * chip's tooltip. The combined scanner DFA fans a start state out ten ways with
 * a character list on every branch; at the old 26 the labels were wider than
 * the states they sat between. Well under ElkGraph's own EDGE_LABEL_MAX_CHARS,
 * because "a, e, f, i +5" is the reading and the list is the reference.
 */
const DFA_LABEL_MAX_LEN = 15;

export interface DfaGraphOptions {
  start: string | null;
  /** Extra nodes that exist but are not D-states (the dead state ∅). */
  extraNodes?: Array<{ id: string; kind: string }>;
  /**
   * Step-independent node text. It feeds ELK's box-size estimate and the
   * structural hash, so it must be constant for the life of the graph — when
   * the visible content changes per step, use `label` to reserve the width and
   * `decorate` to draw.
   */
  labelOf?: (id: string) => string;
  decorate?: (id: string) => ElkGraphNode['reactNode'];
  acceptOf?: (id: string) => string | null;
}

export function dfaGraph(
  states: readonly Pick<DfaState, 'id' | 'accept'>[],
  trans: readonly DtranEntry[],
  opts: DfaGraphOptions,
): AutomatonGraph {
  const bySymbolPair = new Map<string, { from: string; to: string; symbols: string[] }>();
  for (const t of trans) {
    const id = dfaEdgeId(t.from, t.to);
    const hit = bySymbolPair.get(id);
    if (hit) hit.symbols.push(t.symbol);
    else bySymbolPair.set(id, { from: t.from, to: t.to, symbols: [t.symbol] });
  }

  const nodes: ElkGraphNode[] = states.map((s) => ({
    id: s.id,
    label: opts.labelOf?.(s.id) ?? s.id,
    kind: automatonNodeKind(s.id === opts.start, (opts.acceptOf?.(s.id) ?? s.accept?.token ?? null) !== null),
    reactNode: opts.decorate?.(s.id),
  }));
  for (const extra of opts.extraNodes ?? []) {
    nodes.push({
      id: extra.id,
      label: opts.labelOf?.(extra.id) ?? extra.id,
      kind: extra.kind,
      reactNode: opts.decorate?.(extra.id),
    });
  }

  const edges: ElkGraphEdge[] = [...bySymbolPair.entries()].map(([id, e]) => {
    const full = condenseSymbols(e.symbols, Number.POSITIVE_INFINITY);
    const shown = condenseSymbols(e.symbols, DFA_LABEL_MAX_LEN);
    return {
      id,
      source: e.from,
      target: e.to,
      label: shown,
      ...(full === shown ? {} : { title: full }),
    };
  });

  return { nodes, edges };
}

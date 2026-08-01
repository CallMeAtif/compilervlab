/**
 * INTERNAL — private FIRST/FOLLOW machinery for the LR-family modules only.
 *
 * The *traced* FIRST/FOLLOW algorithms (with per-rule events) belong to the
 * LL-side syntax module (first-follow.ts, owned by a sibling team). The LR
 * constructions merely need the finished sets — SLR reduce entries use
 * FOLLOW(A) (Algorithm 4.46) and the LR(1) CLOSURE needs FIRST(βa)
 * (Fig 4.40) — so this file keeps a small untraced copy of the standard
 * fixpoint computations of §4.4.2, avoiding cross-module coupling.
 *
 * Do NOT re-export from the package index; this is an implementation detail.
 */
import { EOF, EPSILON, type Grammar } from './grammar.js';

export type TerminalSet = Set<string>;

/** Cached nonterminal membership set per grammar object. */
const ntSetCache = new WeakMap<Grammar, Set<string>>();
export function ntSet(g: Grammar): Set<string> {
  let s = ntSetCache.get(g);
  if (!s) {
    s = new Set(g.nonterminals);
    ntSetCache.set(g, s);
  }
  return s;
}

/** Deterministic terminal ordering: grammar declaration order, then $, then ε. */
export function terminalOrder(g: Grammar): Map<string, number> {
  const m = new Map<string, number>();
  g.terminals.forEach((t, i) => m.set(t, i));
  m.set(EOF, g.terminals.length);
  m.set(EPSILON, g.terminals.length + 1);
  return m;
}

/** Sort a set of terminals into the deterministic display order. */
export function sortTerminals(g: Grammar, syms: Iterable<string>): string[] {
  const ord = terminalOrder(g);
  return [...new Set(syms)].sort(
    (a, b) =>
      (ord.get(a) ?? Number.MAX_SAFE_INTEGER) - (ord.get(b) ?? Number.MAX_SAFE_INTEGER),
  );
}

/**
 * FIRST sets for all nonterminals (§4.4.2): iterate the three FIRST rules to a
 * fixpoint, scanning productions in declaration order (deterministic; the
 * resulting sets are order-independent anyway).
 */
export function computeFirst(g: Grammar): Record<string, TerminalSet> {
  const nts = ntSet(g);
  const first: Record<string, TerminalSet> = {};
  for (const nt of g.nonterminals) first[nt] = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of g.productions) {
      const target = first[p.lhs]!;
      const before = target.size;
      let allNullable = true;
      for (const sym of p.rhs) {
        if (!nts.has(sym)) {
          // terminal: FIRST rule 1
          target.add(sym);
          allNullable = false;
          break;
        }
        for (const t of first[sym]!) if (t !== EPSILON) target.add(t);
        if (!first[sym]!.has(EPSILON)) {
          allNullable = false;
          break;
        }
      }
      if (allNullable) target.add(EPSILON); // FIRST rule for nullable bodies
      if (target.size !== before) changed = true;
    }
  }
  return first;
}

/**
 * FIRST of a string of grammar symbols X1 X2 … Xn (§4.4.2): union FIRST(X1),
 * then FIRST(X2) if X1 is nullable, …; contains ε iff every Xi is nullable.
 * Terminals (including $) contribute themselves and stop the scan.
 */
export function firstOfString(
  g: Grammar,
  first: Record<string, TerminalSet>,
  symbols: readonly string[],
): TerminalSet {
  const nts = ntSet(g);
  const out = new Set<string>();
  let allNullable = true;
  for (const sym of symbols) {
    if (!nts.has(sym)) {
      out.add(sym);
      allNullable = false;
      break;
    }
    for (const t of first[sym]!) if (t !== EPSILON) out.add(t);
    if (!first[sym]!.has(EPSILON)) {
      allNullable = false;
      break;
    }
  }
  if (allNullable) out.add(EPSILON);
  return out;
}

/**
 * FOLLOW sets for all nonterminals (§4.4.2): $ ∈ FOLLOW(start); for
 * A → αBβ, FIRST(β)∖{ε} ⊆ FOLLOW(B); if β nullable (or empty),
 * FOLLOW(A) ⊆ FOLLOW(B). Fixpoint over productions in declaration order.
 */
export function computeFollow(
  g: Grammar,
  first: Record<string, TerminalSet>,
): Record<string, TerminalSet> {
  const nts = ntSet(g);
  const follow: Record<string, TerminalSet> = {};
  for (const nt of g.nonterminals) follow[nt] = new Set();
  follow[g.start]!.add(EOF); // FOLLOW rule 1
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of g.productions) {
      for (let i = 0; i < p.rhs.length; i++) {
        const b = p.rhs[i]!;
        if (!nts.has(b)) continue;
        const target = follow[b]!;
        const before = target.size;
        const rest = p.rhs.slice(i + 1);
        const f = firstOfString(g, first, rest);
        for (const t of f) if (t !== EPSILON) target.add(t); // FOLLOW rule 2
        if (f.has(EPSILON)) {
          for (const t of follow[p.lhs]!) target.add(t); // FOLLOW rule 3
        }
        if (target.size !== before) changed = true;
      }
    }
  }
  return follow;
}

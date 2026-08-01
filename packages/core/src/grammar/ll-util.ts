/**
 * Deterministic helpers shared by the LL-family algorithms (§4.3–§4.4).
 * All set operations are over sorted string arrays (plain JSON, stable order).
 */
import type { Steps } from '@lab/trace';
import { EPSILON } from './grammar.js';

/** Total order on grammar symbols: plain code-unit comparison. ε (U+03B5)
 *  sorts after every ASCII symbol, so it always appears last in a set. */
export function symCmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sortSet(syms: readonly string[]): string[] {
  return [...syms].sort(symCmp);
}

/** Insert `sym` into a sorted set without mutation.
 *  Returns the new array, or null if `sym` was already present. */
export function addedToSet(set: readonly string[], sym: string): string[] | null {
  if (set.includes(sym)) return null;
  return [...set, sym].sort(symCmp);
}

/** A production body as prose: "X y Z", or "ε" for the empty body. */
export function formatSymbols(syms: readonly string[]): string {
  return syms.length === 0 ? EPSILON : syms.join(' ');
}

/** An id-less production as prose: "A → α". */
export function formatRule(p: { lhs: string; rhs: readonly string[] }): string {
  return `${p.lhs} → ${formatSymbols(p.rhs)}`;
}

/** Run a Steps generator to completion, discarding events (untraced replay). */
export function drain<E, R>(gen: Steps<E, R>): R {
  let it = gen.next();
  while (!it.done) it = gen.next();
  return it.value;
}

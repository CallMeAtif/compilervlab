/**
 * Regex ASTs for the C-subset token classes — the input to Thompson's
 * construction (Algorithm 3.23). Character classes are expanded to unions over
 * a small explicit alphabet so the automata stay textbook-faithful and
 * renderable. Alternation/concat nodes are binary, as in the book; the
 * variadic `cat(...)`/`alt(...)` helpers fold LEFT, so a multi-part sequence is
 * left-nested — the association Example 3.24 uses for abb.
 */

export type RegexAst =
  | { kind: 'char'; ch: string; id: number }
  | { kind: 'epsilon'; id: number }
  | { kind: 'concat'; left: RegexAst; right: RegexAst; id: number }
  | { kind: 'union'; left: RegexAst; right: RegexAst; id: number }
  | { kind: 'star'; inner: RegexAst; id: number };

let nextId = 0;
const chr = (ch: string): RegexAst => ({ kind: 'char', ch, id: nextId++ });
const eps = (): RegexAst => ({ kind: 'epsilon', id: nextId++ });
const cat2 = (l: RegexAst, r: RegexAst): RegexAst => ({ kind: 'concat', left: l, right: r, id: nextId++ });
const alt2 = (l: RegexAst, r: RegexAst): RegexAst => ({ kind: 'union', left: l, right: r, id: nextId++ });
export const star = (inner: RegexAst): RegexAst => ({ kind: 'star', inner, id: nextId++ });

export function cat(...parts: RegexAst[]): RegexAst {
  return parts.reduce((a, b) => cat2(a, b));
}
export function alt(...parts: RegexAst[]): RegexAst {
  return parts.reduce((a, b) => alt2(a, b));
}
export function lit(s: string): RegexAst {
  return cat(...[...s].map(chr));
}
export function oneOf(chars: string): RegexAst {
  return alt(...[...chars].map(chr));
}
export function plus(inner: RegexAst, clone: () => RegexAst): RegexAst {
  // r+ = r r*  (the book's shorthand, §3.3.6); caller supplies a fresh copy
  return cat2(inner, star(clone()));
}
export function opt(inner: RegexAst): RegexAst {
  // r? = r | ε (§3.3.6)
  return alt2(inner, eps());
}

/** Reset the id counter (used by tests for deterministic ids). */
export function resetRegexIds(): void {
  nextId = 0;
}

export const DIGITS = '0123456789';
export const LOWER = 'abcdefghijklmnopqrstuvwxyz';
export const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** A token-class definition: name + regex + priority (lower wins ties, i.e.
 *  keywords beat id) following the "first-listed pattern wins" rule of §3.5.3. */
export interface TokenClassDef {
  name: string; // TokenType it produces (keywords handled via keyword table instead)
  priority: number;
  regex: RegexAst;
  /** Pretty regex string shown in the UI (e.g. "digit digit*"). */
  display: string;
}

/**
 * Teaching token classes for the constructions view. The scanner's real DFA is
 * built from these same definitions (plus operator/punct literals).
 * NOTE: identifiers/keywords follow §3.4.2 — keywords are reserved words
 * recognized as identifiers then looked up in the keyword table (tokens.ts).
 */
export function buildTokenClasses(): TokenClassDef[] {
  resetRegexIds();
  const letter = () => alt(oneOf(LOWER), oneOf(UPPER), chr('_'));
  const digit = () => oneOf(DIGITS);
  return [
    {
      name: 'id',
      priority: 2,
      regex: cat(letter(), star(alt(letter(), digit()))),
      display: 'letter ( letter | digit )*',
    },
    {
      name: 'intconst',
      priority: 3,
      regex: cat(digit(), star(digit())),
      display: 'digit digit*',
    },
    {
      name: 'floatconst',
      priority: 4,
      regex: cat(digit(), star(digit()), chr('.'), digit(), star(digit())),
      display: 'digit+ . digit+',
    },
  ];
}

/**
 * Context-free grammar representation shared by all syntax-analysis algorithms.
 * Symbols are strings; terminals are exactly the symbols not in `nonterminals`.
 * ε is represented by the empty production body (rhs = []), and EPSILON is used
 * only in FIRST-set values, per Dragon Book conventions (§4.2).
 */

export const EPSILON = 'ε';
export const EOF = '$';

export interface Production {
  id: number; // stable index; used in parse traces and SDD actions
  lhs: string;
  rhs: string[]; // empty array = ε-production
}

export interface Grammar {
  name: string;
  start: string;
  nonterminals: string[]; // declaration order = the book's listing order
  terminals: string[];
  productions: Production[];
}

export function isNonterminal(g: Grammar, sym: string): boolean {
  return g.nonterminals.includes(sym);
}

export function isTerminal(g: Grammar, sym: string): boolean {
  return !g.nonterminals.includes(sym) && sym !== EPSILON;
}

export function productionsFor(g: Grammar, nt: string): Production[] {
  return g.productions.filter((p) => p.lhs === nt);
}

/** Format a production as "E → E + T" (ε shown for empty body). */
export function formatProduction(p: Production): string {
  return `${p.lhs} → ${p.rhs.length === 0 ? EPSILON : p.rhs.join(' ')}`;
}

/**
 * Augment a grammar with a NEW start symbol S' → S (§4.6.3). The whole LR
 * construction rests on S' being a symbol of G' that is not a symbol of G: it
 * then appears in no production body, so the only item with the dot at the end
 * of S' → S· signals acceptance and GOTO is never taken on S'. Grammars such as
 * Dragon 4.28 already contain a nonterminal named E', so primes are appended
 * until the name is genuinely fresh (E → E'', not a second E').
 * The augmented production always gets id = original production count.
 */
export function augment(g: Grammar): Grammar {
  const taken = new Set<string>([...g.nonterminals, ...g.terminals, EPSILON, EOF]);
  let startPrime = `${g.start}'`;
  while (taken.has(startPrime)) startPrime += "'";
  return {
    name: `${g.name} (augmented)`,
    start: startPrime,
    nonterminals: [startPrime, ...g.nonterminals],
    terminals: g.terminals,
    productions: [
      ...g.productions,
      { id: g.productions.length, lhs: startPrime, rhs: [g.start] },
    ],
  };
}

/** Build a grammar from "A -> x y z | w" style rule strings (tokens space-separated,
 *  'ε' or empty alternative = ε-production). First rule's lhs is the start symbol. */
export function grammarFromRules(name: string, rules: string[], terminals: string[]): Grammar {
  const productions: Production[] = [];
  const nonterminals: string[] = [];
  for (const rule of rules) {
    const [lhsRaw, rhsRaw] = rule.split('->');
    if (lhsRaw === undefined || rhsRaw === undefined) throw new Error(`bad rule: ${rule}`);
    const lhs = lhsRaw.trim();
    if (!nonterminals.includes(lhs)) nonterminals.push(lhs);
    for (const alt of rhsRaw.split('|')) {
      const rhs = alt.trim().split(/\s+/).filter((s) => s.length > 0 && s !== EPSILON);
      productions.push({ id: productions.length, lhs, rhs });
    }
  }
  const start = nonterminals[0];
  if (!start) throw new Error('grammar has no productions');
  return { name, start, nonterminals, terminals, productions };
}

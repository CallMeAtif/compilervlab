/**
 * Grammar transformations for top-down parsing, traced:
 *  - Left-recursion elimination — Algorithm 4.19 (§4.3.3): arrange the
 *    nonterminals A1…An in declaration order; for each Ai substitute the
 *    current Aj-bodies into productions Ai → Aj γ (j < i), then remove
 *    immediate left recursion by introducing Ai'.
 *  - Left factoring — Algorithm 4.21 (§4.3.4): repeatedly pull the longest
 *    common prefix of two or more alternatives into A → α A'.
 *
 * Golden: eliminating left recursion from Grammar 4.1 yields exactly
 * Grammar 4.28 (E', T' naming, book ordering).
 */
import { record, type Recorded, type Reducer, type Steps } from '@lab/trace';
import { EPSILON, type Grammar } from './grammar.js';
import { cGrammar } from '../csubset/grammar-def.js';
import { drain, formatRule, formatSymbols } from './ll-util.js';

// ── Types ────────────────────────────────────────────────────────────────────

/** An id-less production (ids are reassigned when the final grammar is built). */
export interface GProd {
  lhs: string;
  rhs: string[];
}

/** UI state: the grammar as it is rewritten. */
export interface TransformState {
  nonterminals: string[];
  productions: GProd[];
}

export type TransformEvent =
  | { kind: 'lr.process'; nonterminal: string; index: number }
  | { kind: 'lr.subst'; nonterminal: string; via: string; replaced: GProd; results: GProd[] }
  | {
      kind: 'lr.immediate';
      nonterminal: string;
      prime: string;
      recursive: GProd[]; // A → A α productions
      nonrecursive: GProd[]; // A → β productions
      aProds: GProd[]; // replacement A-productions (β A')
      primeProds: GProd[]; // A' → α A' | ε
    }
  | { kind: 'lf.pass'; pass: number }
  | {
      kind: 'lf.factor';
      nonterminal: string;
      prefix: string[];
      group: GProd[]; // the factored alternatives, original order
      prime: string;
      aProds: GProd[]; // full replacement list of A-productions, in order
      primeProds: GProd[]; // A' → suffixes (non-ε first, ε last, book style)
    };

// ── Small helpers ────────────────────────────────────────────────────────────

function eqProd(a: GProd, b: GProd): boolean {
  return a.lhs === b.lhs && a.rhs.length === b.rhs.length && a.rhs.every((s, i) => s === b.rhs[i]);
}

function stripIds(g: Grammar): TransformState {
  return {
    nonterminals: [...g.nonterminals],
    productions: g.productions.map((p) => ({ lhs: p.lhs, rhs: [...p.rhs] })),
  };
}

/** A fresh prime name A', A'', … not colliding with any known symbol. */
function freshPrime(base: string, used: Set<string>): string {
  let name = `${base}'`;
  while (used.has(name)) name += `'`;
  used.add(name);
  return name;
}

/** Replace the (contiguous, by construction) block of A-productions with
 *  aProds followed by primeProds, keeping everything else in place. */
function replaceBlock(
  productions: GProd[],
  nt: string,
  aProds: GProd[],
  primeProds: GProd[],
): GProd[] {
  const out: GProd[] = [];
  let inserted = false;
  for (const p of productions) {
    if (p.lhs === nt) {
      if (!inserted) {
        out.push(...aProds, ...primeProds);
        inserted = true;
      }
      continue;
    }
    out.push(p);
  }
  if (!inserted) out.push(...aProds, ...primeProds);
  return out;
}

function insertAfter(list: string[], anchor: string, item: string): string[] {
  const i = list.indexOf(anchor);
  const out = [...list];
  out.splice(i + 1, 0, item);
  return out;
}

// ── Shared reducer ───────────────────────────────────────────────────────────

export function initialTransformState(g: Grammar): TransformState {
  return stripIds(g);
}

export const transformReducer: Reducer<TransformState, TransformEvent> = (s, ev) => {
  switch (ev.kind) {
    case 'lr.subst': {
      const idx = s.productions.findIndex((p) => eqProd(p, ev.replaced));
      if (idx < 0) return s;
      const productions = [...s.productions];
      productions.splice(idx, 1, ...ev.results);
      return { ...s, productions };
    }
    case 'lr.immediate':
    case 'lf.factor':
      return {
        nonterminals: insertAfter(s.nonterminals, ev.nonterminal, ev.prime),
        productions: replaceBlock(s.productions, ev.nonterminal, ev.aProds, ev.primeProds),
      };
    default:
      return s; // lr.process / lf.pass are narration-only
  }
};

/** Rebuild a Grammar (sequential production ids) from a transform state. */
function toGrammar(name: string, base: Grammar, s: TransformState): Grammar {
  return {
    name,
    start: base.start,
    nonterminals: [...s.nonterminals],
    terminals: [...base.terminals],
    productions: s.productions.map((p, i) => ({ id: i, lhs: p.lhs, rhs: [...p.rhs] })),
  };
}

// ── Left-recursion elimination (Algorithm 4.19) ──────────────────────────────

export function* eliminateLeftRecursionSteps(g: Grammar): Steps<TransformEvent, Grammar> {
  const nts = [...g.nonterminals]; // grows as primes are introduced
  let productions: GProd[] = g.productions.map((p) => ({ lhs: p.lhs, rhs: [...p.rhs] }));
  const used = new Set<string>([...g.nonterminals, ...g.terminals]);
  const original = [...g.nonterminals]; // A1 … An of the algorithm
  const cite = { section: '4.3.3', figureOrAlgo: 'Algorithm 4.19' };

  const prodsOf = (nt: string): GProd[] => productions.filter((p) => p.lhs === nt);

  for (let i = 0; i < original.length; i++) {
    const Ai = original[i]!;
    yield [
      { kind: 'lr.process', nonterminal: Ai, index: i },
      {
        cite,
        prose: `Process A${i + 1} = ${Ai}: first replace any leading A1…A${i} in ${Ai}-productions by their bodies, then eliminate immediate left recursion among the ${Ai}-productions.`,
        level: 'macro',
        groupId: `lr-${Ai}`,
        section: 'Eliminate left recursion',
      },
    ];

    // Inner loop: for j = 1 .. i-1, substitute Aj-bodies into Ai → Aj γ.
    for (let j = 0; j < i; j++) {
      const Aj = original[j]!;
      // Re-scan Ai's productions each j (substitution may create new leading symbols,
      // but only with index > j, so a single left-to-right j sweep suffices).
      let target = productions.find((p) => p.lhs === Ai && p.rhs[0] === Aj);
      while (target) {
        const gamma = target.rhs.slice(1);
        const results = prodsOf(Aj).map((d) => ({ lhs: Ai, rhs: [...d.rhs, ...gamma] }));
        const replaced: GProd = { lhs: target.lhs, rhs: [...target.rhs] };
        const idx = productions.findIndex((p) => eqProd(p, replaced));
        productions = [...productions];
        productions.splice(idx, 1, ...results);
        yield [
          { kind: 'lr.subst', nonterminal: Ai, via: Aj, replaced, results },
          {
            cite,
            prose: `${formatRule(replaced)} begins with the earlier nonterminal ${Aj}; substitute each ${Aj}-body for it, giving ${results.map(formatRule).join(' ; ')}. This exposes any left recursion of ${Ai} through ${Aj}.`,
            level: 'micro',
            groupId: `lr-${Ai}`,
            section: 'Eliminate left recursion',
          },
        ];
        target = productions.find((p) => p.lhs === Ai && p.rhs[0] === Aj);
      }
    }

    // Eliminate immediate left recursion among the Ai-productions.
    const aiProds = prodsOf(Ai);
    const recursive = aiProds.filter((p) => p.rhs[0] === Ai);
    if (recursive.length === 0) continue;
    const nonrecursive = aiProds.filter((p) => p.rhs[0] !== Ai);
    const prime = freshPrime(Ai, used);
    const aProds = nonrecursive.map((b) => ({ lhs: Ai, rhs: [...b.rhs, prime] }));
    const primeProds = [
      ...recursive.map((r) => ({ lhs: prime, rhs: [...r.rhs.slice(1), prime] })),
      { lhs: prime, rhs: [] as string[] },
    ];
    productions = replaceBlock(productions, Ai, aProds, primeProds);
    const ntIdx = nts.indexOf(Ai);
    nts.splice(ntIdx + 1, 0, prime);
    yield [
      { kind: 'lr.immediate', nonterminal: Ai, prime, recursive, nonrecursive, aProds, primeProds },
      {
        cite,
        prose: `${Ai} is immediately left recursive (${recursive.map(formatRule).join(' ; ')}). Introduce ${prime} and replace the group by ${[...aProds, ...primeProds].map(formatRule).join(' ; ')} — the left recursion becomes right recursion through ${prime}.`,
        level: 'macro',
        groupId: `lr-${Ai}`,
        section: 'Eliminate left recursion',
      },
    ];
  }

  return toGrammar(`${g.name} (no left recursion)`, g, { nonterminals: nts, productions });
}

// ── Left factoring (Algorithm 4.21) ──────────────────────────────────────────

/** The longest prefix common to two or more alternatives, with the indices of
 *  every alternative sharing it (ties: earliest pair in listed order). */
function longestCommonPrefix(alts: GProd[]): { prefix: string[]; members: number[] } | null {
  let best: { len: number; i: number } | null = null;
  for (let i = 0; i < alts.length; i++) {
    for (let j = i + 1; j < alts.length; j++) {
      const a = alts[i]!.rhs;
      const b = alts[j]!.rhs;
      let l = 0;
      while (l < a.length && l < b.length && a[l] === b[l]) l++;
      if (l > 0 && (!best || l > best.len)) best = { len: l, i };
    }
  }
  if (!best) return null;
  const prefix = alts[best.i]!.rhs.slice(0, best.len);
  const members: number[] = [];
  for (let k = 0; k < alts.length; k++) {
    const rhs = alts[k]!.rhs;
    if (rhs.length >= prefix.length && prefix.every((s, x) => rhs[x] === s)) members.push(k);
  }
  return { prefix, members };
}

export function* leftFactorSteps(g: Grammar): Steps<TransformEvent, Grammar> {
  const nts = [...g.nonterminals];
  let productions: GProd[] = g.productions.map((p) => ({ lhs: p.lhs, rhs: [...p.rhs] }));
  const used = new Set<string>([...g.nonterminals, ...g.terminals]);
  const cite = { section: '4.3.4', figureOrAlgo: 'Algorithm 4.21' };

  let pass = 0;
  let changed = true;
  while (changed) {
    changed = false;
    pass++;
    if (pass > 500) throw new Error('left factoring did not converge');
    yield [
      { kind: 'lf.pass', pass },
      {
        cite,
        prose: `Left-factoring pass ${pass}: for each nonterminal in order, find the longest prefix common to two or more of its alternatives and factor it out; repeat until no two alternatives share a prefix.`,
        level: 'macro',
        section: 'Left factoring',
      },
    ];
    for (let idx = 0; idx < nts.length; idx++) {
      const A = nts[idx]!;
      const alts = productions.filter((p) => p.lhs === A);
      const choice = longestCommonPrefix(alts);
      if (!choice) continue;
      const { prefix, members } = choice;
      const prime = freshPrime(A, used);
      const group = members.map((m) => ({ lhs: A, rhs: [...alts[m]!.rhs] }));
      const memberSet = new Set(members);
      const aProds: GProd[] = [];
      for (let k = 0; k < alts.length; k++) {
        if (k === members[0]) aProds.push({ lhs: A, rhs: [...prefix, prime] });
        else if (!memberSet.has(k)) aProds.push({ lhs: A, rhs: [...alts[k]!.rhs] });
      }
      // Book convention (Example 4.33): non-ε suffixes first (original order), ε last.
      const suffixes = members.map((m) => alts[m]!.rhs.slice(prefix.length));
      const primeProds: GProd[] = [
        ...suffixes.filter((sfx) => sfx.length > 0).map((sfx) => ({ lhs: prime, rhs: sfx })),
        ...suffixes.filter((sfx) => sfx.length === 0).map(() => ({ lhs: prime, rhs: [] as string[] })),
      ];
      productions = replaceBlock(productions, A, aProds, primeProds);
      nts.splice(idx + 1, 0, prime);
      changed = true;
      yield [
        { kind: 'lf.factor', nonterminal: A, prefix, group, prime, aProds, primeProds },
        {
          cite,
          prose: `${group.length} alternatives of ${A} share the longest common prefix ${formatSymbols(prefix)} (${group.map(formatRule).join(' ; ')}): the parser cannot choose among them on one lookahead. Defer the choice: ${A} → ${formatSymbols([...prefix, prime])}, with ${prime} → ${primeProds.map((p) => formatSymbols(p.rhs)).join(' | ')}.`,
          level: 'macro',
          groupId: `lf-${A}-${pass}`,
          section: 'Left factoring',
        },
      ];
    }
  }

  return toGrammar(`${g.name} (left-factored)`, g, { nonterminals: nts, productions });
}

// ── Conveniences ─────────────────────────────────────────────────────────────

export function eliminateLeftRecursion(g: Grammar): Grammar {
  return drain(eliminateLeftRecursionSteps(g));
}

export function leftFactor(g: Grammar): Grammar {
  return drain(leftFactorSteps(g));
}

/** Projection used by the replay invariant: a transform's returned Grammar,
 *  viewed as the reducer's state shape. */
export function projectTransformResult(result: Grammar): TransformState {
  return stripIds(result);
}

export function runEliminateLeftRecursion(
  g: Grammar,
  id = 'syntax.eliminate-left-recursion',
): Recorded<TransformState, TransformEvent, Grammar> {
  return record(
    () => eliminateLeftRecursionSteps(g),
    initialTransformState(g),
    transformReducer,
    { id },
  );
}

export function runLeftFactor(
  g: Grammar,
  id = 'syntax.left-factor',
): Recorded<TransformState, TransformEvent, Grammar> {
  return record(() => leftFactorSteps(g), initialTransformState(g), transformReducer, { id });
}

// ── Wire-up: the LL(1)-ready C grammar ───────────────────────────────────────

export interface LLReadyCGrammar {
  grammar: Grammar; // leftFactor(eliminateLeftRecursion(cGrammar()))
  elim: Recorded<TransformState, TransformEvent, Grammar>;
  factor: Recorded<TransformState, TransformEvent, Grammar>;
}

/**
 * The C-subset grammar made ready for top-down parsing, with both transform
 * traces. Its LL(1) table may still hold conflicts (e.g. dangling else, and
 * FuncDef vs VarDecl both starting with a type specifier) — those are genuine,
 * reported as educational conflict events by the table construction, and the
 * parsers resolve them via the longest-match / first-listed rule with a note.
 */
export function llReadyCGrammar(): LLReadyCGrammar {
  const elim = runEliminateLeftRecursion(cGrammar());
  const factor = runLeftFactor(elim.result);
  return { grammar: factor.result, elim, factor };
}

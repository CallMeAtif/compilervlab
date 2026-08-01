/**
 * FIRST and FOLLOW sets (Dragon Book 2nd ed., §4.4.2), fully traced.
 *
 * Computed exactly as the book presents them: "apply the rules until no more
 * terminals or ε can be added to any FIRST/FOLLOW set" — a fixpoint of passes
 * over the productions in declaration order. Every element added to a set is
 * emitted as an event carrying the §4.4.2 rule that justified it and the
 * production responsible.
 */
import { record, type Recorded, type Reducer, type StepMeta, type Steps } from '@lab/trace';
import { EOF, EPSILON, isNonterminal, formatProduction, type Grammar } from './grammar.js';
import { addedToSet, drain, formatSymbols, symCmp } from './ll-util.js';

// ── Types ────────────────────────────────────────────────────────────────────

/** Nonterminal → sorted set of terminals (FIRST sets may also contain ε). */
export interface SymbolSets {
  [nonterminal: string]: string[];
}

export interface FirstFollowResult {
  first: SymbolSets;
  follow: SymbolSets;
}

/** UI state is the pair of set families as they grow. */
export type FirstFollowState = FirstFollowResult;

export type FirstFollowEvent =
  | { kind: 'ff.pass'; phase: 'first' | 'follow'; pass: number }
  | {
      kind: 'ff.first.add';
      target: string; // nonterminal whose FIRST set grows
      symbol: string; // terminal or ε being added
      production: number; // production id that justified the addition
      justification: string; // the §4.4.2 rule instance, in prose
    }
  | {
      kind: 'ff.follow.add';
      target: string;
      symbol: string;
      production: number | null; // null for FOLLOW rule 1 ($ into FOLLOW(start))
      justification: string;
    }
  | { kind: 'ff.fixpoint'; phase: 'first' | 'follow'; passes: number };

// ── Reducer ──────────────────────────────────────────────────────────────────

export function initialFirstFollowState(g: Grammar): FirstFollowState {
  const first: SymbolSets = {};
  const follow: SymbolSets = {};
  for (const nt of g.nonterminals) {
    first[nt] = [];
    follow[nt] = [];
  }
  return { first, follow };
}

export const firstFollowReducer: Reducer<FirstFollowState, FirstFollowEvent> = (state, ev) => {
  switch (ev.kind) {
    case 'ff.first.add': {
      const next = addedToSet(state.first[ev.target] ?? [], ev.symbol);
      if (!next) return state;
      return { ...state, first: { ...state.first, [ev.target]: next } };
    }
    case 'ff.follow.add': {
      const next = addedToSet(state.follow[ev.target] ?? [], ev.symbol);
      if (!next) return state;
      return { ...state, follow: { ...state.follow, [ev.target]: next } };
    }
    default:
      return state; // pass / fixpoint markers do not change the sets
  }
};

// ── FIRST of a sentential form ───────────────────────────────────────────────

/**
 * FIRST(X1 X2 … Xn) for a string of grammar symbols (§4.4.2): all non-ε
 * symbols of FIRST(X1); if X1 ⇒* ε also those of FIRST(X2); …; ε iff every Xi
 * is nullable (including n = 0). Needed by the LL(1) table construction and by
 * LR(1) closure. Terminals (and $) are their own FIRST.
 */
export function firstOfString(
  g: Grammar,
  first: SymbolSets,
  symbols: readonly string[],
): string[] {
  const out: string[] = [];
  let nullable = true;
  for (const sym of symbols) {
    if (!isNonterminal(g, sym)) {
      if (!out.includes(sym)) out.push(sym);
      nullable = false;
      break;
    }
    const fs = first[sym] ?? [];
    for (const a of fs) {
      if (a !== EPSILON && !out.includes(a)) out.push(a);
    }
    if (!fs.includes(EPSILON)) {
      nullable = false;
      break;
    }
  }
  if (nullable && !out.includes(EPSILON)) out.push(EPSILON);
  return out.sort(symCmp);
}

// ── The traced algorithm ─────────────────────────────────────────────────────

export function* firstFollowSteps(g: Grammar): Steps<FirstFollowEvent, FirstFollowResult> {
  const first: SymbolSets = {};
  const follow: SymbolSets = {};
  for (const nt of g.nonterminals) {
    first[nt] = [];
    follow[nt] = [];
  }

  const firstAdd = (
    target: string,
    symbol: string,
    production: number,
    justification: string,
    pass: number,
  ): [FirstFollowEvent, StepMeta] | null => {
    const next = addedToSet(first[target]!, symbol);
    if (!next) return null;
    first[target] = next;
    return [
      { kind: 'ff.first.add', target, symbol, production, justification },
      {
        cite: { section: '4.4.2', rule: justification },
        prose: `Add ${symbol} to FIRST(${target}): ${justification}.`,
        level: 'micro',
        groupId: `first-pass-${pass}`,
        section: 'FIRST',
        irRefs: [{ kind: 'production', id: production }],
      },
    ];
  };

  const followAdd = (
    target: string,
    symbol: string,
    production: number | null,
    justification: string,
    pass: number,
  ): [FirstFollowEvent, StepMeta] | null => {
    const next = addedToSet(follow[target]!, symbol);
    if (!next) return null;
    follow[target] = next;
    return [
      { kind: 'ff.follow.add', target, symbol, production, justification },
      {
        cite: { section: '4.4.2', rule: justification },
        prose: `Add ${symbol} to FOLLOW(${target}): ${justification}.`,
        level: production === null ? 'macro' : 'micro',
        ...(production === null ? {} : { groupId: `follow-pass-${pass}` }),
        section: 'FOLLOW',
        ...(production === null ? {} : { irRefs: [{ kind: 'production' as const, id: production }] }),
      },
    ];
  };

  // ── FIRST: fixpoint passes over the productions in declaration order ──
  let pass = 0;
  let changed = true;
  while (changed) {
    changed = false;
    pass++;
    yield [
      { kind: 'ff.pass', phase: 'first', pass },
      {
        cite: { section: '4.4.2' },
        prose: `FIRST pass ${pass}: apply the FIRST rules to every production, in declaration order, until no set changes.`,
        level: 'macro',
        section: 'FIRST',
      },
    ];
    for (const p of g.productions) {
      const A = p.lhs;
      if (p.rhs.length === 0) {
        const step = firstAdd(
          A,
          EPSILON,
          p.id,
          `FIRST rule 3: ${A} → ε is a production, so ε ∈ FIRST(${A})`,
          pass,
        );
        if (step) {
          changed = true;
          yield step;
        }
        continue;
      }
      let allNullable = true;
      for (let i = 0; i < p.rhs.length; i++) {
        const y = p.rhs[i]!;
        const prefixNote = i > 0 ? `Y1…Y${i} ⇒* ε and ` : '';
        if (!isNonterminal(g, y)) {
          const step = firstAdd(
            A,
            y,
            p.id,
            `FIRST rules 1–2: in ${formatProduction(p)}, ${prefixNote}Y${i + 1} = ${y} is a terminal, so ${y} ∈ FIRST(${A})`,
            pass,
          );
          if (step) {
            changed = true;
            yield step;
          }
          allNullable = false;
          break;
        }
        for (const a of [...first[y]!]) {
          if (a === EPSILON) continue;
          const step = firstAdd(
            A,
            a,
            p.id,
            `FIRST rule 2: in ${formatProduction(p)}, ${prefixNote}FIRST(${y}) − {ε} ⊆ FIRST(${A}); ${a} ∈ FIRST(${y})`,
            pass,
          );
          if (step) {
            changed = true;
            yield step;
          }
        }
        if (!first[y]!.includes(EPSILON)) {
          allNullable = false;
          break;
        }
      }
      if (allNullable) {
        const step = firstAdd(
          A,
          EPSILON,
          p.id,
          `FIRST rule 2: in ${formatProduction(p)}, every Yi ⇒* ε, so ε ∈ FIRST(${A})`,
          pass,
        );
        if (step) {
          changed = true;
          yield step;
        }
      }
    }
  }
  yield [
    { kind: 'ff.fixpoint', phase: 'first', passes: pass },
    {
      cite: { section: '4.4.2' },
      prose: `FIRST computation converged: pass ${pass} added nothing, so no more terminals or ε can be added to any FIRST set.`,
      level: 'macro',
      section: 'FIRST',
    },
  ];

  // ── FOLLOW rule 1: $ ∈ FOLLOW(start) ──
  {
    const step = followAdd(
      g.start,
      EOF,
      null,
      `FOLLOW rule 1: place $ in FOLLOW(${g.start}), the start symbol ($ is the input endmarker)`,
      0,
    );
    if (step) yield step;
  }

  // ── FOLLOW: fixpoint passes applying rules 2 and 3 ──
  pass = 0;
  changed = true;
  while (changed) {
    changed = false;
    pass++;
    yield [
      { kind: 'ff.pass', phase: 'follow', pass },
      {
        cite: { section: '4.4.2' },
        prose: `FOLLOW pass ${pass}: apply FOLLOW rules 2 and 3 to every production, in declaration order, until no set changes.`,
        level: 'macro',
        section: 'FOLLOW',
      },
    ];
    for (const p of g.productions) {
      for (let i = 0; i < p.rhs.length; i++) {
        const B = p.rhs[i]!;
        if (!isNonterminal(g, B)) continue;
        const beta = p.rhs.slice(i + 1);
        const firstBeta = firstOfString(g, first, beta);
        for (const a of firstBeta) {
          if (a === EPSILON) continue;
          const step = followAdd(
            B,
            a,
            p.id,
            `FOLLOW rule 2: ${formatProduction(p)} has the form A → α B β with B = ${B} and β = ${formatSymbols(beta)}; FIRST(β) − {ε} ⊆ FOLLOW(${B}), and ${a} ∈ FIRST(β)`,
            pass,
          );
          if (step) {
            changed = true;
            yield step;
          }
        }
        if (firstBeta.includes(EPSILON)) {
          for (const a of [...follow[p.lhs]!]) {
            const step = followAdd(
              B,
              a,
              p.id,
              `FOLLOW rule 3: in ${formatProduction(p)}, ${
                beta.length === 0 ? `${B} is rightmost` : `β = ${formatSymbols(beta)} ⇒* ε`
              }, so FOLLOW(${p.lhs}) ⊆ FOLLOW(${B}); ${a} ∈ FOLLOW(${p.lhs})`,
              pass,
            );
            if (step) {
              changed = true;
              yield step;
            }
          }
        }
      }
    }
  }
  yield [
    { kind: 'ff.fixpoint', phase: 'follow', passes: pass },
    {
      cite: { section: '4.4.2' },
      prose: `FOLLOW computation converged: pass ${pass} added nothing, so all FOLLOW sets are complete.`,
      level: 'macro',
      section: 'FOLLOW',
    },
  ];

  return { first, follow };
}

// ── Conveniences ─────────────────────────────────────────────────────────────

/** Untraced FIRST/FOLLOW (drains the generator; identical result). */
export function firstFollow(g: Grammar): FirstFollowResult {
  return drain(firstFollowSteps(g));
}

export function runFirstFollow(
  g: Grammar,
  id = 'syntax.first-follow',
): Recorded<FirstFollowState, FirstFollowEvent, FirstFollowResult> {
  return record(() => firstFollowSteps(g), initialFirstFollowState(g), firstFollowReducer, { id });
}

/**
 * The five grammars the syntax page can run on, plus the small pure helpers the
 * views need about them (numbering, augmentation, left-recursion detection).
 *
 * Grammars are cheap to build on the UI thread (they are plain rule lists — the
 * expensive constructions all live in the worker), so the page owns them and the
 * production rail can render before any trace arrives.
 */
import { augment, formatProduction, type Grammar, type Production } from '@lab/core/grammar/grammar.js';
import { STUDY_GRAMMARS } from '@lab/core/csubset/grammar-def.js';
import { llReadyCGrammar } from '@lab/core/grammar/transforms.js';
import { GRAMMAR_IDS, type GrammarId } from '../../../worker/trace-kinds';

export type { GrammarId };
export { formatProduction };

export interface GrammarMeta {
  id: GrammarId;
  /** Selector label. */
  label: string;
  /** One line: what this grammar is for. */
  blurb: string;
  /** Terminals are whitespace-separated names (study grammars) or C source. */
  input: 'c' | 'terminals';
  /** Default sentence for the parse algorithms (study grammars only). */
  sample: string;
}

export const GRAMMARS: readonly GrammarMeta[] = [
  {
    id: 'c-subset',
    label: 'C subset (pipeline)',
    blurb:
      'The grammar this lab’s compiler really parses. Left-recursive and LALR(1) apart from the intentional dangling-else conflict (§4.8.2).',
    input: 'c',
    sample: '',
  },
  {
    id: 'c-subset-ll',
    label: 'C subset — LL-ready',
    blurb:
      'The same language after Algorithm 4.19 (left-recursion elimination) then Algorithm 4.21 (left factoring) — the grammar the top-down parsers can use.',
    input: 'c',
    sample: '',
  },
  {
    id: 'dragon-4.1',
    label: 'Grammar 4.1 — expressions',
    blurb:
      'E → E + T | T, T → T * F | F, F → ( E ) | id. The book’s running example for LR(0)/SLR (Fig 4.31, Fig 4.37, Fig 4.38).',
    input: 'terminals',
    sample: 'id * id + id',
  },
  {
    id: 'dragon-4.28',
    label: 'Grammar 4.28 — LL(1) expressions',
    blurb:
      'Grammar 4.1 with the left recursion removed. The running example for FIRST/FOLLOW (Example 4.30) and the predictive table (Fig 4.17).',
    input: 'terminals',
    sample: 'id + id * id',
  },
  {
    id: 'dragon-4.55',
    label: 'Grammar 4.55 — LR(1) / LALR',
    blurb:
      'S → C C, C → c C | d. Small enough that the canonical LR(1) collection (Fig 4.41) and its LALR merge (Fig 4.43) fit on one screen.',
    input: 'terminals',
    sample: 'c c d d',
  },
];

export const DEFAULT_GRAMMAR: GrammarId = 'dragon-4.1';

export function isGrammarId(v: string | null | undefined): v is GrammarId {
  return typeof v === 'string' && (GRAMMAR_IDS as readonly string[]).includes(v);
}

export function grammarMeta(id: GrammarId): GrammarMeta {
  return GRAMMARS.find((g) => g.id === id) ?? GRAMMARS[0]!;
}

// ── Grammar construction (memoized: llReadyCGrammar re-runs two transforms) ──

const grammarCache = new Map<GrammarId, Grammar>();
const augmentedCache = new Map<GrammarId, Grammar>();

export function grammarFor(id: GrammarId): Grammar {
  const hit = grammarCache.get(id);
  if (hit) return hit;
  const g = id === 'c-subset-ll' ? llReadyCGrammar().grammar : STUDY_GRAMMARS[id]!();
  grammarCache.set(id, g);
  return g;
}

/** The grammar the LR family actually works on: G augmented with S' → S. */
export function augmentedFor(id: GrammarId): Grammar {
  const hit = augmentedCache.get(id);
  if (hit) return hit;
  const g = augment(grammarFor(id));
  augmentedCache.set(id, g);
  return g;
}

/** Terminals in declaration order with the endmarker appended (table columns). */
export function terminalColumns(g: Grammar): string[] {
  return [...g.terminals, '$'];
}

// ── Left recursion (why a top-down parse cannot be attempted) ────────────────

function nullableSet(g: Grammar): ReadonlySet<string> {
  const nts = new Set(g.nonterminals);
  const nullable = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of g.productions) {
      if (nullable.has(p.lhs)) continue;
      if (p.rhs.every((s) => nts.has(s) && nullable.has(s))) {
        nullable.add(p.lhs);
        changed = true;
      }
    }
  }
  return nullable;
}

/**
 * Nonterminals A with A ⇒+ A α (§4.3.3). A grammar with any of these cannot be
 * parsed top-down: the recursive-descent procedure and the predictive parser
 * both loop forever, which is why Algorithm 4.19 exists.
 */
export function leftRecursiveNonterminals(g: Grammar): string[] {
  const nts = new Set(g.nonterminals);
  const nullable = nullableSet(g);
  /** A → (first symbols A can start a derivation with). */
  const edges = new Map<string, Set<string>>();
  for (const nt of g.nonterminals) edges.set(nt, new Set());
  for (const p of g.productions) {
    const to = edges.get(p.lhs);
    if (!to) continue;
    for (const sym of p.rhs) {
      if (!nts.has(sym)) break;
      to.add(sym);
      if (!nullable.has(sym)) break;
    }
  }
  const out: string[] = [];
  for (const start of g.nonterminals) {
    const seen = new Set<string>();
    const stack = [...(edges.get(start) ?? [])];
    let found = false;
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (cur === start) {
        found = true;
        break;
      }
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const nxt of edges.get(cur) ?? []) stack.push(nxt);
    }
    if (found) out.push(start);
  }
  return out;
}

// ── Formatting ───────────────────────────────────────────────────────────────

/** "p12  E → E + T" pieces for the production rail and table popovers. */
export function prodLabel(p: Production): string {
  return `p${p.id}  ${formatProduction(p)}`;
}

export function productionById(g: Grammar, id: number): Production | undefined {
  return g.productions[id];
}

/** Symbols joined for display, with ε for the empty string. */
export function symbols(rhs: readonly string[]): string {
  return rhs.length === 0 ? 'ε' : rhs.join(' ');
}

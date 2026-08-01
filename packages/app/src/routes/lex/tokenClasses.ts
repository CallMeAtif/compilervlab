/**
 * The token classes the constructions tab builds, plus the two *untraced*
 * artifacts the views need locally.
 *
 * `buildTokenClasses()` is deterministic (it resets the regex id counter), so
 * the regex-node ids in a `lex.thompson` trace recorded in the worker are the
 * same ids as the AST we lay out here — that is what lets the tidy tree
 * highlight the node the current Thompson step is translating.
 *
 * Everything below is memoized per class index: the Thompson NFA is sub-
 * millisecond, the untraced subset construction is ~2 ms for the two constant
 * classes and ~180 ms for `id` (which is why the `id` graphs sit behind an
 * explicit cost gate).
 */
import type { Steps } from '@lab/trace';
import { buildTokenClasses, type RegexAst, type TokenClassDef } from '@lab/core/csubset/regex.js';
import { thompson } from '@lab/core/lex/thompson.js';
import { subsetConstruction } from '@lab/core/lex/subset-construction.js';
import { toMultiNfa, type Dfa, type MultiNfa, type Nfa } from '@lab/core/lex/types.js';
import type { TokenClassId } from './lexUrl';

/** Run a Steps<> generator to completion, discarding its events. */
function drain<E, R>(gen: Steps<E, R>): R {
  let it = gen.next();
  while (!it.done) it = gen.next();
  return it.value;
}

export interface LexTokenClass {
  /** `classIndex` trace parameter. */
  index: number;
  id: TokenClassId;
  def: TokenClassDef;
  /** Distinct input symbols the regex mentions (= the DFA's alphabet). */
  alphabet: string[];
  /** States of the Thompson NFA — the size the graph views have to draw. */
  nfaStates: number;
  /**
   * True when the automata are too large to draw (or to record) comfortably.
   * Only `id` is heavy: `letter` expands to 53 character alternatives.
   */
  heavy: boolean;
}

/** Threshold above which a graph is put behind an explicit "render anyway". */
const HEAVY_NFA_STATES = 200;

function alphabetOf(regex: RegexAst): string[] {
  const out = new Set<string>();
  const walk = (n: RegexAst): void => {
    switch (n.kind) {
      case 'char':
        out.add(n.ch);
        return;
      case 'epsilon':
        return;
      case 'star':
        walk(n.inner);
        return;
      default:
        walk(n.left);
        walk(n.right);
    }
  };
  walk(regex);
  return [...out].sort();
}

const defs = buildTokenClasses();

export const LEX_TOKEN_CLASSES: readonly LexTokenClass[] = defs.map((def, index) => {
  const nfa = drain(thompson(def.regex));
  return {
    index,
    id: def.name as TokenClassId,
    def,
    alphabet: alphabetOf(def.regex),
    nfaStates: nfa.states.length,
    heavy: nfa.states.length > HEAVY_NFA_STATES,
  };
});

export function tokenClassById(id: TokenClassId): LexTokenClass {
  return LEX_TOKEN_CLASSES.find((c) => c.id === id) ?? LEX_TOKEN_CLASSES[0]!;
}

const nfaCache = new Map<number, Nfa>();
const multiCache = new Map<number, MultiNfa>();
const dfaCache = new Map<number, Dfa>();

/** The Thompson NFA of a class (memoized; sub-millisecond). */
export function nfaFor(cls: LexTokenClass): Nfa {
  const hit = nfaCache.get(cls.index);
  if (hit) return hit;
  const nfa = drain(thompson(cls.def.regex));
  nfaCache.set(cls.index, nfa);
  return nfa;
}

function multiNfaFor(cls: LexTokenClass): MultiNfa {
  const hit = multiCache.get(cls.index);
  if (hit) return hit;
  const m = toMultiNfa(nfaFor(cls), cls.def.name, cls.def.priority);
  multiCache.set(cls.index, m);
  return m;
}

/**
 * The DFA the minimization view refines, built by the *same* subset
 * construction the worker traces but with events switched off. Synchronous and
 * memoized; callers defer the first call past a paint so the skeleton shows.
 */
export function dfaFor(cls: LexTokenClass): Dfa {
  const hit = dfaCache.get(cls.index);
  if (hit) return hit;
  const dfa = drain(subsetConstruction(multiNfaFor(cls), false));
  dfaCache.set(cls.index, dfa);
  return dfa;
}

/**
 * Semantic-analysis trace vocabulary: the event union, the UI reducer state,
 * the pure reducer, and the projection from the SemanticInfo artifact onto the
 * reduced-state shape (for the replay invariant).
 *
 * One traced pass builds the scope tree / symbol tables (Dragon Book §2.7,
 * chained symbol tables of Fig. 2.36) interleaved with synthesized-attribute
 * type checking (§6.3, §6.5) — interleaving is what makes "declaration before
 * use" fall out naturally.
 */
import type {
  Citation,
  IrRef,
  Reducer,
  SourceSpan,
  StepLevel,
  StepMeta,
} from '@lab/trace';
import type { Diagnostic } from '../common/types.js';
import type { CType, Scope, SemanticInfo, SymbolEntry } from './types.js';

// ── Events ───────────────────────────────────────────────────────────────────

export type SemEvent =
  /** A new scope is opened and chained to its parent (macro). */
  | {
      kind: 'scopeEnter';
      scopeId: number;
      parentId: number | null;
      scopeKind: 'global' | 'function' | 'block';
      label?: string;
      span: SourceSpan;
    }
  /** The innermost scope is closed; lookups resume in its parent (macro). */
  | { kind: 'scopeExit'; scopeId: number }
  /** A symbol was entered into the innermost scope's table (macro). */
  | { kind: 'declare'; symbol: SymbolEntry }
  /** One scope consulted during a chain walk, innermost outward (micro). */
  | { kind: 'lookupStep'; name: string; scopeId: number; found: boolean }
  /** End of a chain walk: hit (symbolId) or miss (null) (micro). */
  | { kind: 'resolve'; nodeId: number; name: string; symbolId: number | null }
  /** A node received its synthesized type via the cited rule (macro). */
  | { kind: 'typed'; nodeId: number; type: CType; ruleApplied: string }
  /** An explicit inttofloat conversion node was inserted (§6.5.2 widening). */
  | { kind: 'convert'; nodeId: number; from: CType; to: CType; op: 'inttofloat' }
  /** An array value decayed to a pointer (trace-only; no IR conversion). */
  | { kind: 'decay'; nodeId: number; from: CType; to: CType }
  /** A rule violation (error) or advisory (warning) was reported (macro). */
  | { kind: 'diagnostic'; diagnostic: Diagnostic };

// ── The exact C-subset rule texts (docs/c-subset.md) cited by diagnostics ────

export const RULE = {
  arithOperands:
    "Rule 1: arithmetic '+ - * / %' require arithmetic operands (int, float, char); char promotes to int",
  widening:
    "Rule 1: if either operand is float, the other is converted via an explicit inttofloat conversion (§6.5.2 widening); result float",
  modInt: "Rule 1: '%' requires integer operands",
  relational:
    "Rule 2: relational/equality take arithmetic operands (same promotion rules), or two pointers of identical type ('=='/'!=' only); result int (0/1)",
  logical:
    "Rule 3: logical '&& || !' take scalar operands (arithmetic or pointer); result int (0/1); short-circuit evaluation",
  assignLValue: "Rule 4: assignment target must be an l-value (identifier, *e, a[i])",
  assignTypes:
    "Rule 4: assignment types must match after promotions; int↔float converts (float→int is an error — no narrowing); pointer assignment requires identical pointer types",
  arrayNotAssignable: 'Rule 4: arrays are not assignable',
  addrOf: "Rule 5: '&e' requires an l-value e and yields T*",
  deref: "Rule 5: '*e' requires a pointer T* and yields an l-value T",
  noPtrArith: 'Rule 5: no pointer arithmetic in the subset',
  indexing: "Rule 6: 'a[i]' requires a : T[n] or T*, i : int/char; yields an l-value T",
  arrayDecay: "Rule 6: in expressions (except '&a' and declarations), T[n] decays to T*",
  callDeclared: 'Rule 7: the callee must be a declared function',
  callArity: 'Rule 7: call arity must match the function declaration',
  callArg:
    'Rule 7: each argument must be assignable to its parameter type (same rules as assignment)',
  voidValue: 'Rule 7: void functions cannot be used as values',
  call: "Rule 7: a call to a declared function yields the function's declared return type",
  returnAssignable:
    "Rule 8: the return expression must be assignable to the function's return type",
  returnVoid: "Rule 8: 'return;' only in void functions; a non-void function must return a value",
  missingReturn:
    'Rule 8: non-void functions must return a value on the checked paths (missing return is a warning)',
  condScalar: 'Rule 9: an if/while/for condition may be any scalar; it is compared ≠ 0',
  declBeforeUse: 'Scoping: declaration before use, everywhere',
  redeclaration:
    'Scoping: redeclaration in the same scope is an error; shadowing in inner scopes is legal',
  voidVar: 'Types: void is a function-return type only',
  constant:
    'A constant carries the type of its lexical class (intconst : int, floatconst : float, charconst : char)',
  identifier:
    'An identifier has the type of its innermost visible declaration (scope-chain lookup, §2.7)',
  funcAsValue: "Not in the lab's C subset: a function name may only appear as a callee",
  globalConstInit:
    'Storage: a global is allocated statically, so its initializer must be a constant expression evaluated at compile time',
  declResolve:
    "Declaration: the declarator wraps the base type — pointerDepth '*' levels, then an optional '[n]' array",
} as const;

// ── StepMeta helper (keeps events/meta free of `undefined` values) ───────────

export interface StepOpts {
  section?: string;
  groupId?: string;
  srcSpans?: SourceSpan[];
  irRefs?: IrRef[];
}

export function step(
  cite: Citation,
  prose: string,
  level: StepLevel,
  opts: StepOpts = {},
): StepMeta {
  const m: StepMeta = { cite, prose, level };
  if (opts.section !== undefined) m.section = opts.section;
  if (opts.groupId !== undefined) m.groupId = opts.groupId;
  if (opts.srcSpans !== undefined) m.srcSpans = opts.srcSpans;
  if (opts.irRefs !== undefined) m.irRefs = opts.irRefs;
  return m;
}

// ── Reduced UI state ─────────────────────────────────────────────────────────

export interface SemState {
  scopes: Scope[];
  symbols: SymbolEntry[];
  /** Ids of the scopes currently open, innermost last (empty when done). */
  scopeStack: number[];
  nodeTypes: Record<number, CType>;
  resolved: Record<number, number>;
  conversions: Record<number, { from: CType; to: CType }>;
  diagnostics: Diagnostic[];
}

export function initialSemState(): SemState {
  return {
    scopes: [],
    symbols: [],
    scopeStack: [],
    nodeTypes: {},
    resolved: {},
    conversions: {},
    diagnostics: [],
  };
}

export const semReducer: Reducer<SemState, SemEvent> = (s, e) => {
  switch (e.kind) {
    case 'scopeEnter': {
      const scope: Scope = {
        id: e.scopeId,
        parentId: e.parentId,
        kind: e.scopeKind,
        ...(e.label !== undefined ? { label: e.label } : {}),
        symbolIds: [],
        span: e.span,
      };
      return { ...s, scopes: [...s.scopes, scope], scopeStack: [...s.scopeStack, e.scopeId] };
    }
    case 'scopeExit':
      return { ...s, scopeStack: s.scopeStack.slice(0, -1) };
    case 'declare':
      return {
        ...s,
        symbols: [...s.symbols, e.symbol],
        scopes: s.scopes.map((sc) =>
          sc.id === e.symbol.scopeId ? { ...sc, symbolIds: [...sc.symbolIds, e.symbol.id] } : sc,
        ),
      };
    case 'lookupStep':
      return s; // pure narration of the chain walk — no state change
    case 'resolve':
      return e.symbolId === null
        ? s
        : { ...s, resolved: { ...s.resolved, [e.nodeId]: e.symbolId } };
    case 'typed':
      return { ...s, nodeTypes: { ...s.nodeTypes, [e.nodeId]: e.type } };
    case 'convert':
      return { ...s, conversions: { ...s.conversions, [e.nodeId]: { from: e.from, to: e.to } } };
    case 'decay':
      return s; // educational only: decay inserts no runtime conversion
    case 'diagnostic':
      return { ...s, diagnostics: [...s.diagnostics, e.diagnostic] };
  }
};

/** Maps the returned SemanticInfo artifact onto the reduced-state shape so the
 *  replay invariant (reduce(all events) ≡ artifact) can be checked. */
export function projectSemanticInfo(info: SemanticInfo): SemState {
  return {
    scopes: info.scopes,
    symbols: info.symbols,
    scopeStack: [], // every scopeEnter is matched by a scopeExit
    nodeTypes: info.nodeTypes,
    resolved: info.resolved,
    conversions: info.conversions,
    diagnostics: info.diagnostics,
  };
}

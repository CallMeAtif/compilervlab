/**
 * Scope tree + symbol table construction, traced.
 *
 * The implementation is the chained-symbol-table scheme of Dragon Book §2.7
 * (Fig. 2.36): every scope owns its own table; a table holds one entry per
 * name; lookup walks the chain from the innermost scope outward, so an inner
 * declaration shadows an outer one and "declaration before use" is enforced
 * by consulting only tables that already contain the earlier declarations.
 *
 * All helpers are generator fragments yielded from the single semantic pass in
 * typecheck.ts; every mutation of the shared SemCtx has a corresponding event.
 */
import type { StepMeta } from '@lab/trace';
import type { Citation, SourceSpan } from '@lab/trace';
import type { Diagnostic } from '../common/types.js';
import type { BaseTypeName, DeclaratorInfo } from '../ast/types.js';
import type { CType, Scope, SymbolEntry } from './types.js';
import { typeToString } from './types.js';
import { RULE, step } from './sem-events.js';
import type { SemEvent } from './sem-events.js';

/** Generator fragment: yields [event, meta] pairs, returns T. */
export type SemSteps<T> = Generator<[SemEvent, StepMeta], T, void>;

/** Mutable analysis context shared by the pass; mirrors the reduced state.
 *  Every mutation is paired with a yielded event (checked by the replay
 *  invariant). */
export interface SemCtx {
  scopes: Scope[];
  symbols: SymbolEntry[];
  /** Ids of the open scopes, innermost last. */
  scopeStack: number[];
  diagnostics: Diagnostic[];
  /** Current scrubber section name ("Global scope", "Function gcd", …). */
  section: string;
}

export function createSemCtx(): SemCtx {
  return { scopes: [], symbols: [], scopeStack: [], diagnostics: [], section: 'Global scope' };
}

export function currentScope(ctx: SemCtx): Scope {
  const id = ctx.scopeStack[ctx.scopeStack.length - 1];
  if (id === undefined) throw new Error('semantic pass: no open scope');
  return ctx.scopes[id]!;
}

function scopeDescription(sc: Scope): string {
  switch (sc.kind) {
    case 'global':
      return 'the global scope';
    case 'function':
      return `function '${sc.label ?? '?'}' scope #${sc.id}`;
    case 'block':
      return `block scope #${sc.id}`;
  }
}

/** Deterministic in-scope search: entries are scanned in declaration order. */
function findInScope(ctx: SemCtx, scope: Scope, name: string): SymbolEntry | null {
  for (const id of scope.symbolIds) {
    const sym = ctx.symbols[id]!;
    if (sym.name === name) return sym;
  }
  return null;
}

/** Resolve a flattened declarator against its base type: pointerDepth '*'
 *  levels wrap the base, then an optional array wraps the result — so
 *  `int *a[10]` is array(10) of pointer to int. (Dragon Book §6.3.) */
export function resolveDeclaratorType(base: BaseTypeName, d: DeclaratorInfo): CType {
  let t: CType = { kind: 'base', name: base };
  for (let i = 0; i < d.pointerDepth; i++) t = { kind: 'pointer', to: t };
  if (d.array !== null) t = { kind: 'array', of: t, length: d.array.length };
  return t;
}

/** True if the type mentions `void` anywhere (illegal outside function returns). */
export function containsVoid(t: CType): boolean {
  switch (t.kind) {
    case 'base':
      return t.name === 'void';
    case 'pointer':
      return containsVoid(t.to);
    case 'array':
      return containsVoid(t.of);
    case 'function':
      return false;
  }
}

/** Open a new scope chained under the current one. */
export function* enterScope(
  ctx: SemCtx,
  kind: Scope['kind'],
  span: SourceSpan,
  label?: string,
): SemSteps<Scope> {
  const id = ctx.scopes.length;
  const parentId = ctx.scopeStack.length > 0 ? ctx.scopeStack[ctx.scopeStack.length - 1]! : null;
  const scope: Scope = {
    id,
    parentId,
    kind,
    ...(label !== undefined ? { label } : {}),
    symbolIds: [],
    span,
  };
  ctx.scopes.push(scope);
  ctx.scopeStack.push(id);
  yield [
    {
      kind: 'scopeEnter',
      scopeId: id,
      parentId,
      scopeKind: kind,
      ...(label !== undefined ? { label } : {}),
      span,
    },
    step(
      { section: '2.7', figureOrAlgo: 'Fig. 2.36' },
      `Enter ${scopeDescription(scope)}${parentId === null ? '' : ` (chained to scope #${parentId})`}: a fresh symbol table for its declarations.`,
      'macro',
      { section: ctx.section, srcSpans: [span] },
    ),
  ];
  return scope;
}

/** Close the innermost scope; lookups resume in its parent. */
export function* exitScope(ctx: SemCtx): SemSteps<void> {
  const id = ctx.scopeStack[ctx.scopeStack.length - 1];
  if (id === undefined) throw new Error('semantic pass: exitScope with empty scope stack');
  const scope = ctx.scopes[id]!;
  ctx.scopeStack.pop();
  yield [
    { kind: 'scopeExit', scopeId: id },
    step(
      { section: '2.7', figureOrAlgo: 'Fig. 2.36' },
      `Exit ${scopeDescription(scope)}: its ${scope.symbolIds.length} symbol(s) go out of scope and lookup falls back to the parent table.`,
      'macro',
      { section: ctx.section, srcSpans: [scope.span] },
    ),
  ];
}

/** Report a diagnostic (error or warning) as an event. */
export function* emitDiagnostic(ctx: SemCtx, d: Diagnostic, cite: Citation): SemSteps<void> {
  ctx.diagnostics.push(d);
  yield [
    { kind: 'diagnostic', diagnostic: d },
    step(cite, `${d.severity === 'error' ? 'Error' : 'Warning'}: ${d.message}.`, 'macro', {
      section: ctx.section,
      srcSpans: [d.span],
    }),
  ];
}

/**
 * Declare `name` in the innermost scope. Redeclaration in the same scope is an
 * error (docs/c-subset.md scoping; §2.7 — one entry per name per table) and
 * returns null without declaring.
 */
export function* declareSymbol(
  ctx: SemCtx,
  name: string,
  type: CType,
  kind: SymbolEntry['kind'],
  declNodeId: number,
  declSpan: SourceSpan,
): SemSteps<SymbolEntry | null> {
  const scope = currentScope(ctx);
  const existing = findInScope(ctx, scope, name);
  if (existing !== null) {
    yield* emitDiagnostic(
      ctx,
      {
        phase: 'semantic',
        severity: 'error',
        message: `redeclaration of '${name}' in the same scope (already declared as ${typeToString(existing.type)})`,
        rule: RULE.redeclaration,
        hint: `rename one of the declarations, or move the new '${name}' into a nested block to shadow the outer one`,
        span: declSpan,
      },
      {
        section: '2.7',
        rule: 'each symbol table holds at most one entry per name; only a nested scope may shadow it',
      },
    );
    return null;
  }
  const sym: SymbolEntry = {
    id: ctx.symbols.length,
    name,
    type,
    kind,
    scopeId: scope.id,
    declSpan,
    declNodeId,
  };
  ctx.symbols.push(sym);
  scope.symbolIds.push(sym.id);
  yield [
    { kind: 'declare', symbol: sym },
    step(
      { section: '2.7', figureOrAlgo: 'Fig. 2.36' },
      `Declare ${kind} '${name}' : ${typeToString(type)} as symbol #${sym.id} in ${scopeDescription(scope)}.`,
      'macro',
      { section: ctx.section, srcSpans: [declSpan], irRefs: [{ kind: 'astNode', id: declNodeId }] },
    ),
  ];
  return sym;
}

/**
 * Traced lookup: walk the scope chain from the innermost scope outward,
 * emitting one micro step per table consulted, then a resolve hit/miss.
 * On a hit the use-site node is recorded in `resolved`.
 */
export function* lookup(
  ctx: SemCtx,
  resolved: Record<number, number>,
  name: string,
  nodeId: number,
  useSpan: SourceSpan,
): SemSteps<SymbolEntry | null> {
  const groupId = `lookup:${nodeId}`;
  for (let i = ctx.scopeStack.length - 1; i >= 0; i--) {
    const sc = ctx.scopes[ctx.scopeStack[i]!]!;
    const sym = findInScope(ctx, sc, name);
    yield [
      { kind: 'lookupStep', name, scopeId: sc.id, found: sym !== null },
      step(
        {
          section: '2.7',
          rule: 'lookup consults the chained tables from the innermost scope outward',
        },
        `Look up '${name}' in ${scopeDescription(sc)}: ${sym !== null ? `found symbol #${sym.id}` : 'not here — follow the chain outward'}.`,
        'micro',
        { groupId, section: ctx.section, srcSpans: [useSpan] },
      ),
    ];
    if (sym !== null) {
      resolved[nodeId] = sym.id;
      yield [
        { kind: 'resolve', nodeId, name, symbolId: sym.id },
        step(
          { section: '2.7', figureOrAlgo: 'Fig. 2.36' },
          `'${name}' resolves to ${sym.kind} symbol #${sym.id} : ${typeToString(sym.type)} — the innermost declaration wins (shadowing).`,
          'micro',
          {
            groupId,
            section: ctx.section,
            srcSpans: [useSpan],
            irRefs: [{ kind: 'astNode', id: nodeId }],
          },
        ),
      ];
      return sym;
    }
  }
  yield [
    { kind: 'resolve', nodeId, name, symbolId: null },
    step(
      { section: '2.7', figureOrAlgo: 'Fig. 2.36' },
      `'${name}' was not found in any enclosing scope — the chain is exhausted (miss).`,
      'micro',
      { groupId, section: ctx.section, srcSpans: [useSpan] },
    ),
  ];
  return null;
}

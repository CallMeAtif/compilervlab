/**
 * Pure projections over the sem.analyze trace + the AST artifact.
 *
 * Nothing here re-derives semantic-analysis state: every value is read from the
 * reduced `SemState` at the cursor, or from the recorded step list (the chain
 * walk of a lookup is *narration* — the reducer deliberately keeps no state for
 * it, so the route reconstructs the walk from the events of the current group).
 */
import type { StepRecord, Trace, SourceSpan } from '@lab/trace';
import type { SemEvent, SemState } from '@lab/core/sem/sem-events.js';
import type { CType, Scope, SymbolEntry } from '@lab/core/sem/types.js';
import type {
  Ast,
  AstNode,
  ProgramNode,
  FuncDefNode,
} from '@lab/core/ast/types.js';
import type { Diagnostic } from '@lab/core';

export type SemTrace = Trace<SemState, SemEvent>;
export type SemStep = StepRecord<SemEvent>;

// ── Types, rendered for humans ───────────────────────────────────────────────

/** Compact, C-like rendering: `int`, `int*`, `int[10]`, `int(int, int)`. */
export function typeLabel(t: CType): string {
  switch (t.kind) {
    case 'base':
      return t.name;
    case 'pointer':
      return `${typeLabel(t.to)}*`;
    case 'array':
      return `${typeLabel(t.of)}[${t.length ?? ''}]`;
    case 'function':
      return `${typeLabel(t.ret)}(${t.params.map(typeLabel).join(', ')})`;
  }
}

/** Spelled-out rendering used as the accessible name / tooltip of a type chip:
 *  `int*` → "pointer to int", `int[10]` → "array[10] of int". */
export function typeDescription(t: CType): string {
  switch (t.kind) {
    case 'base':
      return t.name;
    case 'pointer':
      return `pointer to ${typeDescription(t.to)}`;
    case 'array':
      return `array[${t.length ?? ''}] of ${typeDescription(t.of)}`;
    case 'function':
      return `function(${t.params.map(typeDescription).join(', ')}) returning ${typeDescription(
        t.ret,
      )}`;
  }
}

// ── Scopes ───────────────────────────────────────────────────────────────────

export interface ScopeNode {
  scope: Scope;
  children: ScopeNode[];
}

/** Nest the flat scope list by parentId, preserving declaration order. */
export function scopeForest(scopes: readonly Scope[]): ScopeNode[] {
  const byId = new Map<number, ScopeNode>();
  for (const scope of scopes) byId.set(scope.id, { scope, children: [] });
  const roots: ScopeNode[] = [];
  for (const scope of scopes) {
    const node = byId.get(scope.id)!;
    const parent = scope.parentId === null ? null : (byId.get(scope.parentId) ?? null);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export function scopeTitle(scope: Scope): string {
  switch (scope.kind) {
    case 'global':
      return 'global scope';
    case 'function':
      return `function ${scope.label ?? '?'}`;
    case 'block':
      return `block scope`;
  }
}

export function symbolById(state: SemState, id: number): SymbolEntry | undefined {
  return state.symbols.find((s) => s.id === id);
}

// ── The lookup currently being narrated ──────────────────────────────────────

export interface LookupVisit {
  /** 1-based consultation order, innermost scope first. */
  order: number;
  scopeId: number;
  found: boolean;
}

export interface ActiveLookup {
  name: string;
  /** AST node whose identifier is being resolved. */
  nodeId: number;
  visits: LookupVisit[];
  /** 'walking' while the chain is still being consulted. */
  outcome: 'walking' | 'hit' | 'miss';
  symbolId: number | null;
}

const LOOKUP_PREFIX = 'lookup:';

/**
 * Reconstruct the chain walk the cursor is inside, from the contiguous run of
 * steps sharing the current step's `lookup:<nodeId>` group. Returns null when
 * the cursor is not inside a lookup.
 */
export function activeLookup(trace: SemTrace, index: number): ActiveLookup | null {
  if (index <= 0) return null;
  const current = trace.steps[index - 1];
  const groupId = current?.meta.groupId;
  if (!current || groupId === undefined || !groupId.startsWith(LOOKUP_PREFIX)) return null;

  const nodeId = Number.parseInt(groupId.slice(LOOKUP_PREFIX.length), 10);
  const visits: LookupVisit[] = [];
  let outcome: ActiveLookup['outcome'] = 'walking';
  let symbolId: number | null = null;
  let name = '';

  for (let i = index - 1; i >= 0; i--) {
    const s = trace.steps[i];
    if (!s || s.meta.groupId !== groupId) break;
    if (s.event.kind === 'lookupStep') {
      visits.unshift({ order: 0, scopeId: s.event.scopeId, found: s.event.found });
      name = s.event.name;
    } else if (s.event.kind === 'resolve') {
      outcome = s.event.symbolId === null ? 'miss' : 'hit';
      symbolId = s.event.symbolId;
      name = s.event.name;
    }
  }
  visits.forEach((v, i) => {
    v.order = i + 1;
  });
  return { name, nodeId, visits, outcome, symbolId };
}

// ── AST helpers ──────────────────────────────────────────────────────────────

export function childrenOf(node: AstNode): AstNode[] {
  switch (node.kind) {
    case 'Program':
      return [...node.decls];
    case 'FuncDef':
      return [...node.params, node.body];
    case 'Param':
      return [];
    case 'VarDecl':
      return [...node.decls];
    case 'InitDecl':
      return node.init ? [node.init] : [];
    case 'CompoundStmt':
      return [...node.items];
    case 'ExprStmt':
      return node.expr ? [node.expr] : [];
    case 'IfStmt':
      return node.else_ ? [node.cond, node.then, node.else_] : [node.cond, node.then];
    case 'WhileStmt':
      return [node.cond, node.body];
    case 'ForStmt': {
      const parts = [node.init, node.cond, node.update, node.body];
      return parts.filter((n) => n !== null) as AstNode[];
    }
    case 'ReturnStmt':
      return node.expr ? [node.expr] : [];
    case 'Assign':
      return [node.target, node.value];
    case 'Binary':
      return [node.left, node.right];
    case 'Unary':
      return [node.operand];
    case 'Index':
      return [node.array, node.index];
    case 'Call':
      return [...node.args];
    case 'Ident':
    case 'Const':
      return [];
  }
}

const UNARY_LABEL: Record<string, string> = {
  '-': 'neg',
  '!': 'not',
  '*': 'deref',
  '&': 'addr',
};

/** Short syntax-shaped label for a node (the type is appended separately). */
export function nodeLabel(node: AstNode): string {
  switch (node.kind) {
    case 'Program':
      return 'Program';
    case 'FuncDef':
      return `fn ${node.name}`;
    case 'Param':
      return `par ${node.declarator.name}`;
    case 'VarDecl':
      return `decl ${node.baseType}`;
    case 'InitDecl':
      return node.init ? `${node.declarator.name} =` : node.declarator.name;
    case 'CompoundStmt':
      return '{ }';
    case 'ExprStmt':
      return node.expr ? 'expr ;' : ';';
    case 'IfStmt':
      return 'if';
    case 'WhileStmt':
      return 'while';
    case 'ForStmt':
      return 'for';
    case 'ReturnStmt':
      return 'return';
    case 'Assign':
      return '=';
    case 'Binary':
      return node.op;
    case 'Unary':
      return UNARY_LABEL[node.op] ?? node.op;
    case 'Index':
      return '[ ]';
    case 'Call':
      return `call ${node.callee}`;
    case 'Ident':
      return node.name;
    case 'Const':
      return node.lexeme;
  }
}

export function truncate(s: string, max = 16): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/** The AST roots the tree pane can show: the whole program, or one function. */
export interface AstSubtreeChoice {
  id: string;
  label: string;
  node: AstNode;
}

export function subtreeChoices(root: ProgramNode): AstSubtreeChoice[] {
  const fns = root.decls.filter((d): d is FuncDefNode => d.kind === 'FuncDef');
  return [
    { id: 'program', label: 'Whole program', node: root },
    ...fns.map((f) => ({ id: `fn-${f.id}`, label: `${f.name}()`, node: f as AstNode })),
  ];
}

/** Deepest AST node whose span matches exactly — used to place diagnostics and
 *  to find the node a step is talking about when the event carries no id. */
export function nodesBySpan(ast: Ast): Map<string, number> {
  const map = new Map<string, number>();
  for (const n of ast.nodes) map.set(spanKey(n.span), n.id); // preorder ⇒ deepest wins
  return map;
}

export function spanKey(span: SourceSpan): string {
  return `${span.start}:${span.end}`;
}

/** AST node the current step is about, when the event names one. */
export function stepNodeId(step: SemStep | null): number | null {
  if (!step) return null;
  const e = step.event;
  switch (e.kind) {
    case 'typed':
    case 'convert':
    case 'decay':
    case 'resolve':
      return e.nodeId;
    case 'declare':
      return e.symbol.declNodeId;
    default:
      return null;
  }
}

/** Symbol the current step declares or resolves to, if any. */
export function stepSymbolId(step: SemStep | null): number | null {
  if (!step) return null;
  if (step.event.kind === 'declare') return step.event.symbol.id;
  if (step.event.kind === 'resolve') return step.event.symbolId;
  return null;
}

export function stepSpans(step: SemStep | null): SourceSpan[] {
  return step?.meta.srcSpans ? [...step.meta.srcSpans] : [];
}

// ── Diagnostics ──────────────────────────────────────────────────────────────

export function diagnosticNodeIds(
  diagnostics: readonly Diagnostic[],
  spanIndex: Map<string, number> | null,
): Set<number> {
  const out = new Set<number>();
  if (!spanIndex) return out;
  for (const d of diagnostics) {
    const id = spanIndex.get(spanKey(d.span));
    if (id !== undefined) out.add(id);
  }
  return out;
}

/** Index of the step that reported this diagnostic (for click-to-focus). */
export function diagnosticStepIndex(trace: SemTrace, d: Diagnostic): number {
  return trace.findIndex(
    (s) =>
      s.event.kind === 'diagnostic' &&
      s.event.diagnostic.message === d.message &&
      s.event.diagnostic.span.start === d.span.start,
    0,
  );
}

// ── "Jump to" predicates (used with the stepper's search) ────────────────────

export const JUMP_PREDICATES = {
  scope: (s: SemStep) => s.event.kind === 'scopeEnter',
  declare: (s: SemStep) => s.event.kind === 'declare',
  lookup: (s: SemStep) => s.event.kind === 'lookupStep',
  miss: (s: SemStep) => s.event.kind === 'resolve' && s.event.symbolId === null,
  convert: (s: SemStep) => s.event.kind === 'convert',
  error: (s: SemStep) =>
    s.event.kind === 'diagnostic' && s.event.diagnostic.severity === 'error',
} as const satisfies Record<string, (s: SemStep) => boolean>;

export type JumpTarget = keyof typeof JUMP_PREDICATES;

/** How many steps of a kind the whole trace holds (badge counts on the chips). */
export function countMatching(trace: SemTrace, pred: (s: SemStep) => boolean): number {
  let n = 0;
  for (const s of trace.steps) if (pred(s)) n++;
  return n;
}

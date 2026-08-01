/**
 * Semantic-analysis artifacts: types, scoped symbol tables, and the
 * SemanticInfo contract consumed by IR generation.
 */
import type { SourceSpan, Diagnostic } from '../common/types.js';
import type { BaseTypeName } from '../ast/types.js';

export type CType =
  | { kind: 'base'; name: BaseTypeName }
  | { kind: 'pointer'; to: CType }
  | { kind: 'array'; of: CType; length: number | null }
  | { kind: 'function'; ret: CType; params: CType[] };

export function baseType(name: BaseTypeName): CType {
  return { kind: 'base', name };
}

export function typeToString(t: CType): string {
  switch (t.kind) {
    case 'base':
      return t.name;
    case 'pointer':
      return `${typeToString(t.to)}*`;
    case 'array':
      return `${typeToString(t.of)}[${t.length ?? ''}]`;
    case 'function':
      return `${typeToString(t.ret)}(${t.params.map(typeToString).join(', ')})`;
  }
}

export interface SymbolEntry {
  id: number; // global symbol id — referenced by TAC operands
  name: string;
  type: CType;
  kind: 'var' | 'param' | 'func';
  scopeId: number;
  declSpan: SourceSpan;
  declNodeId: number; // AST node that declared it
}

export interface Scope {
  id: number;
  parentId: number | null;
  kind: 'global' | 'function' | 'block';
  /** For function scopes: the function's name. */
  label?: string;
  symbolIds: number[];
  span: SourceSpan;
}

export interface SemanticInfo {
  scopes: Scope[]; // scopes[0] is the global scope
  symbols: SymbolEntry[];
  /** astNodeId → resolved type (expressions and declarators). */
  nodeTypes: Record<number, CType>;
  /** astNodeId (Ident/Call) → symbolId it resolved to. */
  resolved: Record<number, number>;
  /** Implicit conversions inserted (e.g. int→float), keyed by expr node id. */
  conversions: Record<number, { from: CType; to: CType }>;
  diagnostics: Diagnostic[];
}

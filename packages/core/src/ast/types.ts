/**
 * AST of the C subset. Every node has a unique id (deterministic, preorder of
 * creation during parsing) and a source span — provenance for cross-phase
 * highlighting. The AST is built by reduction-time actions of the pipeline's
 * LALR(1) parse.
 */
import type { SourceSpan } from '../common/types.js';

export type BaseTypeName = 'int' | 'float' | 'char' | 'void';

interface Node {
  id: number;
  span: SourceSpan;
}

// ── Declarations ─────────────────────────────────────────────────────────────

export interface ProgramNode extends Node {
  kind: 'Program';
  decls: Array<FuncDefNode | VarDeclNode>;
}

export interface FuncDefNode extends Node {
  kind: 'FuncDef';
  returnType: BaseTypeName;
  name: string;
  nameSpan: SourceSpan;
  params: ParamNode[];
  body: CompoundStmtNode;
}

export interface ParamNode extends Node {
  kind: 'Param';
  baseType: BaseTypeName;
  declarator: DeclaratorInfo;
}

/** Flattened declarator: pointerDepth **-levels around a name, optionally an array. */
export interface DeclaratorInfo {
  name: string;
  nameSpan: SourceSpan;
  pointerDepth: number;
  array: null | { length: number | null }; // null length = unsized (param) array
}

export interface VarDeclNode extends Node {
  kind: 'VarDecl';
  baseType: BaseTypeName;
  decls: InitDeclNode[];
}

export interface InitDeclNode extends Node {
  kind: 'InitDecl';
  declarator: DeclaratorInfo;
  init: Expr | null;
}

// ── Statements ───────────────────────────────────────────────────────────────

export interface CompoundStmtNode extends Node {
  kind: 'CompoundStmt';
  items: Array<VarDeclNode | Stmt>;
}

export interface ExprStmtNode extends Node {
  kind: 'ExprStmt';
  expr: Expr | null; // null = empty statement ";"
}

export interface IfStmtNode extends Node {
  kind: 'IfStmt';
  cond: Expr;
  then: Stmt;
  else_: Stmt | null;
}

export interface WhileStmtNode extends Node {
  kind: 'WhileStmt';
  cond: Expr;
  body: Stmt;
}

export interface ForStmtNode extends Node {
  kind: 'ForStmt';
  init: Expr | null;
  cond: Expr | null;
  update: Expr | null;
  body: Stmt;
}

export interface ReturnStmtNode extends Node {
  kind: 'ReturnStmt';
  expr: Expr | null;
}

export type Stmt =
  | ExprStmtNode
  | CompoundStmtNode
  | IfStmtNode
  | WhileStmtNode
  | ForStmtNode
  | ReturnStmtNode;

// ── Expressions ──────────────────────────────────────────────────────────────

export type BinaryOp =
  | '+' | '-' | '*' | '/' | '%'
  | '==' | '!=' | '<' | '>' | '<=' | '>='
  | '&&' | '||';

export type UnaryOp = '-' | '!' | '*' | '&'; // neg, not, deref, addr-of

export interface AssignExprNode extends Node {
  kind: 'Assign';
  target: Expr; // must be an l-value (checked semantically)
  value: Expr;
}

export interface BinaryExprNode extends Node {
  kind: 'Binary';
  op: BinaryOp;
  left: Expr;
  right: Expr;
}

export interface UnaryExprNode extends Node {
  kind: 'Unary';
  op: UnaryOp;
  operand: Expr;
}

export interface IndexExprNode extends Node {
  kind: 'Index';
  array: Expr;
  index: Expr;
}

export interface CallExprNode extends Node {
  kind: 'Call';
  callee: string;
  calleeSpan: SourceSpan;
  args: Expr[];
}

export interface IdentExprNode extends Node {
  kind: 'Ident';
  name: string;
}

export interface ConstExprNode extends Node {
  kind: 'Const';
  constType: 'int' | 'float' | 'char';
  value: number;
  lexeme: string;
}

export type Expr =
  | AssignExprNode
  | BinaryExprNode
  | UnaryExprNode
  | IndexExprNode
  | CallExprNode
  | IdentExprNode
  | ConstExprNode;

export type AstNode =
  | ProgramNode
  | FuncDefNode
  | ParamNode
  | VarDeclNode
  | InitDeclNode
  | Stmt
  | Expr;

export interface Ast {
  root: ProgramNode;
  /** Preorder list for O(1) lookup by id. */
  nodes: AstNode[];
}

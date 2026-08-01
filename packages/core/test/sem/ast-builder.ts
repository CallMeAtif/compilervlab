/**
 * Hand-construction of Ast fixtures for semantic-analysis tests (the parser is
 * NOT imported — the AST shape follows packages/core/src/ast/types.ts).
 * Ids are assigned in creation order and nodes[] is indexed by id.
 */
import type {
  AssignExprNode,
  Ast,
  AstNode,
  BaseTypeName,
  BinaryExprNode,
  BinaryOp,
  CallExprNode,
  CompoundStmtNode,
  ConstExprNode,
  DeclaratorInfo,
  Expr,
  ExprStmtNode,
  ForStmtNode,
  FuncDefNode,
  IdentExprNode,
  IfStmtNode,
  IndexExprNode,
  InitDeclNode,
  ParamNode,
  ProgramNode,
  ReturnStmtNode,
  Stmt,
  UnaryExprNode,
  UnaryOp,
  VarDeclNode,
  WhileStmtNode,
} from '../../src/ast/types.js';
import type { SourceSpan } from '../../src/common/types.js';
import { runSemanticAnalysis } from '../../src/sem/typecheck.js';
import type { Diagnostic } from '../../src/common/types.js';

export class AstBuilder {
  readonly nodes: AstNode[] = [];
  private nextId = 0;
  private cursor = 0;

  sp(): SourceSpan {
    const s = this.cursor;
    this.cursor += 4;
    return { start: s, end: s + 3, line: 1, col: s + 1 };
  }

  private id(): number {
    return this.nextId++;
  }

  private reg<T extends AstNode>(n: T): T {
    this.nodes.push(n);
    return n;
  }

  // ── Expressions ────────────────────────────────────────────────────────────

  intc(value: number): ConstExprNode {
    return this.reg({
      kind: 'Const',
      id: this.id(),
      span: this.sp(),
      constType: 'int',
      value,
      lexeme: String(value),
    });
  }

  floatc(value: number): ConstExprNode {
    return this.reg({
      kind: 'Const',
      id: this.id(),
      span: this.sp(),
      constType: 'float',
      value,
      lexeme: value.toFixed(1),
    });
  }

  charc(ch: string): ConstExprNode {
    return this.reg({
      kind: 'Const',
      id: this.id(),
      span: this.sp(),
      constType: 'char',
      value: ch.charCodeAt(0),
      lexeme: `'${ch}'`,
    });
  }

  ident(name: string): IdentExprNode {
    return this.reg({ kind: 'Ident', id: this.id(), span: this.sp(), name });
  }

  bin(op: BinaryOp, left: Expr, right: Expr): BinaryExprNode {
    return this.reg({ kind: 'Binary', id: this.id(), span: this.sp(), op, left, right });
  }

  un(op: UnaryOp, operand: Expr): UnaryExprNode {
    return this.reg({ kind: 'Unary', id: this.id(), span: this.sp(), op, operand });
  }

  assign(target: Expr, value: Expr): AssignExprNode {
    return this.reg({ kind: 'Assign', id: this.id(), span: this.sp(), target, value });
  }

  index(array: Expr, idx: Expr): IndexExprNode {
    return this.reg({ kind: 'Index', id: this.id(), span: this.sp(), array, index: idx });
  }

  call(callee: string, args: Expr[]): CallExprNode {
    return this.reg({
      kind: 'Call',
      id: this.id(),
      span: this.sp(),
      callee,
      calleeSpan: this.sp(),
      args,
    });
  }

  // ── Statements ─────────────────────────────────────────────────────────────

  exprStmt(expr: Expr | null = null): ExprStmtNode {
    return this.reg({ kind: 'ExprStmt', id: this.id(), span: this.sp(), expr });
  }

  ret(expr: Expr | null = null): ReturnStmtNode {
    return this.reg({ kind: 'ReturnStmt', id: this.id(), span: this.sp(), expr });
  }

  ifs(cond: Expr, then: Stmt, else_: Stmt | null = null): IfStmtNode {
    return this.reg({ kind: 'IfStmt', id: this.id(), span: this.sp(), cond, then, else_ });
  }

  wh(cond: Expr, body: Stmt): WhileStmtNode {
    return this.reg({ kind: 'WhileStmt', id: this.id(), span: this.sp(), cond, body });
  }

  fors(init: Expr | null, cond: Expr | null, update: Expr | null, body: Stmt): ForStmtNode {
    return this.reg({ kind: 'ForStmt', id: this.id(), span: this.sp(), init, cond, update, body });
  }

  block(items: Array<VarDeclNode | Stmt>): CompoundStmtNode {
    return this.reg({ kind: 'CompoundStmt', id: this.id(), span: this.sp(), items });
  }

  // ── Declarations ───────────────────────────────────────────────────────────

  dcl(name: string, pointerDepth = 0, array: null | { length: number | null } = null): DeclaratorInfo {
    return { name, nameSpan: this.sp(), pointerDepth, array };
  }

  initDecl(declarator: DeclaratorInfo, init: Expr | null = null): InitDeclNode {
    return this.reg({ kind: 'InitDecl', id: this.id(), span: this.sp(), declarator, init });
  }

  varDecl(baseType: BaseTypeName, decls: InitDeclNode[]): VarDeclNode {
    return this.reg({ kind: 'VarDecl', id: this.id(), span: this.sp(), baseType, decls });
  }

  param(baseType: BaseTypeName, declarator: DeclaratorInfo): ParamNode {
    return this.reg({ kind: 'Param', id: this.id(), span: this.sp(), baseType, declarator });
  }

  func(
    returnType: BaseTypeName,
    name: string,
    params: ParamNode[],
    body: CompoundStmtNode,
  ): FuncDefNode {
    return this.reg({
      kind: 'FuncDef',
      id: this.id(),
      span: this.sp(),
      returnType,
      name,
      nameSpan: this.sp(),
      params,
      body,
    });
  }

  program(decls: Array<FuncDefNode | VarDeclNode>): Ast {
    const root: ProgramNode = this.reg({ kind: 'Program', id: this.id(), span: this.sp(), decls });
    return { root, nodes: this.nodes };
  }
}

// ── Common fixture harness ────────────────────────────────────────────────────

export function analyzeFixture(build: (b: AstBuilder) => Ast) {
  const b = new AstBuilder();
  const ast = build(b);
  const rec = runSemanticAnalysis(ast);
  const info = rec.result;
  const errors: Diagnostic[] = info.diagnostics.filter((d) => d.severity === 'error');
  const warnings: Diagnostic[] = info.diagnostics.filter((d) => d.severity === 'warning');
  return { ast, rec, info, errors, warnings };
}

/** Wrap statements/declarations in `int main() { …; return 0; }` so fixtures
 *  never trip the missing-return warning by accident. */
export function mainWith(b: AstBuilder, items: Array<VarDeclNode | Stmt>): Ast {
  return b.program([b.func('int', 'main', [], b.block([...items, b.ret(b.intc(0))]))]);
}

// ── The gcd/main acceptance program ───────────────────────────────────────────
//
// int gcd(int a, int b) {
//   while (b != 0) { int t; t = b; b = a % b; a = t; }
//   return a;
// }
// int main() { return gcd(36, 24); }

export interface GcdFixture {
  ast: Ast;
  condNode: BinaryExprNode; // b != 0
  modNode: BinaryExprNode; // a % b
  callNode: CallExprNode; // gcd(36, 24)
}

export function buildGcdMain(b: AstBuilder): GcdFixture {
  const condNode = b.bin('!=', b.ident('b'), b.intc(0));
  const modNode = b.bin('%', b.ident('a'), b.ident('b'));
  const loopBody = b.block([
    b.varDecl('int', [b.initDecl(b.dcl('t'))]),
    b.exprStmt(b.assign(b.ident('t'), b.ident('b'))),
    b.exprStmt(b.assign(b.ident('b'), modNode)),
    b.exprStmt(b.assign(b.ident('a'), b.ident('t'))),
  ]);
  const gcd = b.func(
    'int',
    'gcd',
    [b.param('int', b.dcl('a')), b.param('int', b.dcl('b'))],
    b.block([b.wh(condNode, loopBody), b.ret(b.ident('a'))]),
  );
  const callNode = b.call('gcd', [b.intc(36), b.intc(24)]);
  const main = b.func('int', 'main', [], b.block([b.ret(callNode)]));
  return { ast: b.program([gcd, main]), condNode, modNode, callNode };
}

// Handy type literals for assertions.
export const INT = { kind: 'base', name: 'int' } as const;
export const FLOAT = { kind: 'base', name: 'float' } as const;
export const CHAR = { kind: 'base', name: 'char' } as const;
export const PINT = { kind: 'pointer', to: INT } as const;

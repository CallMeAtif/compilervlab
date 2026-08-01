/**
 * Test fixtures for the IR phase: a small AST builder (deterministic node ids
 * in creation order) and a minimal semantic analyzer producing the
 * SemanticInfo contract (symbols, node types, resolutions, int→float
 * conversions) for the hand-built programs the golden tests use.
 *
 * Fixture-only simplifications: one scope per function (block declarations are
 * flattened into it — fixture programs use unique names per function), and
 * only the typing rules the fixtures exercise.
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
import type { CType, Scope, SemanticInfo, SymbolEntry } from '../../src/sem/types.js';
import { baseType } from '../../src/sem/types.js';

// ── AST builder ──────────────────────────────────────────────────────────────

export class AstBuilder {
  private nextId = 0;
  private nodes: AstNode[] = [];

  private span(): SourceSpan {
    const i = this.nextId;
    return { start: i, end: i + 1, line: 1, col: i + 1 };
  }

  private mk<T extends AstNode>(partial: Omit<T, 'id' | 'span'>): T {
    const node = { id: this.nextId, span: this.span(), ...partial } as T;
    this.nextId += 1;
    this.nodes.push(node);
    return node;
  }

  decl(name: string, opts: { ptr?: number; arrayLen?: number | null } = {}): DeclaratorInfo {
    return {
      name,
      nameSpan: { start: 0, end: 0, line: 1, col: 1 },
      pointerDepth: opts.ptr ?? 0,
      array: opts.arrayLen === undefined ? null : { length: opts.arrayLen },
    };
  }

  int(value: number): ConstExprNode {
    return this.mk<ConstExprNode>({ kind: 'Const', constType: 'int', value, lexeme: String(value) });
  }
  flt(value: number): ConstExprNode {
    return this.mk<ConstExprNode>({ kind: 'Const', constType: 'float', value, lexeme: String(value) });
  }
  chr(value: number): ConstExprNode {
    return this.mk<ConstExprNode>({ kind: 'Const', constType: 'char', value, lexeme: `'${String.fromCharCode(value)}'` });
  }
  id(name: string): IdentExprNode {
    return this.mk<IdentExprNode>({ kind: 'Ident', name });
  }
  bin(op: BinaryOp, left: Expr, right: Expr): BinaryExprNode {
    return this.mk<BinaryExprNode>({ kind: 'Binary', op, left, right });
  }
  un(op: UnaryOp, operand: Expr): UnaryExprNode {
    return this.mk<UnaryExprNode>({ kind: 'Unary', op, operand });
  }
  assign(target: Expr, value: Expr): AssignExprNode {
    return this.mk<AssignExprNode>({ kind: 'Assign', target, value });
  }
  index(array: Expr, idx: Expr): IndexExprNode {
    return this.mk<IndexExprNode>({ kind: 'Index', array, index: idx });
  }
  call(callee: string, args: Expr[]): CallExprNode {
    return this.mk<CallExprNode>({
      kind: 'Call',
      callee,
      calleeSpan: { start: 0, end: 0, line: 1, col: 1 },
      args,
    });
  }

  exprStmt(expr: Expr | null): ExprStmtNode {
    return this.mk<ExprStmtNode>({ kind: 'ExprStmt', expr });
  }
  compound(...items: Array<VarDeclNode | Stmt>): CompoundStmtNode {
    return this.mk<CompoundStmtNode>({ kind: 'CompoundStmt', items });
  }
  ifS(cond: Expr, then: Stmt, else_: Stmt | null = null): IfStmtNode {
    return this.mk<IfStmtNode>({ kind: 'IfStmt', cond, then, else_ });
  }
  whileS(cond: Expr, body: Stmt): WhileStmtNode {
    return this.mk<WhileStmtNode>({ kind: 'WhileStmt', cond, body });
  }
  forS(init: Expr | null, cond: Expr | null, update: Expr | null, body: Stmt): ForStmtNode {
    return this.mk<ForStmtNode>({ kind: 'ForStmt', init, cond, update, body });
  }
  ret(expr: Expr | null = null): ReturnStmtNode {
    return this.mk<ReturnStmtNode>({ kind: 'ReturnStmt', expr });
  }

  varDecl(
    base: BaseTypeName,
    name: string,
    init: Expr | null = null,
    opts: { ptr?: number; arrayLen?: number | null } = {},
  ): VarDeclNode {
    const initDecl = this.mk<InitDeclNode>({
      kind: 'InitDecl',
      declarator: this.decl(name, opts),
      init,
    });
    return this.mk<VarDeclNode>({ kind: 'VarDecl', baseType: base, decls: [initDecl] });
  }

  param(base: BaseTypeName, name: string, opts: { ptr?: number; array?: boolean } = {}): ParamNode {
    return this.mk<ParamNode>({
      kind: 'Param',
      baseType: base,
      declarator: this.decl(name, {
        ptr: opts.ptr ?? 0,
        ...(opts.array ? { arrayLen: null } : {}),
      }),
    });
  }

  func(
    returnType: BaseTypeName,
    name: string,
    params: ParamNode[],
    body: CompoundStmtNode,
  ): FuncDefNode {
    return this.mk<FuncDefNode>({
      kind: 'FuncDef',
      returnType,
      name,
      nameSpan: { start: 0, end: 0, line: 1, col: 1 },
      params,
      body,
    });
  }

  program(...decls: Array<FuncDefNode | VarDeclNode>): Ast {
    const root = this.mk<ProgramNode>({ kind: 'Program', decls });
    return { root, nodes: this.nodes };
  }
}

// ── minimal semantic analyzer for fixtures ───────────────────────────────────

function declaratorType(base: BaseTypeName, d: DeclaratorInfo): CType {
  let t: CType = baseType(base);
  for (let i = 0; i < d.pointerDepth; i++) t = { kind: 'pointer', to: t };
  if (d.array) t = { kind: 'array', of: t, length: d.array.length };
  return t;
}

/** Parameter arrays decay to pointers (c-subset rule 6). */
function paramType(base: BaseTypeName, d: DeclaratorInfo): CType {
  const t = declaratorType(base, d);
  return t.kind === 'array' ? { kind: 'pointer', to: t.of } : t;
}

function isFloat(t: CType): boolean {
  return t.kind === 'base' && t.name === 'float';
}
function isIntish(t: CType): boolean {
  return t.kind === 'base' && (t.name === 'int' || t.name === 'char');
}
function promote(t: CType): CType {
  return t.kind === 'base' && t.name === 'char' ? baseType('int') : t;
}

export function analyze(ast: Ast): SemanticInfo {
  const symbols: SymbolEntry[] = [];
  const dummySpan: SourceSpan = { start: 0, end: 0, line: 1, col: 1 };
  const globalScope: Scope = {
    id: 0,
    parentId: null,
    kind: 'global',
    symbolIds: [],
    span: ast.root.span,
  };
  const scopes: Scope[] = [globalScope];
  const nodeTypes: Record<number, CType> = {};
  const resolved: Record<number, number> = {};
  const conversions: Record<number, { from: CType; to: CType }> = {};

  const addSymbol = (
    scope: Scope,
    name: string,
    type: CType,
    kind: SymbolEntry['kind'],
    declNodeId: number,
  ): SymbolEntry => {
    const entry: SymbolEntry = {
      id: symbols.length,
      name,
      type,
      kind,
      scopeId: scope.id,
      declSpan: dummySpan,
      declNodeId,
    };
    symbols.push(entry);
    scope.symbolIds.push(entry.id);
    return entry;
  };

  type Env = Array<Map<string, SymbolEntry>>;
  const globalEnv = new Map<string, SymbolEntry>();

  const lookup = (env: Env, name: string): SymbolEntry => {
    for (let i = env.length - 1; i >= 0; i--) {
      const s = env[i]!.get(name);
      if (s) return s;
    }
    throw new Error(`fixture analyze: undeclared name ${name}`);
  };

  /** Record an int/char → float widening on an expression node when the
   *  context type is float and the expression type is not (§6.5.2). */
  const convertTo = (e: Expr, from: CType, to: CType): void => {
    if (isFloat(to) && isIntish(from)) {
      conversions[e.id] = { from, to: baseType('float') };
    }
  };

  const typeExpr = (e: Expr, env: Env): CType => {
    switch (e.kind) {
      case 'Const': {
        const t = baseType(e.constType);
        nodeTypes[e.id] = t;
        return t;
      }
      case 'Ident': {
        const sym = lookup(env, e.name);
        resolved[e.id] = sym.id;
        nodeTypes[e.id] = sym.type;
        return sym.type;
      }
      case 'Assign': {
        const tt = typeExpr(e.target, env);
        const vt = typeExpr(e.value, env);
        convertTo(e.value, vt, tt);
        nodeTypes[e.id] = tt;
        return tt;
      }
      case 'Binary': {
        const lt = typeExpr(e.left, env);
        const rt = typeExpr(e.right, env);
        let t: CType;
        if (e.op === '&&' || e.op === '||') {
          t = baseType('int');
        } else if (['==', '!=', '<', '>', '<=', '>='].includes(e.op)) {
          if (isFloat(lt) || isFloat(rt)) {
            convertTo(e.left, lt, baseType('float'));
            convertTo(e.right, rt, baseType('float'));
          }
          t = baseType('int');
        } else {
          if (isFloat(lt) || isFloat(rt)) {
            convertTo(e.left, lt, baseType('float'));
            convertTo(e.right, rt, baseType('float'));
            t = baseType('float');
          } else {
            t = baseType('int');
          }
        }
        nodeTypes[e.id] = t;
        return t;
      }
      case 'Unary': {
        const ot = typeExpr(e.operand, env);
        let t: CType;
        if (e.op === '-') t = promote(ot);
        else if (e.op === '!') t = baseType('int');
        else if (e.op === '*') {
          if (ot.kind !== 'pointer') throw new Error('fixture analyze: * on non-pointer');
          t = ot.to;
        } else {
          t = { kind: 'pointer', to: ot };
        }
        nodeTypes[e.id] = t;
        return t;
      }
      case 'Index': {
        const at = typeExpr(e.array, env);
        typeExpr(e.index, env);
        const t =
          at.kind === 'array' ? at.of : at.kind === 'pointer' ? at.to : null;
        if (!t) throw new Error('fixture analyze: indexing a non-array');
        nodeTypes[e.id] = t;
        return t;
      }
      case 'Call': {
        const sym = lookup(env, e.callee);
        if (sym.type.kind !== 'function') throw new Error('fixture analyze: calling a non-function');
        resolved[e.id] = sym.id;
        for (let i = 0; i < e.args.length; i++) {
          const arg = e.args[i]!;
          const at = typeExpr(arg, env);
          const pt = sym.type.params[i];
          if (pt) convertTo(arg, at, pt);
        }
        nodeTypes[e.id] = sym.type.ret;
        return sym.type.ret;
      }
    }
  };

  const walkStmt = (s: Stmt | VarDeclNode, env: Env, fnScope: Scope, fnRet: CType): void => {
    switch (s.kind) {
      case 'VarDecl': {
        for (const init of s.decls) {
          const t = declaratorType(s.baseType, init.declarator);
          nodeTypes[init.id] = t;
          const sym = addSymbol(fnScope, init.declarator.name, t, 'var', init.id);
          env[env.length - 1]!.set(init.declarator.name, sym);
          if (init.init) {
            const vt = typeExpr(init.init, env);
            convertTo(init.init, vt, t);
          }
        }
        return;
      }
      case 'ExprStmt':
        if (s.expr) typeExpr(s.expr, env);
        return;
      case 'CompoundStmt':
        for (const item of s.items) walkStmt(item, env, fnScope, fnRet);
        return;
      case 'IfStmt':
        typeExpr(s.cond, env);
        walkStmt(s.then, env, fnScope, fnRet);
        if (s.else_) walkStmt(s.else_, env, fnScope, fnRet);
        return;
      case 'WhileStmt':
        typeExpr(s.cond, env);
        walkStmt(s.body, env, fnScope, fnRet);
        return;
      case 'ForStmt':
        if (s.init) typeExpr(s.init, env);
        if (s.cond) typeExpr(s.cond, env);
        if (s.update) typeExpr(s.update, env);
        walkStmt(s.body, env, fnScope, fnRet);
        return;
      case 'ReturnStmt':
        if (s.expr) {
          const t = typeExpr(s.expr, env);
          convertTo(s.expr, t, fnRet);
        }
        return;
    }
  };

  for (const decl of ast.root.decls) {
    if (decl.kind === 'VarDecl') {
      for (const init of decl.decls) {
        const t = declaratorType(decl.baseType, init.declarator);
        nodeTypes[init.id] = t;
        const sym = addSymbol(globalScope, init.declarator.name, t, 'var', init.id);
        globalEnv.set(init.declarator.name, sym);
        if (init.init) {
          const vt = typeExpr(init.init, [globalEnv]);
          convertTo(init.init, vt, t);
        }
      }
    } else {
      const ret = baseType(decl.returnType);
      const params = decl.params.map((p) => paramType(p.baseType, p.declarator));
      const fnSym = addSymbol(
        globalScope,
        decl.name,
        { kind: 'function', ret, params },
        'func',
        decl.id,
      );
      globalEnv.set(decl.name, fnSym);
      const fnScope: Scope = {
        id: scopes.length,
        parentId: 0,
        kind: 'function',
        label: decl.name,
        symbolIds: [],
        span: decl.span,
      };
      scopes.push(fnScope);
      const fnEnv = new Map<string, SymbolEntry>();
      for (let i = 0; i < decl.params.length; i++) {
        const p = decl.params[i]!;
        const sym = addSymbol(fnScope, p.declarator.name, params[i]!, 'param', p.id);
        nodeTypes[p.id] = params[i]!;
        fnEnv.set(p.declarator.name, sym);
      }
      walkStmt(decl.body, [globalEnv, fnEnv], fnScope, ret);
    }
  }

  return { scopes, symbols, nodeTypes, resolved, conversions, diagnostics: [] };
}

/** Convenience: build + analyze in one call. */
export function buildProgram(build: (b: AstBuilder) => Ast): { ast: Ast; sem: SemanticInfo } {
  const b = new AstBuilder();
  const ast = build(b);
  return { ast, sem: analyze(ast) };
}

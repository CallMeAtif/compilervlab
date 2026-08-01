/**
 * AST construction for the pipeline parse: fold the concrete parse tree
 * produced by the LALR(1) driver (lr-parse.ts) into the Ast of ast/types.ts.
 *
 * This performs, as one pure function, exactly the reduction-time actions an
 * SDT would attach to each production (§5.4.2 "bottom-up translation"): every
 * internal parse-tree node was created by one reduce move, and the case below
 * for its production is that reduction's semantic action. Node ids are
 * assigned by a final preorder walk (root = 0), so `nodes[id]` is the preorder
 * list promised by the Ast contract; every span covers the constituent tokens.
 */
import type { SourceSpan } from '../common/types.js';
import type { Token } from '../csubset/tokens.js';
import type { Grammar } from '../grammar/grammar.js';
import type { PtNodeJson } from '../grammar/lr-parse.js';
import type {
  Ast,
  AstNode,
  BaseTypeName,
  BinaryOp,
  CompoundStmtNode,
  DeclaratorInfo,
  Expr,
  FuncDefNode,
  InitDeclNode,
  ParamNode,
  ProgramNode,
  Stmt,
  UnaryOp,
  VarDeclNode,
} from './types.js';

const FALLBACK_SPAN: SourceSpan = { start: 0, end: 0, line: 1, col: 1 };

function cover(a: SourceSpan, b: SourceSpan): SourceSpan {
  return { start: a.start, end: b.end, line: a.line, col: a.col };
}

function charValue(lexeme: string): number {
  const inner = lexeme.slice(1, -1);
  if (inner.startsWith('\\')) {
    const c = inner[1];
    switch (c) {
      case 'n': return 10;
      case 't': return 9;
      case '0': return 0;
      case '\\': return 92;
      case "'": return 39;
      default: return c === undefined ? 0 : c.charCodeAt(0);
    }
  }
  return inner.length > 0 ? inner.charCodeAt(0) : 0;
}

/**
 * Build the Ast from the parse forest of an ACCEPTED pipeline parse.
 * `ptNodes` and `rootId` come from LrParseResult; `tokens` is the token array
 * the parse consumed (leaf.tokenIndex indexes into it).
 */
export function buildAst(
  grammar: Grammar,
  ptNodes: PtNodeJson[],
  rootId: number,
  tokens: Token[],
): Ast {
  const node = (id: number): PtNodeJson => {
    const n = ptNodes[id];
    if (!n) throw new Error(`parse-tree node ${id} missing`);
    return n;
  };
  const kids = (n: PtNodeJson): PtNodeJson[] => n.children.map(node);
  const tokenOf = (n: PtNodeJson): Token => {
    const t = n.tokenIndex === null ? undefined : tokens[n.tokenIndex];
    if (!t) throw new Error(`leaf '${n.symbol}' has no token`);
    return t;
  };

  // ── Spans: bottom-up cover of constituent tokens ──────────────────────────
  const spanMemo = new Map<number, SourceSpan | null>();
  function spanOf(n: PtNodeJson): SourceSpan | null {
    const hit = spanMemo.get(n.id);
    if (hit !== undefined) return hit;
    let out: SourceSpan | null;
    if (n.tokenIndex !== null) {
      out = tokenOf(n).span;
    } else {
      const spans = kids(n)
        .map(spanOf)
        .filter((s): s is SourceSpan => s !== null);
      out = spans.length === 0 ? null : cover(spans[0]!, spans[spans.length - 1]!);
    }
    spanMemo.set(n.id, out);
    return out;
  }
  const spanReq = (n: PtNodeJson): SourceSpan => spanOf(n) ?? FALLBACK_SPAN;

  // ── Per-production semantic actions ───────────────────────────────────────
  // Nodes are created with a placeholder id; a final preorder walk numbers them.

  function evalTypeSpec(n: PtNodeJson): BaseTypeName {
    return kids(n)[0]!.symbol as BaseTypeName;
  }

  function evalDeclarator(n: PtNodeJson): DeclaratorInfo {
    const c = kids(n);
    if (c[0]!.symbol === '*') {
      const inner = evalDeclarator(c[1]!);
      return { ...inner, pointerDepth: inner.pointerDepth + 1 };
    }
    return evalDirectDecl(c[0]!);
  }

  function evalDirectDecl(n: PtNodeJson): DeclaratorInfo {
    const c = kids(n);
    const idTok = tokenOf(c[0]!);
    const base: DeclaratorInfo = {
      name: idTok.lexeme,
      nameSpan: idTok.span,
      pointerDepth: 0,
      array: null,
    };
    if (c.length === 4) {
      const len = tokenOf(c[2]!);
      return { ...base, array: { length: len.value ?? parseInt(len.lexeme, 10) } };
    }
    if (c.length === 3) return { ...base, array: { length: null } };
    return base;
  }

  function flattenLeft(n: PtNodeJson, listSym: string): PtNodeJson[] {
    // ListSym → ListSym (sep)? Item | Item — return the Item pt nodes in order.
    const c = kids(n);
    if (c[0]!.symbol === listSym) {
      return [...flattenLeft(c[0]!, listSym), c[c.length - 1]!];
    }
    return [c[c.length - 1]!];
  }

  function evalParam(n: PtNodeJson): ParamNode {
    const c = kids(n);
    return {
      kind: 'Param',
      id: -1,
      span: spanReq(n),
      baseType: evalTypeSpec(c[0]!),
      declarator: evalDeclarator(c[1]!),
    };
  }

  function evalInitDecl(n: PtNodeJson): InitDeclNode {
    const c = kids(n);
    return {
      kind: 'InitDecl',
      id: -1,
      span: spanReq(n),
      declarator: evalDeclarator(c[0]!),
      init: c.length === 3 ? evalExpr(c[2]!) : null,
    };
  }

  function evalVarDecl(n: PtNodeJson): VarDeclNode {
    const c = kids(n);
    return {
      kind: 'VarDecl',
      id: -1,
      span: spanReq(n),
      baseType: evalTypeSpec(c[0]!),
      decls: flattenLeft(c[1]!, 'InitDeclList').map(evalInitDecl),
    };
  }

  function evalCompound(n: PtNodeJson): CompoundStmtNode {
    const c = kids(n);
    const items =
      c.length === 3
        ? flattenLeft(c[1]!, 'BlockItemList').map((bi) => {
            const inner = kids(bi)[0]!;
            return inner.symbol === 'VarDecl' ? evalVarDecl(inner) : evalStmt(inner);
          })
        : [];
    return { kind: 'CompoundStmt', id: -1, span: spanReq(n), items };
  }

  function evalStmt(n: PtNodeJson): Stmt {
    const c0 = kids(n)[0]!;
    switch (c0.symbol) {
      case 'ExprStmt': {
        const c = kids(c0);
        return {
          kind: 'ExprStmt',
          id: -1,
          span: spanReq(c0),
          expr: c.length === 2 ? evalExpr(c[0]!) : null,
        };
      }
      case 'CompoundStmt':
        return evalCompound(c0);
      case 'IfStmt': {
        const c = kids(c0);
        return {
          kind: 'IfStmt',
          id: -1,
          span: spanReq(c0),
          cond: evalExpr(c[2]!),
          then: evalStmt(c[4]!),
          else_: c.length === 7 ? evalStmt(c[6]!) : null,
        };
      }
      case 'WhileStmt': {
        const c = kids(c0);
        return {
          kind: 'WhileStmt',
          id: -1,
          span: spanReq(c0),
          cond: evalExpr(c[2]!),
          body: evalStmt(c[4]!),
        };
      }
      case 'ForStmt': {
        const c = kids(c0);
        const opt = (m: PtNodeJson): Expr | null =>
          m.children.length === 0 ? null : evalExpr(kids(m)[0]!);
        return {
          kind: 'ForStmt',
          id: -1,
          span: spanReq(c0),
          init: opt(c[2]!),
          cond: opt(c[4]!),
          update: opt(c[6]!),
          body: evalStmt(c[8]!),
        };
      }
      case 'ReturnStmt': {
        const c = kids(c0);
        return {
          kind: 'ReturnStmt',
          id: -1,
          span: spanReq(c0),
          expr: c.length === 3 ? evalExpr(c[1]!) : null,
        };
      }
      default:
        throw new Error(`unexpected Stmt alternative '${c0.symbol}'`);
    }
  }

  function evalExpr(n: PtNodeJson): Expr {
    switch (n.symbol) {
      case 'Expr':
        return evalExpr(kids(n)[0]!);
      case 'AssignExpr': {
        const c = kids(n);
        if (c.length === 1) return evalExpr(c[0]!);
        return {
          kind: 'Assign',
          id: -1,
          span: spanReq(n),
          target: evalExpr(c[0]!),
          value: evalExpr(c[2]!),
        };
      }
      case 'OrExpr':
      case 'AndExpr':
      case 'EqExpr':
      case 'RelExpr':
      case 'AddExpr':
      case 'MulExpr': {
        const c = kids(n);
        if (c.length === 1) return evalExpr(c[0]!);
        return {
          kind: 'Binary',
          id: -1,
          span: spanReq(n),
          op: c[1]!.symbol as BinaryOp,
          left: evalExpr(c[0]!),
          right: evalExpr(c[2]!),
        };
      }
      case 'UnaryExpr': {
        const c = kids(n);
        if (c.length === 1) return evalExpr(c[0]!);
        return {
          kind: 'Unary',
          id: -1,
          span: spanReq(n),
          op: c[0]!.symbol as UnaryOp,
          operand: evalExpr(c[1]!),
        };
      }
      case 'PostfixExpr': {
        const c = kids(n);
        if (c.length === 1) return evalExpr(c[0]!);
        return {
          kind: 'Index',
          id: -1,
          span: spanReq(n),
          array: evalExpr(c[0]!),
          index: evalExpr(c[2]!),
        };
      }
      case 'PrimaryExpr': {
        const c = kids(n);
        const first = c[0]!;
        if (first.symbol === '(') return evalExpr(c[1]!); // ( Expr ) — inner node
        if (first.symbol === 'id') {
          const t = tokenOf(first);
          if (c.length === 1) {
            return { kind: 'Ident', id: -1, span: t.span, name: t.lexeme };
          }
          // id ( ArgListOpt )
          const argOpt = c[2]!;
          const args =
            argOpt.children.length === 0
              ? []
              : flattenLeft(kids(argOpt)[0]!, 'ArgList').map(evalExpr);
          return {
            kind: 'Call',
            id: -1,
            span: spanReq(n),
            callee: t.lexeme,
            calleeSpan: t.span,
            args,
          };
        }
        // constants
        const t = tokenOf(first);
        const constType =
          first.symbol === 'intconst' ? 'int' : first.symbol === 'floatconst' ? 'float' : 'char';
        const value =
          t.value ??
          (constType === 'int'
            ? parseInt(t.lexeme, 10)
            : constType === 'float'
              ? parseFloat(t.lexeme)
              : charValue(t.lexeme));
        return { kind: 'Const', id: -1, span: t.span, constType, value, lexeme: t.lexeme };
      }
      default:
        throw new Error(`unexpected expression node '${n.symbol}'`);
    }
  }

  function evalFuncDef(n: PtNodeJson): FuncDefNode {
    const c = kids(n);
    const nameTok = tokenOf(c[1]!);
    const paramOpt = c[3]!;
    const params =
      paramOpt.children.length === 0
        ? []
        : flattenLeft(kids(paramOpt)[0]!, 'ParamList').map(evalParam);
    return {
      kind: 'FuncDef',
      id: -1,
      span: spanReq(n),
      returnType: evalTypeSpec(c[0]!),
      name: nameTok.lexeme,
      nameSpan: nameTok.span,
      params,
      body: evalCompound(c[5]!),
    };
  }

  const rootPt = node(rootId);
  if (rootPt.symbol !== 'Program') {
    throw new Error(`expected parse-tree root 'Program', got '${rootPt.symbol}'`);
  }
  const decls = flattenLeft(kids(rootPt)[0]!, 'DeclList').map((ed) => {
    const inner = kids(ed)[0]!;
    return inner.symbol === 'FuncDef' ? evalFuncDef(inner) : evalVarDecl(inner);
  });
  const root: ProgramNode = { kind: 'Program', id: -1, span: spanReq(rootPt), decls };

  // ── Deterministic preorder numbering; nodes[id] is the preorder list ──────
  const nodes: AstNode[] = [];
  const childrenOfAst = (n: AstNode): AstNode[] => {
    switch (n.kind) {
      case 'Program': return n.decls;
      case 'FuncDef': return [...n.params, n.body];
      case 'Param': return [];
      case 'VarDecl': return n.decls;
      case 'InitDecl': return n.init ? [n.init] : [];
      case 'CompoundStmt': return n.items;
      case 'ExprStmt': return n.expr ? [n.expr] : [];
      case 'IfStmt': return n.else_ ? [n.cond, n.then, n.else_] : [n.cond, n.then];
      case 'WhileStmt': return [n.cond, n.body];
      case 'ForStmt':
        return [n.init, n.cond, n.update, n.body].filter((x): x is Expr | Stmt => x !== null);
      case 'ReturnStmt': return n.expr ? [n.expr] : [];
      case 'Assign': return [n.target, n.value];
      case 'Binary': return [n.left, n.right];
      case 'Unary': return [n.operand];
      case 'Index': return [n.array, n.index];
      case 'Call': return n.args;
      case 'Ident':
      case 'Const':
        return [];
    }
  };
  (function walk(n: AstNode): void {
    n.id = nodes.length;
    nodes.push(n);
    for (const c of childrenOfAst(n)) walk(c);
  })(root);

  return { root, nodes };
}

/**
 * AST → TidyTreeNode for the /ir page.
 *
 * The tree is built ONCE per function (memoized on the FuncDefNode identity),
 * so d3-hierarchy lays it out once and stepping only changes highlight props —
 * the layout-stability rule of docs/PLAN.md.
 *
 * TidyTree renders `node.kind` as a `data-kind` attribute and exposes no other
 * per-node hook, so we encode the AST node id there ("IfStmt#42") and read it
 * back with event delegation to get hover provenance (instruction ↔ AST node).
 */
import type {
  AstNode,
  Expr,
  FuncDefNode,
  InitDeclNode,
  ParamNode,
  Stmt,
  VarDeclNode,
} from '@lab/core/ast/types.js';
import type { TidyTreeNode } from '../../components/viz/TidyTree';

/** `data-kind` payload: the node kind plus its AST id. */
export function encodeKind(kind: string, id: number): string {
  return `${kind}#${id}`;
}

/** Inverse of {@link encodeKind}; null for anything that is not one of ours. */
export function decodeAstId(dataKind: string | null | undefined): number | null {
  if (!dataKind) return null;
  const hash = dataKind.lastIndexOf('#');
  if (hash < 0) return null;
  const n = Number.parseInt(dataKind.slice(hash + 1), 10);
  return Number.isFinite(n) ? n : null;
}

function mk(
  node: { id: number; kind: string },
  label: string,
  children: Array<TidyTreeNode | null> = [],
): TidyTreeNode {
  const kids = children.filter((c): c is TidyTreeNode => c !== null);
  const out: TidyTreeNode = {
    id: String(node.id),
    label,
    kind: encodeKind(node.kind, node.id),
  };
  if (kids.length > 0) out.children = kids;
  return out;
}

function declaratorLabel(name: string, pointerDepth: number, isArray: boolean): string {
  return `${'*'.repeat(pointerDepth)}${name}${isArray ? '[ ]' : ''}`;
}

function exprTree(e: Expr): TidyTreeNode {
  switch (e.kind) {
    case 'Assign':
      return mk(e, '=', [exprTree(e.target), exprTree(e.value)]);
    case 'Binary':
      return mk(e, e.op, [exprTree(e.left), exprTree(e.right)]);
    case 'Unary': {
      const label =
        e.op === '-' ? 'minus' : e.op === '!' ? '!' : e.op === '*' ? '* (deref)' : '& (addr)';
      return mk(e, label, [exprTree(e.operand)]);
    }
    case 'Index':
      return mk(e, '[ ]', [exprTree(e.array), exprTree(e.index)]);
    case 'Call':
      return mk(e, `call ${e.callee}`, e.args.map(exprTree));
    case 'Ident':
      return mk(e, e.name);
    case 'Const':
      return mk(e, e.lexeme);
  }
}

function initDeclTree(d: InitDeclNode): TidyTreeNode {
  const name = declaratorLabel(
    d.declarator.name,
    d.declarator.pointerDepth,
    d.declarator.array !== null,
  );
  return mk(d, d.init ? `${name} =` : name, d.init ? [exprTree(d.init)] : []);
}

function varDeclTree(v: VarDeclNode): TidyTreeNode {
  return mk(v, `decl ${v.baseType}`, v.decls.map(initDeclTree));
}

function paramTree(p: ParamNode): TidyTreeNode {
  return mk(
    p,
    `${p.baseType} ${declaratorLabel(
      p.declarator.name,
      p.declarator.pointerDepth,
      p.declarator.array !== null,
    )}`,
  );
}

function stmtTree(s: Stmt): TidyTreeNode {
  switch (s.kind) {
    case 'ExprStmt':
      return mk(s, 'expr ;', s.expr ? [exprTree(s.expr)] : []);
    case 'CompoundStmt':
      return mk(
        s,
        '{ }',
        s.items.map((item) => (item.kind === 'VarDecl' ? varDeclTree(item) : stmtTree(item))),
      );
    case 'IfStmt':
      return mk(s, 'if', [
        exprTree(s.cond),
        stmtTree(s.then),
        s.else_ ? stmtTree(s.else_) : null,
      ]);
    case 'WhileStmt':
      return mk(s, 'while', [exprTree(s.cond), stmtTree(s.body)]);
    case 'ForStmt':
      return mk(s, 'for', [
        s.init ? exprTree(s.init) : null,
        s.cond ? exprTree(s.cond) : null,
        s.update ? exprTree(s.update) : null,
        stmtTree(s.body),
      ]);
    case 'ReturnStmt':
      return mk(s, 'return', s.expr ? [exprTree(s.expr)] : []);
  }
}

/** The subtree the translator walks for one function definition. */
export function buildFunctionTree(fn: FuncDefNode): TidyTreeNode {
  return mk(fn, `${fn.returnType} ${fn.name}()`, [
    ...fn.params.map(paramTree),
    stmtTree(fn.body),
  ]);
}

/** Short human name for an AST node, for provenance captions. */
export function describeAstNode(node: AstNode | undefined): string {
  if (!node) return 'unknown node';
  switch (node.kind) {
    case 'Ident':
      return `Ident ${node.name}`;
    case 'Const':
      return `Const ${node.lexeme}`;
    case 'Binary':
      return `Binary ${node.op}`;
    case 'Unary':
      return `Unary ${node.op}`;
    case 'Call':
      return `Call ${node.callee}`;
    case 'FuncDef':
      return `FuncDef ${node.name}`;
    default:
      return node.kind;
  }
}

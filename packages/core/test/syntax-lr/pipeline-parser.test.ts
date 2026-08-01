/**
 * The pipeline parser: LALR(1) table for cGrammar() with the dangling-else
 * conflict resolved by shift (§4.8.2) as the ONLY permitted conflict, plus the
 * end-to-end acceptance program parsed into a shape-snapshotted AST.
 */
import { describe, expect, it } from 'vitest';
import { checkTraceInvariants } from '@lab/trace';
import type { AstNode } from '../../src/ast/types.js';
import { parse, pipelineTables } from '../../src/ast/parser.js';
import { lrParseReducer } from '../../src/grammar/lr-parse.js';
import { toks, type TokSpec } from './helpers.js';

// ── Grammar verification ─────────────────────────────────────────────────────

describe('C-subset LALR(1) table', () => {
  const tables = pipelineTables();

  it('has ONLY dangling-else shift/reduce conflicts, each resolved by shift', () => {
    expect(tables.lalr.conflicts.length).toBeGreaterThan(0);
    for (const c of tables.lalr.conflicts) {
      expect(c.kind).toBe('shift/reduce');
      expect(c.symbol).toBe('else');
      expect(c.resolution).not.toBeNull();
      expect(c.resolution!.action.type).toBe('shift');
      expect(c.resolution!.reason).toContain('4.8.2');
    }
    expect(tables.resolutions).toEqual(tables.lalr.conflicts);
  });

  it('is a real machine: hundreds of LR(1) states merged into LALR states', () => {
    expect(tables.lalr.lr1StateCount).toBeGreaterThan(tables.lalr.states.length);
    expect(tables.lalr.states.length).toBeGreaterThan(50);
  });
});

// ── AST shape serialization ──────────────────────────────────────────────────

function declStr(d: { name: string; pointerDepth: number; array: null | { length: number | null } }): string {
  const stars = '*'.repeat(d.pointerDepth);
  const arr = d.array ? `[${d.array.length ?? ''}]` : '';
  return `${stars}${d.name}${arr}`;
}

function shape(n: AstNode): string {
  switch (n.kind) {
    case 'Program': return `(program ${n.decls.map(shape).join(' ')})`;
    case 'FuncDef':
      return `(func ${n.returnType} ${n.name} [${n.params.map(shape).join(' ')}] ${shape(n.body)})`;
    case 'Param': return `(param ${n.baseType} ${declStr(n.declarator)})`;
    case 'VarDecl': return `(var ${n.baseType} ${n.decls.map(shape).join(' ')})`;
    case 'InitDecl':
      return n.init ? `(${declStr(n.declarator)} = ${shape(n.init)})` : declStr(n.declarator);
    case 'CompoundStmt': return `{${n.items.map(shape).join(' ')}}`;
    case 'ExprStmt': return n.expr ? `(expr ${shape(n.expr)})` : '(empty)';
    case 'IfStmt':
      return n.else_
        ? `(if ${shape(n.cond)} ${shape(n.then)} ${shape(n.else_)})`
        : `(if ${shape(n.cond)} ${shape(n.then)})`;
    case 'WhileStmt': return `(while ${shape(n.cond)} ${shape(n.body)})`;
    case 'ForStmt':
      return `(for ${n.init ? shape(n.init) : '_'} ${n.cond ? shape(n.cond) : '_'} ${n.update ? shape(n.update) : '_'} ${shape(n.body)})`;
    case 'ReturnStmt': return n.expr ? `(return ${shape(n.expr)})` : '(return)';
    case 'Assign': return `(= ${shape(n.target)} ${shape(n.value)})`;
    case 'Binary': return `(${n.op} ${shape(n.left)} ${shape(n.right)})`;
    case 'Unary': return `(${n.op}u ${shape(n.operand)})`;
    case 'Index': return `(idx ${shape(n.array)} ${shape(n.index)})`;
    case 'Call': return `(call ${n.callee}${n.args.map((a) => ' ' + shape(a)).join('')})`;
    case 'Ident': return n.name;
    case 'Const': return n.lexeme;
  }
}

// ── Acceptance program ───────────────────────────────────────────────────────

// int gcd(int a, int b) { while (b != 0) { int t; t = b; b = a % b; a = t; } return a; }
// int main() { int x; x = gcd(12, 18); if (x > 5) { return x; } else { return 0; } }
const ACCEPTANCE: TokSpec[] = [
  'int', ['id', 'gcd'], '(', 'int', ['id', 'a'], ',', 'int', ['id', 'b'], ')', '{',
  'while', '(', ['id', 'b'], '!=', ['intconst', '0'], ')', '{',
  'int', ['id', 't'], ';',
  ['id', 't'], '=', ['id', 'b'], ';',
  ['id', 'b'], '=', ['id', 'a'], '%', ['id', 'b'], ';',
  ['id', 'a'], '=', ['id', 't'], ';',
  '}',
  'return', ['id', 'a'], ';',
  '}',
  'int', ['id', 'main'], '(', ')', '{',
  'int', ['id', 'x'], ';',
  ['id', 'x'], '=', ['id', 'gcd'], '(', ['intconst', '12'], ',', ['intconst', '18'], ')', ';',
  'if', '(', ['id', 'x'], '>', ['intconst', '5'], ')', '{',
  'return', ['id', 'x'], ';',
  '}', 'else', '{',
  'return', ['intconst', '0'], ';',
  '}', '}',
];

describe('pipeline parse of the acceptance program', () => {
  const stream = toks(ACCEPTANCE);
  const out = parse(stream);

  it('accepts with no diagnostics and snapshots the AST shape', () => {
    expect(out.diagnostics).toEqual([]);
    expect(out.ast).not.toBeNull();
    expect(shape(out.ast!.root)).toBe(
      '(program ' +
        '(func int gcd [(param int a) (param int b)] ' +
        '{(while (!= b 0) {(var int t) (expr (= t b)) (expr (= b (% a b))) (expr (= a t))}) (return a)}) ' +
        '(func int main [] ' +
        '{(var int x) (expr (= x (call gcd 12 18))) (if (> x 5) {(return x)} {(return 0)})})' +
        ')',
    );
  });

  it('assigns deterministic preorder node ids; nodes[] is the preorder list', () => {
    const ast = out.ast!;
    expect(ast.root.id).toBe(0);
    ast.nodes.forEach((n, i) => expect(n.id).toBe(i));
    // Preorder: first FuncDef is node 1, its first Param node 2.
    expect(ast.nodes[1]!.kind).toBe('FuncDef');
    expect(ast.nodes[2]!.kind).toBe('Param');
  });

  it('gives every node a span covering its constituent tokens', () => {
    const ast = out.ast!;
    const src = stream.tokens;
    expect(ast.root.span.start).toBe(0);
    expect(ast.root.span.end).toBe(src[src.length - 1]!.span.end);
    for (const n of ast.nodes) {
      expect(n.span.start).toBeLessThanOrEqual(n.span.end);
      expect(n.span.end).toBeLessThanOrEqual(src[src.length - 1]!.span.end);
    }
    const gcd = ast.nodes[1]!;
    if (gcd.kind === 'FuncDef') {
      expect(stream.tokens[1]!.span).toEqual(gcd.nameSpan);
    }
  });

  it('records a full driver trace satisfying the invariants', () => {
    expect(out.recorded.result.accepted).toBe(true);
    expect(checkTraceInvariants(out.recorded, lrParseReducer, (r) => r)).toEqual([]);
  });

  it('is deterministic end-to-end', () => {
    const out2 = parse(toks(ACCEPTANCE));
    expect(JSON.stringify(out2.ast)).toBe(JSON.stringify(out.ast));
    expect(JSON.stringify(out2.recorded.trace.steps)).toBe(
      JSON.stringify(out.recorded.trace.steps),
    );
  });
});

// ── Dangling-else semantics ──────────────────────────────────────────────────

describe('dangling else binds to the nearest if (shift resolution, §4.8.2)', () => {
  it('parses if (1) if (2) return 3; else return 4; with the else on the inner if', () => {
    const out = parse(
      toks([
        'int', ['id', 'main'], '(', ')', '{',
        'if', '(', ['intconst', '1'], ')',
        'if', '(', ['intconst', '2'], ')', 'return', ['intconst', '3'], ';',
        'else', 'return', ['intconst', '4'], ';',
        'return', ['intconst', '0'], ';',
        '}',
      ]),
    );
    expect(out.diagnostics).toEqual([]);
    expect(shape(out.ast!.root)).toBe(
      '(program (func int main [] {(if 1 (if 2 (return 3) (return 4))) (return 0)}))',
    );
  });
});

// ── Educational syntax errors ────────────────────────────────────────────────

describe('pipeline syntax errors', () => {
  it('reports the expected set and the offending token span', () => {
    const stream = toks(['int', ['id', 'main'], '(', ')', '{', 'return', '}']);
    const out = parse(stream);
    expect(out.ast).toBeNull();
    expect(out.diagnostics.length).toBe(1);
    const d = out.diagnostics[0]!;
    expect(d.phase).toBe('syntax');
    expect(d.severity).toBe('error');
    expect(d.message).toContain("unexpected '}'");
    expect(d.message).toContain('expected one of');
    expect(d.span).toEqual(stream.tokens[6]!.span); // the '}'
    const err = out.recorded.result.error!;
    expect(err.expected).toContain(';');
    expect(err.expected).toContain('id');
    expect(err.expected).toContain('intconst');
  });

  it('reports unexpected end of input', () => {
    const stream = toks(['int', ['id', 'main'], '(', ')', '{']);
    const out = parse(stream);
    expect(out.ast).toBeNull();
    expect(out.diagnostics[0]!.message).toContain('unexpected end of input');
  });
});

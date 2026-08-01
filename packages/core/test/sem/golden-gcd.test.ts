/**
 * Acceptance golden: the gcd/main program (hand-built Ast matching
 * ast/types.ts) checks clean, with the expected scope tree, symbol table,
 * resolutions, and synthesized types.
 */
import { describe, expect, it } from 'vitest';
import { AstBuilder, INT, buildGcdMain } from './ast-builder.js';
import { runSemanticAnalysis } from '../../src/sem/typecheck.js';

describe('gcd/main acceptance program', () => {
  const b = new AstBuilder();
  const fx = buildGcdMain(b);
  const rec = runSemanticAnalysis(fx.ast);
  const info = rec.result;

  it('checks clean: no diagnostics at all', () => {
    expect(info.diagnostics).toEqual([]);
  });

  it('builds the expected symbol table in declaration order', () => {
    expect(info.symbols.map((s) => [s.id, s.name, s.kind, s.scopeId])).toEqual([
      [0, 'gcd', 'func', 0],
      [1, 'a', 'param', 1],
      [2, 'b', 'param', 1],
      [3, 't', 'var', 2],
      [4, 'main', 'func', 0],
    ]);
    expect(info.symbols[0]!.type).toEqual({
      kind: 'function',
      ret: INT,
      params: [INT, INT],
    });
    expect(info.symbols[4]!.type).toEqual({ kind: 'function', ret: INT, params: [] });
  });

  it('builds the expected scope tree (global → gcd → while-block, global → main)', () => {
    expect(info.scopes.map((s) => [s.id, s.parentId, s.kind, s.label ?? null])).toEqual([
      [0, null, 'global', null],
      [1, 0, 'function', 'gcd'],
      [2, 1, 'block', null],
      [3, 0, 'function', 'main'],
    ]);
  });

  it('resolves the recursive-style cross-function call gcd(36, 24) to symbol #0', () => {
    expect(info.resolved[fx.callNode.id]).toBe(0);
  });

  it('synthesizes int for the condition, the mod, and the call', () => {
    expect(info.nodeTypes[fx.condNode.id]).toEqual(INT);
    expect(info.nodeTypes[fx.modNode.id]).toEqual(INT);
    expect(info.nodeTypes[fx.callNode.id]).toEqual(INT);
  });

  it('inserts no conversions in this all-int program', () => {
    expect(info.conversions).toEqual({});
  });

  it('names the scrubber sections Global scope / Function gcd / Function main', () => {
    expect(rec.trace.sections().map((s) => s.name)).toEqual([
      'Global scope',
      'Function gcd',
      'Function main',
      'Global scope',
    ]);
  });

  it('cites the Dragon Book on every step and explains it in prose', () => {
    for (const s of rec.trace.steps) {
      expect(s.meta.cite.section).toBeTruthy();
      expect(s.meta.prose.length).toBeGreaterThan(10);
    }
  });
});

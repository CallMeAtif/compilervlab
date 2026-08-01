/**
 * Integration guard for the worker's trace registry: every kind declared in
 * trace-kinds.ts must actually build a non-empty trace on the acceptance
 * sample, and upstream failures must come back as diagnostics rather than
 * exceptions. Runs under the root vitest config (node env, no DOM needed —
 * registry.ts is deliberately Worker-free).
 */
import { describe, it, expect } from 'vitest';
import { buildTrace } from '../src/worker/registry';
import { TRACE_KIND_NAMES } from '../src/worker/trace-kinds';
import { gcdAcceptanceSource } from '../src/examples/gcd-acceptance.c';

const source = gcdAcceptanceSource;

const REQUESTS: Array<{ kind: string; params: Record<string, unknown> }> = [
  { kind: 'lex.thompson', params: { classIndex: 0 } },
  { kind: 'lex.thompson', params: { classIndex: 2 } },
  { kind: 'lex.subset', params: { classIndex: 1 } },
  { kind: 'lex.minimize', params: { classIndex: 1 } },
  { kind: 'lex.scan', params: { source } },
  { kind: 'syntax.first-follow', params: { grammarId: 'dragon-4.28' } },
  { kind: 'syntax.first-follow', params: { grammarId: 'c-subset-ll' } },
  { kind: 'syntax.ll1-table', params: { grammarId: 'dragon-4.28' } },
  { kind: 'syntax.ll1-table', params: { grammarId: 'c-subset-ll' } },
  { kind: 'syntax.ll1-parse', params: { grammarId: 'dragon-4.28', source: 'id + id * id' } },
  { kind: 'syntax.ll1-parse', params: { grammarId: 'c-subset-ll', source } },
  { kind: 'syntax.rd', params: { grammarId: 'dragon-4.28', source: 'id + id * id' } },
  { kind: 'syntax.rd', params: { grammarId: 'c-subset-ll', source } },
  { kind: 'syntax.transforms', params: { grammarId: 'c-subset' } },
  { kind: 'syntax.transforms', params: { grammarId: 'c-subset', stage: 'left-factor' } },
  { kind: 'syntax.lr0', params: { grammarId: 'dragon-4.1' } },
  { kind: 'syntax.lr0', params: { grammarId: 'c-subset' } },
  { kind: 'syntax.slr', params: { grammarId: 'dragon-4.1' } },
  { kind: 'syntax.slr', params: { grammarId: 'c-subset' } },
  { kind: 'syntax.lr1', params: { grammarId: 'dragon-4.55' } },
  { kind: 'syntax.lr1', params: { grammarId: 'c-subset' } },
  { kind: 'syntax.lr1-table', params: { grammarId: 'dragon-4.55' } },
  { kind: 'syntax.lalr', params: { grammarId: 'dragon-4.55' } },
  { kind: 'syntax.lalr', params: { grammarId: 'c-subset', resolveDanglingElseByShift: true } },
  { kind: 'syntax.lr-parse', params: { grammarId: 'dragon-4.1', table: 'slr', source: 'id * id + id' } },
  { kind: 'syntax.lr-parse', params: { grammarId: 'c-subset', table: 'lalr', source } },
  { kind: 'sem.analyze', params: { source } },
  { kind: 'ir.gen', params: { source } },
  { kind: 'opt.pass', params: { source, pass: 'const-prop' } },
  { kind: 'opt.pass', params: { source, pass: 'dce' } },
  { kind: 'opt.pipeline', params: { source } },
  { kind: 'opt.analysis', params: { source, analysis: 'basic-blocks' } },
  { kind: 'opt.analysis', params: { source, analysis: 'cfg', functionName: 'gcd' } },
  { kind: 'opt.analysis', params: { source, analysis: 'reaching-defs', functionName: 'gcd' } },
  { kind: 'opt.analysis', params: { source, analysis: 'live-vars', functionName: 'gcd' } },
  { kind: 'opt.analysis', params: { source, analysis: 'avail-exprs', functionName: 'gcd' } },
  { kind: 'opt.analysis', params: { source, analysis: 'dominators', functionName: 'gcd' } },
  { kind: 'opt.analysis', params: { source, analysis: 'loops', functionName: 'gcd' } },
  { kind: 'codegen.isel', params: { source } },
  { kind: 'codegen.liveness', params: { source } },
  { kind: 'codegen.interference', params: { source } },
  { kind: 'codegen.color', params: { source } },
  { kind: 'codegen.color', params: { source, k: 3 } },
  { kind: 'codegen.emit', params: { source } },
  { kind: 'codegen.exec', params: { source } },
];

describe('trace registry', () => {
  it('covers every declared kind', () => {
    const covered = new Set(REQUESTS.map((r) => r.kind));
    expect([...TRACE_KIND_NAMES].filter((k) => !covered.has(k))).toEqual([]);
  });

  for (const req of REQUESTS) {
    it(`${req.kind} ${JSON.stringify(req.params).slice(0, 60)}`, () => {
      const res = buildTrace(req);
      if (!res.trace) {
        throw new Error(
          `${req.kind} produced no trace: ${res.diagnostics.map((d) => d.message).join(' | ')}`,
        );
      }
      expect(res.trace.steps.length).toBeGreaterThan(0);
    });
  }

  it('reports upstream errors for a broken program', () => {
    const bad = 'int main() { return zzz; }';
    const res = buildTrace({ kind: 'ir.gen', params: { source: bad } });
    expect(res.trace).toBeNull();
    expect(res.diagnostics.length).toBeGreaterThan(0);
    expect(res.diagnostics.some((d) => d.phase === 'semantic' && d.severity === 'error')).toBe(true);
  });

  it('reports the LR(1) state cap as a syntax lesson, not an internal fault', () => {
    // The C subset is the default grammar and blows past the cap: the user must
    // get the §4.7.4 explanation (build LALR instead), not a lab bug report.
    const res = buildTrace({ kind: 'syntax.lr1-table', params: { grammarId: 'c-subset' } });
    expect(res.trace).toBeNull();
    expect(res.diagnostics.length).toBe(1);
    const d = res.diagnostics[0]!;
    expect(d.phase).toBe('syntax');
    expect(d.hint ?? '').toContain('why LALR exists');
    expect(d.hint ?? '').not.toContain('not a problem with your program');
    expect(d.rule ?? '').not.toBe('');
  });

  it('rejects unknown kinds', () => {
    const res = buildTrace({ kind: 'nope.nope', params: {} });
    expect(res.trace).toBeNull();
    expect(res.diagnostics.length).toBe(1);
  });
});

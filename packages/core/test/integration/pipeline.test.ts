/**
 * Gate B integration: compile() end-to-end on the acceptance sample.
 *
 * The source is a verbatim copy of `packages/app/src/examples/gcd-acceptance.c.ts`
 * (core must not import from the app — the dependency direction is
 * trace → core → app). Keep them in sync by hand; the assertions below are
 * about pipeline structure, not about the exact text.
 */
import { describe, expect, it } from 'vitest';
import { compile } from '../../src/compile.js';
import { runTac } from '../../src/interp/tac.js';
import { runAsm } from '../../src/interp/asm.js';
import { formatQuad } from '../../src/ir/types.js';
import type { FuncDefNode } from '../../src/ast/types.js';

// ── The acceptance sample (copy of examples/gcd-acceptance.c.ts) ─────────────
const gcdAcceptanceSource = `// Acceptance sample: function + while loop + if/else.
// Computes gcd(48, 36) = 12 by Euclid's algorithm.

int gcd(int a, int b) {
    while (b != 0) {
        int t;
        t = a % b;
        a = b;
        b = t;
    }
    return a;
}

int main() {
    int x = 48;
    int y = 36;
    if (x < y) {
        int tmp;
        tmp = x;
        x = y;
        y = tmp;
    } else {
        x = x + 0;   // keep the else branch non-empty
    }
    return gcd(x, y);
}
`;

// ── The type-error sample (copy of examples/type-error.c.ts) ────────────────
const typeErrorSource = `// Deliberate errors: watch the Semantic stage stop and explain each one.

int main() {
    int n = 5;
    int *p = &n;
    float f = 2.5;

    n = p + f;        // ERROR: cannot add 'int*' and 'float'
    missing = n + 1;  // ERROR: use of undeclared identifier 'missing'

    return n;
}
`;

describe('compile() — acceptance sample', () => {
  const c = compile(gcdAcceptanceSource);

  it('produces no diagnostics', () => {
    expect(c.diagnostics).toEqual([]);
  });

  it('has a stable, source-derived id', () => {
    expect(c.id).toMatch(/^c-[0-9a-z]+$/);
    expect(compile(gcdAcceptanceSource).id).toBe(c.id);
    expect(compile(`${gcdAcceptanceSource}\n`).id).not.toBe(c.id);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(compile(gcdAcceptanceSource))).toBe(JSON.stringify(c));
  });

  it('scans tokens and interns identifiers', () => {
    expect(c.tokens).not.toBeNull();
    expect(c.tokens!.tokens.length).toBeGreaterThan(0);
    // gcd, a, b, t, main, x, y, tmp
    expect(c.tokens!.symbols.map((s) => s.lexeme).sort()).toEqual([
      'a',
      'b',
      'gcd',
      'main',
      't',
      'tmp',
      'x',
      'y',
    ]);
  });

  it('parses to a Program root with two function definitions', () => {
    expect(c.ast).not.toBeNull();
    expect(c.ast!.root.kind).toBe('Program');
    const funcs = c.ast!.root.decls.filter(
      (d): d is FuncDefNode => d.kind === 'FuncDef',
    );
    expect(funcs.map((f) => f.name)).toEqual(['gcd', 'main']);
    expect(funcs[0]!.params.map((p) => p.declarator.name)).toEqual(['a', 'b']);
    expect(funcs[1]!.params).toEqual([]);
  });

  it('type checks cleanly, with scopes for both functions', () => {
    expect(c.semantic).not.toBeNull();
    expect(c.semantic!.diagnostics).toEqual([]);
    expect(c.semantic!.scopes[0]!.kind).toBe('global');
    // gcd + main declared in the global scope
    const globals = c.semantic!.scopes[0]!.symbolIds.map(
      (id) => c.semantic!.symbols.find((s) => s.id === id)!.name,
    );
    expect(globals).toEqual(['gcd', 'main']);
  });

  it('generates non-empty TAC for both functions', () => {
    expect(c.tac).not.toBeNull();
    expect(c.tac!.functions.map((f) => f.name)).toEqual(['gcd', 'main']);
    for (const fn of c.tac!.functions) expect(fn.quads.length).toBeGreaterThan(0);
  });

  it('runs the default optimization sequence and keeps an output program', () => {
    expect(c.optimized).not.toBeNull();
    expect(c.optimized!.passes.map((p) => p.pass)).toEqual([
      'const-fold',
      'const-prop',
      'copy-prop',
      'cse',
      'licm',
      'dce',
    ]);
    expect(c.optimized!.output.functions.length).toBe(2);
    for (const fn of c.optimized!.output.functions) {
      expect(fn.quads.length).toBeGreaterThan(0);
    }
    // Something must actually have been optimized in this program.
    const changes = c.optimized!.passes.reduce((n, p) => n + p.changes.length, 0);
    expect(changes).toBeGreaterThan(0);
  });

  it('emits assembly containing a main: label', () => {
    expect(c.asm).not.toBeNull();
    const text = c.asm!.lines.map((l) => l.text);
    expect(text).toContain('main:');
    expect(text).toContain('gcd:');
    expect(c.interference).not.toBeNull();
    expect(c.registers).not.toBeNull();
    expect(c.registers!.map((r) => r.functionName)).toEqual(['gcd', 'main']);
  });

  it('TAC, optimized TAC and asm all compute gcd(48, 36) = 12', () => {
    // Note: gcd's arguments come from local initializers (`int x = 48;`), which
    // ARE translated. Global initializers are not — see docs/HANDOFF.md.
    const beforeOpt = runTac(c.tac!);
    const afterOpt = runTac(c.optimized!.output);
    const asm = runAsm(c.asm!);

    expect(beforeOpt.returnValue).toBe(12);
    expect(afterOpt.returnValue).toBe(beforeOpt.returnValue);
    expect(asm.error).toBeNull();
    expect(asm.returnValue).toBe(beforeOpt.returnValue);
  });

  it('keeps provenance from quads back to AST nodes', () => {
    const ids = new Set(c.ast!.nodes.map((n) => n.id));
    for (const fn of c.tac!.functions) {
      for (const q of fn.quads) {
        expect(ids.has(q.astNodeId), `${formatQuad(q)} → node ${q.astNodeId}`).toBe(true);
      }
    }
  });
});

// ── The array sample (copy of examples/array-sum.c.ts) ──────────────────────
const arraySumSource = `// Arrays + for loop: fills data[i] = i*i, then sums it.

int sum(int a[], int n) {
    int total = 0;
    int i;
    for (i = 0; i < n; i = i + 1) {
        total = total + a[i];
    }
    return total;
}

int main() {
    int data[5];
    int i;
    for (i = 0; i < 5; i = i + 1) {
        data[i] = i * i;
    }
    return sum(data, 5);   // 0 + 1 + 4 + 9 + 16 = 30
}
`;

describe('compile() — arrays end to end (the shipped array-sum example)', () => {
  const c = compile(arraySumSource);

  it('produces no diagnostics', () => {
    expect(c.diagnostics).toEqual([]);
  });

  it('TAC, optimized TAC and asm all compute 0+1+4+9+16 = 30', () => {
    // Regression guard for the codegen array addressing: index-load /
    // index-store carry an already-scaled BYTE offset (§6.4.3 Fig 6.22), so
    // the emitted addressing mode must add it, not scale it again.
    const beforeOpt = runTac(c.tac!);
    const afterOpt = runTac(c.optimized!.output);
    const asm = runAsm(c.asm!);

    expect(beforeOpt.returnValue).toBe(30);
    expect(afterOpt.returnValue).toBe(beforeOpt.returnValue);
    expect(asm.error).toBeNull();
    expect(asm.returnValue).toBe(beforeOpt.returnValue);
  });
});

describe('compile() — semantic error path', () => {
  const c = compile(typeErrorSource);

  it('reports semantic errors', () => {
    const sem = c.diagnostics.filter((d) => d.phase === 'semantic');
    expect(sem.length).toBeGreaterThan(0);
    expect(sem.every((d) => d.severity === 'error')).toBe(true);
    expect(sem.some((d) => d.message.includes('missing'))).toBe(true);
  });

  it('still publishes the artifacts of the phases that ran', () => {
    expect(c.tokens).not.toBeNull();
    expect(c.ast).not.toBeNull();
    expect(c.semantic).not.toBeNull(); // partial symbol table drives the sem view
  });

  it('leaves every downstream artifact null', () => {
    expect(c.tac).toBeNull();
    expect(c.optimized).toBeNull();
    expect(c.asm).toBeNull();
    expect(c.interference).toBeNull();
    expect(c.registers).toBeNull();
  });

  it('orders diagnostics by phase, then by span', () => {
    const order = ['lex', 'syntax', 'semantic', 'ir', 'opt', 'codegen'];
    for (let i = 1; i < c.diagnostics.length; i++) {
      const prev = c.diagnostics[i - 1]!;
      const cur = c.diagnostics[i]!;
      const dp = order.indexOf(prev.phase) - order.indexOf(cur.phase);
      expect(dp).toBeLessThanOrEqual(0);
      if (dp === 0) expect(prev.span.start).toBeLessThanOrEqual(cur.span.start);
    }
  });
});

describe('compile() — syntax error path', () => {
  const c = compile('int main() { return 1 }\n'); // missing semicolon

  it('reports a syntax error with the expected-terminal set', () => {
    const syn = c.diagnostics.filter((d) => d.phase === 'syntax');
    expect(syn.length).toBe(1);
    expect(syn[0]!.message).toContain('expected one of');
    expect(syn[0]!.rule).toContain('ACTION');
  });

  it('keeps the tokens but nothing downstream', () => {
    expect(c.tokens).not.toBeNull();
    expect(c.ast).toBeNull();
    expect(c.semantic).toBeNull();
    expect(c.tac).toBeNull();
    expect(c.asm).toBeNull();
  });
});

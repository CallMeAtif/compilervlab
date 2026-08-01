/**
 * Regression guards for defects found auditing the IR phase against the
 * Dragon Book (2nd ed., Ch. 6):
 *
 *  - a triple position reference "(i)" names *the value computed by triple i*
 *    (§6.2.3), so a temporary whose producer is decided by control flow — the
 *    1/0 materialization of a boolean value, §6.6.6 — must not be referenced
 *    that way;
 *  - the pointer instruction forms x = &y, x = *y, *x = y are enumerated in
 *    §6.2.1 "Addresses and Instructions", not in §6.2.2 (quadruples);
 *  - Fig 6.22 "semantic actions for array references" lives in §6.4.4, while
 *    §6.4.3 is the base + i × w addressing formula;
 *  - a void call in value-free position takes §6.9's `call p, n` form with no
 *    result temporary, wherever it appears (expression statement, for-init,
 *    for-update);
 *  - a float constant must render differently from an int constant, or the
 *    §6.5.2 widening steps are unreadable.
 */
import { describe, expect, it } from 'vitest';
import { compile } from '../../src/compile.js';
import { runIrGen } from '../../src/ir/gen.js';
import { formatQuad } from '../../src/ir/types.js';
import type { TacFunction, TacProgram } from '../../src/ir/types.js';
import { toIndirectTriples, toTriples } from '../../src/ir/views.js';

function tacOf(src: string): TacProgram {
  const c = compile(src);
  expect(c.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return c.tac!;
}

function fnOf(tac: TacProgram, name = 'main'): TacFunction {
  const fn = tac.functions.find((f) => f.name === name);
  if (!fn) throw new Error(`no function ${name}`);
  return fn;
}

/** All trace-step citations of one translation, as "section|rule" pairs. */
function cites(src: string): Array<{ section: string; rule: string }> {
  const c = compile(src);
  const { trace } = runIrGen(c.ast!, c.semantic!);
  return trace.steps.map((s) => ({
    section: s.meta.cite.section,
    rule: s.meta.cite.rule ?? '',
  }));
}

describe('triples: a multiply-defined temporary is not referenced by position (§6.2.3/§6.6.6)', () => {
  const src = 'int main(){ int a; int b; int x; x = a && b; return x; }';

  it('the boolean 1/0 exits write a named temporary, and the store reads that name', () => {
    const fn = fnOf(tacOf(src));
    // the generator materializes the boolean value into ONE temporary from two
    // different quads — that is the situation the view must survive
    expect(fn.quads.map(formatQuad)).toEqual([
      'if a goto L1',
      'goto L3',
      'L1:',
      'if b goto L2',
      'goto L3',
      'L2:',
      't1 = 1',
      'goto L4',
      'L3:',
      't1 = 0',
      'L4:',
      'x = t1',
      'return x',
    ]);

    const rows = toTriples(fn);
    const byQuad = (i: number) => rows.filter((r) => r.quadIndex === i);
    // both exits are explicit "=" rows into the NAME t1 …
    expect(byQuad(6).map((r) => [r.op, r.arg1, r.arg2])).toEqual([['=', 't1', '1']]);
    expect(byQuad(9).map((r) => [r.op, r.arg1, r.arg2])).toEqual([['=', 't1', '0']]);
    // … and the store into x reads the name, never one branch's row position
    expect(byQuad(11).map((r) => [r.op, r.arg1, r.arg2])).toEqual([['=', 'x', 't1']]);
    for (const r of rows) {
      expect(r.arg2).not.toBe('(9)');
    }
  });

  it('the indirect-triple listing inherits the same rows', () => {
    const fn = fnOf(tacOf(src));
    const view = toIndirectTriples(fn);
    expect(view.order).toEqual(view.triples.map((t) => t.index));
    const store = view.triples.find((r) => r.op === '=' && r.arg1 === 'x');
    expect(store?.arg2).toBe('t1');
  });

  it('a singly-defined temporary is still referenced by position', () => {
    const fn = fnOf(tacOf('int main(){ int a; int b; int x; x = a + b; return x; }'));
    const rows = toTriples(fn).map((r) => [r.op, r.arg1, r.arg2]);
    expect(rows).toContainEqual(['+', 'a', 'b']);
    expect(rows).toContainEqual(['=', 'x', '(0)']);
  });
});

describe('citations point at the section that defines the rule', () => {
  const pointerSrc =
    'int main(){ int x; int *p; p = &x; *p = 3; x = *p; return x; }';
  const arraySrc = 'int main(){ int a[10]; int i; a[i] = a[i] + 1; return 0; }';

  it('x = &y / x = *y / *x = y cite §6.2.1 (Addresses and Instructions), never §6.2.2', () => {
    const all = cites(pointerSrc);
    const pointerForms = all.filter((c) => /x = &y|x = \*y|\*x = y/.test(c.rule));
    expect(pointerForms.length).toBeGreaterThan(0);
    for (const c of pointerForms) expect(c.section).toBe('6.2.1');
    // §6.2.2 is about the quadruple representation and cites nothing here
    expect(all.some((c) => c.section === '6.2.2')).toBe(false);
  });

  it('array-decay and pointer-element loads cite §6.2.1 too', () => {
    const all = cites('int f(int *p){ return p[1]; } int main(){ int a[4]; return f(a); }');
    for (const c of all.filter((x) => /x = &y|x = \*y|\*x = y/.test(x.rule))) {
      expect(c.section).toBe('6.2.1');
    }
    expect(all.some((c) => c.section === '6.2.2')).toBe(false);
  });

  it('Fig 6.22 rules cite §6.4.4, while the bare address formula stays §6.4.3', () => {
    const c = compile(arraySrc);
    const { trace } = runIrGen(c.ast!, c.semantic!);
    const figRows = trace.steps.filter((s) => s.meta.cite.figureOrAlgo === 'Fig 6.22');
    expect(figRows.length).toBeGreaterThan(0);
    for (const s of figRows) expect(s.meta.cite.section).toBe('6.4.4');
    const formula = trace.steps.filter((s) => (s.meta.cite.rule ?? '').includes('base + i × w'));
    for (const s of formula) {
      expect(s.meta.cite.section).toBe('6.4.3');
      expect(s.meta.cite.figureOrAlgo).toBeUndefined();
    }
  });
});

describe('a void call in value-free position takes the `call p, n` form (§6.9)', () => {
  it('for-init and for-update void calls get no result temporary', () => {
    const fn = fnOf(tacOf('void v(){} int main(){ for (v(); 0; v()) ; return 0; }'));
    expect(fn.quads.map(formatQuad)).toEqual([
      'call v, 0',
      'L1:',
      'goto L3',
      'L2:',
      'call v, 0',
      'goto L1',
      'L3:',
      'return 0',
    ]);
    expect(fn.tempCount).toBe(0);
  });

  it('a non-void call in a for clause still computes into a temporary', () => {
    const fn = fnOf(tacOf('int g(){ return 1; } int main(){ for (g(); 0; g()) ; return 0; }'));
    expect(fn.quads.map(formatQuad)).toContain('t1 = call g, 0');
    expect(fn.tempCount).toBe(2);
  });
});

describe('float constants render as floats (§6.5.2 readability)', () => {
  it('f = 1.0 keeps its fractional part', () => {
    const fn = fnOf(tacOf('int main(){ float f; f = 1.0; return 0; }'));
    expect(fn.quads.map(formatQuad)).toContain('f = 1.0');
  });

  it('an integral float constant in an expression is not printed as an int', () => {
    const fn = fnOf(tacOf('int main(){ float a[10]; int i; a[i] = a[i] + 1.0; return 0; }'));
    expect(fn.quads.map(formatQuad)).toContain('t4 = t3 + 1.0');
    // the int index scaling is still an int constant
    expect(fn.quads.map(formatQuad)).toContain('t1 = i * 8');
  });

  it('the triple view renders float constants the same way', () => {
    const fn = fnOf(tacOf('int main(){ float f; f = 2.0; return 0; }'));
    expect(toTriples(fn).map((r) => [r.op, r.arg1, r.arg2])).toContainEqual(['=', 'f', '2.0']);
  });
});

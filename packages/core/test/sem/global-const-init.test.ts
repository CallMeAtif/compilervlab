/**
 * The static-initializer rule for globals.
 *
 * A global has static storage duration: it is laid out in the data area and
 * already holds its value when execution begins (§7.1 "static allocation"), so
 * its initializer must be computable at compile time. Accepting one silently
 * and then dropping it — the regression this file guards, together with
 * test/ir/global-init.test.ts — made `int g = 7;` compute 0.
 */
import { describe, expect, it } from 'vitest';
import { compile } from '../../src/compile.js';
import { RULE } from '../../src/sem/sem-events.js';

function errors(src: string) {
  return compile(src).diagnostics.filter((d) => d.severity === 'error');
}

describe('a global initializer must be a constant expression (§7.1)', () => {
  it.each([
    ['int g = 7; int main(){ return g; }', 'a literal'],
    ['int g = -7; int main(){ return g; }', 'unary minus'],
    ['int g = 2 * 3 + 1; int main(){ return g; }', 'arithmetic on literals'],
    ['char c = 65; int main(){ return c; }', 'a char global'],
    ['float f = 1.5; int main(){ return 0; }', 'a float global'],
    ['int g = 1 < 2; int main(){ return g; }', 'a relational constant'],
  ])('accepts %s (%s)', (src) => {
    expect(errors(src)).toEqual([]);
  });

  it.each([
    ['int a = 1; int b = a; int main(){ return b; }', 'another global'],
    ['int f(){ return 1; } int g = f(); int main(){ return g; }', 'a call'],
    ['int a[3]; int g = a[0]; int main(){ return g; }', 'an array element'],
    ['int g = 1 / 0; int main(){ return g; }', 'division by zero'],
  ])('rejects an initializer built from %s (%s)', (src) => {
    const es = errors(src);
    expect(es.length).toBe(1);
    expect(es[0]?.phase).toBe('semantic');
    expect(es[0]?.message).toContain('must be a constant expression');
    expect(es[0]?.rule).toBe(RULE.globalConstInit);
  });

  it('a local initializer may be any expression — the rule is about static storage', () => {
    expect(errors('int a = 1; int main(){ int b = a + 1; return b; }')).toEqual([]);
  });
});

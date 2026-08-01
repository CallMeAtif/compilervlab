/**
 * Global variable initializers (`int g = 7;`).
 *
 * A global has static storage duration: it is laid out in the static data area
 * and already holds its initial value when execution begins (§7.1 "static
 * allocation"), so the translation must carry that value into the program —
 * never drop it. The regression these tests guard is exactly that drop: the
 * initializer was type-checked, then silently discarded, so `int g = 7; int
 * main(){ return g; }` computed 0 with no diagnostic.
 */
import { describe, expect, it } from 'vitest';
import { checkTraceInvariants } from '@lab/trace';
import { compile } from '../../src/compile.js';
import { runIrGen } from '../../src/ir/gen.js';
import { irGenReducer, projectIrGenState } from '../../src/ir/ir-events.js';
import { runTac } from '../../src/interp/tac.js';
import { runAsm } from '../../src/interp/asm.js';

describe('initialized globals reach the program (§7.1 static allocation)', () => {
  it('int g = 7; int main(){ return g; } returns 7, with no diagnostic', () => {
    const c = compile('int g = 7; int main(){ return g; }');
    expect(c.diagnostics).toEqual([]);
    const tac = c.tac!;
    expect(tac.globalInits).toEqual([
      { symbolId: tac.globals[0], name: 'g', value: 7, ctype: 'int' },
    ]);
    expect(runTac(tac).returnValue).toBe(7);
  });

  it('several initialized globals all reach the data area', () => {
    const c = compile('int a = 1; int b = 2; int main(){ return a + b; }');
    expect(c.diagnostics).toEqual([]);
    expect(c.tac!.globalInits?.map((g) => [g.name, g.value])).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
    expect(runTac(c.tac!).returnValue).toBe(3);
  });

  it('a constant-expression initializer is folded at compile time', () => {
    const c = compile('int g = 2 * 3 + 1; int main(){ return g; }');
    expect(c.diagnostics).toEqual([]);
    expect(c.tac!.globalInits?.[0]?.value).toBe(7);
    expect(runTac(c.tac!).returnValue).toBe(7);
  });

  it('a float global keeps its float value and float tag', () => {
    const c = compile(
      'float g = 1.5; int main(){ float x; x = g + g; if (x > 2.9) { return 1; } return 0; }',
    );
    expect(c.diagnostics).toEqual([]);
    expect(c.tac!.globalInits?.[0]).toEqual({
      symbolId: c.tac!.globals[0],
      name: 'g',
      value: 1.5,
      ctype: 'float',
    });
    expect(runTac(c.tac!).returnValue).toBe(1);
  });

  it('an uninitialized global still starts at 0 (and gets no init entry)', () => {
    const c = compile('int g; int main(){ return g; }');
    expect(c.tac!.globalInits ?? []).toEqual([]);
    expect(runTac(c.tac!).returnValue).toBe(0);
  });

  it('a non-constant global initializer is a semantic error, not silent code', () => {
    const c = compile('int a = 1; int b = a + 1; int main(){ return b; }');
    expect(
      c.diagnostics.filter((d) => d.severity === 'error' && d.phase === 'semantic').length,
    ).toBe(1);
    expect(c.diagnostics[0]?.message).toContain('must be a constant expression');
  });

  it('optimization preserves the initial values', () => {
    const c = compile('int g = 7; int main(){ return g; }');
    expect(runTac(c.optimized!.input).returnValue).toBe(7);
    expect(runTac(c.optimized!.output).returnValue).toBe(7);
    for (const p of c.optimized!.passes) {
      expect(runTac(p.after).returnValue).toBe(7);
    }
  });

  it('the replayed trace state matches the returned program (initial values included)', () => {
    const c = compile('int g = 7; float h = 1.5; int main(){ return g; }');
    const recorded = runIrGen(c.ast!, c.semantic!);
    expect(checkTraceInvariants(recorded, irGenReducer, projectIrGenState)).toEqual([]);
    expect(recorded.trace.final().globalInits).toEqual(recorded.result.globalInits);
  });

  it('the emitted assembly initializes the data cell, and running it yields 7', () => {
    const c = compile('int g = 7; int main(){ return g; }');
    const text = c.asm!.lines.map((l) => l.text);
    // an initialized global is laid down in the data section, not reserved as
    // zero-filled .comm storage
    expect(text).not.toContain('.comm g, 8');
    expect(text).toContain('g:');
    expect(text).toContain('.quad 7');
    expect(runAsm(c.asm!).returnValue).toBe(7);
  });
});

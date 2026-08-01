/**
 * Golden test: f(a,b,c){ t1=a+b; t2=t1*c; return t2; } must produce exactly
 * the expected AT&T assembly (deterministic tiling §8.9.2/§8.6, Kempe
 * coloring §8.8.4, frame/callee-save prologue §8.3.2).
 */
import { describe, expect, it } from 'vitest';
import { codegen } from '../../src/codegen/emit.js';
import type { AsmLine } from '../../src/codegen/types.js';
import {
  arrayPointerAgreementProgram,
  callProgram,
  crossCallProgram,
  fnAbcProgram,
  frameArrayProgram,
  gcdProgram,
} from './fixtures.js';

describe('codegen golden: f(a,b,c) = (a+b)*c', () => {
  const art = codegen(fnAbcProgram());

  it('produces no diagnostics', () => {
    expect(art.diagnostics).toEqual([]);
  });

  it('emits exactly the expected assembly text', () => {
    expect(art.asm.lines.map((l) => l.text)).toEqual([
      '# Lab x86-64 subset (AT&T syntax). int/char are treated as 64-bit for simplicity.',
      '.text',
      '.globl main',
      'f:',
      'pushq %rbp',
      'movq %rsp, %rbp',
      'pushq %rbx',
      'pushq %rcx',
      'movq %rdi, %rbx',
      'movq %rdx, %rcx',
      'addq %rsi, %rbx',
      'imulq %rcx, %rbx',
      'movq %rbx, %rax',
      'jmp .Lf_ret',
      '.Lf_ret:',
      'popq %rcx',
      'popq %rbx',
      'movq %rbp, %rsp',
      'popq %rbp',
      'ret',
    ]);
  });

  it('assigns the book-faithful colors (lowest-numbered free register)', () => {
    const a = art.registers[0]!;
    expect(a.functionName).toBe('f');
    expect(a.spilled).toEqual([]);
    expect(a.assignment).toEqual({
      a: { reg: '%rbx' },
      b: { reg: '%rsi' },
      c: { reg: '%rcx' },
      t1: { reg: '%rbx' },
      t2: { reg: '%rbx' },
    });
  });

  it('builds the expected interference graph (edges a<b, nodes sorted)', () => {
    const g = art.interferenceGraphs[0]!;
    expect(g.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c', 't1', 't2']);
    expect(g.edges).toEqual([
      { a: 'a', b: 'b' },
      { a: 'a', b: 'c' },
      { a: 'b', b: 'c' },
      { a: 'b', b: 't1' },
      { a: 'c', b: 't1' },
      { a: 'c', b: 't2' },
    ]);
  });

  it('records tacIndex provenance on every body instruction', () => {
    const body = art.asm.lines.filter((l) => l.functionName === 'f' && l.tacIndex !== null);
    expect(body.length).toBeGreaterThan(0);
    for (const l of body) {
      expect(l.tacIndex).toBeGreaterThanOrEqual(0);
      expect(l.tacIndex).toBeLessThan(3);
    }
    // the addq comes from quad 0, the imulq from quad 1, the return jump from quad 2
    expect(art.asm.lines.find((l) => l.text.startsWith('addq'))!.tacIndex).toBe(0);
    expect(art.asm.lines.find((l) => l.text.startsWith('imulq'))!.tacIndex).toBe(1);
    expect(art.asm.lines.find((l) => l.text.startsWith('jmp'))!.tacIndex).toBe(2);
  });
});

/**
 * The prologue claims real x86-64 conventions, so %rsp must be ≡ 0 (mod 16) at
 * every `call`. Walk the emitted text and re-derive %rsp: a function is entered
 * with the caller's return address on the stack (%rsp ≡ 8), `pushq %rbp` makes
 * it 16-aligned again, and the frame allocation plus the callee-save pushes
 * must not break that.
 */
function callSiteOffsets(lines: AsmLine[]): Array<{ fn: string; rsp: number }> {
  const calls: Array<{ fn: string; rsp: number }> = [];
  let fnName = '';
  let rsp = 0; // bytes pushed since the caller's 16-aligned %rsp
  for (const l of lines) {
    if (l.kind === 'label' && !l.text.startsWith('.')) {
      fnName = l.text.replace(/:$/, '');
      rsp = 8; // the `call` that got us here pushed the return address
      continue;
    }
    if (l.kind !== 'instr') continue;
    const sub = /^subq \$(\d+), %rsp$/.exec(l.text);
    const add = /^addq \$(\d+), %rsp$/.exec(l.text);
    if (l.text.startsWith('pushq ')) rsp += 8;
    else if (l.text.startsWith('popq ')) rsp -= 8;
    else if (sub) rsp += Number(sub[1]);
    else if (add) rsp -= Number(add[1]);
    else if (l.text === 'movq %rbp, %rsp') rsp = 16; // return address + saved %rbp
    else if (l.text.startsWith('call ')) calls.push({ fn: fnName, rsp });
  }
  return calls;
}

/** Callee-save pushes of each function (the `pushq %rbp` of the prologue excluded). */
function calleeSavePushes(lines: AsmLine[]): Map<string, number> {
  const counts = new Map<string, number>();
  let fnName = '';
  for (const l of lines) {
    if (l.kind === 'label' && !l.text.startsWith('.')) {
      fnName = l.text.replace(/:$/, '');
      counts.set(fnName, 0);
      continue;
    }
    if (l.kind === 'instr' && l.text.startsWith('pushq ') && l.text !== 'pushq %rbp') {
      counts.set(fnName, (counts.get(fnName) ?? 0) + 1);
    }
  }
  return counts;
}

describe('§8.3.2 activation record: %rsp is 16-byte aligned at every call site', () => {
  const fixtures: Array<[string, () => Parameters<typeof codegen>]> = [
    ['call', () => [callProgram(), undefined]],
    ['gcd', () => [gcdProgram(), undefined]],
    ['cross-call', () => [crossCallProgram(), undefined]],
    ['frame array', () => { const f = frameArrayProgram(); return [f.program, f.symbols]; }],
    ['array/pointer', () => { const f = arrayPointerAgreementProgram(); return [f.program, f.symbols]; }],
  ];

  for (const [name, mk] of fixtures) {
    it(`${name}: every call sees %rsp ≡ 0 (mod 16)`, () => {
      const [program, symbols] = mk();
      const { asm } = codegen(program, symbols);
      const calls = callSiteOffsets(asm.lines);
      expect(calls.length).toBeGreaterThan(0);
      for (const c of calls) expect([c.fn, c.rsp % 16]).toEqual([c.fn, 0]);
    });
  }

  it('the check is meaningful: some function saves an ODD number of registers', () => {
    // An odd callee-save count is what used to leave %rsp ≡ 8 (mod 16) at the
    // call, because the pushes came after an already-16-aligned subq.
    const odd = fixtures.flatMap(([, mk]) => {
      const [program, symbols] = mk();
      const { asm } = codegen(program, symbols);
      return [...calleeSavePushes(asm.lines).values()].filter((n) => n % 2 === 1);
    });
    expect(odd.length).toBeGreaterThan(0);
  });
});

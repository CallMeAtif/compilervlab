/**
 * Interpreter for EXACTLY the x86-64 subset codegen emits (§8.2.1 target-
 * machine model): movq, addq, subq, imulq, cqto, idivq, cmpq, the jcc set,
 * jmp, call/ret (lab convention: args in %rdi…%r9 / %xmm0…, result in %rax /
 * %xmm0, callee saves what it writes), pushq/popq, leaq for frame math, and
 * the float path movsd/addsd/subsd/mulsd/divsd/cvtsi2sdq/ucomisd.
 *
 * Machine model: registers and 8-byte memory cells hold JS numbers (the lab's
 * int/char are 64-bit without overflow modeling, float is IEEE double);
 * `.comm`-declared globals, initialized globals (`.quad` / `.double` under
 * their label) and `.double` pool entries live in a static data area; the stack
 * grows down from a fixed top. Execution is step-limited.
 */

import type { Recorded, Reducer, Steps, StepMeta } from '@lab/trace';
import { record } from '@lab/trace';
import type { AsmLine, AsmProgram } from '../codegen/types.js';
import type { AsmExecEvent, AsmRunResult } from '../codegen/cg-events.js';
import { drainSteps } from '../codegen/cg-events.js';

export type { AsmExecEvent, AsmRunResult } from '../codegen/cg-events.js';

function cite(rule?: string): StepMeta['cite'] {
  const c: StepMeta['cite'] = { section: '8.2.1' };
  if (rule !== undefined) c.rule = rule;
  return c;
}

// ---------------------------------------------------------------------------
// Parsing (AT&T syntax, exactly the emitted forms)
// ---------------------------------------------------------------------------

type Op =
  | { t: 'imm'; v: number }
  | { t: 'reg'; r: string }
  | { t: 'mem'; base: string | null; index: string | null; scale: number; offset: number; sym: string | null }
  | { t: 'lab'; name: string };

interface Parsed {
  mnemonic: string;
  ops: Op[];
}

function splitOperands(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim().length > 0) out.push(cur.trim());
  return out;
}

function parseOperand(s: string, where: string): Op {
  const immM = /^\$(-?\d+)$/.exec(s);
  if (immM) return { t: 'imm', v: Number(immM[1]) };
  if (/^%[a-z0-9]+$/.test(s)) return { t: 'reg', r: s };
  const symM = /^([A-Za-z_.][\w.$@]*)\(%rip\)$/.exec(s);
  if (symM) return { t: 'mem', base: null, index: null, scale: 1, offset: 0, sym: symM[1]! };
  const memM = /^(-?\d+)?\((.*)\)$/.exec(s);
  if (memM) {
    const inner = (memM[2] ?? '').split(',').map((x) => x.trim());
    const base = inner[0] && inner[0].length > 0 ? inner[0] : null;
    const index = inner[1] && inner[1].length > 0 ? inner[1] : null;
    const scale = inner[2] && inner[2].length > 0 ? Number(inner[2]) : 1;
    return { t: 'mem', base, index, scale, offset: memM[1] !== undefined ? Number(memM[1]) : 0, sym: null };
  }
  if (/^[A-Za-z_.][\w.$@]*$/.test(s)) return { t: 'lab', name: s };
  throw new AsmParseError(`cannot parse operand '${s}' in ${where}`);
}

export class AsmParseError extends Error {}

function parseInstr(text: string): Parsed {
  const m = /^(\S+)(?:\s+(.*))?$/.exec(text.trim());
  if (!m) throw new AsmParseError(`cannot parse instruction '${text}'`);
  const mnemonic = m[1]!;
  const ops = m[2] !== undefined ? splitOperands(m[2]).map((s) => parseOperand(s, text)) : [];
  return { mnemonic, ops };
}

// ---------------------------------------------------------------------------
// Machine state
// ---------------------------------------------------------------------------

const STACK_TOP = 0x7ff00000;
const DATA_BASE = 0x1000;
const RET_SENTINEL = -1;

const JCC: Record<string, (d: number) => boolean> = {
  je: (d) => d === 0,
  jne: (d) => d !== 0,
  jl: (d) => d < 0,
  jle: (d) => d <= 0,
  jg: (d) => d > 0,
  jge: (d) => d >= 0,
  jb: (d) => d < 0,
  jbe: (d) => d <= 0,
  ja: (d) => d > 0,
  jae: (d) => d >= 0,
};

export interface AsmRunOptions {
  stepLimit?: number;
}

class Machine {
  regs = new Map<string, number>();
  mem = new Map<number, number>();
  flags: number | null = null; // last comparison difference (dst − src)
  dataAddr = new Map<string, number>();

  getReg(r: string): number {
    return this.regs.get(r) ?? 0;
  }
  setReg(r: string, v: number): void {
    this.regs.set(r, v);
  }
  load(a: number): number {
    return this.mem.get(a) ?? 0;
  }
  store(a: number, v: number): void {
    this.mem.set(a, v);
  }
  ea(o: Op): number {
    if (o.t !== 'mem') throw new AsmParseError('effective address of non-memory operand');
    if (o.sym !== null) {
      const a = this.dataAddr.get(o.sym);
      if (a === undefined) throw new AsmParseError(`unknown data symbol '${o.sym}'`);
      return a + o.offset;
    }
    let a = o.offset;
    if (o.base !== null) a += this.getReg(o.base);
    if (o.index !== null) a += this.getReg(o.index) * o.scale;
    return a;
  }
  value(o: Op): number {
    switch (o.t) {
      case 'imm':
        return o.v;
      case 'reg':
        return this.getReg(o.r);
      case 'mem':
        return this.load(this.ea(o));
      case 'lab':
        throw new AsmParseError('label used as a value');
    }
  }
  write(o: Op, v: number): void {
    if (o.t === 'reg') this.setReg(o.r, v);
    else if (o.t === 'mem') this.store(this.ea(o), v);
    else throw new AsmParseError('write to non-writable operand');
  }
}

// ---------------------------------------------------------------------------
// The traced interpreter
// ---------------------------------------------------------------------------

export function* execute(program: AsmProgram, opts?: AsmRunOptions): Steps<AsmExecEvent, AsmRunResult> {
  const stepLimit = opts?.stepLimit ?? 1_000_000;
  const lines = program.lines;

  // Pre-pass: label positions and static data.
  const labelAt = new Map<string, number>();
  const m = new Machine();
  let dataPtr = DATA_BASE;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.kind === 'label') {
      const name = l.text.replace(/:\s*$/, '');
      labelAt.set(name, i);
      const next = lines[i + 1];
      if (next && next.kind === 'directive') {
        // `.double v` (pooled float constant) and `.quad v` (initialized global)
        // both lay one initialized 8-byte cell down in the data area.
        const dm = /^\.(?:double|quad)\s+(-?[\d.eE+-]+)$/.exec(next.text.trim());
        if (dm) {
          m.dataAddr.set(name, dataPtr);
          m.store(dataPtr, Number(dm[1]));
          dataPtr += 8;
        }
      }
    } else if (l.kind === 'directive') {
      const cm = /^\.comm\s+([\w.$@]+)\s*,\s*(\d+)$/.exec(l.text.trim());
      if (cm) {
        const size = Number(cm[2]);
        m.dataAddr.set(cm[1]!, dataPtr);
        for (let off = 0; off < size; off += 8) m.store(dataPtr + off, 0);
        dataPtr += Math.max(8, size);
      }
    }
  }

  const finish = function* (
    returnValue: number | null,
    steps: number,
    error: string | null,
  ): Steps<AsmExecEvent, AsmRunResult> {
    yield [
      { kind: 'halt', returnValue, steps, error },
      {
        cite: cite('execution ends when control returns from the entry procedure'),
        prose: error === null
          ? `Program halted normally after ${steps} step(s); main returned ${returnValue} (%rax).`
          : `Program halted after ${steps} step(s) with a runtime error: ${error}.`,
        level: 'macro',
        section: 'Halt',
      },
    ];
    return { returnValue, steps, error };
  };

  const mainAt = labelAt.get('main');
  if (mainAt === undefined) {
    return yield* finish(null, 0, "no 'main' label in the program");
  }

  // Boot: push the sentinel return address and enter main.
  m.setReg('%rsp', STACK_TOP);
  m.setReg('%rsp', m.getReg('%rsp') - 8);
  m.store(m.getReg('%rsp'), RET_SENTINEL);
  let pc = mainAt;
  let steps = 0;

  const parsedCache = new Map<number, Parsed>();

  while (true) {
    if (pc < 0 || pc >= lines.length) {
      return yield* finish(null, steps, `control fell outside the program (pc=${pc})`);
    }
    const l = lines[pc]!;
    if (l.kind === 'label' || l.kind === 'directive' || l.text.startsWith('#')) {
      // .data section entered ⇒ running past the last ret
      if (
        l.kind === 'directive' &&
        (l.text === '.data' || l.text.startsWith('.double') || l.text.startsWith('.quad'))
      ) {
        return yield* finish(null, steps, 'control fell into the data section');
      }
      pc++;
      continue;
    }
    if (steps >= stepLimit) {
      return yield* finish(null, steps, `step limit of ${stepLimit} exceeded`);
    }
    let p = parsedCache.get(pc);
    if (p === undefined) {
      p = parseInstr(l.text);
      parsedCache.set(pc, p);
    }
    steps++;
    let nextPc = pc + 1;
    let err: string | null = null;

    const src = p.ops[0];
    const dst = p.ops[p.ops.length - 1];
    switch (p.mnemonic) {
      case 'movq':
      case 'movsd':
        m.write(dst!, m.value(src!));
        break;
      case 'addq':
      case 'addsd':
        m.write(dst!, m.value(dst!) + m.value(src!));
        break;
      case 'subq':
      case 'subsd':
        m.write(dst!, m.value(dst!) - m.value(src!));
        break;
      case 'imulq':
      case 'mulsd':
        m.write(dst!, m.value(dst!) * m.value(src!));
        break;
      case 'divsd':
        m.write(dst!, m.value(dst!) / m.value(src!)); // IEEE semantics for floats
        break;
      case 'cvtsi2sdq':
        m.write(dst!, m.value(src!));
        break;
      case 'leaq':
        m.write(dst!, m.ea(src!));
        break;
      case 'cqto':
        m.setReg('%rdx', m.getReg('%rax') < 0 ? -1 : 0);
        break;
      case 'idivq': {
        const v = m.value(src!);
        if (v === 0) {
          err = 'division by zero';
          break;
        }
        const rax = m.getReg('%rax');
        const q = Math.trunc(rax / v);
        m.setReg('%rax', q);
        m.setReg('%rdx', rax - q * v);
        break;
      }
      case 'cmpq':
      case 'ucomisd':
        m.flags = m.value(dst!) - m.value(src!);
        break;
      case 'jmp': {
        const t = labelAt.get((src as { name: string }).name);
        if (t === undefined) err = `jump to unknown label '${(src as { name: string }).name}'`;
        else nextPc = t;
        break;
      }
      case 'call': {
        const t = labelAt.get((src as { name: string }).name);
        if (t === undefined) {
          err = `call to unknown function '${(src as { name: string }).name}'`;
          break;
        }
        m.setReg('%rsp', m.getReg('%rsp') - 8);
        m.store(m.getReg('%rsp'), pc + 1);
        nextPc = t;
        break;
      }
      case 'ret': {
        const ra = m.load(m.getReg('%rsp'));
        m.setReg('%rsp', m.getReg('%rsp') + 8);
        if (ra === RET_SENTINEL) {
          yield [
            { kind: 'exec', pc, text: l.text, steps },
            {
              cite: cite('one instruction executes at a time; ret pops the return address'),
              prose: `Execute '${l.text}' — return from main.`,
              level: 'micro',
              groupId: 'exec',
              section: 'Execution',
            },
          ];
          return yield* finish(m.getReg('%rax'), steps, null);
        }
        nextPc = ra;
        break;
      }
      case 'pushq':
        m.setReg('%rsp', m.getReg('%rsp') - 8);
        m.store(m.getReg('%rsp'), m.value(src!));
        break;
      case 'popq':
        m.write(src!, m.load(m.getReg('%rsp')));
        m.setReg('%rsp', m.getReg('%rsp') + 8);
        break;
      default: {
        const cond = JCC[p.mnemonic];
        if (cond !== undefined) {
          if (m.flags === null) {
            err = `conditional jump '${p.mnemonic}' with no preceding comparison`;
          } else if (cond(m.flags)) {
            const t = labelAt.get((src as { name: string }).name);
            if (t === undefined) err = `jump to unknown label '${(src as { name: string }).name}'`;
            else nextPc = t;
          }
        } else {
          err = `unknown mnemonic '${p.mnemonic}' (not in the emitted subset)`;
        }
      }
    }

    yield [
      { kind: 'exec', pc, text: l.text, steps },
      {
        cite: cite('the target machine executes one instruction at a time, updating registers and memory'),
        prose: `Execute '${l.text}'.`,
        level: p.mnemonic === 'call' || p.mnemonic === 'ret' ? 'macro' : 'micro',
        groupId: 'exec',
        section: 'Execution',
      },
    ];
    if (err !== null) {
      return yield* finish(null, steps, err);
    }
    pc = nextPc;
  }
}

// ---------------------------------------------------------------------------
// UI state + reducer
// ---------------------------------------------------------------------------

export interface AsmExecState {
  steps: number;
  halted: boolean;
  returnValue: number | null;
  error: string | null;
}

export function initialAsmExecState(): AsmExecState {
  return { steps: 0, halted: false, returnValue: null, error: null };
}

export const asmExecReducer: Reducer<AsmExecState, AsmExecEvent> = (s, e) => {
  switch (e.kind) {
    case 'exec':
      return { ...s, steps: e.steps };
    case 'halt':
      return { steps: e.steps, halted: true, returnValue: e.returnValue, error: e.error };
  }
};

export function projectAsmRun(r: AsmRunResult): AsmExecState {
  return { steps: r.steps, halted: true, returnValue: r.returnValue, error: r.error };
}

/** Run the program untraced (the semantic-equivalence oracle). */
export function runAsm(program: AsmProgram, opts?: AsmRunOptions): AsmRunResult {
  return drainSteps(execute(program, opts));
}

/** Convenience: record an execution trace. */
export function runAsmTraced(
  program: AsmProgram,
  opts?: AsmRunOptions,
  id = 'interp.asm',
): Recorded<AsmExecState, AsmExecEvent, AsmRunResult> {
  return record(() => execute(program, opts), initialAsmExecState(), asmExecReducer, { id });
}

export type { AsmLine };

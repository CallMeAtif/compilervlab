/**
 * Instruction selection — maximal-munch tiling of quads (the tree-pattern
 * flavor of §8.9 simplified to quad-at-a-time tiles). Each quad matches one
 * tile that expands to x86-64 instructions (AT&T syntax) over virtual
 * registers: temps tN and scalar locals are pseudo-registers; arrays and
 * address-taken scalars live on the %rbp stack frame; globals are rip-relative.
 *
 * Calling convention (our own, stated honestly): the first six integer
 * arguments go in %rdi, %rsi, %rdx, %rcx, %r8, %r9 (float arguments in
 * %xmm0…%xmm7 by float-argument position); the result returns in %rax
 * (%xmm0 for float); every general-purpose register a function writes is
 * callee-saved in its prologue. int/char are treated as 64-bit throughout.
 *
 * Division uses the machine idiom cqto + idivq with %rax/%rdx reserved as
 * scratch (they are never allocatable — see GP_REGISTERS).
 *
 * Floats are OUT of scope for register allocation (§8.8.4 colors the GP
 * registers only), and "out of scope" is implemented honestly: every float
 * value gets its own frame slot and each float instruction is expanded in the
 * style of the simple code generator of §8.6 — read the operands from memory,
 * compute in the reserved SSE scratch register %xmm8, write the result back.
 * No float value is ever live in an SSE register across an instruction
 * boundary, so nothing can collide with the pinned %xmm0 argument/return
 * register or with another float value. %xmm0…%xmm7 are used only to pass and
 * return float arguments.
 */

import type { Recorded, Reducer, Steps, StepMeta } from '@lab/trace';
import { record } from '@lab/trace';
import type { Diagnostic } from '../common/types.js';
import type { Quad, TacFunction, TacOperand, TacProgram } from '../ir/types.js';
import { formatQuad } from '../ir/types.js';
import type { SymbolEntry, CType } from '../sem/types.js';
import type { RaNode } from './types.js';
import type {
  FrameSlot,
  GlobalDatum,
  IselEvent,
  IselResult,
  VFunction,
  VInstr,
  VOperand,
} from './cg-events.js';
import { cmpName } from './cg-events.js';

export type { GlobalDatum, IselEvent, IselResult, VFunction, VInstr, VOperand } from './cg-events.js';

/** Integer argument registers of the lab convention, in order. */
export const ARG_GP_REGISTERS = ['%rdi', '%rsi', '%rdx', '%rcx', '%r8', '%r9'] as const;

/**
 * The single SSE register reserved as scratch for the float path — the
 * counterpart of %rax/%rdx on the GP side. It is never an argument or return
 * register (those are %xmm0…%xmm7), and no value ever stays in it across an
 * instruction, so it needs neither allocation nor saving.
 */
export const SSE_SCRATCH = '%xmm8';

const DUMMY_SPAN = { start: 0, end: 0, line: 1, col: 1 };

function cite(section: string, rule?: string, figureOrAlgo?: string): StepMeta['cite'] {
  const c: StepMeta['cite'] = { section };
  if (figureOrAlgo !== undefined) c.figureOrAlgo = figureOrAlgo;
  if (rule !== undefined) c.rule = rule;
  return c;
}

// ---------------------------------------------------------------------------
// Operand helpers
// ---------------------------------------------------------------------------

const pseudo = (name: string): Extract<VOperand, { k: 'pseudo' }> => ({ k: 'pseudo', name });
const phys = (reg: string): Extract<VOperand, { k: 'phys' }> => ({ k: 'phys', reg });
const imm = (value: number): VOperand => ({ k: 'imm', value });
const lab = (name: string): VOperand => ({ k: 'lab', name });
const rbpMem = (offset: number): VOperand => ({ k: 'mem', base: '%rbp', offset });
const symMem = (sym: string): VOperand => ({ k: 'mem', base: null, offset: 0, sym });

function sameName(a: VOperand, b: VOperand): boolean {
  return a.k === 'pseudo' && b.k === 'pseudo' && a.name === b.name;
}

const CC_INT: Record<string, string> = {
  '==': 'je', '!=': 'jne', '<': 'jl', '<=': 'jle', '>': 'jg', '>=': 'jge',
};
const CC_FLOAT: Record<string, string> = {
  '==': 'je', '!=': 'jne', '<': 'jb', '<=': 'jbe', '>': 'ja', '>=': 'jae',
};

// ---------------------------------------------------------------------------
// Per-function selection context
// ---------------------------------------------------------------------------

interface ProgCtx {
  symbolsById: Map<number, SymbolEntry>;
  globalIds: Set<number>;
  /** value → label; pooled program-wide in first-use order. */
  floatConstPool: Map<number, string>;
  newFloatConsts: Array<{ label: string; value: number }>; // pending events
  floatConsts: Array<{ label: string; value: number }>;
  newDiagnostics: Diagnostic[]; // pending events
  diagnostics: Diagnostic[];
}

interface FnCtx {
  prog: ProgCtx;
  fn: TacFunction;
  name: string;
  varPseudo: Map<number, string>; // non-global symbolId → pseudo name
  frameBySym: Map<number, FrameSlot>; // frame-resident vars (arrays, addr-taken)
  arraySyms: Set<number>; // frame arrays (locals with array type)
  globalArraySyms: Set<number>;
  frame: FrameSlot[];
  frameSize: number;
  floatTemps: Set<number>;
  floatVars: Set<number>; // symbolIds
  floatNames: Set<string>; // float pseudo names (incl. fresh float temps)
  floatOrder: string[]; // first-creation order
  floatSlot: Map<string, VOperand>; // float pseudo → its frame slot (lazy)
  pseudoKind: Map<string, 'temp' | 'var'>;
  tempCounter: number;
  labelCounter: number;
  pendingInt: number;
  pendingFloat: number;
}

function diag(prog: ProgCtx, message: string, hint?: string): Diagnostic {
  const d: Diagnostic = {
    phase: 'codegen',
    severity: 'error',
    message,
    span: { ...DUMMY_SPAN },
  };
  if (hint !== undefined) d.hint = hint;
  prog.diagnostics.push(d);
  prog.newDiagnostics.push(d);
  return d;
}

function floatConstLabel(prog: ProgCtx, value: number): string {
  const existing = prog.floatConstPool.get(value);
  if (existing !== undefined) return existing;
  const label = `.Lfc${prog.floatConstPool.size}`;
  prog.floatConstPool.set(value, label);
  prog.newFloatConsts.push({ label, value });
  prog.floatConsts.push({ label, value });
  return label;
}

function isBaseFloat(t: CType | undefined): boolean {
  return t !== undefined && t.kind === 'base' && t.name === 'float';
}

/** Build the per-function context: naming, frame layout, float inference. */
function buildFnCtx(prog: ProgCtx, fn: TacFunction): FnCtx {
  // --- var pseudo naming (collision-safe, deterministic) ---
  const nameOf = new Map<number, string>(); // symbolId → source name
  for (const sid of fn.params) {
    const sym = prog.symbolsById.get(sid);
    if (sym) nameOf.set(sid, sym.name);
  }
  for (const q of fn.quads) {
    for (const o of [q.arg1, q.arg2, q.result]) {
      if (o && o.kind === 'var' && !nameOf.has(o.symbolId)) nameOf.set(o.symbolId, o.name);
    }
  }
  const nameCount = new Map<string, number>();
  for (const [, n] of nameOf) nameCount.set(n, (nameCount.get(n) ?? 0) + 1);
  const varPseudo = new Map<number, string>();
  for (const [sid, n] of nameOf) {
    if (prog.globalIds.has(sid)) continue; // globals are memory, not pseudos
    const clash = (nameCount.get(n) ?? 0) > 1 || /^t\d+$/.test(n);
    varPseudo.set(sid, clash ? `${n}@${sid}` : n);
  }

  // --- classification: arrays, address-taken, globals ---
  const paramSet = new Set(fn.params);
  const arraySyms = new Set<number>();
  const globalArraySyms = new Set<number>();
  const addrTaken = new Set<number>();
  for (const q of fn.quads) {
    if (q.op === 'addr' && q.arg1?.kind === 'var' && !prog.globalIds.has(q.arg1.symbolId)) {
      addrTaken.add(q.arg1.symbolId);
    }
  }
  const referenced: number[] = [];
  const seen = new Set<number>();
  for (const q of fn.quads) {
    for (const o of [q.arg1, q.arg2, q.result]) {
      if (o && o.kind === 'var' && !seen.has(o.symbolId)) {
        seen.add(o.symbolId);
        referenced.push(o.symbolId);
      }
    }
  }
  for (const sid of referenced) {
    const sym = prog.symbolsById.get(sid);
    if (sym && sym.type.kind === 'array') {
      if (prog.globalIds.has(sid)) globalArraySyms.add(sid);
      else if (!paramSet.has(sid)) arraySyms.add(sid); // array params decay to pointers
    }
  }
  if (prog.symbolsById.size === 0) {
    // No symbol table: index-op bases that are non-param locals must be arrays,
    // but their size is unknown — diagnose (tests pass symbols when using arrays).
    for (const q of fn.quads) {
      const base =
        q.op === 'index-load' ? q.arg1 : q.op === 'index-store' ? q.result : null;
      if (base && base.kind === 'var' && !paramSet.has(base.symbolId) && !prog.globalIds.has(base.symbolId) && !arraySyms.has(base.symbolId)) {
        arraySyms.add(base.symbolId);
        diag(prog, `array '${base.name}' in '${fn.name}': size unknown without a symbol table; assuming 1 element`, 'pass SemanticInfo symbols to selectInstructions');
      }
    }
  }

  // --- float inference ---
  const floatVars = new Set<number>();
  const floatTemps = new Set<number>();
  for (const sid of referenced.concat(fn.params)) {
    const sym = prog.symbolsById.get(sid);
    if (sym && isBaseFloat(sym.type)) floatVars.add(sid);
  }
  const isFloatOp = (o: TacOperand | null): boolean => {
    if (!o) return false;
    if (o.kind === 'const') return o.ctype === 'float';
    if (o.kind === 'temp') return floatTemps.has(o.id);
    if (o.kind === 'var') return floatVars.has(o.symbolId);
    return false;
  };
  const markFloat = (o: TacOperand | null): boolean => {
    if (!o) return false;
    if (o.kind === 'temp' && !floatTemps.has(o.id)) { floatTemps.add(o.id); return true; }
    if (o.kind === 'var' && !floatVars.has(o.symbolId)) { floatVars.add(o.symbolId); return true; }
    return false;
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const q of fn.quads) {
      switch (q.op) {
        case 'inttofloat':
          if (markFloat(q.result)) changed = true;
          break;
        case '+': case '-': case '*': case '/':
          if ((isFloatOp(q.arg1) || isFloatOp(q.arg2)) && markFloat(q.result)) changed = true;
          break;
        case 'neg': case 'copy':
          if (isFloatOp(q.arg1) && markFloat(q.result)) changed = true;
          break;
        case 'call': {
          if (q.result && q.arg1 && q.arg1.kind === 'var') {
            const callee = prog.symbolsById.get(q.arg1.symbolId);
            if (callee && callee.type.kind === 'function' && isBaseFloat(callee.type.ret)) {
              if (markFloat(q.result)) changed = true;
            }
          }
          break;
        }
        default:
          break;
      }
    }
  }

  // --- frame layout: first-occurrence order over the quads ---
  const frame: FrameSlot[] = [];
  const frameBySym = new Map<number, FrameSlot>();
  let frameSize = 0;
  const addSlot = (sid: number, reason: 'array' | 'addr-taken'): void => {
    if (frameBySym.has(sid)) return;
    const sym = prog.symbolsById.get(sid);
    const elems = reason === 'array' && sym && sym.type.kind === 'array' ? (sym.type.length ?? 1) : 1;
    const size = 8 * Math.max(1, elems);
    frameSize += size;
    const slot: FrameSlot = {
      name: varPseudo.get(sid) ?? nameOf.get(sid) ?? `v${sid}`,
      offset: -frameSize,
      size,
      reason,
    };
    frame.push(slot);
    frameBySym.set(sid, slot);
  };
  for (const sid of fn.params) if (addrTaken.has(sid)) addSlot(sid, 'addr-taken');
  for (const sid of referenced) {
    if (prog.globalIds.has(sid)) continue;
    if (arraySyms.has(sid)) addSlot(sid, 'array');
    else if (addrTaken.has(sid)) addSlot(sid, 'addr-taken');
  }

  const ctx: FnCtx = {
    prog,
    fn,
    name: fn.name,
    varPseudo,
    frameBySym,
    arraySyms,
    globalArraySyms,
    frame,
    frameSize,
    floatTemps,
    floatVars,
    floatNames: new Set(),
    floatOrder: [],
    floatSlot: new Map(),
    pseudoKind: new Map(),
    tempCounter: fn.tempCount + 1,
    labelCounter: 0,
    pendingInt: 0,
    pendingFloat: 0,
  };
  // Register float pseudo names for temps/vars known to be float.
  for (const id of [...floatTemps].sort((a, b) => a - b)) registerFloat(ctx, `t${id}`);
  for (const sid of referenced) {
    if (floatVars.has(sid) && varPseudo.has(sid) && !frameBySym.has(sid)) {
      registerFloat(ctx, varPseudo.get(sid)!);
    }
  }
  for (const sid of fn.params) {
    if (floatVars.has(sid) && varPseudo.has(sid) && !frameBySym.has(sid)) {
      registerFloat(ctx, varPseudo.get(sid)!);
    }
  }
  return ctx;
}

function registerFloat(ctx: FnCtx, name: string): void {
  if (!ctx.floatNames.has(name)) {
    ctx.floatNames.add(name);
    ctx.floatOrder.push(name);
  }
}

function freshTemp(ctx: FnCtx, float = false): string {
  const name = `t${ctx.tempCounter++}`;
  ctx.pseudoKind.set(name, 'temp');
  if (float) registerFloat(ctx, name);
  return name;
}

function freshLabel(ctx: FnCtx): string {
  return `.L${ctx.name}_m${ctx.labelCounter++}`;
}

function tacLabel(ctx: FnCtx, l: string): string {
  return `.L${ctx.name}_${l}`;
}

function isFloatVOp(ctx: FnCtx, o: VOperand): boolean {
  if (o.k === 'pseudo') return ctx.floatNames.has(o.name);
  if (o.k === 'mem' && o.sym !== undefined && o.sym.startsWith('.Lfc')) return true;
  return false;
}

/** Lower a TAC operand to a virtual operand (value position). */
function lower(ctx: FnCtx, o: TacOperand): VOperand {
  switch (o.kind) {
    case 'const':
      if (o.ctype === 'float') return symMem(floatConstLabel(ctx.prog, o.value));
      return imm(o.value);
    case 'temp': {
      const name = `t${o.id}`;
      ctx.pseudoKind.set(name, 'temp');
      return pseudo(name);
    }
    case 'var': {
      if (ctx.prog.globalIds.has(o.symbolId)) return symMem(o.name);
      const slot = ctx.frameBySym.get(o.symbolId);
      if (slot) return rbpMem(slot.offset);
      const name = ctx.varPseudo.get(o.symbolId) ?? o.name;
      ctx.pseudoKind.set(name, 'var');
      return pseudo(name);
    }
    case 'label':
      return lab(tacLabel(ctx, o.name));
  }
}

// ---------------------------------------------------------------------------
// Instruction builders
// ---------------------------------------------------------------------------

function mk(mnemonic: string, operands: VOperand[], tacIndex: number | null, extra?: { extraUse?: string[]; extraDef?: string[] }): VInstr {
  const i: VInstr = { kind: 'instr', mnemonic, operands, tacIndex };
  if (extra?.extraUse && extra.extraUse.length > 0) i.extraUse = extra.extraUse;
  if (extra?.extraDef && extra.extraDef.length > 0) i.extraDef = extra.extraDef;
  return i;
}

function mkLabel(name: string, tacIndex: number | null): VInstr {
  return { kind: 'label', mnemonic: 'label', operands: [], label: name, tacIndex };
}

/** Materialize an operand into a (pseudo) register when the addressing mode
 *  needs one; movq/movsd chosen by float-ness. */
function toReg(ctx: FnCtx, o: VOperand, out: VInstr[], ti: number, float: boolean): VOperand {
  if (o.k === 'pseudo' || o.k === 'phys') return o;
  const t = pseudo(freshTemp(ctx, float));
  out.push(mk(float ? 'movsd' : 'movq', [o, t], ti));
  return t;
}

/** Ensure the operand is valid as the second (register-or-memory, non-imm)
 *  operand of cmpq, materializing when both would be memory. */
function toCmpReg(ctx: FnCtx, o: VOperand, other: VOperand, out: VInstr[], ti: number, float: boolean): VOperand {
  if (float) {
    // ucomisd's destination operand must be an XMM register.
    if (o.k === 'mem') return toReg(ctx, o, out, ti, true);
    return o;
  }
  if (o.k === 'imm') return toReg(ctx, o, out, ti, false);
  if (o.k === 'mem' && other.k === 'mem') return toReg(ctx, o, out, ti, false);
  return o;
}

interface Tile {
  tile: string;
  instrs: VInstr[];
}

// ---------------------------------------------------------------------------
// Quad tiles
// ---------------------------------------------------------------------------

function tileBinary(ctx: FnCtx, q: Quad): Tile {
  const ti = q.index;
  const out: VInstr[] = [];
  const va = lower(ctx, q.arg1!);
  const vb = lower(ctx, q.arg2!);
  const vx = lower(ctx, q.result!);
  const float = isFloatVOp(ctx, va) || isFloatVOp(ctx, vb) || (vx.k === 'pseudo' && ctx.floatNames.has(vx.name));

  if (float && (q.op === '+' || q.op === '-' || q.op === '*' || q.op === '/')) {
    const mn = { '+': 'addsd', '-': 'subsd', '*': 'mulsd', '/': 'divsd' }[q.op];
    const commutative = q.op === '+' || q.op === '*';
    if (vx.k === 'pseudo' && sameName(vb, vx) && !commutative) {
      const t = pseudo(freshTemp(ctx, true));
      out.push(mk('movsd', [va, t], ti), mk(mn, [vb, t], ti), mk('movsd', [t, vx], ti));
    } else if (vx.k === 'pseudo') {
      if (sameName(vb, vx)) {
        out.push(mk(mn, [va, vx], ti)); // commutative: x = b op a
      } else {
        if (!sameName(va, vx)) out.push(mk('movsd', [va, vx], ti));
        out.push(mk(mn, [vb, vx], ti));
      }
    } else {
      const t = pseudo(freshTemp(ctx, true));
      out.push(mk('movsd', [va, t], ti), mk(mn, [vb, t], ti), mk('movsd', [t, vx], ti));
    }
    return { tile: `float-${q.op}`, instrs: out };
  }

  if (q.op === '/' || q.op === '%') {
    // Machine idiom: dividend in %rdx:%rax (cqto sign-extends), idivq divisor.
    out.push(mk('movq', [va, phys('%rax')], ti));
    out.push(mk('cqto', [], ti));
    const divisor = vb.k === 'imm' ? toReg(ctx, vb, out, ti, false) : vb;
    out.push(mk('idivq', [divisor], ti));
    out.push(mk('movq', [phys(q.op === '/' ? '%rax' : '%rdx'), vx], ti));
    return { tile: q.op === '/' ? 'div' : 'rem', instrs: out };
  }

  const mn = { '+': 'addq', '-': 'subq', '*': 'imulq' }[q.op as '+' | '-' | '*'];
  const commutative = q.op === '+' || q.op === '*';
  if (vx.k === 'pseudo' && sameName(vb, vx) && !commutative) {
    const t = pseudo(freshTemp(ctx));
    out.push(mk('movq', [va, t], ti), mk(mn, [vb, t], ti), mk('movq', [t, vx], ti));
  } else if (vx.k === 'pseudo') {
    if (sameName(vb, vx)) {
      out.push(mk(mn, [va, vx], ti));
    } else {
      if (!sameName(va, vx)) out.push(mk('movq', [va, vx], ti));
      out.push(mk(mn, [vb, vx], ti));
    }
  } else {
    const t = pseudo(freshTemp(ctx));
    out.push(mk('movq', [va, t], ti), mk(mn, [vb, t], ti), mk('movq', [t, vx], ti));
  }
  return { tile: `binary-${q.op}`, instrs: out };
}

function tileRelopValue(ctx: FnCtx, q: Quad): Tile {
  const ti = q.index;
  const out: VInstr[] = [];
  const va = lower(ctx, q.arg1!);
  const vb = lower(ctx, q.arg2!);
  const vx = lower(ctx, q.result!);
  const float = isFloatVOp(ctx, va) || isFloatVOp(ctx, vb);
  const cc = (float ? CC_FLOAT : CC_INT)[q.op]!;
  // Result register T must not alias either compared operand.
  const aliases = (t: VOperand) => sameName(t, va) || sameName(t, vb);
  const T = vx.k === 'pseudo' && !aliases(vx) ? vx : pseudo(freshTemp(ctx));
  const L = freshLabel(ctx);
  out.push(mk('movq', [imm(1), T], ti));
  const lhs = toCmpReg(ctx, va, vb, out, ti, float);
  out.push(mk(float ? 'ucomisd' : 'cmpq', [vb, lhs], ti));
  out.push(mk(cc, [lab(L)], ti));
  out.push(mk('movq', [imm(0), T], ti));
  out.push(mkLabel(L, ti));
  if (!(vx.k === 'pseudo' && T.k === 'pseudo' && vx.name === T.name)) {
    out.push(mk('movq', [T, vx], ti));
  }
  return { tile: `relop-value-${q.op}`, instrs: out };
}

function tileNeg(ctx: FnCtx, q: Quad): Tile {
  const ti = q.index;
  const out: VInstr[] = [];
  const va = lower(ctx, q.arg1!);
  const vx = lower(ctx, q.result!);
  const float = isFloatVOp(ctx, va) || (vx.k === 'pseudo' && ctx.floatNames.has(vx.name));
  if (float) {
    const zero = symMem(floatConstLabel(ctx.prog, 0));
    if (vx.k === 'pseudo' && !sameName(va, vx)) {
      out.push(mk('movsd', [zero, vx], ti), mk('subsd', [va, vx], ti));
    } else {
      const t = pseudo(freshTemp(ctx, true));
      out.push(mk('movsd', [zero, t], ti), mk('subsd', [va, t], ti), mk('movsd', [t, vx], ti));
    }
    return { tile: 'float-neg', instrs: out };
  }
  if (vx.k === 'pseudo' && !sameName(va, vx)) {
    out.push(mk('movq', [imm(0), vx], ti), mk('subq', [va, vx], ti));
  } else {
    const t = pseudo(freshTemp(ctx));
    out.push(mk('movq', [imm(0), t], ti), mk('subq', [va, t], ti), mk('movq', [t, vx], ti));
  }
  return { tile: 'neg', instrs: out };
}

function tileNot(ctx: FnCtx, q: Quad): Tile {
  const ti = q.index;
  const out: VInstr[] = [];
  const va = lower(ctx, q.arg1!);
  const vx = lower(ctx, q.result!);
  const T = vx.k === 'pseudo' && !sameName(vx, va) ? vx : pseudo(freshTemp(ctx));
  const L = freshLabel(ctx);
  out.push(mk('movq', [imm(1), T], ti));
  const lhs = va.k === 'imm' ? toReg(ctx, va, out, ti, false) : va;
  out.push(mk('cmpq', [imm(0), lhs], ti));
  out.push(mk('je', [lab(L)], ti));
  out.push(mk('movq', [imm(0), T], ti));
  out.push(mkLabel(L, ti));
  if (!(vx.k === 'pseudo' && T.k === 'pseudo' && vx.name === T.name)) {
    out.push(mk('movq', [T, vx], ti));
  }
  return { tile: 'not', instrs: out };
}

function tileCopy(ctx: FnCtx, q: Quad): Tile {
  const ti = q.index;
  const out: VInstr[] = [];
  const va = lower(ctx, q.arg1!);
  const vx = lower(ctx, q.result!);
  const float = isFloatVOp(ctx, va) || (vx.k === 'pseudo' && ctx.floatNames.has(vx.name));
  const mn = float ? 'movsd' : 'movq';
  if (va.k === 'mem' && vx.k === 'mem') {
    const t = pseudo(freshTemp(ctx, float));
    out.push(mk(mn, [va, t], ti), mk(mn, [t, vx], ti));
  } else if (float && va.k === 'imm') {
    // (never produced: float consts lower to memory) — defensive
    const t = pseudo(freshTemp(ctx, true));
    out.push(mk(mn, [va, t], ti), mk(mn, [t, vx], ti));
  } else if (!sameName(va, vx)) {
    out.push(mk(mn, [va, vx], ti));
  }
  return { tile: float ? 'float-copy' : 'copy', instrs: out };
}

function tileIntToFloat(ctx: FnCtx, q: Quad): Tile {
  const ti = q.index;
  const out: VInstr[] = [];
  const va = lower(ctx, q.arg1!);
  const vx = lower(ctx, q.result!);
  const src = va.k === 'imm' ? toReg(ctx, va, out, ti, false) : va;
  if (vx.k === 'pseudo') {
    out.push(mk('cvtsi2sdq', [src, vx], ti));
  } else {
    const t = pseudo(freshTemp(ctx, true));
    out.push(mk('cvtsi2sdq', [src, t], ti), mk('movsd', [t, vx], ti));
  }
  return { tile: 'inttofloat', instrs: out };
}

function tileCond(ctx: FnCtx, q: Quad): Tile {
  const ti = q.index;
  const out: VInstr[] = [];
  const target = lower(ctx, q.result!); // label
  if (q.op === 'ifrel') {
    const va = lower(ctx, q.arg1!);
    const vb = lower(ctx, q.arg2!);
    const float = isFloatVOp(ctx, va) || isFloatVOp(ctx, vb);
    const cc = (float ? CC_FLOAT : CC_INT)[q.relop!]!;
    const lhs = toCmpReg(ctx, va, vb, out, ti, float);
    out.push(mk(float ? 'ucomisd' : 'cmpq', [vb, lhs], ti));
    out.push(mk(cc, [target], ti));
    return { tile: `ifrel-${q.relop!}`, instrs: out };
  }
  const va = lower(ctx, q.arg1!);
  const lhs = va.k === 'imm' ? toReg(ctx, va, out, ti, false) : va;
  out.push(mk('cmpq', [imm(0), lhs], ti));
  out.push(mk(q.op === 'if' ? 'jne' : 'je', [target], ti));
  return { tile: q.op === 'if' ? 'if-true' : 'if-false', instrs: out };
}

/**
 * Compute the memory operand for a[i] given the base variable and index.
 *
 * The IR already scaled the index by the element width (§6.4.3 Fig 6.22:
 * `L.addr = E.addr * width`), so the second operand of index-load /
 * index-store is an ALREADY-SCALED BYTE OFFSET, exactly as the TAC
 * interpreter reads it (`readMem(base + off)`). The address is therefore
 * `base + off`: a register offset enters the addressing mode with scale 1 and
 * a constant offset is added verbatim — scaling here a second time would
 * address `base + width² × i`.
 */
function elementAddr(ctx: FnCtx, base: TacOperand, idx: TacOperand, out: VInstr[], ti: number): VOperand | null {
  // Index contribution: a byte offset, not an element number.
  let constOff = 0;
  let idxReg: string | null = null;
  if (idx.kind === 'const') {
    constOff = idx.value;
  } else {
    const vi = lower(ctx, idx);
    const r = vi.k === 'mem' ? toReg(ctx, vi, out, ti, false) : vi;
    if (r.k !== 'pseudo' && r.k !== 'phys') return null;
    idxReg = r.k === 'pseudo' ? r.name : r.reg;
  }
  const memOp = (b: string, off: number): VOperand => {
    const m: VOperand = { k: 'mem', base: b, offset: off };
    if (idxReg !== null && m.k === 'mem') {
      m.index = idxReg;
      m.scale = 1; // the offset register already holds i × width
    }
    return m;
  };
  if (base.kind === 'var') {
    const sid = base.symbolId;
    if (ctx.arraySyms.has(sid)) {
      const slot = ctx.frameBySym.get(sid)!;
      return memOp('%rbp', slot.offset + constOff);
    }
    if (ctx.prog.globalIds.has(sid)) {
      const sym = ctx.prog.symbolsById.get(sid);
      const isArray = sym !== undefined && sym.type.kind === 'array';
      if (!isArray) {
        // global pointer variable: load its value, then index through it
        const p = pseudo(freshTemp(ctx));
        out.push(mk('movq', [symMem(base.name), p], ti));
        return memOp(p.name, constOff);
      }
      // global array: materialize its address, then index off the register
      const t = pseudo(freshTemp(ctx));
      out.push(mk('leaq', [symMem(base.name), t], ti));
      return memOp(t.name, constOff);
    }
  }
  // Pointer value (param, local pointer, or temp): base register is the pointer.
  const vp = lower(ctx, base);
  const r = vp.k === 'mem' ? toReg(ctx, vp, out, ti, false) : vp;
  if (r.k !== 'pseudo' && r.k !== 'phys') return null;
  return memOp(r.k === 'pseudo' ? r.name : r.reg, constOff);
}

function tileIndexLoad(ctx: FnCtx, q: Quad): Tile | null {
  const ti = q.index;
  const out: VInstr[] = [];
  const addr = elementAddr(ctx, q.arg1!, q.arg2!, out, ti);
  if (!addr) return null;
  const vx = lower(ctx, q.result!);
  const float = vx.k === 'pseudo' && ctx.floatNames.has(vx.name);
  const mn = float ? 'movsd' : 'movq';
  if (vx.k === 'mem') {
    const t = pseudo(freshTemp(ctx, float));
    out.push(mk(mn, [addr, t], ti), mk(mn, [t, vx], ti));
  } else {
    out.push(mk(mn, [addr, vx], ti));
  }
  return { tile: 'index-load', instrs: out };
}

function tileIndexStore(ctx: FnCtx, q: Quad): Tile | null {
  const ti = q.index;
  const out: VInstr[] = [];
  const addr = elementAddr(ctx, q.result!, q.arg2!, out, ti);
  if (!addr) return null;
  const vy = lower(ctx, q.arg1!);
  const float = isFloatVOp(ctx, vy);
  if (float) {
    const src = vy.k === 'mem' ? toReg(ctx, vy, out, ti, true) : vy;
    out.push(mk('movsd', [src, addr], ti));
  } else {
    const src = vy.k === 'mem' ? toReg(ctx, vy, out, ti, false) : vy;
    out.push(mk('movq', [src, addr], ti));
  }
  return { tile: 'index-store', instrs: out };
}

function tileAddr(ctx: FnCtx, q: Quad): Tile | null {
  const ti = q.index;
  const out: VInstr[] = [];
  const y = q.arg1!;
  const vx = lower(ctx, q.result!);
  let src: VOperand;
  if (y.kind === 'var' && ctx.prog.globalIds.has(y.symbolId)) {
    src = symMem(y.name);
  } else if (y.kind === 'var' && ctx.frameBySym.has(y.symbolId)) {
    src = rbpMem(ctx.frameBySym.get(y.symbolId)!.offset);
  } else {
    return null; // &temp or &register-resident var — pre-scan should prevent
  }
  if (vx.k === 'pseudo') {
    out.push(mk('leaq', [src, vx], ti));
  } else {
    const t = pseudo(freshTemp(ctx));
    out.push(mk('leaq', [src, t], ti), mk('movq', [t, vx], ti));
  }
  return { tile: 'addr-of', instrs: out };
}

function tileDerefLoad(ctx: FnCtx, q: Quad): Tile | null {
  const ti = q.index;
  const out: VInstr[] = [];
  const vp = lower(ctx, q.arg1!);
  const p = vp.k === 'mem' ? toReg(ctx, vp, out, ti, false) : vp;
  if (p.k !== 'pseudo' && p.k !== 'phys') return null;
  const addr: VOperand = { k: 'mem', base: p.k === 'pseudo' ? p.name : p.reg, offset: 0 };
  const vx = lower(ctx, q.result!);
  const float = vx.k === 'pseudo' && ctx.floatNames.has(vx.name);
  const mn = float ? 'movsd' : 'movq';
  if (vx.k === 'mem') {
    const t = pseudo(freshTemp(ctx, float));
    out.push(mk(mn, [addr, t], ti), mk(mn, [t, vx], ti));
  } else {
    out.push(mk(mn, [addr, vx], ti));
  }
  return { tile: 'deref-load', instrs: out };
}

function tileDerefStore(ctx: FnCtx, q: Quad): Tile | null {
  const ti = q.index;
  const out: VInstr[] = [];
  const vp = lower(ctx, q.result!);
  const p = vp.k === 'mem' ? toReg(ctx, vp, out, ti, false) : vp;
  if (p.k !== 'pseudo' && p.k !== 'phys') return null;
  const addr: VOperand = { k: 'mem', base: p.k === 'pseudo' ? p.name : p.reg, offset: 0 };
  const vy = lower(ctx, q.arg1!);
  const float = isFloatVOp(ctx, vy);
  const src = vy.k === 'mem' ? toReg(ctx, vy, out, ti, float) : vy;
  out.push(mk(float ? 'movsd' : 'movq', [src, addr], ti));
  return { tile: 'deref-store', instrs: out };
}

function tileParam(ctx: FnCtx, q: Quad): Tile | null {
  const ti = q.index;
  const out: VInstr[] = [];
  const a = q.arg1!;
  const va = lower(ctx, a);
  const float = isFloatVOp(ctx, va) || (a.kind === 'const' && a.ctype === 'float');
  if (float) {
    if (ctx.pendingFloat >= 8) {
      diag(ctx.prog, `call in '${ctx.name}': more than 8 float arguments are not supported by the lab convention`);
      return { tile: 'param-overflow', instrs: [] };
    }
    const reg = phys(`%xmm${ctx.pendingFloat++}`);
    out.push(mk('movsd', [va, reg], ti));
    return { tile: 'param-float', instrs: out };
  }
  if (ctx.pendingInt >= ARG_GP_REGISTERS.length) {
    diag(ctx.prog, `call in '${ctx.name}': more than 6 integer arguments are not supported by the lab convention`);
    return { tile: 'param-overflow', instrs: [] };
  }
  const reg = phys(ARG_GP_REGISTERS[ctx.pendingInt++]!);
  // Arrays decay to pointers: pass the address.
  if (a.kind === 'var' && ctx.arraySyms.has(a.symbolId)) {
    const slot = ctx.frameBySym.get(a.symbolId)!;
    out.push(mk('leaq', [rbpMem(slot.offset), reg], ti));
  } else if (a.kind === 'var' && ctx.globalArraySyms.has(a.symbolId)) {
    out.push(mk('leaq', [symMem(a.name), reg], ti));
  } else {
    out.push(mk('movq', [va, reg], ti));
  }
  return { tile: 'param', instrs: out };
}

function tileCall(ctx: FnCtx, q: Quad): Tile {
  const ti = q.index;
  const out: VInstr[] = [];
  const calleeName = q.arg1!.kind === 'var' ? q.arg1!.name : q.arg1!.kind === 'label' ? q.arg1!.name : String(q.arg1);
  const argRegs = ARG_GP_REGISTERS.slice(0, ctx.pendingInt);
  out.push(mk('call', [lab(calleeName)], ti, { extraUse: [...argRegs], extraDef: ['%rax'] }));
  if (q.result) {
    const vx = lower(ctx, q.result);
    const float = vx.k === 'pseudo' && ctx.floatNames.has(vx.name);
    if (float) out.push(mk('movsd', [phys('%xmm0'), vx], ti));
    else out.push(mk('movq', [phys('%rax'), vx], ti));
  }
  ctx.pendingInt = 0;
  ctx.pendingFloat = 0;
  return { tile: q.result ? 'call-result' : 'call', instrs: out };
}

function tileReturn(ctx: FnCtx, q: Quad): Tile {
  const ti = q.index;
  const out: VInstr[] = [];
  if (q.arg1) {
    const va = lower(ctx, q.arg1);
    const float = isFloatVOp(ctx, va);
    if (float) {
      out.push(mk('movsd', [va, phys('%xmm0')], ti));
      out.push(mk('jmp', [lab(`.L${ctx.name}_ret`)], ti));
    } else {
      out.push(mk('movq', [va, phys('%rax')], ti));
      out.push(mk('jmp', [lab(`.L${ctx.name}_ret`)], ti, { extraUse: ['%rax'] }));
    }
  } else {
    out.push(mk('jmp', [lab(`.L${ctx.name}_ret`)], ti));
  }
  return { tile: q.arg1 ? 'return-value' : 'return', instrs: out };
}

function tileQuad(ctx: FnCtx, q: Quad): Tile | null {
  switch (q.op) {
    case '+': case '-': case '*': case '/': case '%':
      return tileBinary(ctx, q);
    case '==': case '!=': case '<': case '>': case '<=': case '>=':
      return tileRelopValue(ctx, q);
    case 'neg':
      return tileNeg(ctx, q);
    case 'not':
      return tileNot(ctx, q);
    case 'copy':
      return tileCopy(ctx, q);
    case 'inttofloat':
      return tileIntToFloat(ctx, q);
    case 'label':
      return { tile: 'label', instrs: [mkLabel(tacLabel(ctx, (q.result as { name: string }).name), q.index)] };
    case 'goto':
      return { tile: 'goto', instrs: [mk('jmp', [lower(ctx, q.result!)], q.index)] };
    case 'if': case 'iffalse': case 'ifrel':
      return tileCond(ctx, q);
    case 'param':
      return tileParam(ctx, q);
    case 'call':
      return tileCall(ctx, q);
    case 'return':
      return tileReturn(ctx, q);
    case 'index-load':
      return tileIndexLoad(ctx, q);
    case 'index-store':
      return tileIndexStore(ctx, q);
    case 'addr':
      return tileAddr(ctx, q);
    case 'deref-load':
      return tileDerefLoad(ctx, q);
    case 'deref-store':
      return tileDerefStore(ctx, q);
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Float lowering: memory-resident values + one scratch SSE register
// ---------------------------------------------------------------------------

/** SSE arithmetic: reads AND writes its destination, which must be a register. */
const SSE_ARITH = new Set(['addsd', 'subsd', 'mulsd', 'divsd']);

/** The frame slot of a float pseudo, allocated on first use (deterministic:
 *  slots follow the order the instructions mentioning them are emitted). */
function floatSlotOf(ctx: FnCtx, name: string): VOperand {
  const existing = ctx.floatSlot.get(name);
  if (existing !== undefined) return existing;
  ctx.frameSize += 8;
  const slot: FrameSlot = { name, offset: -ctx.frameSize, size: 8, reason: 'float' };
  ctx.frame.push(slot);
  const mem = rbpMem(slot.offset);
  ctx.floatSlot.set(name, mem);
  return mem;
}

/**
 * Expand one selected instruction so that no float pseudo-register survives:
 * each float value is read from / written to its frame slot and the operation
 * itself runs in the reserved scratch register %xmm8 whenever the destination
 * has to be a register (SSE arithmetic, ucomisd, cvtsi2sdq) or both operands
 * would otherwise be memory. This is the §8.6 simple code generator applied to
 * the values the allocator does not color, and it is what keeps a float alive
 * across a call: the value is in memory, not in a register a callee or an
 * argument move could clobber.
 */
function expandFloat(ctx: FnCtx, i: VInstr): VInstr[] {
  if (i.kind === 'label' || i.operands.length !== 2) return [i];
  const isFloatPseudo = (o: VOperand | undefined): boolean =>
    o !== undefined && o.k === 'pseudo' && ctx.floatNames.has(o.name);
  const src0 = i.operands[0]!;
  const dst0 = i.operands[1]!;
  if (!isFloatPseudo(src0) && !isFloatPseudo(dst0)) return [i];
  const src = isFloatPseudo(src0) ? floatSlotOf(ctx, (src0 as { name: string }).name) : src0;
  const dst = isFloatPseudo(dst0) ? floatSlotOf(ctx, (dst0 as { name: string }).name) : dst0;
  const dstMustBeReg = i.mnemonic !== 'movsd';
  if (dst.k !== 'mem' || !(dstMustBeReg || src.k === 'mem')) {
    return [{ ...i, operands: [src, dst] }];
  }
  const scratch = phys(SSE_SCRATCH);
  const readsDst = SSE_ARITH.has(i.mnemonic) || i.mnemonic === 'ucomisd';
  const writesDst = i.mnemonic !== 'ucomisd';
  const out: VInstr[] = [];
  if (readsDst) out.push(mk('movsd', [dst, scratch], i.tacIndex));
  out.push({ ...i, operands: [src, scratch] });
  if (writesDst) out.push(mk('movsd', [scratch, dst], i.tacIndex));
  return out;
}

// ---------------------------------------------------------------------------
// Pseudo collection
// ---------------------------------------------------------------------------

const FIXED_BASES = new Set(['%rbp', '%rsp', '%rip']);

function pseudoNamesIn(code: VInstr[]): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  const add = (n: string) => {
    if (!n.startsWith('%') && !seen.has(n)) {
      seen.add(n);
      order.push(n);
    }
  };
  for (const i of code) {
    for (const o of i.operands) {
      if (o.k === 'pseudo') add(o.name);
      else if (o.k === 'mem') {
        if (o.base !== null && !FIXED_BASES.has(o.base)) add(o.base);
        if (o.index !== undefined && !FIXED_BASES.has(o.index)) add(o.index);
      }
    }
  }
  return order;
}

// ---------------------------------------------------------------------------
// The traced algorithm
// ---------------------------------------------------------------------------

/**
 * Select x86-64 instructions for every function of the program by
 * quad-at-a-time maximal-munch tiling. `symbols` (SemanticInfo.symbols) is
 * optional but required to size arrays and to type float variables precisely.
 */
export function* selectInstructions(
  program: TacProgram,
  symbols?: SymbolEntry[],
): Steps<IselEvent, IselResult> {
  const prog: ProgCtx = {
    symbolsById: new Map((symbols ?? []).map((s) => [s.id, s])),
    globalIds: new Set(program.globals),
    floatConstPool: new Map(),
    newFloatConsts: [],
    floatConsts: [],
    newDiagnostics: [],
    diagnostics: [],
  };

  function* flushDiags(section: string): Steps<IselEvent, void> {
    for (const d of prog.newDiagnostics.splice(0)) {
      yield [
        { kind: 'diagnostic', diagnostic: d },
        {
          cite: cite('8.9.2', 'if no rule applies, code generation reports failure for the construct'),
          prose: `Diagnostic: ${d.message}.`,
          level: 'macro',
          section,
        },
      ];
    }
  }

  function* flushFloatConsts(section: string): Steps<IselEvent, void> {
    for (const fc of prog.newFloatConsts.splice(0)) {
      yield [
        { kind: 'floatConst', label: fc.label, value: fc.value },
        {
          cite: cite('8.3.1', 'constants are placed in a statically allocated data area'),
          prose: `Float constant ${fc.value} is pooled as ${fc.label} (.double in the data section) — SSE has no float immediates.`,
          level: 'micro',
          section,
        },
      ];
    }
  }

  const globals: GlobalDatum[] = [];
  const initOf = new Map(
    (program.globalInits ?? []).map((g) => [g.symbolId, { value: g.value, ctype: g.ctype }]),
  );
  // Global names/sizes: from symbols when available, else scanned from quads.
  const globalNameOf = new Map<number, string>();
  for (const fn of program.functions) {
    for (const q of fn.quads) {
      for (const o of [q.arg1, q.arg2, q.result]) {
        if (o && o.kind === 'var' && prog.globalIds.has(o.symbolId) && !globalNameOf.has(o.symbolId)) {
          globalNameOf.set(o.symbolId, o.name);
        }
      }
    }
  }
  for (const sid of program.globals) {
    const sym = prog.symbolsById.get(sid);
    const name = sym?.name ?? globalNameOf.get(sid) ?? `g${sid}`;
    const size = sym && sym.type.kind === 'array' ? 8 * Math.max(1, sym.type.length ?? 1) : 8;
    const init = initOf.get(sid);
    globals.push(init ? { name, size, init } : { name, size });
    yield [
      init ? { kind: 'globalDecl', name, size, init } : { kind: 'globalDecl', name, size },
      {
        cite: cite('8.3.1', 'statically allocated names are addressed by their fixed location in the data area'),
        prose:
          `Global '${name}' gets ${size} bytes of statically allocated storage, addressed rip-relative as ${name}(%rip)` +
          (init
            ? `; the data area holds its initial value ${init.value} before execution begins.`
            : '.'),
        level: 'micro',
        section: 'Globals',
      },
    ];
  }

  const functions: VFunction[] = [];

  for (const fn of program.functions) {
    const ctx = buildFnCtx(prog, fn);
    const code: VInstr[] = [];

    yield [
      {
        kind: 'fnStart',
        functionName: fn.name,
        params: fn.params.map((sid) => ctx.varPseudo.get(sid) ?? null),
        frame: ctx.frame.map((s) => ({ ...s })),
        frameSize: ctx.frameSize,
      },
      {
        cite: cite('8.9.2', 'tile the input with rules covering machine instructions', 'quad-at-a-time tiling'),
        prose: `Select instructions for '${fn.name}': ${fn.quads.length} quads are tiled one at a time; ${ctx.frame.length} frame slot(s) hold arrays and address-taken locals.`,
        level: 'macro',
        section: `${fn.name}: selection`,
      },
    ];
    yield* flushDiags(`${fn.name}: selection`);

    // Entry moves: incoming arguments (lab convention) into their pseudos.
    let intIdx = 0;
    let floatIdx = 0;
    for (const sid of fn.params) {
      const isF = ctx.floatVars.has(sid);
      const argReg = isF ? `%xmm${floatIdx++}` : ARG_GP_REGISTERS[intIdx++] ?? null;
      if (argReg === null) {
        diag(prog, `function '${fn.name}' has more than 6 integer parameters (lab convention limit)`);
        yield* flushDiags(`${fn.name}: selection`);
        continue;
      }
      const slot = ctx.frameBySym.get(sid);
      const dst: VOperand = slot ? rbpMem(slot.offset) : ctx.varPseudo.has(sid) ? pseudo(ctx.varPseudo.get(sid)!) : ({ k: 'pseudo', name: '' } as VOperand);
      if (dst.k === 'pseudo' && dst.name === '') continue; // parameter never referenced
      if (dst.k === 'pseudo') ctx.pseudoKind.set(dst.name, 'var');
      const pname = ctx.varPseudo.get(sid) ?? `param${sid}`;
      for (const instr of expandFloat(ctx, mk(isF ? 'movsd' : 'movq', [phys(argReg), dst], null))) {
        code.push(instr);
        yield [
          { kind: 'entryMove', functionName: fn.name, param: pname, instr },
          {
            cite: cite('8.3.2', 'on entry, the callee moves incoming parameters from their convention locations'),
            prose: `Parameter '${pname}' arrives in ${argReg} (lab convention) and is moved into its ${isF ? 'frame slot (floats are memory-resident)' : slot ? 'frame slot, since its address is taken' : 'pseudo-register'}.`,
            level: 'micro',
            groupId: `${fn.name}:entry`,
            section: `${fn.name}: selection`,
          },
        ];
      }
    }

    for (const q of fn.quads) {
      const tiled = tileQuad(ctx, q);
      // Emit pooled float constants / diagnostics discovered by this tile first.
      yield* flushFloatConsts(`${fn.name}: selection`);
      yield* flushDiags(`${fn.name}: selection`);
      if (!tiled) {
        diag(prog, `no tile for quad ${q.index} (${formatQuad(q)}) in '${fn.name}'`, "not in the lab's codegen subset");
        yield* flushDiags(`${fn.name}: selection`);
        continue;
      }
      yield [
        { kind: 'tile', functionName: fn.name, tacIndex: q.index, quadText: formatQuad(q), tileName: tiled.tile },
        {
          cite: cite('8.9.2', "one tile per IR operator: the quad's opcode selects the rule that covers it", 'quad-at-a-time tiling'),
          prose: `Quad ${q.index} '${formatQuad(q)}' matches tile '${tiled.tile}' (${tiled.instrs.length} instruction${tiled.instrs.length === 1 ? '' : 's'}).`,
          level: 'macro',
          section: `${fn.name}: selection`,
          irRefs: [{ kind: 'tacInstr', id: q.index }],
        },
      ];
      for (const selected of tiled.instrs) {
        for (const instr of expandFloat(ctx, selected)) {
          code.push(instr);
          yield [
            { kind: 'instr', functionName: fn.name, instr },
            {
              cite: instr.mnemonic === 'cqto' || instr.mnemonic === 'idivq'
                ? cite('8.9.2', 'machine idioms are single tiles: x86-64 division needs the dividend sign-extended into %rdx:%rax')
                : cite('8.6', 'a simple code generator emits a load, an operation, and a store for each three-address instruction'),
              prose: `Emit '${fmtForProse(instr)}'.`,
              level: 'micro',
              groupId: `${fn.name}:q${q.index}`,
              section: `${fn.name}: selection`,
              irRefs: [{ kind: 'tacInstr', id: q.index }],
            },
          ];
        }
      }
    }

    // expandFloat replaced every float pseudo with its frame slot, so none can
    // survive in the code and no SSE register has to be allocated.
    const floatPseudos = pseudoNamesIn(code)
      .filter((n) => ctx.floatNames.has(n))
      .map((name) => ({ name, xmm: SSE_SCRATCH }));
    const floatSet = new Set(floatPseudos.map((f) => f.name));
    const pseudos: RaNode[] = pseudoNamesIn(code)
      .filter((n) => !floatSet.has(n))
      .map((id) => ({ id, kind: ctx.pseudoKind.get(id) ?? 'temp' }))
      .sort((a, b) => cmpName(a.id, b.id));

    const vfn: VFunction = {
      name: fn.name,
      params: fn.params.map((sid) => ctx.varPseudo.get(sid) ?? null),
      code,
      frame: { slots: ctx.frame, size: ctx.frameSize },
      pseudos,
      floatPseudos,
      tempCounter: ctx.tempCounter,
      labelCounter: ctx.labelCounter,
    };
    functions.push(vfn);

    yield [
      {
        kind: 'fnEnd',
        functionName: fn.name,
        pseudos,
        floatPseudos,
        tempCounter: ctx.tempCounter,
        labelCounter: ctx.labelCounter,
        frame: ctx.frame.map((s) => ({ ...s })),
        frameSize: ctx.frameSize,
      },
      {
        cite: cite('8.9.2', 'the tiling covers the whole function body'),
        prose: `'${fn.name}' selected: ${code.length} instructions over ${pseudos.length} GP pseudo-register(s)${ctx.floatSlot.size > 0 ? ` and ${ctx.floatSlot.size} float value(s) in frame slots (floats are not register-allocated; ${SSE_SCRATCH} is the scratch)` : ''}.`,
        level: 'macro',
        section: `${fn.name}: selection`,
      },
    ];
  }

  const result: IselResult = {
    functions,
    floatConsts: prog.floatConsts,
    globals,
    diagnostics: prog.diagnostics,
  };
  yield [
    { kind: 'done' },
    {
      cite: cite('8.9.2', 'code generation by tiling is complete when every IR operation is covered'),
      prose: `Instruction selection complete: ${functions.length} function(s), ${prog.diagnostics.length} diagnostic(s).`,
      level: 'macro',
      section: 'Done',
    },
  ];
  return result;
}

function fmtForProse(i: VInstr): string {
  if (i.kind === 'label') return `${i.label ?? ''}:`;
  const ops = i.operands
    .map((o) => {
      switch (o.k) {
        case 'pseudo': return o.name;
        case 'phys': return o.reg;
        case 'imm': return `$${o.value}`;
        case 'lab': return o.name;
        case 'mem': {
          if (o.sym !== undefined) return `${o.sym}(%rip)`;
          const off = o.offset === 0 ? '' : String(o.offset);
          const parts = [o.base ?? ''];
          if (o.index !== undefined) parts.push(o.index, String(o.scale ?? 1));
          return `${off}(${parts.join(', ')})`;
        }
      }
    })
    .join(', ');
  return ops.length > 0 ? `${i.mnemonic} ${ops}` : i.mnemonic;
}

// ---------------------------------------------------------------------------
// UI state + reducer
// ---------------------------------------------------------------------------

export interface IselState {
  functions: VFunction[];
  floatConsts: Array<{ label: string; value: number }>;
  globals: GlobalDatum[];
  diagnostics: Diagnostic[];
  done: boolean;
}

export function initialIselState(): IselState {
  return { functions: [], floatConsts: [], globals: [], diagnostics: [], done: false };
}

export const iselReducer: Reducer<IselState, IselEvent> = (s, e) => {
  switch (e.kind) {
    case 'globalDecl':
      return {
        ...s,
        globals: [
          ...s.globals,
          e.init ? { name: e.name, size: e.size, init: e.init } : { name: e.name, size: e.size },
        ],
      };
    case 'floatConst':
      return { ...s, floatConsts: [...s.floatConsts, { label: e.label, value: e.value }] };
    case 'fnStart':
      return {
        ...s,
        functions: [
          ...s.functions,
          {
            name: e.functionName,
            params: e.params,
            code: [],
            frame: { slots: e.frame, size: e.frameSize },
            pseudos: [],
            floatPseudos: [],
            tempCounter: 0,
            labelCounter: 0,
          },
        ],
      };
    case 'entryMove':
    case 'instr': {
      const fns = [...s.functions];
      const last = fns[fns.length - 1];
      if (!last) return s;
      fns[fns.length - 1] = { ...last, code: [...last.code, e.instr] };
      return { ...s, functions: fns };
    }
    case 'tile':
      return s;
    case 'diagnostic':
      return { ...s, diagnostics: [...s.diagnostics, e.diagnostic] };
    case 'fnEnd': {
      const fns = [...s.functions];
      const last = fns[fns.length - 1];
      if (!last) return s;
      fns[fns.length - 1] = {
        ...last,
        pseudos: e.pseudos,
        floatPseudos: e.floatPseudos,
        tempCounter: e.tempCounter,
        labelCounter: e.labelCounter,
        frame: { slots: e.frame, size: e.frameSize },
      };
      return { ...s, functions: fns };
    }
    case 'done':
      return { ...s, done: true };
  }
};

export function projectIsel(r: IselResult): IselState {
  return { ...r, done: true };
}

/** Convenience: record an instruction-selection trace. */
export function runIsel(
  program: TacProgram,
  symbols?: SymbolEntry[],
  id = 'codegen.isel',
): Recorded<IselState, IselEvent, IselResult> {
  return record(() => selectInstructions(program, symbols), initialIselState(), iselReducer, { id });
}

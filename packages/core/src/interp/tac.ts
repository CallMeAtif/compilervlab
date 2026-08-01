/**
 * TAC interpreter — the deterministic test oracle for the IR (and later the
 * optimizer / codegen phases), per docs/c-subset.md "Evaluation semantics":
 *   - int/char are 64-bit-style JS integers (no overflow modeling); float is
 *     IEEE double. Integer division truncates toward zero (C semantics).
 *   - Division (or %) by zero is a runtime error.
 *   - Uninitialized variables read 0.
 *   - Entry point is `main` (no arguments); its return value is the result.
 *
 * Memory model: one linear byte-addressed memory. Every variable (global,
 * param, local — including whole arrays) owns a fixed-size slot; pointers are
 * plain numeric addresses into this memory. Temporaries are per-activation
 * registers. Each value carries a float tag so `/` can pick float vs truncating
 * integer division (quads carry no types; the tag is seeded by float constants
 * and inttofloat quads and propagated through copies and arithmetic).
 *
 * Convention from the generator: `index-load` / `index-store` take the ARRAY
 * NAME as base (its slot address); element access through a pointer value is
 * emitted as pointer arithmetic (`t = p + offset`) followed by deref-load /
 * deref-store.
 */
import type { Quad, TacFunction, TacOperand, TacProgram } from '../ir/types.js';

export interface TacRunResult {
  returnValue: number;
  steps: number;
}

export class TacRuntimeError extends Error {
  constructor(
    message: string,
    readonly at?: { func: string; index: number },
  ) {
    super(at ? `${message} (at ${at.func}:${at.index})` : message);
    this.name = 'TacRuntimeError';
  }
}

/** Bytes reserved per variable slot — generous enough for the lab's arrays. */
const SLOT = 4096;
const DEFAULT_MAX_STEPS = 1_000_000;

interface Cell {
  v: number;
  /** float tag: drives float vs truncating integer division. */
  f: boolean;
}

const ZERO: Cell = { v: 0, f: false };

interface LoadedFunction {
  fn: TacFunction;
  labels: Map<string, number>;
  /** Non-global variable symbolIds in deterministic order: params first (in
   *  declaration order), then other locals by first appearance in the quads. */
  frameVars: Array<{ symbolId: number; name: string }>;
}

interface Frame {
  lf: LoadedFunction;
  pc: number;
  temps: Map<number, Cell>;
  varAddr: Map<number, number>;
  frameBase: number;
  /** The call quad in the CALLER that created this frame (null for entry). */
  callQuad: Quad | null;
}

function collectFrameVars(fn: TacFunction, globals: Set<number>): LoadedFunction['frameVars'] {
  const seen = new Set<number>();
  const out: LoadedFunction['frameVars'] = [];
  const add = (symbolId: number, name: string): void => {
    if (globals.has(symbolId) || seen.has(symbolId)) return;
    seen.add(symbolId);
    out.push({ symbolId, name });
  };
  // params first, in declaration order — names recovered from operand uses below
  const paramNames = new Map<number, string>();
  for (const q of fn.quads) {
    for (const o of [q.arg1, q.arg2, q.result]) {
      if (o && o.kind === 'var') paramNames.set(o.symbolId, o.name);
    }
  }
  for (const p of fn.params) add(p, paramNames.get(p) ?? `p${p}`);
  for (const q of fn.quads) {
    const uses: Array<TacOperand | null> =
      q.op === 'call' ? [q.arg2, q.result] : [q.arg1, q.arg2, q.result];
    for (const o of uses) {
      if (o && o.kind === 'var') add(o.symbolId, o.name);
    }
  }
  return out;
}

/** Run a TAC program to completion. Deterministic; guarded by a step limit. */
export function runTac(
  program: TacProgram,
  entry = 'main',
  maxSteps = DEFAULT_MAX_STEPS,
): TacRunResult {
  const globals = new Set(program.globals);
  const byName = new Map<string, LoadedFunction>();
  for (const fn of program.functions) {
    const labels = new Map<string, number>();
    for (const q of fn.quads) {
      if (q.op === 'label' && q.result && q.result.kind === 'label') {
        labels.set(q.result.name, q.index);
      }
    }
    byName.set(fn.name, { fn, labels, frameVars: collectFrameVars(fn, globals) });
  }

  // memory + global slots
  const mem = new Map<number, Cell>();
  const globalAddr = new Map<number, number>();
  let top = 16; // keep address 0 unused (null-ish)
  for (const g of program.globals) {
    globalAddr.set(g, top);
    top += SLOT;
  }
  // Statically allocated globals already hold their initial value when
  // execution begins (§7.1): no instruction writes them, the data area does.
  for (const init of program.globalInits ?? []) {
    const addr = globalAddr.get(init.symbolId);
    if (addr === undefined) {
      throw new TacRuntimeError(`initializer for unknown global '${init.name}'`);
    }
    mem.set(addr, { v: init.value, f: init.ctype === 'float' });
  }

  const entryFn = byName.get(entry);
  if (!entryFn) throw new TacRuntimeError(`no function named '${entry}'`);

  const readMem = (addr: number): Cell => mem.get(addr) ?? ZERO;

  const makeFrame = (lf: LoadedFunction, callQuad: Quad | null): Frame => {
    const varAddr = new Map<number, number>();
    const frameBase = top;
    for (const v of lf.frameVars) {
      varAddr.set(v.symbolId, top);
      top += SLOT;
    }
    return { lf, pc: 0, temps: new Map(), varAddr, frameBase, callQuad };
  };

  const stack: Frame[] = [makeFrame(entryFn, null)];
  const paramQueue: Cell[] = [];
  let steps = 0;

  const here = (): { func: string; index: number } => {
    const f = stack[stack.length - 1];
    return { func: f ? f.lf.fn.name : entry, index: f ? f.pc : 0 };
  };

  const addrOfVar = (frame: Frame, symbolId: number, name: string): number => {
    const a = frame.varAddr.get(symbolId) ?? globalAddr.get(symbolId);
    if (a === undefined) {
      throw new TacRuntimeError(`unknown variable ${name} (symbol ${symbolId})`, here());
    }
    return a;
  };

  const evalOperand = (frame: Frame, o: TacOperand | null): Cell => {
    if (!o) throw new TacRuntimeError('missing operand', here());
    switch (o.kind) {
      case 'const':
        return { v: o.value, f: o.ctype === 'float' };
      case 'temp':
        return frame.temps.get(o.id) ?? ZERO;
      case 'var':
        return readMem(addrOfVar(frame, o.symbolId, o.name));
      case 'label':
        throw new TacRuntimeError(`label ${o.name} used as a value`, here());
    }
  };

  const assign = (frame: Frame, o: TacOperand | null, cell: Cell): void => {
    if (!o) throw new TacRuntimeError('missing assignment target', here());
    if (o.kind === 'temp') {
      frame.temps.set(o.id, cell);
    } else if (o.kind === 'var') {
      mem.set(addrOfVar(frame, o.symbolId, o.name), cell);
    } else {
      throw new TacRuntimeError('invalid assignment target operand', here());
    }
  };

  const jumpTo = (frame: Frame, q: Quad): void => {
    if (!q.result || q.result.kind !== 'label') {
      throw new TacRuntimeError('jump with unfilled target (backpatching incomplete?)', here());
    }
    const t = frame.lf.labels.get(q.result.name);
    if (t === undefined) {
      throw new TacRuntimeError(`undefined label ${q.result.name}`, here());
    }
    frame.pc = t; // will be incremented past the label quad below
  };

  const compare = (rel: string, a: Cell, b: Cell): boolean => {
    switch (rel) {
      case '==': return a.v === b.v;
      case '!=': return a.v !== b.v;
      case '<': return a.v < b.v;
      case '>': return a.v > b.v;
      case '<=': return a.v <= b.v;
      case '>=': return a.v >= b.v;
      default:
        throw new TacRuntimeError(`unknown relational operator ${rel}`, here());
    }
  };

  const arith = (op: string, a: Cell, b: Cell): Cell => {
    const f = a.f || b.f;
    switch (op) {
      case '+': return { v: a.v + b.v, f };
      case '-': return { v: a.v - b.v, f };
      case '*': return { v: a.v * b.v, f };
      case '/':
        if (b.v === 0) throw new TacRuntimeError('division by zero', here());
        return f ? { v: a.v / b.v, f: true } : { v: Math.trunc(a.v / b.v), f: false };
      case '%':
        if (f) throw new TacRuntimeError('% requires integer operands', here());
        if (b.v === 0) throw new TacRuntimeError('division by zero', here());
        return { v: a.v % b.v, f: false };
      default:
        throw new TacRuntimeError(`unknown arithmetic operator ${op}`, here());
    }
  };

  for (;;) {
    const frame = stack[stack.length - 1];
    if (!frame) throw new TacRuntimeError('empty call stack');
    if (frame.pc >= frame.lf.fn.quads.length) {
      // fell off the end without return — treat as `return` with value 0
      const done = popFrame(stack, ZERO, top);
      top = done.top;
      if (done.finished) return { returnValue: 0, steps };
      continue;
    }
    const q = frame.lf.fn.quads[frame.pc];
    if (!q) throw new TacRuntimeError('missing instruction', here());
    if (++steps > maxSteps) {
      throw new TacRuntimeError(`step limit of ${maxSteps} exceeded (infinite loop?)`, here());
    }

    switch (q.op) {
      case 'label':
        break;
      case 'goto':
        jumpTo(frame, q);
        break;
      case 'if':
        if (evalOperand(frame, q.arg1).v !== 0) jumpTo(frame, q);
        break;
      case 'iffalse':
        if (evalOperand(frame, q.arg1).v === 0) jumpTo(frame, q);
        break;
      case 'ifrel': {
        const a = evalOperand(frame, q.arg1);
        const b = evalOperand(frame, q.arg2);
        if (compare(q.relop ?? '==', a, b)) jumpTo(frame, q);
        break;
      }
      case 'copy':
        assign(frame, q.result, evalOperand(frame, q.arg1));
        break;
      case 'neg': {
        const a = evalOperand(frame, q.arg1);
        assign(frame, q.result, { v: -a.v, f: a.f });
        break;
      }
      case 'not': {
        const a = evalOperand(frame, q.arg1);
        assign(frame, q.result, { v: a.v === 0 ? 1 : 0, f: false });
        break;
      }
      case 'inttofloat': {
        const a = evalOperand(frame, q.arg1);
        assign(frame, q.result, { v: a.v, f: true });
        break;
      }
      case '+':
      case '-':
      case '*':
      case '/':
      case '%':
        assign(frame, q.result, arith(q.op, evalOperand(frame, q.arg1), evalOperand(frame, q.arg2)));
        break;
      case '==':
      case '!=':
      case '<':
      case '>':
      case '<=':
      case '>=': {
        const a = evalOperand(frame, q.arg1);
        const b = evalOperand(frame, q.arg2);
        assign(frame, q.result, { v: compare(q.op, a, b) ? 1 : 0, f: false });
        break;
      }
      case 'addr': {
        if (!q.arg1 || q.arg1.kind !== 'var') {
          throw new TacRuntimeError('& requires a variable operand', here());
        }
        assign(frame, q.result, { v: addrOfVar(frame, q.arg1.symbolId, q.arg1.name), f: false });
        break;
      }
      case 'deref-load': {
        const p = evalOperand(frame, q.arg1);
        assign(frame, q.result, readMem(p.v));
        break;
      }
      case 'deref-store': {
        const p = evalOperand(frame, q.result);
        mem.set(p.v, evalOperand(frame, q.arg1));
        break;
      }
      case 'index-load': {
        if (!q.arg1 || q.arg1.kind !== 'var') {
          throw new TacRuntimeError('index-load base must be an array name', here());
        }
        const base = addrOfVar(frame, q.arg1.symbolId, q.arg1.name);
        const off = evalOperand(frame, q.arg2).v;
        assign(frame, q.result, readMem(base + off));
        break;
      }
      case 'index-store': {
        if (!q.result || q.result.kind !== 'var') {
          throw new TacRuntimeError('index-store base must be an array name', here());
        }
        const base = addrOfVar(frame, q.result.symbolId, q.result.name);
        const off = evalOperand(frame, q.arg2).v;
        mem.set(base + off, evalOperand(frame, q.arg1));
        break;
      }
      case 'param':
        paramQueue.push(evalOperand(frame, q.arg1));
        break;
      case 'call': {
        if (!q.arg1 || q.arg1.kind !== 'var') {
          throw new TacRuntimeError('call target must name a function', here());
        }
        const n = evalOperand(frame, q.arg2).v;
        const callee = byName.get(q.arg1.name);
        if (!callee) throw new TacRuntimeError(`call to unknown function ${q.arg1.name}`, here());
        if (callee.fn.params.length !== n) {
          throw new TacRuntimeError(
            `${q.arg1.name} expects ${callee.fn.params.length} argument(s), got ${n}`,
            here(),
          );
        }
        const args = paramQueue.splice(paramQueue.length - n, n);
        const next = makeFrame(callee, q);
        for (let i = 0; i < callee.fn.params.length; i++) {
          const sid = callee.fn.params[i]!;
          const a = next.varAddr.get(sid);
          if (a !== undefined) mem.set(a, args[i] ?? ZERO);
        }
        stack.push(next);
        continue; // do not advance caller pc yet; return does that
      }
      case 'return': {
        const value = q.arg1 ? evalOperand(frame, q.arg1) : ZERO;
        const done = popFrame(stack, value, top);
        top = done.top;
        if (done.finished) return { returnValue: value.v, steps };
        continue;
      }
      default:
        throw new TacRuntimeError(`unknown TAC op ${q.op}`, here());
    }
    frame.pc += 1;
  }
}

function popFrame(
  stack: Frame[],
  value: Cell,
  top: number,
): { finished: boolean; top: number } {
  const frame = stack.pop();
  if (!frame) return { finished: true, top };
  const newTop = frame.frameBase; // release the frame's slots
  const caller = stack[stack.length - 1];
  if (!caller) return { finished: true, top: newTop };
  const callQuad = frame.callQuad;
  if (callQuad && callQuad.result) {
    if (callQuad.result.kind === 'temp') {
      caller.temps.set(callQuad.result.id, value);
    }
    // (call results into vars are not emitted by the generator, but handle
    // temps as the canonical case; anything else would have thrown earlier)
  }
  caller.pc += 1; // step past the call quad
  return { finished: false, top: newTop };
}

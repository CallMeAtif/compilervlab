/**
 * Final assembly emission: substitute the register assignment into the
 * selected (and possibly spill-rewritten) code, add the %rbp frame
 * prologue/epilogue (§8.3.2 activation records) and assemble the AsmProgram.
 * Every AsmLine carries tacIndex provenance back to its quad.
 *
 * Lab convention (stated in an emitted comment): int/char are 64-bit here;
 * every GP register a function writes is callee-saved in its prologue.
 */

import type { Recorded, Reducer, Steps, StepMeta } from '@lab/trace';
import { record } from '@lab/trace';
import { GP_REGISTERS } from './types.js';
import type { AsmLine, AsmProgram, InterferenceGraph, RegisterAssignment } from './types.js';
import type { Diagnostic } from '../common/types.js';
import type { TacProgram } from '../ir/types.js';
import type { SymbolEntry } from '../sem/types.js';
import type {
  ColorOutcome,
  EmitEvent,
  FunctionLiveness,
  InterferenceResult,
  IselResult,
  VInstr,
  VOperand,
} from './cg-events.js';
import { drainSteps, formatVInstr } from './cg-events.js';
import { selectInstructions } from './isel.js';
import { analyzeLiveness, useDef } from './liveness.js';
import { buildInterference } from './interference.js';
import { computeAllocation } from './color.js';

export type { EmitEvent } from './cg-events.js';

function cite(section: string, rule?: string): StepMeta['cite'] {
  const c: StepMeta['cite'] = { section };
  if (rule !== undefined) c.rule = rule;
  return c;
}

const FIXED_BASES = new Set(['%rbp', '%rsp', '%rip']);

// ---------------------------------------------------------------------------
// Substitution
// ---------------------------------------------------------------------------

function substOperand(o: VOperand, regOf: (name: string) => string): VOperand {
  switch (o.k) {
    case 'pseudo':
      return { k: 'phys', reg: regOf(o.name) };
    case 'mem': {
      const m: VOperand = { k: 'mem', base: o.base, offset: o.offset };
      if (m.k === 'mem') {
        if (o.sym !== undefined) m.sym = o.sym;
        if (o.base !== null && !o.base.startsWith('%')) m.base = regOf(o.base);
        if (o.index !== undefined) m.index = o.index.startsWith('%') ? o.index : regOf(o.index);
        if (o.scale !== undefined) m.scale = o.scale;
      }
      return m;
    }
    default:
      return o;
  }
}

function substInstr(i: VInstr, regOf: (name: string) => string): VInstr {
  const out: VInstr = { ...i, operands: i.operands.map((o) => substOperand(o, regOf)) };
  return out;
}

function isIdentityMove(i: VInstr): boolean {
  if (i.kind !== 'instr' || (i.mnemonic !== 'movq' && i.mnemonic !== 'movsd')) return false;
  const [a, b] = i.operands;
  return a !== undefined && b !== undefined && a.k === 'phys' && b.k === 'phys' && a.reg === b.reg;
}

// ---------------------------------------------------------------------------
// The traced algorithm
// ---------------------------------------------------------------------------

export function* emitProgram(
  isel: IselResult,
  colors: ColorOutcome[],
): Steps<EmitEvent, AsmProgram> {
  const lines: AsmLine[] = [];

  function* line(
    text: string,
    lineKind: AsmLine['kind'],
    tacIndex: number | null,
    functionName: string | null,
    meta: StepMeta,
  ): Steps<EmitEvent, void> {
    const l: AsmLine = { index: lines.length, text, kind: lineKind, tacIndex, functionName };
    lines.push(l);
    yield [
      { kind: 'line', line: { index: l.index, text, lineKind, tacIndex, functionName } },
      meta,
    ];
  }

  const header = (prose: string): StepMeta => ({
    cite: cite('8.2.1', 'assembly programs are sequences of labels, directives and instructions'),
    prose,
    level: 'micro',
    section: 'Header',
  });

  yield* line(
    '# Lab x86-64 subset (AT&T syntax). int/char are treated as 64-bit for simplicity.',
    'directive',
    null,
    null,
    header('State the lab simplification: int/char values occupy full 64-bit GP registers.'),
  );
  yield* line('.text', 'directive', null, null, header('Code goes in the .text section.'));
  yield* line('.globl main', 'directive', null, null, header('main is the entry point and must be visible to the loader.'));
  // Globals without an initializer are plain zero-filled reservations; the
  // initialized ones go to the data section below, where the assembler can lay
  // their value down (§7.1 static allocation).
  for (const g of isel.globals) {
    if (g.init) continue;
    yield* line(
      `.comm ${g.name}, ${g.size}`,
      'directive',
      null,
      null,
      {
        cite: cite('8.3.1', 'statically allocated storage in the data area'),
        prose: `Reserve ${g.size} zero-initialized bytes of static storage for global '${g.name}'.`,
        level: 'micro',
        section: 'Header',
      },
    );
  }

  const outcomeOf = new Map(colors.map((c) => [c.assignment.functionName, c]));

  for (const vfn of isel.functions) {
    const outcome = outcomeOf.get(vfn.name);
    if (!outcome) throw new Error(`no register assignment for function '${vfn.name}'`);
    const floatReg = new Map(vfn.floatPseudos.map((f) => [f.name, f.xmm]));
    const regOf = (name: string): string => {
      const fx = floatReg.get(name);
      if (fx !== undefined) return fx;
      const a = outcome.assignment.assignment[name];
      if (!a || !('reg' in a)) {
        throw new Error(`pseudo '${name}' in '${vfn.name}' has no register (spilled pseudos must be rewritten)`);
      }
      return a.reg;
    };

    const body = outcome.finalCode
      .map((i) => substInstr(i, regOf))
      .filter((i) => !isIdentityMove(i));

    // Callee-saved set: every allocatable GP register the body writes.
    const savedSet = new Set<string>();
    for (const i of body) {
      for (const d of useDef(i).def) if ((GP_REGISTERS as readonly string[]).includes(d)) savedSet.add(d);
    }
    const saved = GP_REGISTERS.filter((r) => savedSet.has(r));
    // %rsp must be ≡ 0 (mod 16) at every `call`. `call` pushed 8 bytes and
    // `pushq %rbp` another 8, so %rsp is 16-aligned right after the prologue's
    // move; the frame area AND the callee-save pushes that follow it must
    // therefore total a multiple of 16 — pad the frame when the number of
    // saved registers is odd.
    const savedBytes = 8 * saved.length;
    const frameBytes = Math.ceil((outcome.frame.size + savedBytes) / 16) * 16 - savedBytes;

    yield* line(`${vfn.name}:`, 'label', null, vfn.name, {
      cite: cite('8.3.2', 'each procedure has a label marking its entry point'),
      prose: `Function '${vfn.name}' begins.`,
      level: 'macro',
      section: `${vfn.name}: emit`,
    });
    const pro = (prose: string): StepMeta => ({
      cite: cite('8.3.2', 'the calling sequence saves the old frame pointer and allocates the activation record'),
      prose,
      level: 'micro',
      groupId: `${vfn.name}:prologue`,
      section: `${vfn.name}: emit`,
    });
    yield* line('pushq %rbp', 'instr', null, vfn.name, pro('Save the caller\'s frame pointer.'));
    yield* line('movq %rsp, %rbp', 'instr', null, vfn.name, pro('Establish this activation record\'s frame pointer.'));
    if (frameBytes > 0) {
      yield* line(`subq $${frameBytes}, %rsp`, 'instr', null, vfn.name, pro(`Allocate ${frameBytes} bytes for arrays, address-taken locals and spill slots (${outcome.frame.size} needed, padded so that with the ${saved.length} callee-save push${saved.length === 1 ? '' : 'es'} below %rsp stays 16-byte aligned at every call).`));
    }
    for (const r of saved) {
      yield* line(`pushq ${r}`, 'instr', null, vfn.name, pro(`Callee-save ${r} (lab convention: a function preserves every GP register it writes).`));
    }

    for (const i of body) {
      if (i.kind === 'label') {
        yield* line(`${i.label ?? ''}:`, 'label', i.tacIndex, vfn.name, {
          cite: cite('8.2.1', 'labels name instruction addresses'),
          prose: `Local label ${i.label ?? ''}.`,
          level: 'micro',
          groupId: `${vfn.name}:body`,
          section: `${vfn.name}: emit`,
        });
      } else {
        yield* line(formatVInstr(i), 'instr', i.tacIndex, vfn.name, {
          cite: cite('8.6', 'emit the target instruction with all names replaced by their assigned locations'),
          prose: `Emit '${formatVInstr(i)}'${i.spillOf !== undefined ? ` (spill traffic for '${i.spillOf}')` : ''}.`,
          level: 'micro',
          groupId: `${vfn.name}:body`,
          section: `${vfn.name}: emit`,
          irRefs: i.tacIndex !== null ? [{ kind: 'tacInstr', id: i.tacIndex }] : [],
        });
      }
    }

    const epi = (prose: string): StepMeta => ({
      cite: cite('8.3.2', 'the return sequence restores the saved registers and the caller\'s frame'),
      prose,
      level: 'micro',
      groupId: `${vfn.name}:epilogue`,
      section: `${vfn.name}: emit`,
    });
    yield* line(`.L${vfn.name}_ret:`, 'label', null, vfn.name, {
      cite: cite('8.3.2', 'a single return point simplifies the return sequence'),
      prose: `Shared return point of '${vfn.name}'.`,
      level: 'macro',
      section: `${vfn.name}: emit`,
    });
    for (const r of [...saved].reverse()) {
      yield* line(`popq ${r}`, 'instr', null, vfn.name, epi(`Restore callee-saved ${r}.`));
    }
    yield* line('movq %rbp, %rsp', 'instr', null, vfn.name, epi('Discard the activation record.'));
    yield* line('popq %rbp', 'instr', null, vfn.name, epi('Restore the caller\'s frame pointer.'));
    yield* line('ret', 'instr', null, vfn.name, epi('Return to the caller (result in %rax, or %xmm0 for float).'));
  }

  const initializedGlobals = isel.globals.filter((g) => g.init !== undefined);
  if (isel.floatConsts.length > 0 || initializedGlobals.length > 0) {
    yield* line('.data', 'directive', null, null, {
      cite: cite('8.3.1', 'constants live in statically allocated storage'),
      prose:
        initializedGlobals.length > 0
          ? 'Data section for the initialized globals and the pooled float constants.'
          : 'Data section for pooled float constants.',
      level: 'macro',
      section: 'Data',
    });
    for (const g of initializedGlobals) {
      const init = g.init!;
      yield* line(`${g.name}:`, 'label', null, null, {
        cite: cite('8.3.1', 'a statically allocated name labels its cell in the data area'),
        prose: `Static storage for global '${g.name}'.`,
        level: 'micro',
        section: 'Data',
      });
      const directive =
        init.ctype === 'float' ? `.double ${init.value}` : `.quad ${init.value}`;
      yield* line(directive, 'directive', null, null, {
        cite: cite('8.3.1', 'statically allocated storage is laid out with its initial value before execution begins (§7.1)'),
        prose: `'${g.name}' starts at ${init.value}: the assembler writes it into the data area, so no instruction has to.`,
        level: 'micro',
        section: 'Data',
      });
    }
    for (const fc of isel.floatConsts) {
      yield* line(`${fc.label}:`, 'label', null, null, {
        cite: cite('8.3.1', 'each constant gets a label'),
        prose: `Float constant ${fc.value}.`,
        level: 'micro',
        section: 'Data',
      });
      yield* line(`.double ${fc.value}`, 'directive', null, null, {
        cite: cite('8.3.1', 'the assembler reserves and initializes the storage'),
        prose: `Storage for ${fc.value} (IEEE double).`,
        level: 'micro',
        section: 'Data',
      });
    }
  }

  const result: AsmProgram = { lines };
  yield [
    { kind: 'done', lineCount: lines.length },
    {
      cite: cite('8.2.1', 'the emitted program is complete'),
      prose: `Assembly emission complete: ${lines.length} line(s).`,
      level: 'macro',
      section: 'Done',
    },
  ];
  return result;
}

// ---------------------------------------------------------------------------
// UI state + reducer
// ---------------------------------------------------------------------------

export interface EmitState {
  lines: AsmLine[];
  done: boolean;
}

export function initialEmitState(): EmitState {
  return { lines: [], done: false };
}

export const emitReducer: Reducer<EmitState, EmitEvent> = (s, e) => {
  switch (e.kind) {
    case 'line':
      return {
        ...s,
        lines: [
          ...s.lines,
          {
            index: e.line.index,
            text: e.line.text,
            kind: e.line.lineKind,
            tacIndex: e.line.tacIndex,
            functionName: e.line.functionName,
          },
        ],
      };
    case 'done':
      return { ...s, done: true };
  }
};

export function projectEmit(r: AsmProgram): EmitState {
  return { lines: r.lines, done: true };
}

/** Convenience: record an emission trace. */
export function runEmit(
  isel: IselResult,
  colors: ColorOutcome[],
  id = 'codegen.emit',
): Recorded<EmitState, EmitEvent, AsmProgram> {
  return record(() => emitProgram(isel, colors), initialEmitState(), emitReducer, { id });
}

// ---------------------------------------------------------------------------
// Whole-phase pipeline convenience (untraced)
// ---------------------------------------------------------------------------

export interface CodegenArtifacts {
  isel: IselResult;
  liveness: FunctionLiveness[];
  interference: InterferenceResult[];
  colors: ColorOutcome[];
  asm: AsmProgram;
  /** Contract views for Compilation. */
  interferenceGraphs: InterferenceGraph[];
  registers: RegisterAssignment[];
  diagnostics: Diagnostic[];
}

/** Run the full code-generation pipeline untraced (worker/pipeline use). */
export function codegen(program: TacProgram, symbols?: SymbolEntry[]): CodegenArtifacts {
  const isel = drainSteps(selectInstructions(program, symbols));
  const liveness = drainSteps(analyzeLiveness(isel));
  const interference = drainSteps(buildInterference(isel, liveness));
  const colors = computeAllocation(isel);
  const asm = drainSteps(emitProgram(isel, colors));
  return {
    isel,
    liveness,
    interference,
    colors,
    asm,
    interferenceGraphs: interference.map((i) => i.graph),
    registers: colors.map((c) => c.assignment),
    diagnostics: isel.diagnostics,
  };
}

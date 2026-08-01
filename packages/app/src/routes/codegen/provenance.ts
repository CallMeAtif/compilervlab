/**
 * Provenance for the emitted assembly: asm line → quad → source span.
 *
 * `AsmLine` already carries `tacIndex` + `functionName`; the rest is a lookup
 * through the optimized TAC (which is what code generation ran on) and the AST
 * node each quad was translated from.
 *
 * The prologue / epilogue / spill classification comes from the emit trace's
 * own step metadata (`groupId`, and the prose the emitter wrote), so the labels
 * cannot drift from what the algorithm actually did.
 */
import type { Compilation } from '@lab/core';
import type { EmitEvent, EmitState } from '@lab/core/codegen/emit.js';
import type { Quad } from '@lab/core/ir/types.js';
import type { SourceSpan, Trace } from '@lab/trace';

export type LineRole = 'header' | 'prologue' | 'body' | 'epilogue' | 'data' | 'other';

export interface LineNote {
  role: LineRole;
  /** Set on spill loads/stores: the value that lives in memory. */
  spillOf: string | null;
}

const SPILL_RE = /spill traffic for '([^']+)'/;

/** One pass over the recorded emit steps; the map is keyed by line index. */
export function lineNotes(trace: Trace<EmitState, EmitEvent>): Map<number, LineNote> {
  const out = new Map<number, LineNote>();
  for (const step of trace.steps) {
    if (step.event.kind !== 'line') continue;
    const group = step.meta.groupId ?? '';
    const section = step.meta.section ?? '';
    const text = step.event.line.text;
    const role: LineRole = group.endsWith(':prologue')
      ? 'prologue'
      : group.endsWith(':epilogue') || /_ret:$/.test(text)
        ? 'epilogue'
        : group.endsWith(':body')
          ? 'body'
          : section === 'Header'
            ? 'header'
            : section === 'Data'
              ? 'data'
              : 'other';
    const m = SPILL_RE.exec(step.meta.prose);
    out.set(step.event.line.index, { role, spillOf: m?.[1] ?? null });
  }
  return out;
}

/** The quad an asm line was selected from, if any. */
export function quadFor(
  compilation: Compilation,
  functionName: string | null,
  tacIndex: number | null,
): Quad | null {
  if (functionName === null || tacIndex === null) return null;
  const fn = compilation.optimized?.output.functions.find((f) => f.name === functionName);
  if (!fn) return null;
  return fn.quads.find((q) => q.index === tacIndex) ?? null;
}

/** The source span the quad came from (via its AST node). */
export function spanFor(compilation: Compilation, quad: Quad | null): SourceSpan | null {
  if (quad === null || compilation.ast === null) return null;
  const nodes = compilation.ast.nodes;
  const direct = nodes[quad.astNodeId];
  if (direct && direct.id === quad.astNodeId) return direct.span;
  return nodes.find((n) => n.id === quad.astNodeId)?.span ?? null;
}

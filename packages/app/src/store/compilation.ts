/**
 * The single Zustand store driving every view. One immutable Compilation at a
 * time; editing the source marks views stale — it NEVER auto-recompiles.
 */
import { create } from 'zustand';
import type { Compilation, Diagnostic, Phase } from '@lab/core';
import { getCompilerClient, type PipelineInfo } from '../worker/api';
import { DEFAULT_EXAMPLE_ID, exampleById } from '../examples';

export interface CompilationStore {
  source: string;
  selectedExample: string;
  compilation: Compilation | null;
  /** True when the source has been edited since `compilation` was produced. */
  stale: boolean;
  compiling: boolean;
  /** Last compile failure (worker crash etc.), not a diagnostic. */
  compileError: string | null;
  /** Source-independent parser facts, fetched once alongside the first compile. */
  pipelineInfo: PipelineInfo | null;

  setSource: (source: string) => void;
  selectExample: (id: string) => void;
  compile: () => Promise<void>;
}

const defaultSource = exampleById(DEFAULT_EXAMPLE_ID)?.source ?? '';

export const useCompilationStore = create<CompilationStore>((set, get) => ({
  source: defaultSource,
  selectedExample: DEFAULT_EXAMPLE_ID,
  compilation: null,
  stale: false,
  compiling: false,
  compileError: null,
  pipelineInfo: null,

  setSource: (source) =>
    set((s) => ({
      source,
      stale: s.compilation !== null && source !== s.compilation.source,
    })),

  selectExample: (id) => {
    const example = exampleById(id);
    if (!example) return;
    set((s) => ({
      selectedExample: id,
      source: example.source,
      stale: s.compilation !== null && example.source !== s.compilation.source,
    }));
  },

  compile: async () => {
    if (get().compiling) return;
    const source = get().source;
    set({ compiling: true, compileError: null });
    try {
      const client = getCompilerClient();
      const compilation = await client.compile(source);
      set({
        compilation,
        // Edits made while the worker was busy keep the stale flag honest.
        stale: get().source !== source,
        compiling: false,
      });
      // Parser facts never change; fetch them once, after the first compile has
      // already warmed the LALR tables in the worker.
      if (get().pipelineInfo === null) {
        void client
          .getPipelineInfo()
          .then((pipelineInfo) => set({ pipelineInfo }))
          .catch(() => undefined);
      }
    } catch (err) {
      set({
        compiling: false,
        compileError: err instanceof Error ? err.message : String(err),
      });
    }
  },
}));

// ── Pipeline stage status (drives the top-bar chips + overview diagram) ──────

export type StageStatus = 'ok' | 'errors' | 'stale' | 'pending';

const PHASE_ORDER: readonly Phase[] = ['lex', 'syntax', 'semantic', 'ir', 'opt', 'codegen'];

function artifactPresent(c: Compilation, phase: Phase): boolean {
  switch (phase) {
    case 'lex':
      return c.tokens !== null;
    case 'syntax':
      return c.ast !== null;
    case 'semantic':
      return c.semantic !== null;
    case 'ir':
      return c.tac !== null;
    case 'opt':
      return c.optimized !== null;
    case 'codegen':
      return c.asm !== null;
  }
}

export function phaseDiagnostics(c: Compilation | null, phase: Phase): Diagnostic[] {
  return c ? c.diagnostics.filter((d) => d.phase === phase) : [];
}

export function stageStatus(
  compilation: Compilation | null,
  stale: boolean,
  phase: Phase,
): StageStatus {
  if (compilation === null) return 'pending';
  if (stale) return 'stale';
  if (compilation.diagnostics.some((d) => d.phase === phase && d.severity === 'error')) {
    return 'errors';
  }
  return artifactPresent(compilation, phase) ? 'ok' : 'pending';
}

export function allStageStatuses(
  compilation: Compilation | null,
  stale: boolean,
): Record<Phase, StageStatus> {
  const out = {} as Record<Phase, StageStatus>;
  for (const p of PHASE_ORDER) out[p] = stageStatus(compilation, stale, p);
  return out;
}

/** Everything a stage chip needs, in one call. */
export interface StageInfo {
  status: StageStatus;
  errors: number;
  warnings: number;
  /**
   * One-line artifact summary ("95 tokens · 8 identifiers"), or the error count
   * when the phase failed, or null when there is nothing to say yet.
   */
  summary: string | null;
}

export function stageInfo(
  compilation: Compilation | null,
  stale: boolean,
  phase: Phase,
  summarize: (c: Compilation) => string | null,
): StageInfo {
  const status = stageStatus(compilation, stale, phase);
  const ds = phaseDiagnostics(compilation, phase);
  const errors = ds.filter((d) => d.severity === 'error').length;
  const warnings = ds.length - errors;

  let summary: string | null = null;
  if (errors > 0) {
    summary = `${errors} error${errors === 1 ? '' : 's'}`;
    if (warnings > 0) summary += ` · ${warnings} warning${warnings === 1 ? '' : 's'}`;
  } else if (compilation && !stale) {
    summary = summarize(compilation);
    if (summary && warnings > 0) {
      summary += ` · ${warnings} warning${warnings === 1 ? '' : 's'}`;
    }
  } else if (compilation && stale) {
    // Keep the last known shape visible, dimmed by the 'stale' chip styling.
    summary = summarize(compilation);
  }
  return { status, errors, warnings, summary };
}

export { PHASE_ORDER };

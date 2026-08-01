/**
 * Typed Comlink client for the compile worker. The worker owns all heavy
 * compilation + trace construction; the UI thread only ever sees
 * JSON-serializable artifacts and SerializedTrace payloads.
 */
import * as Comlink from 'comlink';
import type { Compilation, Diagnostic } from '@lab/core';
import type { SerializedTrace } from '@lab/trace';
import type { TraceKind } from './trace-kinds';

export interface TraceRequest {
  /** Trace kind — a key of TRACE_KINDS in ./trace-kinds.ts (e.g. 'syntax.lalr'). */
  kind: TraceKind | (string & {});
  /** Kind-specific parameters (grammar id, source, pass name, …). */
  params: Record<string, unknown>;
}

/** Serialized trace payloads are opaque on the UI thread until a phase route
 *  rebuilds them with its reducer via `traceFromSerialized`. */
export type AnySerializedTrace = SerializedTrace<unknown, { kind: string }>;

export interface TraceResponse {
  /** null when the trace could not be built (bad request, or upstream error). */
  trace: AnySerializedTrace | null;
  /**
   * Why `trace` is null. For source-dependent kinds these are the compilation's
   * own diagnostics (the same ones the overview lists), so a phase route can
   * explain "no IR trace because semantic analysis failed" without re-deriving
   * anything. Empty when `trace` is non-null.
   */
  diagnostics: Diagnostic[];
}

/**
 * Facts about the parser the pipeline actually uses. They depend only on the
 * C-subset grammar (not on the source), the worker memoizes the tables, and
 * they are far too expensive to derive on the UI thread — so the store fetches
 * them once and the syntax stage chip reports them.
 */
export interface PipelineInfo {
  grammarName: string;
  productions: number;
  terminals: number;
  nonterminals: number;
  /** LALR(1) states of the pipeline parser, and the LR(1) states they merge. */
  lalrStates: number;
  lr1States: number;
  /** Dangling-else shift/reduce conflicts resolved by shift (§4.8.2). */
  resolvedConflicts: number;
}

export interface CompilerWorkerApi {
  compile(source: string): Promise<Compilation>;
  /** Source-independent facts about the pipeline's LALR(1) parser. */
  getPipelineInfo(): Promise<PipelineInfo>;
  /** Convenience: the payload only, or null. */
  getTrace(req: TraceRequest): Promise<AnySerializedTrace | null>;
  /** The payload plus the diagnostics explaining a null. */
  getTraceOrError(req: TraceRequest): Promise<TraceResponse>;
}

let client: Comlink.Remote<CompilerWorkerApi> | null = null;

/** Lazily create (and reuse) the compile worker. */
export function getCompilerClient(): Comlink.Remote<CompilerWorkerApi> {
  if (!client) {
    const worker = new Worker(new URL('./compile.worker.ts', import.meta.url), {
      type: 'module',
      name: 'cvl-compile',
    });
    client = Comlink.wrap<CompilerWorkerApi>(worker);
  }
  return client;
}

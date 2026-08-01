/**
 * Compile worker — Comlink-exposed. Thin: the pipeline lives in @lab/core and
 * every recorded algorithm run lives in ./registry.ts (keyed by the manifest in
 * ./trace-kinds.ts). This file only marshals across the worker boundary.
 */
import * as Comlink from 'comlink';
import type { Compilation } from '@lab/core';
import { compile as coreCompile, pipelineTables } from '@lab/core';
import type {
  AnySerializedTrace,
  CompilerWorkerApi,
  PipelineInfo,
  TraceRequest,
  TraceResponse,
} from './api';
import { buildTrace } from './registry';

const api: CompilerWorkerApi = {
  async compile(source: string): Promise<Compilation> {
    return coreCompile(source);
  },

  async getPipelineInfo(): Promise<PipelineInfo> {
    const { grammar, lalr, resolutions } = pipelineTables(); // memoized in core
    return {
      grammarName: grammar.name,
      productions: grammar.productions.length,
      terminals: grammar.terminals.length,
      nonterminals: grammar.nonterminals.length,
      lalrStates: lalr.states.length,
      lr1States: lalr.lr1StateCount,
      resolvedConflicts: resolutions.length,
    };
  },

  /** The payload only — the UI reads `store.compilation.diagnostics` for the why. */
  async getTrace(req: TraceRequest): Promise<AnySerializedTrace | null> {
    return buildTrace(req).trace;
  },

  /** The payload plus the diagnostics that explain a null payload. */
  async getTraceOrError(req: TraceRequest): Promise<TraceResponse> {
    return buildTrace(req);
  },
};

Comlink.expose(api);

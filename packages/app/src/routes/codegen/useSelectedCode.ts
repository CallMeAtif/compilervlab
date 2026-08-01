/**
 * The selected ("virtual") code every later code-generation stage talks about.
 *
 * `codegen.liveness`, `codegen.interference` and `codegen.color` all reference
 * instructions by index but do not carry the instruction listing themselves, so
 * the tabs read the FINAL state of the `codegen.isel` trace — the exact code
 * those algorithms ran on — and index into it.
 */
import { useMemo } from 'react';
import { iselReducer } from '@lab/core/codegen/isel.js';
import type { IselEvent, IselState } from '@lab/core/codegen/isel.js';
import type { VFunction } from '@lab/core/codegen/cg-events.js';
import { useCodegenTrace, type TraceStatus } from './useCodegenTrace';

export interface SelectedCode {
  status: TraceStatus;
  functions: readonly VFunction[];
  byName: ReadonlyMap<string, VFunction>;
}

export function useSelectedCode(source: string, enabled = true): SelectedCode {
  const result = useCodegenTrace<IselState, IselEvent>(
    'codegen.isel',
    { source },
    iselReducer,
    enabled,
  );
  return useMemo(() => {
    const functions = result.trace?.final().functions ?? [];
    return {
      status: result.status,
      functions,
      byName: new Map(functions.map((f) => [f.name, f])),
    };
  }, [result.trace, result.status]);
}

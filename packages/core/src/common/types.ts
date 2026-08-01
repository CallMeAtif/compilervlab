import type { SourceSpan } from '@lab/trace';

export type { SourceSpan };

export type Phase = 'lex' | 'syntax' | 'semantic' | 'ir' | 'opt' | 'codegen';

export interface Diagnostic {
  phase: Phase;
  severity: 'error' | 'warning';
  message: string; // what failed
  rule?: string; // which rule (educational: cite the C-subset rule text)
  hint?: string; // why / how to fix
  span: SourceSpan;
}

export function span(start: number, end: number, line: number, col: number): SourceSpan {
  return { start, end, line, col };
}

/** Deterministic id counters — reset per compilation so artifacts are reproducible. */
export class IdGen {
  private next = 0;
  fresh(): number {
    return this.next++;
  }
}

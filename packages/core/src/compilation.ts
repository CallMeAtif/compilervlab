/**
 * The single immutable Compilation object that drives every phase view.
 * Produced by compile() (wired during integration); each field is the frozen
 * contract owned by one phase team.
 */
import type { Diagnostic } from './common/types.js';
import type { TokenStream } from './csubset/tokens.js';
import type { Ast } from './ast/types.js';
import type { SemanticInfo } from './sem/types.js';
import type { TacProgram } from './ir/types.js';
import type { OptimizedProgram } from './opt/types.js';
import type { AsmProgram, InterferenceGraph, RegisterAssignment } from './codegen/types.js';

export interface Compilation {
  id: string; // hash of (source, options) — deep-link stability
  source: string;
  /** Phase artifacts; a phase is null if an earlier phase errored fatally. */
  tokens: TokenStream | null;
  ast: Ast | null;
  semantic: SemanticInfo | null;
  tac: TacProgram | null;
  optimized: OptimizedProgram | null;
  asm: AsmProgram | null;
  interference: InterferenceGraph[] | null;
  registers: RegisterAssignment[] | null;
  diagnostics: Diagnostic[]; // all phases, ordered by phase then span
}

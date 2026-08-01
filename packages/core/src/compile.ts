/**
 * The whole compiler, run eagerly and untraced: source → Compilation.
 *
 *   scan (§3.8)            → TokenStream
 *   LALR(1) pipeline parse → Ast              (ast/parser.ts — our own table)
 *   semantic analysis      → SemanticInfo
 *   TAC generation (§6)    → TacProgram
 *   optimization (§8/§9)   → OptimizedProgram (const-fold, const-prop,
 *                                              copy-prop, cse, licm, dce)
 *   code generation (§8.8) → AsmProgram + interference graphs + assignments
 *
 * Staging rule: a stage runs only if every earlier stage produced a usable
 * artifact AND emitted no `severity: 'error'` diagnostic. The erroring stage
 * still publishes whatever it produced (so the UI can show the tokens that led
 * to a syntax error, or the symbol table that led to a type error); every
 * downstream artifact stays `null`.
 *
 * Fully deterministic: no clocks, no randomness, no ambient state — the same
 * source always yields the same Compilation, which is what makes `?step=`
 * deep links stable.
 */
import type { Diagnostic, Phase } from './common/types.js';
import { fnv1a } from './common/hash.js';
import type { TokenStream } from './csubset/tokens.js';
import type { Ast } from './ast/types.js';
import type { SemanticInfo } from './sem/types.js';
import type { TacProgram } from './ir/types.js';
import type { OptimizedProgram, OptPassName } from './opt/types.js';
import type {
  AsmProgram,
  InterferenceGraph,
  RegisterAssignment,
} from './codegen/types.js';
import type { Compilation } from './compilation.js';

import { scan } from './lex/scanner.js';
import { parse } from './ast/parser.js';
import { analyze } from './sem/typecheck.js';
import { generateTac } from './ir/gen.js';
import { optimize, PIPELINE_ORDER } from './opt/passes/pipeline.js';
import { codegen } from './codegen/emit.js';

/** Run a Steps<E, R> generator to completion, discarding the events. */
function drain<E, R>(gen: Generator<[E, unknown], R, void>): R {
  let it = gen.next();
  while (!it.done) it = gen.next();
  return it.value;
}

/** The optimization sequence the pipeline applies by default (§8.5, §9). */
export const DEFAULT_OPT_PASSES: readonly OptPassName[] = PIPELINE_ORDER;

export interface CompileOptions {
  /** Override the default optimization sequence (still applied in pipeline order). */
  passes?: OptPassName[];
}

const PHASE_RANK: Record<Phase, number> = {
  lex: 0,
  syntax: 1,
  semantic: 2,
  ir: 3,
  opt: 4,
  codegen: 5,
};

/** Diagnostics are presented phase-by-phase, then in source order. */
function orderDiagnostics(ds: Diagnostic[]): Diagnostic[] {
  return [...ds].sort((a, b) => {
    const p = PHASE_RANK[a.phase] - PHASE_RANK[b.phase];
    if (p !== 0) return p;
    if (a.span.start !== b.span.start) return a.span.start - b.span.start;
    if (a.span.end !== b.span.end) return a.span.end - b.span.end;
    return 0;
  });
}

function hasError(ds: readonly Diagnostic[]): boolean {
  return ds.some((d) => d.severity === 'error');
}

/**
 * An internal-error diagnostic. A thrown exception inside a phase is a bug in
 * the lab, not in the student's program — we surface it as a diagnostic on that
 * phase rather than letting it take down the worker.
 */
function crashDiagnostic(phase: Phase, err: unknown): Diagnostic {
  const message = err instanceof Error ? err.message : String(err);
  return {
    phase,
    severity: 'error',
    message: `Internal compiler error in the ${phase} phase: ${message}`,
    hint: 'This is a defect in the lab, not in your program. Please report the source that triggered it.',
    span: { start: 0, end: 0, line: 1, col: 1 },
  };
}

/**
 * Compile `source` end-to-end. Never throws: every failure becomes a
 * Diagnostic and leaves the affected artifacts null.
 */
export function compile(source: string, options: CompileOptions = {}): Compilation {
  const diagnostics: Diagnostic[] = [];

  let tokens: TokenStream | null = null;
  let ast: Ast | null = null;
  let semantic: SemanticInfo | null = null;
  let tac: TacProgram | null = null;
  let optimized: OptimizedProgram | null = null;
  let asm: AsmProgram | null = null;
  let interference: InterferenceGraph[] | null = null;
  let registers: RegisterAssignment[] | null = null;

  const finish = (): Compilation => ({
    id: `c-${fnv1a(source)}`,
    source,
    tokens,
    ast,
    semantic,
    tac,
    optimized,
    asm,
    interference,
    registers,
    diagnostics: orderDiagnostics(diagnostics),
  });

  // ── 1. Lexical analysis ───────────────────────────────────────────────────
  try {
    const scanned = drain(scan(source));
    tokens = { tokens: scanned.tokens, symbols: scanned.symbols };
    diagnostics.push(...scanned.errors);
    if (hasError(scanned.errors)) return finish();
  } catch (err) {
    diagnostics.push(crashDiagnostic('lex', err));
    return finish();
  }

  // ── 2. Syntax analysis (the LALR(1) machine built by grammar/lalr.ts) ─────
  try {
    const parsed = parse(tokens);
    diagnostics.push(...parsed.diagnostics);
    ast = parsed.ast;
    if (ast === null || hasError(parsed.diagnostics)) return finish();
  } catch (err) {
    diagnostics.push(crashDiagnostic('syntax', err));
    return finish();
  }

  // ── 3. Semantic analysis ──────────────────────────────────────────────────
  try {
    const info = drain(analyze(ast));
    semantic = info;
    diagnostics.push(...info.diagnostics);
    if (hasError(info.diagnostics)) return finish();
  } catch (err) {
    diagnostics.push(crashDiagnostic('semantic', err));
    return finish();
  }

  // ── 4. Intermediate code generation ───────────────────────────────────────
  try {
    tac = drain(generateTac(ast, semantic));
  } catch (err) {
    diagnostics.push(crashDiagnostic('ir', err));
    return finish();
  }

  // ── 5. Machine-independent optimization ───────────────────────────────────
  try {
    optimized = drain(optimize(tac, { passes: [...(options.passes ?? PIPELINE_ORDER)] }));
  } catch (err) {
    diagnostics.push(crashDiagnostic('opt', err));
    return finish();
  }

  // ── 6. Code generation + register allocation ──────────────────────────────
  try {
    const cg = codegen(optimized.output, semantic.symbols);
    asm = cg.asm;
    interference = cg.interferenceGraphs;
    registers = cg.registers;
    diagnostics.push(...cg.diagnostics);
  } catch (err) {
    diagnostics.push(crashDiagnostic('codegen', err));
    return finish();
  }

  return finish();
}

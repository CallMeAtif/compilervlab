// Contracts (frozen — changes require cross-phase review; see docs/PLAN.md)
export * from './common/types.js';
export * from './common/hash.js';
export * from './csubset/tokens.js';
export * from './csubset/regex.js';
export * from './csubset/grammar-def.js';
export * from './grammar/grammar.js';
export * from './ast/types.js';
export * from './sem/types.js';
export * from './ir/types.js';
export * from './opt/types.js';
export * from './codegen/types.js';
export * from './compilation.js';

// ── Phase implementations ────────────────────────────────────────────────────
// Every phase module exports its traced generator, its event union, its UI
// reducer + initial state, a `run*` recorder and (usually) an untraced
// convenience. They are also reachable individually via the './*' subpath
// export (e.g. `@lab/core/lex/scanner.js`) — the phase UIs import reducers that
// way to keep their bundles small; this barrel is for cross-phase consumers.

// Lexical analysis (§3)
export * from './lex/types.js';
export * from './lex/events.js';
export * from './lex/reducers.js';
export * from './lex/thompson.js';
export * from './lex/subset-construction.js';
export * from './lex/minimize.js';
export * from './lex/scanner.js';

// Syntax analysis — LL family (§4.3–4.4)
export * from './grammar/ll-util.js';
export * from './grammar/first-follow.js';
export * from './grammar/ll1-table.js';
export * from './grammar/ll1-parse.js';
export * from './grammar/recursive-descent.js';
export * from './grammar/transforms.js';

// Syntax analysis — LR family (§4.5–4.7)
export * from './grammar/lr-first.js';
export * from './grammar/lr-events.js';
export * from './grammar/lr0-items.js';
export * from './grammar/slr-table.js';
export * from './grammar/lr1-items.js';
export * from './grammar/lalr.js';
export * from './grammar/lr-parse.js';

// The pipeline parser + AST construction
export * from './ast/build.js';
export * from './ast/parser.js';

// Semantic analysis (§2.7, §6.3, §6.5)
export * from './sem/sem-events.js';
export * from './sem/scopes.js';
export * from './sem/typecheck.js';

// Intermediate code (§6) + the TAC oracle
export * from './ir/ir-events.js';
export * from './ir/backpatch.js';
export * from './ir/gen.js';
export * from './ir/views.js';
export * from './interp/tac.js';

// Optimization (§8.4–8.5, §9)
export * from './opt/basic-blocks.js';
export * from './opt/cfg.js';
export * from './opt/dataflow.js';
export * from './opt/dominators.js';
export * from './opt/loops.js';
export * from './opt/opt-events.js';
export * from './opt/passes/util.js';
export * from './opt/passes/const-fold.js';
export * from './opt/passes/const-prop.js';
export * from './opt/passes/copy-prop.js';
export * from './opt/passes/cse.js';
export * from './opt/passes/dce.js';
export * from './opt/passes/licm.js';
export * from './opt/passes/pipeline.js';

// Code generation (§8.6–8.8) + the asm oracle
export * from './codegen/cg-events.js';
export * from './codegen/isel.js';
export * from './codegen/liveness.js';
export * from './codegen/interference.js';
export * from './codegen/color.js';
export * from './codegen/emit.js';
export * from './interp/asm.js';

// The end-to-end driver
export * from './compile.js';

// ── Ambiguity resolutions ────────────────────────────────────────────────────
// Names that more than one of the modules above exports. TS reports these as
// TS2308 unless the barrel names a single winner explicitly. Each choice is the
// definition site (re-exports elsewhere are convenience aliases of the same
// value), except where noted.

// `drain` exists in three flavours (LL helpers, LR helpers, opt helpers) — all
// "run the generator, keep the result". The LL one is the canonical helper;
// the others stay reachable via their subpaths and under the aliases below.
export { drain } from './grammar/ll-util.js';
export { drain as drainLrSteps } from './grammar/lr-events.js';
export { drain as drainPassSteps } from './opt/passes/util.js';

// FIRST-of-a-string: the LL implementation works on FirstFollowResult, the LR
// one on the raw Record<string, TerminalSet> used by the item-set machinery.
export { firstOfString } from './grammar/first-follow.js';
export { firstOfString as firstOfStringLr } from './grammar/lr-first.js';

// Set helpers: the dataflow module owns them; ll-util has its own symbol-set
// variants (`sortSet` over grammar symbols vs over TAC variable names).
export { sortSet } from './opt/dataflow.js';
export { sortSet as sortSymbolSet } from './grammar/ll-util.js';
export { union, intersection, sameSet } from './opt/dataflow.js';

// Re-exported contract types / helpers (identical values, two export sites).
export { formatQuad } from './ir/types.js';
export type { TacProgram, TacFunction, Quad } from './ir/types.js';
export type { SemanticInfo } from './sem/types.js';
export { RULE, initialSemState, projectSemanticInfo, semReducer } from './sem/sem-events.js';
export type { SemEvent, SemState } from './sem/sem-events.js';
export type { Lr0ItemJson, Lr1ItemJson } from './grammar/lr-events.js';
export type {
  IselEvent,
  IselResult,
  VFunction,
  VInstr,
  VOperand,
  FunctionLiveness,
  LivenessEvent,
  InterferenceEvent,
  InterferenceResult,
  ColorEvent,
  ColorOutcome,
  EmitEvent,
  AsmExecEvent,
  AsmRunResult,
} from './codegen/cg-events.js';
export { cmpName } from './codegen/cg-events.js';
export type { AsmLine } from './codegen/types.js';

// Basic-block/instruction label indices: the opt one maps label → quad index,
// the codegen one maps label → VInstr index (`labelIndexOf`), so only the
// former needs disambiguating against the dataflow re-export.
export { labelIndex } from './opt/basic-blocks.js';

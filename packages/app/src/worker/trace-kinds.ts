/**
 * THE TRACE-KIND MANIFEST — the contract between the compile worker and the six
 * phase UIs.
 *
 * The worker (`compile.worker.ts`) owns every recorded algorithm run and hands
 * the UI a `SerializedTrace` (JSON: `{ id, steps, initial, truncated,
 * keyframeEvery }`). To get a replayable trace back, the UI rebuilds it locally
 * with the algorithm's *pure reducer*:
 *
 * ```ts
 * import { traceFromSerialized } from '@lab/trace';
 * import { lr0Reducer, type Lr0UiState, type Lr0Event } from '@lab/core/grammar/lr0-items.js';
 * import { getCompilerClient } from '../../worker/api';
 *
 * const payload = await getCompilerClient().getTrace({
 *   kind: 'syntax.lr0',
 *   params: { grammarId: 'dragon-4.1' },
 * });
 * if (payload) {
 *   const trace = traceFromSerialized<Lr0UiState, Lr0Event>(payload as never, lr0Reducer);
 *   const state = trace.stateAt(step);   // O(1)-ish via keyframes
 * }
 * ```
 *
 * `payload.initial` already carries the correct initial state, so
 * `traceFromSerialized` never needs the `initialState` export listed below —
 * that export is documented so a route can type its state, render an empty view
 * before the payload arrives, and (for the grammar-parameterised ones) rebuild
 * the same value locally if it wants to.
 *
 * Import paths: the `module` field is a subpath of `@lab/core`
 * (`@lab/core/<module>`, `.js` extension included — the package maps
 * `./*` → `./src/*` and both `tsc` and Vite resolve it). Importing a reducer
 * from its own module (rather than the `@lab/core` barrel) is what keeps a
 * phase route's chunk small.
 *
 * ⚠️  Keep this file in sync with `compile.worker.ts`. `TRACE_KINDS` is the
 * single source of truth for kind names; `TraceKind` is derived from it, and
 * the worker registry is keyed by the same union.
 */

// ── Manifest shape ───────────────────────────────────────────────────────────

/** One request parameter of a trace kind. */
export interface ParamSpec {
  /** What it means and what values are legal. */
  description: string;
  /** Omit it and the worker falls back to the documented default. */
  optional?: boolean;
  /** Enumerated legal values, when the parameter is a closed set. */
  values?: readonly string[];
}

/** Where the UI gets the reducer that replays a payload of this kind. */
export interface ReducerSpec {
  /** `@lab/core` subpath, e.g. 'grammar/lr0-items.js'. */
  module: string;
  /** Named export of `Reducer<S, E>`. */
  reducer: string;
  /**
   * Named export of the initial state. `kind: 'const'` is a plain value,
   * `'function'` is a zero-arg factory, `'factory'` needs arguments (listed in
   * `initialStateArgs`) — in every case `payload.initial` already holds the
   * value the worker used.
   */
  initialState: string;
  initialStateKind: 'const' | 'function' | 'factory';
  /** Arguments of a `'factory'` initial state, in order. */
  initialStateArgs?: readonly string[];
  /** Exported type name of the replayed state (same module). */
  stateType: string;
  /** Exported type name of the event union (same module). */
  eventType: string;
}

export interface TraceKindSpec extends ReducerSpec {
  /** What the trace shows, in one line. */
  description: string;
  /** Dragon Book anchor for the algorithm being traced. */
  cite: string;
  params: Readonly<Record<string, ParamSpec>>;
  /**
   * Some kinds dispatch on a parameter: the payload's reducer then depends on
   * that parameter's value. When present, the top-level reducer fields describe
   * the *default* variant and `variants[value]` overrides them.
   */
  variantParam?: string;
  variants?: Readonly<Record<string, ReducerSpec>>;
  /** Non-obvious behaviour the route has to handle (caps, truncation, …). */
  notes?: string;
}

// ── Shared parameter descriptions ────────────────────────────────────────────

/** Legal `grammarId` values: the study grammars plus the LL-ready C grammar. */
export const GRAMMAR_IDS = [
  'c-subset',
  'c-subset-ll',
  'dragon-4.1',
  'dragon-4.28',
  'dragon-4.55',
] as const;
export type GrammarId = (typeof GRAMMAR_IDS)[number];

const GRAMMAR_PARAM: ParamSpec = {
  description:
    "Grammar to run on. 'c-subset' is the pipeline grammar (csubset/grammar-def.ts); " +
    "'c-subset-ll' is llReadyCGrammar() — left-recursion-eliminated (Algo 4.19) then " +
    'left-factored (Algo 4.21); the dragon-* ids are the book study grammars.',
  values: GRAMMAR_IDS,
};

const SOURCE_PARAM: ParamSpec = {
  description:
    'C source text. The worker re-runs exactly the upstream stages this trace needs ' +
    '(scan → LALR parse → semantics → TAC → optimize) and memoizes them, so pass the ' +
    "store's `compilation.source` verbatim to hit the cache.",
};

const SENTENCE_PARAM: ParamSpec = {
  description:
    'Input sentence. For the C grammars this is C source text and the worker scans it into ' +
    'terminals; for the dragon-* grammars it is a whitespace-separated list of terminal ' +
    "names, e.g. 'id * id + id'.",
};

const CLASS_INDEX_PARAM: ParamSpec = {
  description:
    'Index into buildTokenClasses() (csubset/regex.ts): 0 = id, 1 = intconst, 2 = floatconst.',
  optional: true,
};

const FUNCTION_NAME_PARAM: ParamSpec = {
  description: 'TAC function to analyse; defaults to the first function of the program.',
  optional: true,
};

// ── Reducer specs reused across kinds ────────────────────────────────────────

const DATAFLOW_REDUCER: ReducerSpec = {
  module: 'opt/dataflow.js',
  reducer: 'dataflowReducer',
  initialState: 'initialDataflowState',
  initialStateKind: 'const',
  stateType: 'DataflowState',
  eventType: 'DataflowEvent',
};

// ── The manifest ─────────────────────────────────────────────────────────────

export const TRACE_KINDS = {
  // ── Lexical analysis (§3) ──────────────────────────────────────────────────
  'lex.thompson': {
    description: 'Thompson construction: one token-class regex → an NFA, one fragment per step.',
    cite: '§3.7.4, Algorithm 3.23 (Fig 3.34)',
    params: { classIndex: CLASS_INDEX_PARAM },
    module: 'lex/reducers.js',
    reducer: 'thompsonReducer',
    initialState: 'initialThompsonState',
    initialStateKind: 'function',
    stateType: 'ThompsonState',
    eventType: 'ThompsonEvent',
  },
  'lex.subset': {
    description:
      'Subset construction: the token class’s Thompson NFA → a DFA, one Dstate per step.',
    cite: '§3.7.1, Algorithm 3.20 (Fig 3.36/3.37)',
    params: { classIndex: CLASS_INDEX_PARAM },
    module: 'lex/reducers.js',
    reducer: 'subsetReducer',
    initialState: 'initialSubsetState',
    initialStateKind: 'function',
    stateType: 'SubsetState',
    eventType: 'SubsetEvent',
  },
  'lex.minimize': {
    description: 'Partition refinement of the token class’s DFA into the minimum-state DFA.',
    cite: '§3.9.6, Algorithm 3.39 (Fig 3.65)',
    params: { classIndex: CLASS_INDEX_PARAM },
    module: 'lex/reducers.js',
    reducer: 'minimizeReducer',
    initialState: 'initialMinimizeState',
    initialStateKind: 'function',
    stateType: 'MinimizeState',
    eventType: 'MinimizeEvent',
  },
  'lex.scan': {
    description:
      'The scanner driver on the real source: longest match with retraction, keyword lookup, ' +
      'symbol-table interning, lexical errors.',
    cite: '§3.8.1–3.8.3 (Fig 3.54)',
    params: { source: SOURCE_PARAM },
    module: 'lex/reducers.js',
    reducer: 'scanReducer',
    initialState: 'initialScanState',
    initialStateKind: 'function',
    stateType: 'ScanState',
    eventType: 'ScanEvent',
    notes:
      'Always available — a lexical error is a step in the trace, not a reason to return null.',
  },

  // ── Syntax analysis — LL family (§4.3–4.4) ─────────────────────────────────
  'syntax.first-follow': {
    description: 'Fixed-point computation of the FIRST and FOLLOW sets.',
    cite: '§4.4.2 (Example 4.30)',
    params: { grammarId: GRAMMAR_PARAM },
    module: 'grammar/first-follow.js',
    reducer: 'firstFollowReducer',
    initialState: 'initialFirstFollowState',
    initialStateKind: 'factory',
    initialStateArgs: ['grammar: Grammar'],
    stateType: 'FirstFollowState',
    eventType: 'FirstFollowEvent',
  },
  'syntax.ll1-table': {
    description:
      'Predictive-parsing table construction, including the conflict cells that prove a ' +
      'grammar is not LL(1).',
    cite: '§4.4.3, Algorithm 4.31 (Fig 4.17)',
    params: { grammarId: GRAMMAR_PARAM },
    module: 'grammar/ll1-table.js',
    reducer: 'll1TableReducer',
    initialState: 'initialLL1TableState',
    initialStateKind: 'factory',
    initialStateArgs: ['grammar: Grammar'],
    stateType: 'LL1TableState',
    eventType: 'LL1TableEvent',
    notes:
      "'c-subset-ll' genuinely retains conflicts (dangling else; FuncDef vs VarDecl). They are " +
      'reported as conflict events, not suppressed.',
  },
  'syntax.ll1-parse': {
    description: 'Table-driven predictive parse: stack, input, and the productions applied.',
    cite: '§4.4.4, Algorithm 4.34 (Fig 4.19/4.21)',
    params: { grammarId: GRAMMAR_PARAM, source: SENTENCE_PARAM },
    module: 'grammar/ll1-parse.js',
    reducer: 'll1ParseReducer',
    initialState: 'initialLL1ParseState',
    initialStateKind: 'factory',
    initialStateArgs: ['grammar: Grammar', 'input: readonly string[]'],
    stateType: 'LL1ParseState',
    eventType: 'LL1ParseEvent',
  },
  'syntax.rd': {
    description: 'Recursive-descent parse: the procedure call tree with backtracking-free FIRST tests.',
    cite: '§4.4.1 (Fig 4.13/4.14)',
    params: { grammarId: GRAMMAR_PARAM, source: SENTENCE_PARAM },
    module: 'grammar/recursive-descent.js',
    reducer: 'rdReducer',
    initialState: 'initialRDState',
    initialStateKind: 'factory',
    initialStateArgs: ['input: readonly string[]'],
    stateType: 'RDState',
    eventType: 'RDEvent',
  },
  'syntax.transforms': {
    description:
      'Grammar transformations: left-recursion elimination, or left factoring of its result.',
    cite: '§4.3.3 Algorithm 4.19; §4.3.4 Algorithm 4.21',
    params: {
      grammarId: GRAMMAR_PARAM,
      stage: {
        description:
          "Which transform to trace. 'eliminate-left-recursion' (default) runs on the raw " +
          "grammar; 'left-factor' runs on the left-recursion-eliminated grammar, i.e. the " +
          'second half of llReadyCGrammar().',
        optional: true,
        values: ['eliminate-left-recursion', 'left-factor'],
      },
    },
    module: 'grammar/transforms.js',
    reducer: 'transformReducer',
    initialState: 'initialTransformState',
    initialStateKind: 'factory',
    initialStateArgs: ['grammar: Grammar'],
    stateType: 'TransformState',
    eventType: 'TransformEvent',
  },

  // ── Syntax analysis — LR family (§4.5–4.7) ─────────────────────────────────
  'syntax.lr0': {
    description: 'The canonical collection of sets of LR(0) items (CLOSURE/GOTO, state numbering).',
    cite: '§4.6.2, Algorithm 4.32 (Fig 4.31)',
    params: { grammarId: GRAMMAR_PARAM },
    module: 'grammar/lr0-items.js',
    reducer: 'lr0Reducer',
    initialState: 'lr0Initial',
    initialStateKind: 'function',
    stateType: 'Lr0UiState',
    eventType: 'Lr0Event',
  },
  'syntax.slr': {
    description: 'SLR(1) ACTION/GOTO construction from the LR(0) collection plus FOLLOW sets.',
    cite: '§4.6.4, Algorithm 4.46 (Fig 4.37)',
    params: { grammarId: GRAMMAR_PARAM },
    module: 'grammar/slr-table.js',
    reducer: 'slrReducer',
    initialState: 'slrInitial',
    initialStateKind: 'function',
    stateType: 'SlrUiState',
    eventType: 'SlrEvent',
    notes: "'c-subset' surfaces genuine conflicts here — that is the teaching point.",
  },
  'syntax.lr1': {
    description: 'The canonical collection of sets of LR(1) items.',
    cite: '§4.7.2, Algorithm 4.53 (Fig 4.41)',
    params: {
      grammarId: GRAMMAR_PARAM,
      maxStates: {
        description:
          'Educational cap on the number of LR(1) states (default 400). When the cap is hit the ' +
          'collection carries `truncated: true` and the trace stops — show the "this is why ' +
          'LALR exists" banner instead of freezing the tab.',
        optional: true,
      },
    },
    module: 'grammar/lr1-items.js',
    reducer: 'lr1Reducer',
    initialState: 'lr1Initial',
    initialStateKind: 'function',
    stateType: 'Lr1UiState',
    eventType: 'Lr1Event',
    notes:
      'Check `trace.final().truncated` (and `trace.truncated` for the event cap) before ' +
      'claiming the collection is complete.',
  },
  'syntax.lr1-table': {
    description: 'Canonical LR(1) ACTION/GOTO construction (reduce only on the item’s own lookahead).',
    cite: '§4.7.3, Algorithm 4.56 (Fig 4.42)',
    params: {
      grammarId: GRAMMAR_PARAM,
      maxStates: {
        description: 'Cap on the underlying LR(1) collection (default 400).',
        optional: true,
      },
    },
    module: 'grammar/lr1-items.js',
    reducer: 'lr1TableReducer',
    initialState: 'lr1TableInitial',
    initialStateKind: 'function',
    stateType: 'Lr1TableUiState',
    eventType: 'Lr1TableEvent',
    notes:
      'Returns null when the state cap is exceeded (the table cannot be built from a truncated ' +
      'collection) — use getTraceOrError to show why.',
  },
  'syntax.lalr': {
    description:
      'LALR(1): merge LR(1) states with equal cores, then build ACTION/GOTO; mergeable states ' +
      'and any resulting reduce/reduce conflicts are events.',
    cite: '§4.7.4, Algorithm 4.59 (Fig 4.43)',
    params: {
      grammarId: GRAMMAR_PARAM,
      resolveDanglingElseByShift: {
        description:
          'Resolve if/else shift-reduce conflicts by shifting (§4.8.2). Defaults to false so ' +
          "study grammars show raw conflicts; the pipeline parser uses true. For 'c-subset' " +
          'this is what makes the table usable.',
        optional: true,
      },
    },
    module: 'grammar/lalr.js',
    reducer: 'lalrReducer',
    initialState: 'lalrInitial',
    initialStateKind: 'function',
    stateType: 'LalrUiState',
    eventType: 'LalrEvent',
  },
  'syntax.lr-parse': {
    description:
      'The LR driver: shift/reduce/accept over the configuration stack. With grammarId ' +
      "'c-subset' + table 'lalr' this is literally the parse the rest of the compiler consumes.",
    cite: '§4.6.3, Algorithm 4.44 (Fig 4.36/4.38)',
    params: {
      grammarId: GRAMMAR_PARAM,
      table: {
        description: "Which table drives the parse.",
        optional: true,
        values: ['slr', 'lalr'],
      },
      source: SENTENCE_PARAM,
    },
    module: 'grammar/lr-parse.js',
    reducer: 'lrParseReducer',
    initialState: 'lrParseInitial',
    initialStateKind: 'function',
    stateType: 'LrParseUiState',
    eventType: 'LrParseEvent',
    notes:
      "table defaults to 'lalr'. For the C grammars the input symbols carry lexeme/tokenIndex/" +
      'span, so parse steps highlight the editor.',
  },

  // ── Semantic analysis ──────────────────────────────────────────────────────
  'sem.analyze': {
    description:
      'Scope entry/exit, symbol declaration and lookup, type synthesis, implicit conversions, ' +
      'and each semantic error with its cited rule.',
    cite: '§2.7, §6.3, §6.5',
    params: { source: SOURCE_PARAM },
    module: 'sem/sem-events.js',
    reducer: 'semReducer',
    initialState: 'initialSemState',
    initialStateKind: 'function',
    stateType: 'SemState',
    eventType: 'SemEvent',
    notes:
      'Requires a successful parse. Array decay appears only as a trace event — it is not in ' +
      'SemanticInfo.conversions.',
  },

  // ── Intermediate code (§6) ─────────────────────────────────────────────────
  'ir.gen': {
    description:
      'Syntax-directed translation to three-address code: temporaries, jumping code for ' +
      'booleans, and §6.7 backpatching (makelist/merge/backpatch).',
    cite: '§6.2, §6.4, §6.6, §6.7',
    params: { source: SOURCE_PARAM },
    module: 'ir/ir-events.js',
    reducer: 'irGenReducer',
    initialState: 'initialIrGenState',
    initialStateKind: 'function',
    stateType: 'IrGenState',
    eventType: 'IrEvent',
    notes: 'Requires clean semantic analysis. Global initializers are not translated.',
  },

  // ── Optimization (§8.4–8.5, §9) ────────────────────────────────────────────
  'opt.pass': {
    description:
      'One optimization pass, run on exactly the program state it sees inside the default ' +
      'pipeline (so the trace matches the per-pass diff on the overview).',
    cite: '§8.5 (local), §9.1–9.5 (global)',
    params: {
      source: SOURCE_PARAM,
      pass: {
        description: 'Which pass to trace.',
        values: ['const-fold', 'const-prop', 'copy-prop', 'cse', 'licm', 'dce'],
      },
    },
    module: 'opt/opt-events.js',
    reducer: 'passReducer',
    initialState: 'initialPassState',
    initialStateKind: 'const',
    stateType: 'PassState',
    eventType: 'PassEvent',
    notes:
      'The trace interleaves the pass’s own analysis events (blocks/CFG/dataflow/dominators/' +
      'loops); passReducer ignores those, so replay them with the analysis reducers below if ' +
      'you want the tables alongside the diff.',
  },
  'opt.pipeline': {
    description: 'The whole default sequence — const-fold, const-prop, copy-prop, cse, licm, dce.',
    cite: '§8.5, §9',
    params: { source: SOURCE_PARAM },
    module: 'opt/opt-events.js',
    reducer: 'pipelineReducer',
    initialState: 'initialPipelineState',
    initialStateKind: 'const',
    stateType: 'PipelineState',
    eventType: 'OptEvent',
    notes: 'State is one PassState per pass, in applied order.',
  },
  'opt.analysis': {
    description:
      'A single analysis in isolation on one TAC function of the unoptimized program. ' +
      'The reducer depends on the `analysis` parameter — see `variants`.',
    cite: '§8.4 (blocks/CFG), §9.2 (dataflow), §9.6 (dominators/loops)',
    params: {
      source: SOURCE_PARAM,
      analysis: {
        description: 'Which analysis to trace.',
        values: [
          'basic-blocks',
          'cfg',
          'reaching-defs',
          'live-vars',
          'avail-exprs',
          'dominators',
          'loops',
        ],
      },
      functionName: FUNCTION_NAME_PARAM,
    },
    variantParam: 'analysis',
    // Default (documented) variant = 'basic-blocks'.
    module: 'opt/basic-blocks.js',
    reducer: 'basicBlocksReducer',
    initialState: 'initialBasicBlocksState',
    initialStateKind: 'const',
    stateType: 'BasicBlocksState',
    eventType: 'BasicBlockEvent',
    variants: {
      'basic-blocks': {
        module: 'opt/basic-blocks.js',
        reducer: 'basicBlocksReducer',
        initialState: 'initialBasicBlocksState',
        initialStateKind: 'const',
        stateType: 'BasicBlocksState',
        eventType: 'BasicBlockEvent',
      },
      cfg: {
        module: 'opt/cfg.js',
        reducer: 'cfgReducer',
        initialState: 'initialCfgState',
        initialStateKind: 'factory',
        initialStateArgs: ['fn: TacFunction', 'blocks: BasicBlock[]'],
        stateType: 'CfgState',
        eventType: 'CfgEvent',
      },
      'reaching-defs': DATAFLOW_REDUCER,
      'live-vars': DATAFLOW_REDUCER,
      'avail-exprs': DATAFLOW_REDUCER,
      dominators: {
        module: 'opt/dominators.js',
        reducer: 'dominatorsReducer',
        initialState: 'initialDominatorsState',
        initialStateKind: 'const',
        stateType: 'DominatorsState',
        eventType: 'DominatorsEvent',
      },
      loops: {
        module: 'opt/loops.js',
        reducer: 'loopsReducer',
        initialState: 'initialLoopsState',
        initialStateKind: 'const',
        stateType: 'LoopsState',
        eventType: 'LoopsEvent',
      },
    },
    notes:
      'Runs on `optimized.input` (the renumbered TAC that enters the pipeline), so block ids ' +
      'line up with what opt.pass shows. The three dataflow instantiations share one reducer ' +
      'and one state shape; tell them apart by the trace id / your own route state.',
  },

  // ── Code generation (§8.6–8.8) ─────────────────────────────────────────────
  'codegen.isel': {
    description:
      'Instruction selection: each TAC quad → x86-64 AT&T instructions over virtual registers, ' +
      'with the frame layout decisions (arrays, address-taken locals).',
    cite: '§8.2, §8.6',
    params: { source: SOURCE_PARAM },
    module: 'codegen/isel.js',
    reducer: 'iselReducer',
    initialState: 'initialIselState',
    initialStateKind: 'function',
    stateType: 'IselState',
    eventType: 'IselEvent',
    notes: 'Runs on the OPTIMIZED program (`optimized.output`), like the real pipeline.',
  },
  'codegen.liveness': {
    description: 'Backward liveness over the selected code — the input to the interference graph.',
    cite: '§8.8.2 (Algorithm 9.14 applied to machine code)',
    params: { source: SOURCE_PARAM },
    module: 'codegen/liveness.js',
    reducer: 'livenessReducer',
    initialState: 'initialLivenessState',
    initialStateKind: 'function',
    stateType: 'LivenessState',
    eventType: 'LivenessEvent',
  },
  'codegen.interference': {
    description: 'Interference-graph construction: an edge per pair simultaneously live at a def.',
    cite: '§8.8.3',
    params: { source: SOURCE_PARAM },
    module: 'codegen/interference.js',
    reducer: 'interferenceReducer',
    initialState: 'initialInterferenceState',
    initialStateKind: 'function',
    stateType: 'InterferenceState',
    eventType: 'InterferenceEvent',
  },
  'codegen.color': {
    description:
      'Chaitin-style simplify/select coloring with spilling: the stack of removed nodes, the ' +
      'spill choices, and the rewritten code each spill round.',
    cite: '§8.8.4',
    params: {
      source: SOURCE_PARAM,
      k: {
        description:
          'Number of available GP registers (default GP_REGISTERS.length = 8). SELECT colours ' +
          'from GP_REGISTERS.slice(0, k), so lowering it forces real spills — 2 is the lowest ' +
          'value that reliably converges; k = 1 usually cannot (three-address instructions ' +
          'need more simultaneously-live scratch values than exist) and comes back as null ' +
          'plus a diagnostic.',
        optional: true,
      },
    },
    module: 'codegen/color.js',
    reducer: 'colorReducer',
    initialState: 'initialColorState',
    initialStateKind: 'function',
    stateType: 'ColorState',
    eventType: 'ColorEvent',
  },
  'codegen.emit': {
    description: 'Final emission: prologue/epilogue, register substitution, one line per step.',
    cite: '§8.6, §7.2 (activation records)',
    params: { source: SOURCE_PARAM },
    module: 'codegen/emit.js',
    reducer: 'emitReducer',
    initialState: 'initialEmitState',
    initialStateKind: 'function',
    stateType: 'EmitState',
    eventType: 'EmitEvent',
  },
  'codegen.exec': {
    description:
      'The x86-64 subset interpreter executing the emitted program — the oracle that must agree ' +
      'with the TAC interpreter.',
    cite: 'lab oracle (see docs/PLAN.md testing layer 3)',
    params: {
      source: SOURCE_PARAM,
      stepLimit: { description: 'Interpreter step limit (default 1,000,000).', optional: true },
    },
    module: 'interp/asm.js',
    reducer: 'asmExecReducer',
    initialState: 'initialAsmExecState',
    initialStateKind: 'function',
    stateType: 'AsmExecState',
    eventType: 'AsmExecEvent',
  },
} as const satisfies Record<string, TraceKindSpec>;

export type TraceKind = keyof typeof TRACE_KINDS;

export const TRACE_KIND_NAMES = Object.keys(TRACE_KINDS) as TraceKind[];

export function isTraceKind(k: string): k is TraceKind {
  return Object.prototype.hasOwnProperty.call(TRACE_KINDS, k);
}

/** The reducer spec for a kind, honouring `variantParam` when it applies. */
export function reducerSpecFor(
  kind: TraceKind,
  params: Record<string, unknown> = {},
): ReducerSpec {
  const spec = TRACE_KINDS[kind] as TraceKindSpec;
  if (spec.variantParam && spec.variants) {
    const value = params[spec.variantParam];
    if (typeof value === 'string' && spec.variants[value]) return spec.variants[value];
  }
  return spec;
}

/** Every kind a given phase route owns, in manifest order. */
export function traceKindsForPhase(prefix: string): TraceKind[] {
  return TRACE_KIND_NAMES.filter((k) => k.startsWith(`${prefix}.`));
}

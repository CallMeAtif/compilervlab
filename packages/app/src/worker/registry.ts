/**
 * The trace registry — every recorded algorithm run the lab can produce, keyed
 * by the trace kinds declared in ./trace-kinds.ts (the manifest the phase UIs
 * build against). Lives outside compile.worker.ts so it can be exercised
 * without a Worker context.
 *
 * Everything here is deterministic and memoized: upstream compilation stages
 * are cached per source, finished traces per (kind, params).
 */
import type { Compilation, Grammar, ParseInputSym, Phase, TokenClassDef } from '@lab/core';
import {
  // pipeline
  compile as coreCompile,
  drain,
  // lex
  buildTokenClasses,
  toMultiNfa,
  thompson,
  subsetConstruction,
  runThompson,
  runSubsetConstruction,
  runMinimize,
  runScan,
  // grammars
  cGrammar,
  STUDY_GRAMMARS,
  llReadyCGrammar,
  // syntax LL
  runFirstFollow,
  runLL1Table,
  runLL1Parse,
  runRecursiveDescent,
  runEliminateLeftRecursion,
  runLeftFactor,
  // syntax LR
  lr0ItemsRun,
  slrTableRun,
  lr1ItemsRun,
  lr1TableRun,
  Lr1StateCapError,
  lalrRun,
  lrParseRun,
  // semantics / IR
  runSemanticAnalysis,
  runIrGen,
  // optimization
  PIPELINE_ORDER,
  runOptimize,
  runFindBasicBlocks,
  runBuildCfg,
  runReachingDefinitions,
  runLiveVariables,
  runAvailableExpressions,
  runComputeDominators,
  runFindLoops,
  computeBlocks,
  computeCfg,
  constFold,
  constProp,
  copyProp,
  cse,
  licm,
  dce,
  initialPassState,
  passReducer,
  // codegen
  runIsel,
  runLiveness,
  runInterference,
  runColor,
  runEmit,
  computeAllocation,
  GP_REGISTERS,
  runAsmTraced,
} from '@lab/core';
import type {
  BasicBlock,
  Cfg,
  ColorOutcome,
  Diagnostic,
  FunctionLiveness,
  IselResult,
  OptPassName,
  OptPassResult,
  OptimizedProgram,
  PassEvent,
  TacFunction,
  TacProgram,
} from '@lab/core';
import type { Recorded, SerializedTrace, Steps } from '@lab/trace';
import { record, serializeTrace } from '@lab/trace';
import type { TraceRequest, TraceResponse } from './api';
import { fnv1a } from '../lib/hash';
import { isTraceKind, type TraceKind } from './trace-kinds';

// ─────────────────────────────────────────────────────────────────────────────
// Small LRU
// ─────────────────────────────────────────────────────────────────────────────

class Lru<V> {
  private readonly map = new Map<string, V>();
  constructor(private readonly max: number) {}

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (hit === undefined) return undefined;
    this.map.delete(key); // re-insert to mark most-recently used
    this.map.set(key, hit);
    return hit;
  }

  set(key: string, value: V): V {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.map.delete(oldest.value);
    }
    return value;
  }
}

/** Thrown by a stage helper when an upstream phase could not produce its artifact. */
class UpstreamError extends Error {
  constructor(
    message: string,
    readonly diagnostics: Diagnostic[],
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Upstream stages, memoized per source
// ─────────────────────────────────────────────────────────────────────────────

interface Stages {
  compilation: Compilation;
  /** Lazily derived codegen intermediates (isel → liveness → colors). */
  isel(): IselResult;
  liveness(): FunctionLiveness[];
  colors(): ColorOutcome[];
}

const stagesCache = new Lru<Stages>(4);

function stagesFor(source: string): Stages {
  const key = fnv1a(source);
  const hit = stagesCache.get(key);
  if (hit) return hit;

  const compilation = coreCompile(source);
  let iselMemo: IselResult | null = null;
  let livenessMemo: FunctionLiveness[] | null = null;
  let colorsMemo: ColorOutcome[] | null = null;

  const stages: Stages = {
    compilation,
    isel() {
      if (!iselMemo) {
        const opt = requireOptimized(compilation);
        iselMemo = runIsel(opt.output, compilation.semantic?.symbols).result;
      }
      return iselMemo;
    },
    liveness() {
      if (!livenessMemo) livenessMemo = runLiveness(this.isel()).result;
      return livenessMemo;
    },
    colors() {
      if (!colorsMemo) colorsMemo = computeAllocation(this.isel());
      return colorsMemo;
    },
  };
  return stagesCache.set(key, stages);
}

function upstream(c: Compilation, phase: string): UpstreamError {
  return new UpstreamError(
    `cannot build this trace: the ${phase} phase produced no artifact`,
    c.diagnostics,
  );
}

function requireTokens(c: Compilation) {
  if (!c.tokens) throw upstream(c, 'lexical');
  return c.tokens;
}
function requireAst(c: Compilation) {
  if (!c.ast) throw upstream(c, 'syntax');
  return c.ast;
}
/**
 * Semantic info good enough to translate. A SemanticInfo is produced even when
 * type checking fails — that partial table is exactly what the `sem.analyze`
 * trace visualizes — but IR generation may only run on an error-free one, so
 * this guard checks the diagnostics too.
 */
function requireSemantic(c: Compilation) {
  if (!c.semantic) throw upstream(c, 'semantic');
  if (c.diagnostics.some((d) => d.phase === 'semantic' && d.severity === 'error')) {
    throw new UpstreamError(
      'cannot build this trace: semantic analysis reported errors',
      c.diagnostics,
    );
  }
  return c.semantic;
}
function requireTac(c: Compilation): TacProgram {
  if (!c.tac) throw upstream(c, 'intermediate-code');
  return c.tac;
}
function requireOptimized(c: Compilation): OptimizedProgram {
  if (!c.optimized) throw upstream(c, 'optimization');
  return c.optimized;
}
function requireAsm(c: Compilation) {
  if (!c.asm) throw upstream(c, 'code-generation');
  return c.asm;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parameter helpers
// ─────────────────────────────────────────────────────────────────────────────

type Params = Record<string, unknown>;

function str(params: Params, name: string, fallback?: string): string {
  const v = params[name];
  if (typeof v === 'string') return v;
  if (fallback !== undefined) return fallback;
  throw new UpstreamError(`trace parameter '${name}' is required (string)`, []);
}

function num(params: Params, name: string, fallback: number): number {
  const v = params[name];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function bool(params: Params, name: string, fallback: boolean): boolean {
  const v = params[name];
  return typeof v === 'boolean' ? v : fallback;
}

function tokenClass(params: Params): TokenClassDef {
  const classes = buildTokenClasses();
  const i = num(params, 'classIndex', 0);
  const cls = classes[i];
  if (!cls) {
    throw new UpstreamError(
      `classIndex ${i} is out of range (0..${classes.length - 1}: ${classes
        .map((c) => c.name)
        .join(', ')})`,
      [],
    );
  }
  return cls;
}

const C_GRAMMAR_IDS = new Set(['c-subset', 'c-subset-ll']);

function grammarFor(id: string): Grammar {
  if (id === 'c-subset-ll') return llReadyCGrammar().grammar;
  const make = STUDY_GRAMMARS[id];
  if (!make) {
    throw new UpstreamError(
      `unknown grammarId '${id}' (expected one of: c-subset-ll, ${Object.keys(STUDY_GRAMMARS).join(', ')})`,
      [],
    );
  }
  return make();
}

/**
 * Turn the `source` parameter into parser input. For the C grammars we scan it
 * with the real lexer so each symbol keeps its lexeme/span (parse steps then
 * highlight the editor); for the study grammars it is a whitespace-separated
 * list of terminal names.
 */
function parseInput(grammarId: string, source: string): ParseInputSym[] {
  if (!C_GRAMMAR_IDS.has(grammarId)) {
    return source
      .split(/\s+/u)
      .filter((s) => s.length > 0)
      .map((term) => ({ term }));
  }
  const { compilation } = stagesFor(source);
  const tokens = requireTokens(compilation);
  return tokens.tokens
    .filter((t) => t.type !== '$')
    .map((t) => ({ term: t.type, lexeme: t.lexeme, tokenIndex: t.index, span: t.span }));
}

function terminalInput(grammarId: string, source: string): string[] {
  return parseInput(grammarId, source).map((s) => s.term);
}

// ─────────────────────────────────────────────────────────────────────────────
// opt helpers
// ─────────────────────────────────────────────────────────────────────────────

const PASS_GENERATORS: Record<OptPassName, (p: TacProgram) => Steps<PassEvent, OptPassResult>> = {
  'const-fold': constFold,
  'const-prop': constProp,
  'copy-prop': copyProp,
  cse,
  licm,
  dce,
};

function optPassName(params: Params): OptPassName {
  const name = str(params, 'pass');
  if (!(name in PASS_GENERATORS)) {
    throw new UpstreamError(
      `unknown optimization pass '${name}' (expected one of: ${PIPELINE_ORDER.join(', ')})`,
      [],
    );
  }
  return name as OptPassName;
}

/**
 * The program state a pass sees inside the default pipeline: the pipeline input
 * for the first enabled pass, otherwise the previous pass's output. Tracing the
 * pass on this program makes its trace agree with the pipeline's per-pass diff.
 */
function programEnteringPass(opt: OptimizedProgram, pass: OptPassName): TacProgram {
  let current = opt.input;
  for (const done of opt.passes) {
    if (done.pass === pass) return current;
    current = done.after;
  }
  return current;
}

function functionOf(program: TacProgram, params: Params): TacFunction {
  const name = params['functionName'];
  if (typeof name === 'string' && name.length > 0) {
    const fn = program.functions.find((f) => f.name === name);
    if (!fn) {
      throw new UpstreamError(
        `no function named '${name}' (have: ${program.functions.map((f) => f.name).join(', ')})`,
        [],
      );
    }
    return fn;
  }
  const first = program.functions[0];
  if (!first) throw new UpstreamError('the program contains no functions', []);
  return first;
}

function blocksOf(fn: TacFunction): BasicBlock[] {
  return computeBlocks(fn);
}

function cfgOfFunction(fn: TacFunction): Cfg {
  return computeCfg(fn, blocksOf(fn));
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants + misc helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Educational cap on the canonical LR(1) collection ("this is why LALR exists"). */
const LR1_STATE_CAP = 400;

/** Default register count offered to the allocator. */
const DEFAULT_K = GP_REGISTERS.length;

/** Key params deterministically: object key order must not change the cache key. */
function stableKey(params: Params): string {
  const keys = Object.keys(params).sort();
  return JSON.stringify(keys.map((k) => [k, params[k]]));
}

const KIND_PREFIX_PHASE: Record<string, Phase> = {
  lex: 'lex',
  syntax: 'syntax',
  sem: 'semantic',
  ir: 'ir',
  opt: 'opt',
  codegen: 'codegen',
};

/**
 * The educational LR(1) state cap is a lesson, not a bug: report it as a plain
 * syntax-phase diagnostic carrying the §4.7.4 explanation, so the view can
 * offer LALR instead of showing an internal-fault message.
 */
function stateCapDiagnostic(err: Lr1StateCapError): Diagnostic {
  return {
    phase: 'syntax',
    severity: 'error',
    message: err.message,
    rule: err.rule,
    hint: err.hint,
    span: { start: 0, end: 0, line: 1, col: 1 },
  };
}

/** A trace-request failure that is not a diagnostic about the user's program. */
function internalDiagnostic(message: string, kind = ''): Diagnostic {
  return {
    phase: KIND_PREFIX_PHASE[kind.split('.')[0] ?? ''] ?? 'lex',
    severity: 'error',
    message,
    hint: 'This is a trace-request problem inside the lab, not a problem with your program.',
    span: { start: 0, end: 0, line: 1, col: 1 },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The registry
// ─────────────────────────────────────────────────────────────────────────────

type AnyRecorded = Recorded<unknown, { kind: string }, unknown>;
type TraceBuilder = (params: Params) => AnyRecorded;

const TRACE_REGISTRY: Record<TraceKind, TraceBuilder> = {
  // ── Lexical analysis ──────────────────────────────────────────────────────
  'lex.thompson': (p) => {
    const cls = tokenClass(p);
    return runThompson(cls.regex, `lex.thompson.${cls.name}`) as AnyRecorded;
  },
  'lex.subset': (p) => {
    const cls = tokenClass(p);
    const nfa = toMultiNfa(drain(thompson(cls.regex)), cls.name, cls.priority);
    return runSubsetConstruction(nfa, `lex.subset.${cls.name}`) as AnyRecorded;
  },
  'lex.minimize': (p) => {
    const cls = tokenClass(p);
    const nfa = toMultiNfa(drain(thompson(cls.regex)), cls.name, cls.priority);
    const dfa = drain(subsetConstruction(nfa, false));
    return runMinimize(dfa, `lex.minimize.${cls.name}`) as AnyRecorded;
  },
  'lex.scan': (p) => runScan(str(p, 'source')) as AnyRecorded,

  // ── Syntax — LL family ────────────────────────────────────────────────────
  'syntax.first-follow': (p) =>
    runFirstFollow(grammarFor(str(p, 'grammarId'))) as AnyRecorded,
  'syntax.ll1-table': (p) => runLL1Table(grammarFor(str(p, 'grammarId'))) as AnyRecorded,
  'syntax.ll1-parse': (p) => {
    const id = str(p, 'grammarId');
    const g = grammarFor(id);
    return runLL1Parse(g, terminalInput(id, str(p, 'source'))) as AnyRecorded;
  },
  'syntax.rd': (p) => {
    const id = str(p, 'grammarId');
    const g = grammarFor(id);
    return runRecursiveDescent(g, terminalInput(id, str(p, 'source'))) as AnyRecorded;
  },
  'syntax.transforms': (p) => {
    const g = grammarFor(str(p, 'grammarId'));
    const stage = str(p, 'stage', 'eliminate-left-recursion');
    if (stage === 'left-factor') {
      return runLeftFactor(runEliminateLeftRecursion(g).result) as AnyRecorded;
    }
    if (stage !== 'eliminate-left-recursion') {
      throw new UpstreamError(
        `unknown transform stage '${stage}' (expected 'eliminate-left-recursion' or 'left-factor')`,
        [],
      );
    }
    return runEliminateLeftRecursion(g) as AnyRecorded;
  },

  // ── Syntax — LR family ────────────────────────────────────────────────────
  'syntax.lr0': (p) => lr0ItemsRun(grammarFor(str(p, 'grammarId'))) as AnyRecorded,
  'syntax.slr': (p) => slrTableRun(grammarFor(str(p, 'grammarId'))) as AnyRecorded,
  'syntax.lr1': (p) =>
    lr1ItemsRun(grammarFor(str(p, 'grammarId')), {
      maxStates: num(p, 'maxStates', LR1_STATE_CAP),
    }) as AnyRecorded,
  'syntax.lr1-table': (p) =>
    lr1TableRun(grammarFor(str(p, 'grammarId')), {
      maxStates: num(p, 'maxStates', LR1_STATE_CAP),
    }) as AnyRecorded,
  'syntax.lalr': (p) =>
    lalrRun(grammarFor(str(p, 'grammarId')), {
      resolveDanglingElseByShift: bool(p, 'resolveDanglingElseByShift', false),
    }) as AnyRecorded,
  'syntax.lr-parse': (p) => {
    const id = str(p, 'grammarId');
    const g = grammarFor(id);
    const which = str(p, 'table', 'lalr');
    if (which !== 'slr' && which !== 'lalr') {
      throw new UpstreamError(`unknown table '${which}' (expected 'slr' or 'lalr')`, []);
    }
    const table =
      which === 'slr'
        ? slrTableRun(g).result
        : lalrRun(g, { resolveDanglingElseByShift: id === 'c-subset' }).result;
    return lrParseRun(g, table, parseInput(id, str(p, 'source')), {
      id: `syntax.lr-parse.${which}`,
    }) as AnyRecorded;
  },

  // ── Semantic analysis ─────────────────────────────────────────────────────
  'sem.analyze': (p) => {
    const { compilation } = stagesFor(str(p, 'source'));
    return runSemanticAnalysis(requireAst(compilation)) as AnyRecorded;
  },

  // ── Intermediate code ─────────────────────────────────────────────────────
  'ir.gen': (p) => {
    const { compilation } = stagesFor(str(p, 'source'));
    return runIrGen(requireAst(compilation), requireSemantic(compilation)) as AnyRecorded;
  },

  // ── Optimization ──────────────────────────────────────────────────────────
  'opt.pass': (p) => {
    const { compilation } = stagesFor(str(p, 'source'));
    const opt = requireOptimized(compilation);
    const pass = optPassName(p);
    const input = programEnteringPass(opt, pass);
    return record(() => PASS_GENERATORS[pass](input), initialPassState, passReducer, {
      id: `opt.pass.${pass}`,
    }) as AnyRecorded;
  },
  'opt.pipeline': (p) => {
    const { compilation } = stagesFor(str(p, 'source'));
    return runOptimize(requireTac(compilation)) as AnyRecorded;
  },
  'opt.analysis': (p) => {
    const { compilation } = stagesFor(str(p, 'source'));
    const program = requireOptimized(compilation).input;
    const fn = functionOf(program, p);
    const analysis = str(p, 'analysis');
    switch (analysis) {
      case 'basic-blocks':
        return runFindBasicBlocks(fn) as AnyRecorded;
      case 'cfg':
        return runBuildCfg(fn, blocksOf(fn)) as AnyRecorded;
      case 'reaching-defs':
        return runReachingDefinitions(fn, cfgOfFunction(fn)) as AnyRecorded;
      case 'live-vars':
        return runLiveVariables(fn, cfgOfFunction(fn)) as AnyRecorded;
      case 'avail-exprs':
        return runAvailableExpressions(fn, cfgOfFunction(fn)) as AnyRecorded;
      case 'dominators':
        return runComputeDominators(cfgOfFunction(fn)) as AnyRecorded;
      case 'loops':
        return runFindLoops(cfgOfFunction(fn)) as AnyRecorded;
      default:
        throw new UpstreamError(
          `unknown analysis '${analysis}' (expected basic-blocks, cfg, reaching-defs, live-vars, avail-exprs, dominators or loops)`,
          [],
        );
    }
  },

  // ── Code generation ───────────────────────────────────────────────────────
  'codegen.isel': (p) => {
    const { compilation } = stagesFor(str(p, 'source'));
    const opt = requireOptimized(compilation);
    return runIsel(opt.output, compilation.semantic?.symbols) as AnyRecorded;
  },
  'codegen.liveness': (p) => {
    const stages = stagesFor(str(p, 'source'));
    requireOptimized(stages.compilation);
    return runLiveness(stages.isel()) as AnyRecorded;
  },
  'codegen.interference': (p) => {
    const stages = stagesFor(str(p, 'source'));
    requireOptimized(stages.compilation);
    return runInterference(stages.isel(), stages.liveness()) as AnyRecorded;
  },
  'codegen.color': (p) => {
    const stages = stagesFor(str(p, 'source'));
    requireOptimized(stages.compilation);
    const k = num(p, 'k', DEFAULT_K);
    return runColor(stages.isel(), k) as AnyRecorded;
  },
  'codegen.emit': (p) => {
    const stages = stagesFor(str(p, 'source'));
    requireOptimized(stages.compilation);
    return runEmit(stages.isel(), stages.colors()) as AnyRecorded;
  },
  'codegen.exec': (p) => {
    const { compilation } = stagesFor(str(p, 'source'));
    const asm = requireAsm(compilation);
    return runAsmTraced(asm, { stepLimit: num(p, 'stepLimit', 1_000_000) }) as AnyRecorded;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Entry points
// ─────────────────────────────────────────────────────────────────────────────

const traceCache = new Lru<SerializedTrace<unknown, { kind: string }>>(8);

export function buildTrace(req: TraceRequest): TraceResponse {
  if (!isTraceKind(req.kind)) {
    return {
      trace: null,
      diagnostics: [
        internalDiagnostic(
          `unknown trace kind '${req.kind}' — see packages/app/src/worker/trace-kinds.ts`,
          req.kind,
        ),
      ],
    };
  }
  const params = req.params ?? {};
  const key = `${req.kind}|${stableKey(params)}`;
  const cached = traceCache.get(key);
  if (cached) return { trace: cached, diagnostics: [] };

  try {
    const recorded = TRACE_REGISTRY[req.kind](params);
    const payload = serializeTrace(recorded.trace);
    traceCache.set(key, payload);
    return { trace: payload, diagnostics: [] };
  } catch (err) {
    if (err instanceof Lr1StateCapError) {
      return { trace: null, diagnostics: [stateCapDiagnostic(err)] };
    }
    if (err instanceof UpstreamError) {
      return {
        trace: null,
        diagnostics:
          err.diagnostics.length > 0
            ? err.diagnostics
            : [internalDiagnostic(err.message, req.kind)],
      };
    }
    return {
      trace: null,
      diagnostics: [
        internalDiagnostic(
          `failed to build the '${req.kind}' trace: ${err instanceof Error ? err.message : String(err)}`,
          req.kind,
        ),
      ],
    };
  }
}


/**
 * Static metadata + URL model for the /opt phase view.
 *
 * URL contract (only ?algo=, ?step= and ?pass= exist in lib/urlState.ts):
 *   ?algo=<passId>      → the pass view for that pass  (mirrored into ?pass=)
 *   ?algo=<analysisId>  → the analysis view            (?pass= carries the
 *                         TAC function name, the only phase-specific extra
 *                         parameter this page needs)
 *   ?algo=pipeline      → the whole-pipeline view
 * The PhasePage header tablist writes ?algo=<passId> for the six passes, so
 * the header tabs and the in-page pass rail drive exactly the same state.
 */
import type { OptPassName } from '@lab/core/opt/types.js';

// ── Passes ───────────────────────────────────────────────────────────────────

export const PASS_IDS = [
  'const-fold',
  'const-prop',
  'copy-prop',
  'cse',
  'licm',
  'dce',
] as const satisfies readonly OptPassName[];

export type PassId = (typeof PASS_IDS)[number];

export function isPassId(v: string | null): v is PassId {
  return v !== null && (PASS_IDS as readonly string[]).includes(v);
}

export interface PassMeta {
  id: PassId;
  label: string;
  short: string;
  citation: { section: string; figureOrAlgo?: string; rule?: string };
  blurb: string;
  /** Dataflow analysis this pass runs first (its events ride in the trace). */
  analysis: AnalysisId | null;
  analysisLabel: string | null;
}

export const PASS_META: Record<PassId, PassMeta> = {
  'const-fold': {
    id: 'const-fold',
    label: 'Constant folding',
    short: 'const-fold',
    citation: { section: '8.5.4' },
    blurb:
      'Evaluates every instruction whose operands are all compile-time constants and replaces it with a copy of the value. Purely local — no dataflow analysis needed.',
    analysis: null,
    analysisLabel: null,
  },
  'const-prop': {
    id: 'const-prop',
    label: 'Constant propagation',
    short: 'const-prop',
    citation: { section: '9.4' },
    blurb:
      'Where every definition reaching a use is the same constant, the use is replaced by that constant. Driven by reaching definitions (§9.2.4).',
    analysis: 'reaching-defs',
    analysisLabel: 'Reaching definitions',
  },
  'copy-prop': {
    id: 'copy-prop',
    label: 'Copy propagation',
    short: 'copy-prop',
    citation: { section: '9.1.6' },
    blurb:
      'After u = v, later uses of u are rewritten to v whenever the copy still reaches them and neither variable was redefined. Driven by the reaching-copies dataflow problem.',
    analysis: 'reaching-defs',
    analysisLabel: 'Reaching copies',
  },
  cse: {
    id: 'cse',
    label: 'Common subexpression elimination',
    short: 'cse',
    citation: { section: '9.1.4' },
    blurb:
      'An expression already computed on every path to this point is available: the recomputation is replaced by a copy of the earlier result. Driven by available expressions (§9.2.6).',
    analysis: 'avail-exprs',
    analysisLabel: 'Available expressions',
  },
  licm: {
    id: 'licm',
    label: 'Loop-invariant code motion',
    short: 'licm',
    citation: { section: '9.1.5' },
    blurb:
      'Statements whose operands do not change inside a natural loop are moved to a freshly created preheader — but only after the three code-motion legality conditions are checked.',
    analysis: 'loops',
    analysisLabel: 'Dominators · loops · liveness',
  },
  dce: {
    id: 'dce',
    label: 'Dead-code elimination',
    short: 'dce',
    citation: { section: '9.1.4' },
    blurb:
      'A side-effect-free assignment to a variable that is not live afterwards is removed, iterating to a fixpoint. Driven by live variables (§9.2.5).',
    analysis: 'live-vars',
    analysisLabel: 'Live variables',
  },
};

export const PASS_LIST: readonly PassMeta[] = PASS_IDS.map((id) => PASS_META[id]);

// ── Analyses ─────────────────────────────────────────────────────────────────

export const ANALYSIS_IDS = [
  'basic-blocks',
  'cfg',
  'reaching-defs',
  'live-vars',
  'avail-exprs',
  'dominators',
  'loops',
] as const;

export type AnalysisId = (typeof ANALYSIS_IDS)[number];

export function isAnalysisId(v: string | null): v is AnalysisId {
  return v !== null && (ANALYSIS_IDS as readonly string[]).includes(v);
}

export interface AnalysisMeta {
  id: AnalysisId;
  label: string;
  short: string;
  citation: { section: string; figureOrAlgo?: string; rule?: string };
  blurb: string;
  group: 'structure' | 'dataflow' | 'loops';
}

export const ANALYSIS_META: Record<AnalysisId, AnalysisMeta> = {
  'basic-blocks': {
    id: 'basic-blocks',
    label: 'Basic blocks (leaders)',
    short: 'Blocks',
    citation: { section: '8.4.1', figureOrAlgo: 'Algorithm 8.5' },
    blurb:
      'Find the leaders, then cut the instruction list at every leader. Rule 1: the first instruction. Rule 2: any jump target. Rule 3: any instruction following a jump.',
    group: 'structure',
  },
  cfg: {
    id: 'cfg',
    label: 'Flow graph',
    short: 'CFG',
    citation: { section: '8.4.3' },
    blurb:
      'One node per basic block plus ENTRY and EXIT: an edge B → C exists when C’s leader can immediately follow B’s last instruction.',
    group: 'structure',
  },
  'reaching-defs': {
    id: 'reaching-defs',
    label: 'Reaching definitions',
    short: 'Reaching defs',
    citation: { section: '9.2.4', figureOrAlgo: 'Algorithm 9.11' },
    blurb:
      'Forward, meet = ∪. OUT[B] = gen_B ∪ (IN[B] − kill_B). Answers “which definitions of x can reach this point?”.',
    group: 'dataflow',
  },
  'live-vars': {
    id: 'live-vars',
    label: 'Live variables',
    short: 'Live vars',
    citation: { section: '9.2.5' },
    blurb:
      'Backward, meet = ∪. IN[B] = use_B ∪ (OUT[B] − def_B). Answers “is the value of x used on some path after this point?”.',
    group: 'dataflow',
  },
  'avail-exprs': {
    id: 'avail-exprs',
    label: 'Available expressions',
    short: 'Avail exprs',
    citation: { section: '9.2.6' },
    blurb:
      'Forward, meet = ∩ (so interior blocks start at the full domain U). Answers “has y + z already been computed on every path here, with no operand redefined since?”.',
    group: 'dataflow',
  },
  dominators: {
    id: 'dominators',
    label: 'Dominators',
    short: 'Dominators',
    citation: { section: '9.6.1' },
    blurb:
      'D(n0) = {n0}; D(n) = {n} ∪ (∩ of D(p) over predecessors p), iterated to a fixpoint. d dom n means every path from ENTRY to n goes through d.',
    group: 'loops',
  },
  loops: {
    id: 'loops',
    label: 'Back edges & natural loops',
    short: 'Loops',
    citation: { section: '9.6.4', figureOrAlgo: 'Algorithm 9.46 (§9.6.6)' },
    blurb:
      'a → b is a back edge when its head b dominates its tail a. Its natural loop is b plus every node that can reach a without going through b.',
    group: 'loops',
  },
};

export const ANALYSIS_LIST: readonly AnalysisMeta[] = ANALYSIS_IDS.map((id) => ANALYSIS_META[id]);

export const DATAFLOW_ANALYSES: readonly AnalysisId[] = [
  'reaching-defs',
  'live-vars',
  'avail-exprs',
];

// ── View model ───────────────────────────────────────────────────────────────

export type OptView =
  | { kind: 'pass'; pass: PassId }
  | { kind: 'analysis'; analysis: AnalysisId }
  | { kind: 'pipeline' };

export type OptViewKind = OptView['kind'];

export const DEFAULT_PASS: PassId = 'const-fold';
export const DEFAULT_ANALYSIS: AnalysisId = 'basic-blocks';

/** Resolve ?algo= (falling back to ?pass=) into the view being shown. */
export function viewFromParams(algo: string | null, pass: string | null): OptView {
  if (algo === 'pipeline') return { kind: 'pipeline' };
  if (isAnalysisId(algo)) return { kind: 'analysis', analysis: algo };
  if (isPassId(algo)) return { kind: 'pass', pass: algo };
  if (isPassId(pass)) return { kind: 'pass', pass };
  return { kind: 'pass', pass: DEFAULT_PASS };
}

/** A stable key per (view, function) so the stepper restarts when it changes. */
export function viewKey(view: OptView, functionName: string): string {
  switch (view.kind) {
    case 'pass':
      return `pass:${view.pass}:${functionName}`;
    case 'analysis':
      return `analysis:${view.analysis}:${functionName}`;
    case 'pipeline':
      return 'pipeline';
  }
}

// ── ENTRY / EXIT pseudo-node conventions (§8.4.3, mirrored from core) ────────

export const ENTRY_ID = -1;
export const EXIT_ID = -2;

export function blockName(id: number): string {
  return id === ENTRY_ID ? 'ENTRY' : id === EXIT_ID ? 'EXIT' : `B${id}`;
}

export function edgeKey(from: number, to: number): string {
  return `${from}->${to}`;
}

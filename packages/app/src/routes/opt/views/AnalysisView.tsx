/**
 * The seven `opt.analysis` traces, each on one TAC function of the program that
 * enters the pipeline (`optimized.input`):
 *   basic-blocks · cfg · reaching-defs · live-vars · avail-exprs ·
 *   dominators · loops
 *
 * Structure first (leaders → blocks → flow graph), then the data-flow problems
 * that the passes consume, then the loop machinery LICM needs.
 */
import { useMemo } from 'react';
import { clsx } from 'clsx';
import { ArrowRight, CheckCircle2, RefreshCw, Waypoints } from 'lucide-react';
import type { Cfg } from '@lab/core/opt/types.js';
import type { TacFunction } from '@lab/core/ir/types.js';
import {
  basicBlocksReducer,
  type BasicBlockEvent,
  type BasicBlocksState,
  type LeaderRule as CoreLeaderRule,
} from '@lab/core/opt/basic-blocks.js';
import { cfgReducer, type CfgEvent, type CfgState } from '@lab/core/opt/cfg.js';
import {
  dataflowReducer,
  numberDefinitions,
  type DataflowEvent,
  type DataflowState,
} from '@lab/core/opt/dataflow.js';
import {
  dominatorsReducer,
  type DominatorsEvent,
  type DominatorsState,
} from '@lab/core/opt/dominators.js';
import { loopsReducer, type LoopsEvent, type LoopsState } from '@lab/core/opt/loops.js';
import type { UseStepperOptions } from '../../../lib/useStepper';
import type { JumpTarget } from '../../../components/StepControls';
import { ANALYSIS_META, blockName, edgeKey, type AnalysisId } from '../lib/optModel';
import { cfgBlockViews, loopStructure, quadLines } from '../lib/cfgModel';
import { useOptTrace } from '../lib/useOptTrace';
import { CfgGraph, type CfgGraphEdgeView } from '../components/CfgGraph';
import { DataflowTable } from '../components/DataflowTable';
import { Chip, Notice, Panel } from '../components/OptStates';
import { SplitTraceView } from '../components/SplitTraceView';
import { TacListing, LEADER_RULES } from '../components/TacListing';
import { TraceGate } from '../components/TraceGate';

export interface AnalysisViewProps {
  analysis: AnalysisId;
  source: string;
  fn: TacFunction;
  cfg: Cfg;
  stepperOptions: UseStepperOptions;
  onSelectAnalysis: (analysis: AnalysisId) => void;
}

export function AnalysisView(props: AnalysisViewProps) {
  switch (props.analysis) {
    case 'basic-blocks':
      return <BasicBlocksAnalysis {...props} />;
    case 'cfg':
      return <CfgAnalysis {...props} />;
    case 'dominators':
      return <DominatorsAnalysis {...props} />;
    case 'loops':
      return <LoopsAnalysis {...props} />;
    default:
      return <DataflowAnalysis {...props} />;
  }
}

function analysisRequest(analysis: AnalysisId, source: string, fn: TacFunction) {
  return { kind: 'opt.analysis', params: { source, analysis, functionName: fn.name } };
}

const UNAVAILABLE =
  'Analyses run on the three-address code that enters the optimizer, so they need a program that compiled through intermediate-code generation.';

// ── 1. Basic blocks (§8.4.1, Algorithm 8.5) ─────────────────────────────────

function BasicBlocksAnalysis({
  source,
  fn,
  stepperOptions,
  onSelectAnalysis,
}: AnalysisViewProps) {
  const load = useOptTrace<BasicBlocksState, BasicBlockEvent>(
    analysisRequest('basic-blocks', source, fn),
    basicBlocksReducer,
  );
  const lines = useMemo(() => quadLines(fn), [fn]);

  return (
    <TraceGate load={load} what={`basic-block partitioning of ${fn.name}()`} unavailableExplanation={UNAVAILABLE}>
      {(trace) => (
        <SplitTraceView trace={trace} title="Algorithm 8.5 — leaders" stepperOptions={stepperOptions}>
          {(stepper) => {
            const state = stepper.state;
            const event = stepper.currentStep?.event ?? null;
            const leaders = new Map<number, CoreLeaderRule>(
              state.leaders.map((l) => [l.quadIndex, l.rule]),
            );
            const blockOf = new Map<number, number>();
            for (const b of state.blocks) for (const qi of b.quadIndices) blockOf.set(qi, b.id);
            const current = new Set<number>();
            let firedRule: CoreLeaderRule | null = null;
            if (event?.kind === 'leader-found') {
              current.add(event.quadIndex);
              firedRule = event.rule;
            } else if (event?.kind === 'block-formed') {
              for (const qi of event.quadIndices) current.add(qi);
            }

            return (
              <>
                <Panel
                  title={`Partitioning ${fn.name}() into basic blocks`}
                  cite={{ section: '8.4.1', figureOrAlgo: 'Algorithm 8.5' }}
                  subtitle={`${state.leaders.length} of ${lines.length} instructions marked as leaders · ${state.blocks.length} blocks formed`}
                  bodyClassName="flex flex-col gap-3"
                >
                  <ol className="flex flex-col gap-1.5">
                    {([1, 2, 3] as const).map((rule) => (
                      <li
                        key={rule}
                        className={clsx(
                          'flex gap-2 rounded-md border px-2 py-1.5 text-xs',
                          firedRule === rule
                            ? 'border-accent bg-accent-soft text-ink'
                            : 'border-line text-ink-muted',
                        )}
                      >
                        <span className="font-mono font-semibold">L{rule}</span>
                        <span>{LEADER_RULES[rule]}</span>
                        {firedRule === rule && (
                          <span className="ml-auto shrink-0 font-mono text-[11px] text-accent">
                            fired
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                  <TacListing
                    lines={lines}
                    leaders={leaders}
                    blockOf={blockOf}
                    currentQuads={current}
                    className="max-h-140"
                    ariaLabel={`Three-address code of ${fn.name}`}
                  />
                </Panel>

                <Panel
                  title="Blocks formed"
                  subtitle="A block runs from its leader up to (not including) the next leader."
                  bodyClassName="flex flex-wrap items-center gap-1.5"
                >
                  {state.blocks.length === 0 && (
                    <p className="text-sm text-ink-muted">
                      No block has been formed yet — leaders are identified first, then the
                      instruction list is cut at each of them.
                    </p>
                  )}
                  {state.blocks.map((b) => (
                    <Chip key={b.id} tone={event?.kind === 'block-formed' && event.blockId === b.id ? 'accent' : 'neutral'}>
                      B{b.id}: {b.quadIndices[0] ?? 0}–{b.quadIndices[b.quadIndices.length - 1] ?? 0}
                    </Chip>
                  ))}
                  {state.blocks.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onSelectAnalysis('cfg')}
                      className="ml-auto flex h-11 cursor-pointer items-center gap-1.5 rounded-md border border-control px-3 text-xs font-medium text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
                    >
                      Now draw the flow graph
                      <ArrowRight aria-hidden className="size-3.5" />
                    </button>
                  )}
                </Panel>
              </>
            );
          }}
        </SplitTraceView>
      )}
    </TraceGate>
  );
}

// ── 2. Flow graph (§8.4.3) ──────────────────────────────────────────────────

const EDGE_REASON: Record<string, string> = {
  entry: 'ENTRY reaches the block holding the first instruction',
  'jump-target': 'the block ends in a jump whose target is this block’s leader',
  fallthrough: 'this block immediately follows in program order and the predecessor does not end in an unconditional jump',
  return: 'the block ends in a return, which leaves the function',
  'fall-off-end': 'the last block falls off the end of the function',
};

function CfgAnalysis({ source, fn, stepperOptions }: AnalysisViewProps) {
  const load = useOptTrace<CfgState, CfgEvent>(analysisRequest('cfg', source, fn), cfgReducer);

  return (
    <TraceGate load={load} what={`the flow graph of ${fn.name}()`} unavailableExplanation={UNAVAILABLE}>
      {(trace) => {
        const finalCfg = trace.final();
        const blocks = cfgBlockViews(fn, finalCfg);
        const loops = loopStructure(finalCfg);
        const edges: CfgGraphEdgeView[] = finalCfg.edges.map((e) => ({
          from: e.from,
          to: e.to,
          back: loops.backEdges.has(edgeKey(e.from, e.to)),
        }));

        return (
          <SplitTraceView trace={trace} title="§8.4.3 — one edge per step" stepperOptions={stepperOptions}>
            {(stepper) => {
              const discovered = stepper.state.edges.map((e) => edgeKey(e.from, e.to));
              const event = stepper.currentStep?.event ?? null;
              const currentEdge = event ? edgeKey(event.from, event.to) : null;
              const reasons = new Map<string, string>();
              for (let i = 0; i < stepper.index && i < trace.steps.length; i++) {
                const step = trace.steps[i];
                if (step) reasons.set(edgeKey(step.event.from, step.event.to), step.event.reason);
              }
              return (
                <>
                  <Panel
                    title={`Flow graph of ${fn.name}()`}
                    cite={{ section: '8.4.3' }}
                    subtitle={`${discovered.length} of ${finalCfg.edges.length} edges added`}
                    bodyClassName="p-0"
                  >
                    <CfgGraph
                      blocks={blocks}
                      edges={edges}
                      currentBlocks={event ? [event.from, event.to] : []}
                      visitedEdges={discovered}
                      currentEdges={currentEdge ? [currentEdge] : []}
                      badges={loopBadges(loops.loopHeaders)}
                      graphHeight="28rem"
                      ariaLabel={`Flow graph of ${fn.name}`}
                    />
                  </Panel>

                  <Panel title="Edges" subtitle="Why each edge exists" bodyClassName="p-0">
                    <table className="w-full border-collapse text-left font-mono text-xs">
                      <thead>
                        <tr className="border-b border-line text-ink-muted">
                          <th scope="col" className="px-3 py-1.5">Edge</th>
                          <th scope="col" className="px-3 py-1.5">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {finalCfg.edges.map((e) => {
                          const key = edgeKey(e.from, e.to);
                          const reason = reasons.get(key);
                          const isBack = loops.backEdges.has(key);
                          return (
                            <tr
                              key={key}
                              className={clsx(
                                'border-b border-line/50',
                                key === currentEdge && 'bg-accent-soft',
                                reason === undefined && 'text-ink-faint',
                              )}
                            >
                              <td className="px-3 py-1.5 whitespace-nowrap">
                                {blockName(e.from)} → {blockName(e.to)}
                                {isBack && (
                                  <span className="ml-1.5 rounded-sm border border-line-strong px-1 text-[10px] tracking-wide uppercase">
                                    ↩ back edge
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-1.5 font-sans text-ink-muted">
                                {reason ? (EDGE_REASON[reason] ?? reason) : 'not discovered yet'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </Panel>
                </>
              );
            }}
          </SplitTraceView>
        );
      }}
    </TraceGate>
  );
}

function loopBadges(headers: ReadonlySet<number>): Record<number, string[]> {
  const out: Record<number, string[]> = {};
  for (const h of headers) out[h] = ['↻ loop header'];
  return out;
}

// ── 3. The three data-flow problems (§9.2) ──────────────────────────────────

/** The round-robin solver's two landmarks, in the shared "Jump to…" menu. */
const DATAFLOW_JUMPS: ReadonlyArray<JumpTarget<DataflowEvent>> = [
  {
    label: 'Next iteration',
    hint: 'iteration of the round-robin solver',
    predicate: (s) => s.event.kind === 'df-iteration',
  },
  {
    label: 'Converged',
    hint: 'step where the analysis reaches its fixpoint',
    predicate: (s) => s.event.kind === 'df-converged',
  },
];

function DataflowAnalysis({ analysis, source, fn, cfg, stepperOptions }: AnalysisViewProps) {
  const meta = ANALYSIS_META[analysis];
  const load = useOptTrace<DataflowState, DataflowEvent>(
    analysisRequest(analysis, source, fn),
    dataflowReducer,
  );
  const blocks = useMemo(() => cfgBlockViews(fn, cfg), [fn, cfg]);
  const blockIds = useMemo(() => cfg.blocks.map((b) => b.id), [cfg]);
  const loops = useMemo(() => loopStructure(cfg), [cfg]);
  const edges = useMemo<CfgGraphEdgeView[]>(
    () =>
      cfg.edges.map((e) => ({
        from: e.from,
        to: e.to,
        back: loops.backEdges.has(edgeKey(e.from, e.to)),
      })),
    [cfg, loops],
  );
  const defs = useMemo(
    () => (analysis === 'reaching-defs' ? numberDefinitions(fn) : []),
    [analysis, fn],
  );
  const lines = useMemo(() => quadLines(fn), [fn]);

  return (
    <TraceGate load={load} what={`${meta.label.toLowerCase()} on ${fn.name}()`} unavailableExplanation={UNAVAILABLE}>
      {(trace) => (
        <SplitTraceView
          trace={trace}
          title={meta.label}
          stepperOptions={stepperOptions}
          jumpTargets={DATAFLOW_JUMPS}
        >
          {(stepper) => {
            const state = stepper.state;
            const event = stepper.currentStep?.event ?? null;
            const currentBlock = event?.kind === 'df-update' ? event.blockId : null;
            const changed = event?.kind === 'df-update' ? event.changed : undefined;
            return (
              <>
                <Panel
                  title={meta.label}
                  cite={meta.citation}
                  subtitle={meta.blurb}
                  bodyClassName="flex flex-col gap-3"
                >
                  {state.converged ? (
                    <Notice tone="ok" icon={<CheckCircle2 aria-hidden className="size-4 shrink-0" />}>
                      <span className="font-medium">Converged</span> after {state.iterations}{' '}
                      iteration{state.iterations === 1 ? '' : 's'} — the last pass over the blocks
                      changed nothing, so IN/OUT are the fixedpoint the round-robin algorithm
                      computes (§9.3).
                    </Notice>
                  ) : (
                    <Notice tone="info" icon={<RefreshCw aria-hidden className="size-4 shrink-0" />}>
                      {state.iterations === 0
                        ? 'Setting the problem up: gen/kill per block, boundary value, and the initial value for every interior block.'
                        : `Iteration ${state.iterations} in progress — blocks are revisited in ${
                            state.direction === 'forward' ? 'ascending' : 'descending'
                          } id order until nothing changes.`}
                    </Notice>
                  )}
                  <DataflowTable
                    state={state}
                    blockIds={blockIds}
                    currentBlock={currentBlock}
                    changed={changed}
                  />
                </Panel>

                {analysis === 'reaching-defs' && defs.length > 0 && (
                  <Panel
                    title="Definition numbering"
                    subtitle="The domain U: every definition in the function, numbered in program order (§9.2.4)."
                    bodyClassName="grid gap-1 sm:grid-cols-2"
                  >
                    {defs.map((d) => (
                      <div key={d.id} className="flex items-baseline gap-2 font-mono text-xs">
                        <span className="w-8 shrink-0 font-semibold">{d.id}</span>
                        <span className="w-8 shrink-0 text-ink-faint">{d.quadIndex}</span>
                        <span className="truncate text-ink-muted" title={lines[d.quadIndex]?.text}>
                          {lines[d.quadIndex]?.text ?? `defines ${d.var}`}
                        </span>
                      </div>
                    ))}
                  </Panel>
                )}

                <Panel title={`Flow graph of ${fn.name}()`} bodyClassName="p-0">
                  <CfgGraph
                    blocks={blocks}
                    edges={edges}
                    currentBlocks={currentBlock === null ? [] : [currentBlock]}
                    badges={loopBadges(loops.loopHeaders)}
                    graphHeight="24rem"
                    ariaLabel={`Flow graph of ${fn.name}`}
                  />
                </Panel>
              </>
            );
          }}
        </SplitTraceView>
      )}
    </TraceGate>
  );
}

// ── 4. Dominators (§9.6.1) ──────────────────────────────────────────────────

function DominatorsAnalysis({ source, fn, cfg, stepperOptions }: AnalysisViewProps) {
  const load = useOptTrace<DominatorsState, DominatorsEvent>(
    analysisRequest('dominators', source, fn),
    dominatorsReducer,
  );
  const blocks = useMemo(() => cfgBlockViews(fn, cfg), [fn, cfg]);
  const loops = useMemo(() => loopStructure(cfg), [cfg]);
  const edges = useMemo<CfgGraphEdgeView[]>(
    () =>
      cfg.edges.map((e) => ({
        from: e.from,
        to: e.to,
        back: loops.backEdges.has(edgeKey(e.from, e.to)),
      })),
    [cfg, loops],
  );

  return (
    <TraceGate load={load} what={`dominators of ${fn.name}()`} unavailableExplanation={UNAVAILABLE}>
      {(trace) => (
        <SplitTraceView trace={trace} title="Dominators" stepperOptions={stepperOptions}>
          {(stepper) => {
            const state = stepper.state;
            const event = stepper.currentStep?.event ?? null;
            const currentBlock = event?.kind === 'dom-update' ? event.blockId : null;
            const currentDoms = currentBlock === null ? [] : (state.dom[String(currentBlock)] ?? []);
            const ids = Object.keys(state.dom)
              .map((k) => Number(k))
              .sort((a, b) => a - b);
            return (
              <>
                <Panel
                  title={`Dominators of ${fn.name}()`}
                  cite={{ section: '9.6.1', rule: 'D(n) = {n} ∪ ( ∩ over predecessors p of n of D(p) )' }}
                  subtitle="d dom n means every path from ENTRY to n passes through d."
                  bodyClassName="flex flex-col gap-3"
                >
                  {state.converged ? (
                    <Notice tone="ok" icon={<CheckCircle2 aria-hidden className="size-4 shrink-0" />}>
                      <span className="font-medium">Converged</span> after {state.iterations}{' '}
                      iteration{state.iterations === 1 ? '' : 's'}.
                    </Notice>
                  ) : (
                    <Notice tone="info" icon={<RefreshCw aria-hidden className="size-4 shrink-0" />}>
                      {state.iterations === 0
                        ? 'Initialising: D(entry) = {entry}, and D(n) = all blocks for every other block.'
                        : `Iteration ${state.iterations}: recomputing D(n) for every block in ascending id order.`}
                    </Notice>
                  )}
                  <table className="w-full border-collapse text-left font-mono text-xs">
                    <thead>
                      <tr className="border-b border-line text-ink-muted">
                        <th scope="col" className="px-2 py-1.5">Block</th>
                        <th scope="col" className="px-2 py-1.5">D(block)</th>
                        <th scope="col" className="px-2 py-1.5">|D|</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ids.map((id) => {
                        const doms = state.dom[String(id)] ?? [];
                        return (
                          <tr
                            key={id}
                            className={clsx(
                              'border-b border-line/50',
                              id === currentBlock && 'bg-accent-soft shadow-[inset_2px_0_0_var(--accent)]',
                            )}
                          >
                            <th scope="row" className="px-2 py-1.5 font-semibold">
                              B{id}
                              {id === state.entry && (
                                <span className="ml-1 text-[10px] font-normal text-ink-muted">entry</span>
                              )}
                            </th>
                            <td className="px-2 py-1.5">
                              {doms.length === 0 ? '∅' : `{${doms.map((d) => `B${d}`).join(', ')}}`}
                            </td>
                            <td className="px-2 py-1.5 text-ink-faint">{doms.length}</td>
                          </tr>
                        );
                      })}
                      {ids.length === 0 && (
                        <tr>
                          <td colSpan={3} className="px-2 py-6 text-center text-ink-faint">
                            Step forward to initialise the dominator sets.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </Panel>

                <Panel
                  title="Flow graph"
                  subtitle={
                    currentBlock === null
                      ? 'The block being recomputed is emphasized; its dominators are shaded.'
                      : `D(B${currentBlock}) = {${currentDoms.map((d) => `B${d}`).join(', ')}}`
                  }
                  bodyClassName="p-0"
                >
                  <CfgGraph
                    blocks={blocks}
                    edges={edges}
                    currentBlocks={currentBlock === null ? [] : [currentBlock]}
                    visitedBlocks={currentDoms.filter((d) => d !== currentBlock)}
                    badges={loopBadges(loops.loopHeaders)}
                    graphHeight="24rem"
                    ariaLabel={`Flow graph of ${fn.name}`}
                  />
                </Panel>
              </>
            );
          }}
        </SplitTraceView>
      )}
    </TraceGate>
  );
}

// ── 5. Back edges and natural loops (§9.6.4 / Algorithm 9.46) ───────────────

function LoopsAnalysis({ source, fn, cfg, stepperOptions }: AnalysisViewProps) {
  const load = useOptTrace<LoopsState, LoopsEvent>(
    analysisRequest('loops', source, fn),
    loopsReducer,
  );
  const blocks = useMemo(() => cfgBlockViews(fn, cfg), [fn, cfg]);
  const loops = useMemo(() => loopStructure(cfg), [cfg]);
  const edges = useMemo<CfgGraphEdgeView[]>(
    () =>
      cfg.edges.map((e) => ({
        from: e.from,
        to: e.to,
        back: loops.backEdges.has(edgeKey(e.from, e.to)),
      })),
    [cfg, loops],
  );

  return (
    <TraceGate load={load} what={`the natural loops of ${fn.name}()`} unavailableExplanation={UNAVAILABLE}>
      {(trace) => (
        <SplitTraceView trace={trace} title="Back edges & natural loops" stepperOptions={stepperOptions}>
          {(stepper) => {
            const state = stepper.state;
            const event = stepper.currentStep?.event ?? null;
            const foundBackEdges = state.backEdges.map((e) => edgeKey(e.from, e.to));
            const currentEdge =
              event?.kind === 'back-edge' ? [edgeKey(event.from, event.to)] : [];
            const bodyBlocks = new Set<number>();
            for (const loop of state.loops) for (const b of loop.body) bodyBlocks.add(b);
            for (const b of state.building?.nodes ?? []) bodyBlocks.add(b);
            const currentBlocks =
              event?.kind === 'loop-node-added'
                ? [event.node]
                : event?.kind === 'back-edge'
                  ? [event.from, event.to]
                  : [];

            const badges: Record<number, string[]> = {};
            for (const loop of state.loops) {
              (badges[loop.header] ??= []).push('↻ loop header');
              for (const b of loop.body) {
                if (b !== loop.header) (badges[b] ??= []).push(`in loop B${loop.header}`);
              }
            }

            return (
              <>
                <Panel
                  title={`Loops in ${fn.name}()`}
                  cite={{ section: '9.6.6', figureOrAlgo: 'Algorithm 9.46' }}
                  subtitle="A back edge’s head dominates its tail; its natural loop is the head plus everything that reaches the tail without passing through the head."
                  bodyClassName="p-0"
                >
                  <CfgGraph
                    blocks={blocks}
                    edges={edges}
                    currentBlocks={currentBlocks}
                    visitedBlocks={[...bodyBlocks]}
                    visitedEdges={foundBackEdges}
                    currentEdges={currentEdge}
                    badges={badges}
                    graphHeight="28rem"
                    ariaLabel={`Flow graph of ${fn.name} with natural loops`}
                  />
                </Panel>

                <Panel
                  title="Back edges"
                  subtitle={`${state.backEdges.length} found`}
                  bodyClassName="flex flex-wrap gap-1.5"
                >
                  {state.backEdges.length === 0 && (
                    <p className="text-sm text-ink-muted">
                      None found yet. Every edge a → b of the flow graph is tested: it is a back
                      edge exactly when b dominates a.
                    </p>
                  )}
                  {state.backEdges.map((e) => (
                    <Chip key={edgeKey(e.from, e.to)} tone="accent">
                      <Waypoints aria-hidden className="size-3" />
                      B{e.from} → B{e.to}
                    </Chip>
                  ))}
                </Panel>

                <Panel title="Natural loops" bodyClassName="flex flex-col gap-2">
                  {state.loops.length === 0 && state.building === null && (
                    <p className="text-sm text-ink-muted">
                      No natural loop has been closed yet.
                    </p>
                  )}
                  {state.loops.map((loop) => (
                    <div
                      key={`${loop.backEdge.from}-${loop.header}`}
                      className="rounded-md border border-line px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <Chip tone="accent">header B{loop.header}</Chip>
                        <Chip tone="neutral">
                          back edge B{loop.backEdge.from} → B{loop.backEdge.to}
                        </Chip>
                        <span className="font-mono text-ink-muted">
                          body {`{${loop.body.map((b) => `B${b}`).join(', ')}}`}
                        </span>
                      </div>
                    </div>
                  ))}
                  {state.building && (
                    <div className="rounded-md border border-dashed border-accent/60 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <Chip tone="accent">building</Chip>
                        <span className="font-mono text-ink-muted">
                          header B{state.building.header} · so far{' '}
                          {`{${state.building.nodes.map((b) => `B${b}`).join(', ')}}`}
                        </span>
                      </div>
                    </div>
                  )}
                </Panel>
              </>
            );
          }}
        </SplitTraceView>
      )}
    </TraceGate>
  );
}

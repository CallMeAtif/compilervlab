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
import { FullscreenTransport } from '../../../components/Fullscreen';
import { ANALYSIS_META, blockName, edgeKey, type AnalysisId } from '../lib/optModel';
import { cfgBlockViews, loopStructure, quadLines } from '../lib/cfgModel';
import { useOptTrace } from '../lib/useOptTrace';
import { CfgGraph, type CfgGraphEdgeView } from '../components/CfgGraph';
import { DataflowTable } from '../components/DataflowTable';
import { Chip, Disclosure, Panel } from '../components/OptStates';
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

const UNAVAILABLE = 'Analyses need a program that reached intermediate-code generation.';

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
        <SplitTraceView trace={trace} stepperOptions={stepperOptions}>
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
                  title={`Basic blocks · ${fn.name}()`}
                  cite={{ section: '8.4.1', figureOrAlgo: 'Algorithm 8.5' }}
                  actions={
                    <span className="section-meta">
                      {state.leaders.length}/{lines.length} leaders · {state.blocks.length} blocks
                    </span>
                  }
                  bodyClassName="flex flex-col gap-4"
                  fullscreen={{
                    label: `the three-address code of ${fn.name}`,
                    controls: <FullscreenTransport stepper={stepper} />,
                  }}
                >
                  {/* The three rule statements are reference material: one
                      interaction away, with the rule that just fired named on
                      the closed summary line. */}
                  <Disclosure
                    summary="Leader rules"
                    meta={firedRule === null ? undefined : `L${firedRule} fired`}
                  >
                    <ol className="flex flex-col">
                      {([1, 2, 3] as const).map((rule) => (
                        <li
                          key={rule}
                          className={clsx(
                            'flex items-baseline gap-2.5 border-t border-line py-2 pl-3 text-sm first:border-t-0',
                            firedRule === rule
                              ? 'bg-accent-soft text-ink shadow-[inset_3px_0_0_var(--accent)]'
                              : 'text-ink-muted',
                          )}
                        >
                          <span className="font-mono text-xs font-semibold">L{rule}</span>
                          <span className="min-w-0 flex-1">{LEADER_RULES[rule]}</span>
                          {firedRule === rule && (
                            <span className="shrink-0 pr-2 font-mono text-2xs text-accent">
                              fired
                            </span>
                          )}
                        </li>
                      ))}
                    </ol>
                  </Disclosure>
                  <TacListing
                    lines={lines}
                    leaders={leaders}
                    blockOf={blockOf}
                    currentQuads={current}
                    className="max-h-140"
                    ariaLabel={`Three-address code of ${fn.name}`}
                  />
                </Panel>

                <Panel title="Blocks formed" bodyClassName="flex flex-wrap items-center gap-1.5">
                  {state.blocks.length === 0 && <p className="prose-note">None yet.</p>}
                  {state.blocks.map((b) => (
                    <Chip key={b.id} tone={event?.kind === 'block-formed' && event.blockId === b.id ? 'accent' : 'neutral'}>
                      B{b.id}: {b.quadIndices[0] ?? 0}–{b.quadIndices[b.quadIndices.length - 1] ?? 0}
                    </Chip>
                  ))}
                  {state.blocks.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onSelectAnalysis('cfg')}
                      className="ml-auto flex h-11 cursor-pointer items-center gap-1.5 text-sm font-medium text-accent underline decoration-accent/40 underline-offset-4 transition-colors hover:decoration-accent"
                    >
                      Flow graph
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

/** Per-edge reason, as a noun phrase in the Reason column. */
const EDGE_REASON: Record<string, string> = {
  entry: 'ENTRY to the first instruction',
  'jump-target': 'jump target',
  fallthrough: 'falls through in program order',
  return: 'return leaves the function',
  'fall-off-end': 'falls off the end',
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
          <SplitTraceView trace={trace} stepperOptions={stepperOptions}>
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
                    title={`Flow graph · ${fn.name}()`}
                    cite={{ section: '8.4.3' }}
                    actions={
                      <span className="section-meta">
                        {discovered.length}/{finalCfg.edges.length} edges
                      </span>
                    }
                    /* No `frame`: ElkGraph already draws the artifact's own `.framed` box. */
                  >
                    <CfgGraph
                      blocks={blocks}
                      edges={edges}
                      currentBlocks={event ? [event.from, event.to] : []}
                      visitedEdges={discovered}
                      currentEdges={currentEdge ? [currentEdge] : []}
                      badges={loopBadges(loops.loopHeaders)}
                      graphHeight="28rem"
                      controls={<FullscreenTransport stepper={stepper} />}
                      ariaLabel={`Flow graph of ${fn.name}`}
                    />
                  </Panel>

                  <Panel title="Edges">
                    <div className="artifact-scroll">
                      <table className="w-full border-collapse text-left font-mono text-xs">
                        <thead>
                          <tr className="border-b border-line text-2xs tracking-wide text-ink-faint uppercase">
                            <th scope="col" className="py-1.5 pr-3 font-medium">Edge</th>
                            <th scope="col" className="py-1.5 pr-3 font-medium">Reason</th>
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
                                  'border-b border-line/60',
                                  key === currentEdge &&
                                    'bg-accent-soft shadow-[inset_3px_0_0_var(--accent)]',
                                  reason === undefined && 'text-ink-faint',
                                )}
                              >
                                <td className="py-1.5 pr-3 pl-3 whitespace-nowrap">
                                  {blockName(e.from)} → {blockName(e.to)}
                                  {isBack && (
                                    <span className="ml-1.5 rounded-sm border border-line-strong px-1 text-3xs tracking-wide uppercase">
                                      ↩ back edge
                                    </span>
                                  )}
                                </td>
                                <td className="py-1.5 pr-3 font-sans text-sm text-ink-muted">
                                  {reason ? (EDGE_REASON[reason] ?? reason) : 'not discovered yet'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
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
                  actions={
                    <span className="section-meta flex items-center gap-1.5">
                      {state.converged ? (
                        <>
                          <CheckCircle2 aria-hidden className="size-3 text-ok" />
                          converged · {state.iterations} iteration
                          {state.iterations === 1 ? '' : 's'}
                        </>
                      ) : (
                        <>
                          <RefreshCw aria-hidden className="size-3" />
                          {state.iterations === 0 ? 'setting up' : `iteration ${state.iterations}`}
                        </>
                      )}
                    </span>
                  }
                  bodyClassName="flex flex-col gap-4"
                  fullscreen={{
                    label: `the ${meta.label.toLowerCase()} table`,
                    controls: <FullscreenTransport stepper={stepper} />,
                  }}
                >
                  <DataflowTable
                    state={state}
                    blockIds={blockIds}
                    currentBlock={currentBlock}
                    changed={changed}
                  />
                </Panel>

                {analysis === 'reaching-defs' && defs.length > 0 && (
                  <Disclosure summary="Domain U" meta={`${defs.length} definitions · §9.2.4`}>
                    <div className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
                      {defs.map((d) => (
                        <div key={d.id} className="flex items-baseline gap-2 font-mono text-xs">
                          <span className="w-8 shrink-0 font-semibold tabular-nums">{d.id}</span>
                          <span className="w-8 shrink-0 text-ink-faint tabular-nums">
                            {d.quadIndex}
                          </span>
                          <span
                            className="truncate text-ink-muted"
                            title={lines[d.quadIndex]?.text}
                          >
                            {lines[d.quadIndex]?.text ?? `defines ${d.var}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </Disclosure>
                )}

                <Panel title={`Flow graph · ${fn.name}()`}>
                  <CfgGraph
                    blocks={blocks}
                    edges={edges}
                    currentBlocks={currentBlock === null ? [] : [currentBlock]}
                    badges={loopBadges(loops.loopHeaders)}
                    graphHeight="24rem"
                    controls={<FullscreenTransport stepper={stepper} />}
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
        <SplitTraceView trace={trace} stepperOptions={stepperOptions}>
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
                  title={`Dominators · ${fn.name}()`}
                  cite={{
                    section: '9.6.1',
                    rule: 'D(n) = {n} ∪ ( ∩ over predecessors p of n of D(p) ). d dom n means every path from ENTRY to n passes through d.',
                  }}
                  actions={
                    <span className="section-meta flex items-center gap-1.5">
                      {state.converged ? (
                        <>
                          <CheckCircle2 aria-hidden className="size-3 text-ok" />
                          converged · {state.iterations} iteration
                          {state.iterations === 1 ? '' : 's'}
                        </>
                      ) : (
                        <>
                          <RefreshCw aria-hidden className="size-3" />
                          {state.iterations === 0 ? 'initialising' : `iteration ${state.iterations}`}
                        </>
                      )}
                    </span>
                  }
                  bodyClassName="flex flex-col gap-4"
                  fullscreen={{
                    label: 'the dominator table',
                    controls: <FullscreenTransport stepper={stepper} />,
                  }}
                >
                  <div className="artifact-scroll">
                    <table className="w-full border-collapse text-left font-mono text-xs">
                      <thead>
                        <tr className="border-b border-line text-2xs tracking-wide text-ink-faint uppercase">
                          <th scope="col" className="py-1.5 pr-3 pl-3 font-medium">Block</th>
                          <th scope="col" className="py-1.5 pr-3 font-medium">D(block)</th>
                          <th scope="col" className="py-1.5 pr-3 font-medium">|D|</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ids.map((id) => {
                          const doms = state.dom[String(id)] ?? [];
                          return (
                            <tr
                              key={id}
                              className={clsx(
                                'border-b border-line/60',
                                id === currentBlock &&
                                  'bg-accent-soft shadow-[inset_3px_0_0_var(--accent)]',
                              )}
                            >
                              <th scope="row" className="py-1.5 pr-3 pl-3 font-semibold">
                                B{id}
                                {id === state.entry && (
                                  <span className="ml-1 text-3xs font-normal text-ink-muted">
                                    entry
                                  </span>
                                )}
                              </th>
                              <td className="py-1.5 pr-3">
                                {doms.length === 0 ? '∅' : `{${doms.map((d) => `B${d}`).join(', ')}}`}
                              </td>
                              <td className="py-1.5 pr-3 text-ink-faint tabular-nums">
                                {doms.length}
                              </td>
                            </tr>
                          );
                        })}
                        {ids.length === 0 && (
                          <tr>
                            <td colSpan={3} className="py-6 pl-3 text-ink-faint">
                              Not initialised yet. Step forward.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </Panel>

                <Panel
                  title="Flow graph"
                  actions={
                    currentBlock === null ? undefined : (
                      <span className="section-meta">
                        D(B{currentBlock}) = {`{${currentDoms.map((d) => `B${d}`).join(', ')}}`}
                      </span>
                    )
                  }
                  /* No `frame`: ElkGraph already draws the artifact's own `.framed` box. */
                >
                  <CfgGraph
                    blocks={blocks}
                    edges={edges}
                    currentBlocks={currentBlock === null ? [] : [currentBlock]}
                    visitedBlocks={currentDoms.filter((d) => d !== currentBlock)}
                    badges={loopBadges(loops.loopHeaders)}
                    graphHeight="24rem"
                    controls={<FullscreenTransport stepper={stepper} />}
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
        <SplitTraceView trace={trace} stepperOptions={stepperOptions}>
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
                  title={`Loops · ${fn.name}()`}
                  cite={{
                    section: '9.6.6',
                    figureOrAlgo: 'Algorithm 9.46',
                    rule: 'A back edge’s head dominates its tail; its natural loop is the head plus everything that reaches the tail without passing through the head.',
                  }}
                  /* No `frame`: ElkGraph already draws the artifact's own `.framed` box. */
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
                    controls={<FullscreenTransport stepper={stepper} />}
                    ariaLabel={`Flow graph of ${fn.name} with natural loops`}
                  />
                </Panel>

                <Panel
                  title="Back edges"
                  actions={<span className="section-meta">{state.backEdges.length} found</span>}
                  bodyClassName="flex flex-wrap gap-1.5"
                >
                  {state.backEdges.length === 0 && <p className="prose-note">None found yet.</p>}
                  {state.backEdges.map((e) => (
                    <Chip key={edgeKey(e.from, e.to)} tone="accent">
                      <Waypoints aria-hidden className="size-3" />
                      B{e.from} → B{e.to}
                    </Chip>
                  ))}
                </Panel>

                <Panel title="Natural loops" bodyClassName="flex flex-col">
                  {state.loops.length === 0 && state.building === null && (
                    <p className="prose-note">None closed yet.</p>
                  )}
                  {state.loops.map((loop) => (
                    <div
                      key={`${loop.backEdge.from}-${loop.header}`}
                      className="flex flex-wrap items-center gap-2 border-t border-line py-2.5 first:border-t-0"
                    >
                      <Chip tone="accent">header B{loop.header}</Chip>
                      <Chip tone="neutral">
                        back edge B{loop.backEdge.from} → B{loop.backEdge.to}
                      </Chip>
                      <span className="font-mono text-xs text-ink-muted">
                        body {`{${loop.body.map((b) => `B${b}`).join(', ')}}`}
                      </span>
                    </div>
                  ))}
                  {state.building && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 border-l-2 border-dashed border-l-accent py-1 pl-3">
                      <Chip tone="accent">building</Chip>
                      <span className="font-mono text-xs text-ink-muted">
                        header B{state.building.header} · so far{' '}
                        {`{${state.building.nodes.map((b) => `B${b}`).join(', ')}}`}
                      </span>
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

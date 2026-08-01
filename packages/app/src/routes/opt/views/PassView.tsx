/**
 * One optimization pass (`opt.pass`), traced on exactly the program state it
 * sees inside the default pipeline.
 *
 * A pass trace interleaves the pass's own analysis events — basic blocks, CFG,
 * data flow (§9.2), dominators and natural loops (§9.6) — which `passReducer`
 * ignores. Those events are replayed here with their own reducers so the
 * analysis table stands next to the rewrite diff, exactly as the algorithm saw
 * it. LICM additionally emits invariant marking and the three code-motion
 * legality conditions, which get their own panel.
 */
import { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import {
  Check,
  CircleSlash,
  CornerDownRight,
  MoveDown,
  Repeat,
  X,
} from 'lucide-react';
import type { OptimizedProgram } from '@lab/core/opt/types.js';
import { formatQuad } from '@lab/core/ir/types.js';
import {
  passReducer,
  type PassEvent,
  type PassState,
} from '@lab/core/opt/opt-events.js';
import {
  dataflowReducer,
  initialDataflowState,
  type DataflowEvent,
  type DataflowState,
} from '@lab/core/opt/dataflow.js';
import {
  dominatorsReducer,
  initialDominatorsState,
  type DominatorsEvent,
  type DominatorsState,
} from '@lab/core/opt/dominators.js';
import {
  initialLoopsState,
  loopsReducer,
  type LoopsEvent,
  type LoopsState,
} from '@lab/core/opt/loops.js';
import type { Trace } from '@lab/trace';
import type { Stepper, UseStepperOptions } from '../../../lib/useStepper';
import { DiffView } from '../../../components/DiffView';
import {
  PASS_META,
  blockName,
  edgeKey,
  type PassId,
} from '../lib/optModel';
import {
  blockOfQuad,
  cfgBlockViews,
  cfgForFunction,
  loopStructure,
} from '../lib/cfgModel';
import { buildPassDiff, unchangedRows } from '../lib/passDiff';
import {
  DATAFLOW_KINDS,
  DOMINATOR_KINDS,
  LOOP_KINDS,
  lastIndexOfKind,
  useOptTrace,
  useReplay,
  type ReplaySpec,
} from '../lib/useOptTrace';
import { CitationBadge } from '../../../components/CitationBadge';
import { FullscreenTransport } from '../../../components/Fullscreen';
import { CfgGraph, type CfgGraphEdgeView } from '../components/CfgGraph';
import { DataflowTable } from '../components/DataflowTable';
import { Chip, Notice, Panel } from '../components/OptStates';
import { PassRail, FunctionPicker, type PassStat } from '../components/OptNav';
import { SplitTraceView } from '../components/SplitTraceView';
import { TraceGate } from '../components/TraceGate';

const DATAFLOW_SPEC: ReplaySpec<DataflowState, DataflowEvent> = {
  kinds: DATAFLOW_KINDS,
  reducer: dataflowReducer,
  initial: initialDataflowState,
};
const DOMINATOR_SPEC: ReplaySpec<DominatorsState, DominatorsEvent> = {
  kinds: DOMINATOR_KINDS,
  reducer: dominatorsReducer,
  initial: initialDominatorsState,
};
const LOOPS_SPEC: ReplaySpec<LoopsState, LoopsEvent> = {
  kinds: LOOP_KINDS,
  reducer: loopsReducer,
  initial: initialLoopsState,
};
const DOM_INIT_KINDS: ReadonlySet<string> = new Set(['dom-init']);

/** The three §9.1.5 code-motion conditions, as labels for each checked item. */
const LEGALITY_LABEL: Record<string, string> = {
  'dominates-exits-or-dead': '1 · dominates every loop exit, or target dead after the loop',
  'only-def-in-loop': '2 · sole definition of x in the loop',
  'only-def-reaching-uses': '3 · reaches every use of x in the loop',
  'depends-on-moved-invariants': 'dep · operands’ in-loop definitions already moved',
};

export interface PassViewProps {
  pass: PassId;
  source: string;
  optimized: OptimizedProgram;
  stepperOptions: UseStepperOptions;
  onSelectPass: (pass: PassId) => void;
}

function quadCount(program: { functions: ReadonlyArray<{ quads: unknown[] }> }): number {
  return program.functions.reduce((n, f) => n + f.quads.length, 0);
}

export function PassView({ pass, source, optimized, stepperOptions, onSelectPass }: PassViewProps) {
  const meta = PASS_META[pass];
  const load = useOptTrace<PassState, PassEvent>(
    { kind: 'opt.pass', params: { source, pass } },
    passReducer,
  );

  const passIndex = optimized.passes.findIndex((p) => p.pass === pass);
  const previous = passIndex > 0 ? optimized.passes[passIndex - 1] : undefined;
  const entering = passIndex <= 0 ? optimized.input : (previous?.after ?? optimized.input);
  const enteringCfgs = passIndex <= 0 ? optimized.cfgs : (previous?.cfgAfter ?? optimized.cfgs);
  const result = passIndex >= 0 ? optimized.passes[passIndex] : undefined;

  const stats = useMemo<Partial<Record<PassId, PassStat>>>(() => {
    const out: Partial<Record<PassId, PassStat>> = {};
    let before = quadCount(optimized.input);
    for (const p of optimized.passes) {
      const after = quadCount(p.after);
      out[p.pass as PassId] = { before, after, changes: p.changes.length, ran: true };
      before = after;
    }
    return out;
  }, [optimized]);

  const changedFunctions = useMemo(
    () => new Set((result?.changes ?? []).map((c) => c.functionName)),
    [result],
  );
  const functionNames = useMemo(
    () => entering.functions.map((f) => f.name),
    [entering],
  );
  const [selected, setSelected] = useState<string | null>(null);
  const selectedFn =
    (selected && functionNames.includes(selected) ? selected : null) ??
    functionNames.find((n) => changedFunctions.has(n)) ??
    functionNames[0] ??
    '';

  return (
    <div className="flex min-w-0 flex-col">
      {/* ONE band above the artifact: the pass name and its analysis on the
          title line, the pipeline rail under it, the function picker beside. */}
      <section className="section">
        <header className="section-head">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <h2 className="section-title">{meta.label}</h2>
            <CitationBadge cite={meta.citation} />
          </div>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="section-meta">{meta.analysisLabel ?? 'no analysis'}</span>
            <FunctionPicker functions={functionNames} selected={selectedFn} onSelect={setSelected} label="fn" />
          </div>
        </header>
        <PassRail
          selected={pass}
          onSelect={onSelectPass}
          stats={stats}
          inputQuads={quadCount(optimized.input)}
          outputQuads={quadCount(optimized.output)}
        />
      </section>

      <div className="mt-8 min-w-0">
        <TraceGate
          load={load}
          what={`the ${meta.label.toLowerCase()} pass`}
          unavailableExplanation="Pass traces need a program that reached intermediate-code generation."
        >
          {(trace) => (
            <SplitTraceView trace={trace} stepperOptions={stepperOptions}>
              {(stepper) => (
                <PassViz
                  pass={pass}
                  stepper={stepper}
                  trace={trace}
                  selectedFn={selectedFn}
                  entering={entering}
                  enteringCfgs={enteringCfgs}
                />
              )}
            </SplitTraceView>
          )}
        </TraceGate>
      </div>
    </div>
  );
}

interface PassVizProps {
  pass: PassId;
  stepper: Stepper<PassState, PassEvent>;
  trace: Trace<PassState, PassEvent>;
  selectedFn: string;
  entering: OptimizedProgram['input'];
  enteringCfgs: OptimizedProgram['cfgs'];
}

function PassViz({ pass, stepper, trace, selectedFn, entering, enteringCfgs }: PassVizProps) {
  const meta = PASS_META[pass];
  const index = stepper.index;
  const state = stepper.state;

  const fn = useMemo(
    () => entering.functions.find((f) => f.name === selectedFn) ?? entering.functions[0] ?? null,
    [entering, selectedFn],
  );
  const cfg = useMemo(
    () => (fn ? cfgForFunction(enteringCfgs, fn.name) : null),
    [enteringCfgs, fn],
  );
  const beforeLines = useMemo(() => (fn ? fn.quads.map((q) => formatQuad(q)) : []), [fn]);

  // ── rewrite diff ───────────────────────────────────────────────────────────
  const rewrites = useMemo(() => {
    const out: Array<{ snapshot: readonly string[]; justification: string }> = [];
    for (let i = 0; i < index && i < trace.steps.length; i++) {
      const event = trace.steps[i]?.event;
      if (event?.kind !== 'rewrite') continue;
      if (event.change.functionName !== selectedFn) continue;
      out.push({ snapshot: event.snapshot.quads, justification: event.change.justification });
    }
    return out;
  }, [trace, index, selectedFn]);

  const diff = useMemo(
    () =>
      rewrites.length === 0
        ? { rows: unchangedRows(beforeLines), added: 0, removed: 0, changed: 0 }
        : buildPassDiff(beforeLines, rewrites),
    [beforeLines, rewrites],
  );

  const skipped = useMemo(() => {
    const out: Array<{ quadIndex: number; reason: string }> = [];
    for (let i = 0; i < index && i < trace.steps.length; i++) {
      const event = trace.steps[i]?.event;
      if (event?.kind === 'rewrite-skipped' && event.functionName === selectedFn) {
        out.push({ quadIndex: event.quadIndex, reason: event.reason });
      }
    }
    return out;
  }, [trace, index, selectedFn]);

  // ── replayed analyses ──────────────────────────────────────────────────────
  const segmentStart = lastIndexOfKind(trace, index, DOM_INIT_KINDS);
  const dataflow = useReplay(trace, index, DATAFLOW_SPEC);
  const dominators = useReplay(trace, index, DOMINATOR_SPEC, segmentStart);
  const loops = useReplay(trace, index, LOOPS_SPEC, segmentStart);

  const dfBlockIds = useMemo(
    () =>
      Object.keys(dataflow.gen)
        .map((k) => Number(k))
        .filter((n) => Number.isFinite(n) && n >= 0)
        .sort((a, b) => a - b),
    [dataflow],
  );

  // ── LICM marking / legality ────────────────────────────────────────────────
  const licm = useMemo(() => {
    const invariants = new Map<number, { reason: string; loopHeader: number }>();
    const legality = new Map<
      number,
      Array<{ condition: string; ok: boolean; detail: string }>
    >();
    for (let i = 0; i < index && i < trace.steps.length; i++) {
      const event = trace.steps[i]?.event;
      if (!event) continue;
      if (event.kind === 'licm-invariant' && event.functionName === selectedFn) {
        invariants.set(event.quadIndex, { reason: event.reason, loopHeader: event.loopHeader });
      } else if (event.kind === 'licm-legality' && event.functionName === selectedFn) {
        const list = legality.get(event.quadIndex) ?? [];
        const existing = list.findIndex((c) => c.condition === event.condition);
        const entry = { condition: event.condition, ok: event.ok, detail: event.detail };
        if (existing >= 0) list[existing] = entry;
        else list.push(entry);
        legality.set(event.quadIndex, list);
      }
    }
    return { invariants, legality };
  }, [trace, index, selectedFn]);

  const currentEvent = stepper.currentStep?.event ?? null;
  const licmFocus =
    currentEvent && (currentEvent.kind === 'licm-invariant' || currentEvent.kind === 'licm-legality')
      ? currentEvent.quadIndex
      : null;

  const movedChanges = useMemo(
    () => state.changes.filter((c) => c.functionName === selectedFn && c.kind === 'move'),
    [state.changes, selectedFn],
  );
  const preheaderChange = useMemo(
    () => state.changes.find((c) => c.functionName === selectedFn && c.kind === 'insert'),
    [state.changes, selectedFn],
  );

  // ── CFG emphasis ───────────────────────────────────────────────────────────
  const quadToBlock = useMemo(() => (cfg ? blockOfQuad(cfg) : new Map<number, number>()), [cfg]);
  const structure = useMemo(() => (cfg ? loopStructure(cfg) : null), [cfg]);
  const blocks = useMemo(() => (fn && cfg ? cfgBlockViews(fn, cfg) : []), [fn, cfg]);
  const edges = useMemo<CfgGraphEdgeView[]>(
    () =>
      cfg
        ? cfg.edges.map((e) => ({
            from: e.from,
            to: e.to,
            back: structure?.backEdges.has(edgeKey(e.from, e.to)) ?? false,
          }))
        : [],
    [cfg, structure],
  );

  const currentBlocks = useMemo(() => {
    const out = new Set<number>();
    for (const ref of stepper.currentStep?.meta.irRefs ?? []) {
      if (ref.kind === 'block') out.add(Number(ref.id));
      else if (ref.kind === 'tacInstr') {
        const b = quadToBlock.get(Number(ref.id));
        if (b !== undefined) out.add(b);
      }
    }
    if (licmFocus !== null) {
      const b = quadToBlock.get(licmFocus);
      if (b !== undefined) out.add(b);
    }
    return [...out];
  }, [stepper.currentStep, quadToBlock, licmFocus]);

  const badges = useMemo(() => {
    const out: Record<number, string[]> = {};
    for (const header of structure?.loopHeaders ?? []) out[header] = ['↻ loop header'];
    for (const loop of loops.loops) {
      for (const b of loop.body) {
        if (b !== loop.header) (out[b] ??= []).push(`in loop B${loop.header}`);
      }
    }
    return out;
  }, [structure, loops]);

  const markedQuads = useMemo(() => new Set(licm.invariants.keys()), [licm]);

  if (!fn || !cfg) {
    return <Notice tone="warn">No flow graph for this function.</Notice>;
  }

  return (
    <>
      <Panel
        title="Flow graph"
        actions={
          <span className="section-meta">
            {fn.name}() · {cfg.blocks.length} blocks · {cfg.edges.length} edges
            {structure && structure.backEdges.size > 0
              ? ` · ${structure.backEdges.size} back`
              : ''}
          </span>
        }
        /* No `frame`: ElkGraph already draws the artifact's own `.framed` box. */
      >
        <CfgGraph
          blocks={blocks}
          edges={edges}
          currentBlocks={currentBlocks}
          badges={badges}
          markedQuads={markedQuads}
          graphHeight="24rem"
          controls={<FullscreenTransport stepper={stepper} />}
          ariaLabel={`Flow graph of ${fn.name} entering the ${pass} pass`}
        />
      </Panel>

      {pass === 'licm' && (
        <LicmPanel
          fn={fn}
          invariants={licm.invariants}
          legality={licm.legality}
          focus={licmFocus}
          loops={loops}
          dominators={dominators}
          preheaderJustification={preheaderChange?.justification ?? null}
          movedCount={movedChanges.length}
        />
      )}

      {meta.analysis !== null && dataflow.name !== '' && (
        <Panel
          title={dataflow.name}
          cite={{ section: dataflow.name === 'live-variables' ? '9.2.5' : '9.2' }}
          actions={
            <span className="section-meta flex items-center gap-1.5">
              {dataflow.converged ? (
                <>
                  <Check aria-hidden className="size-3 text-ok" />
                  converged · {dataflow.iterations} iteration
                  {dataflow.iterations === 1 ? '' : 's'}
                </>
              ) : (
                <>
                  <Repeat aria-hidden className="size-3" />
                  iteration {Math.max(dataflow.iterations, 1)}
                </>
              )}
            </span>
          }
          bodyClassName="flex flex-col gap-4"
          fullscreen={{
            label: `the ${dataflow.name} table`,
            controls: <FullscreenTransport stepper={stepper} />,
          }}
        >
          <DataflowTable
            state={dataflow}
            blockIds={dfBlockIds}
            currentBlock={currentEvent?.kind === 'df-update' ? currentEvent.blockId : null}
            changed={currentEvent?.kind === 'df-update' ? currentEvent.changed : undefined}
          />
        </Panel>
      )}

      <Panel
        title={`Rewrites in ${fn.name}()`}
        actions={
          <div className="flex items-center gap-1.5">
            <span className="section-meta">
              {state.changes.filter((c) => c.functionName === fn.name).length} applied
              {state.done ? ' · done' : ''}
            </span>
            <Chip tone={diff.changed > 0 ? 'warn' : 'neutral'}>~ {diff.changed}</Chip>
            <Chip tone={diff.added > 0 ? 'ok' : 'neutral'}>+ {diff.added}</Chip>
            <Chip tone={diff.removed > 0 ? 'err' : 'neutral'}>− {diff.removed}</Chip>
          </div>
        }
      >
        <DiffView
          rows={diff.rows}
          beforeLabel={`Before ${meta.short}`}
          afterLabel={state.done ? `After ${meta.short}` : 'At this step'}
          className="diff-editorial"
        />
      </Panel>

      {skipped.length > 0 && (
        <Panel
          title="Declined rewrites"
          actions={<span className="section-meta">{skipped.length}</span>}
          bodyClassName="flex flex-col gap-1.5"
        >
          {skipped.map((s, i) => (
            <p key={`${s.quadIndex}-${i}`} className="flex gap-2 text-sm text-ink-muted">
              <CircleSlash aria-hidden className="mt-1 size-3.5 shrink-0 text-warn" />
              <span className="min-w-0">
                <span className="font-mono text-xs text-ink">instruction {s.quadIndex}</span>{' '}
                {s.reason}
              </span>
            </p>
          ))}
        </Panel>
      )}
    </>
  );
}

// ── LICM detail panel ────────────────────────────────────────────────────────

function LicmPanel({
  fn,
  invariants,
  legality,
  focus,
  loops,
  dominators,
  preheaderJustification,
  movedCount,
}: {
  fn: OptimizedProgram['input']['functions'][number];
  invariants: ReadonlyMap<number, { reason: string; loopHeader: number }>;
  legality: ReadonlyMap<number, Array<{ condition: string; ok: boolean; detail: string }>>;
  focus: number | null;
  loops: LoopsState;
  dominators: DominatorsState;
  preheaderJustification: string | null;
  movedCount: number;
}) {
  const entries = [...invariants.entries()].sort((a, b) => a[0] - b[0]);
  return (
    <Panel
      title="Invariants"
      cite={{
        section: '9.1.5',
        rule: 'A statement is loop-invariant if each operand is constant, defined only outside the loop, or defined by a single loop-invariant statement of the loop',
      }}
      actions={
        <span className="section-meta">
          {loops.loops.length} loops · {entries.length} marked
        </span>
      }
      bodyClassName="flex flex-col gap-5"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip tone={dominators.converged ? 'ok' : 'neutral'}>
          dominators {dominators.converged ? `converged (${dominators.iterations})` : 'computing…'}
        </Chip>
        {loops.loops.map((loop) => (
          <Chip key={`${loop.backEdge.from}-${loop.header}`} tone="accent">
            loop B{loop.header} ← back edge B{loop.backEdge.from} · body{' '}
            {`{${loop.body.map((b) => `B${b}`).join(', ')}}`}
          </Chip>
        ))}
      </div>

      {entries.length === 0 ? (
        <p className="prose-note">Nothing marked yet.</p>
      ) : (
        <ul className="flex flex-col">
          {entries.map(([quadIndex, info]) => {
            const quad = fn.quads[quadIndex];
            const conditions = legality.get(quadIndex) ?? [];
            const allOk = conditions.length > 0 && conditions.every((c) => c.ok);
            const isFocus = focus === quadIndex;
            return (
              <li
                key={quadIndex}
                className={clsx(
                  'border-t border-line py-3 pl-3 first:border-t-0',
                  isFocus
                    ? 'bg-accent-soft shadow-[inset_3px_0_0_var(--accent)]'
                    : 'shadow-[inset_3px_0_0_var(--line)]',
                )}
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono type-code">
                  <CornerDownRight
                    aria-hidden
                    className="size-3.5 shrink-0 translate-y-0.5 text-ink-faint"
                  />
                  <span className="text-2xs text-ink-faint tabular-nums">{quadIndex}</span>
                  <span className="font-semibold text-ink">
                    {quad ? formatQuad(quad) : '‹removed›'}
                  </span>
                  <Chip tone="neutral">loop B{info.loopHeader}</Chip>
                  {conditions.length > 0 && (
                    <Chip tone={allOk ? 'ok' : 'err'}>
                      {allOk ? '✓ legal to move' : '■ blocked'}
                    </Chip>
                  )}
                </div>
                <p className="prose-note mt-1 text-sm">Invariant because {info.reason}.</p>
                {conditions.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1">
                    {conditions.map((c) => (
                      <li key={c.condition} className="flex items-start gap-2 text-sm">
                        {c.ok ? (
                          <Check aria-hidden className="mt-1 size-3.5 shrink-0 text-ok" />
                        ) : (
                          <X aria-hidden className="mt-1 size-3.5 shrink-0 text-err" />
                        )}
                        <span className="text-ink-muted">
                          <span className="font-semibold text-ink">
                            {LEGALITY_LABEL[c.condition] ?? c.condition}
                          </span>{' '}
                          — {c.detail}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {preheaderJustification && (
        <div className="border-l-2 border-l-accent pl-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <MoveDown aria-hidden className="size-3.5 text-accent" />
            Preheader · {movedCount} moved
          </p>
          {/* Per-item data from the pass itself, not standing explanation. */}
          <p className="prose-note mt-1 text-sm">{preheaderJustification}</p>
          <div className="mt-2.5 flex flex-col items-start gap-1 font-mono text-2xs text-ink-muted">
            <span className="rounded-sm border border-dashed border-accent px-2 py-0.5">
              preheader
            </span>
            <span className="pl-4" aria-hidden>
              ↓
            </span>
            <span className="rounded-sm border border-line-strong px-2 py-0.5">
              {blockName(loops.loops[0]?.header ?? 0)} header
            </span>
          </div>
        </div>
      )}
    </Panel>
  );
}

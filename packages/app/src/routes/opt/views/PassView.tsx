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

const LEGALITY_LABEL: Record<string, string> = {
  'dominates-exits-or-dead': '1 · the statement dominates every loop exit, or its target is dead after the loop',
  'only-def-in-loop': '2 · x has no other definition inside the loop',
  'only-def-reaching-uses': '3 · every use of x in the loop is reached only by this definition',
  'depends-on-moved-invariants': 'dep · the in-loop definitions its operands rely on have already moved',
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
    <div className="flex min-w-0 flex-col gap-4">
      <Panel
        title={meta.label}
        cite={meta.citation}
        subtitle={meta.analysisLabel ? `Analysis: ${meta.analysisLabel}` : 'No data-flow analysis needed'}
        bodyClassName="flex flex-col gap-3"
      >
        <p className="max-w-3xl text-sm text-ink-muted">{meta.blurb}</p>
        <PassRail
          selected={pass}
          onSelect={onSelectPass}
          stats={stats}
          inputQuads={quadCount(optimized.input)}
          outputQuads={quadCount(optimized.output)}
        />
        <FunctionPicker functions={functionNames} selected={selectedFn} onSelect={setSelected} />
      </Panel>

      <TraceGate
        load={load}
        what={`the ${meta.label.toLowerCase()} pass`}
        unavailableExplanation="Pass traces run on the optimizer's input program, so they need a program that compiled through intermediate-code generation."
      >
        {(trace) => (
          <SplitTraceView trace={trace} title={`Pass: ${pass}`} stepperOptions={stepperOptions}>
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
    return (
      <Notice tone="warn">
        This pass produced no flow graph for the selected function — pick another function.
      </Notice>
    );
  }

  return (
    <>
      <Panel
        title={`Flow graph entering ${meta.short} · ${fn.name}()`}
        subtitle={`${cfg.blocks.length} blocks · ${cfg.edges.length} edges${
          structure && structure.backEdges.size > 0
            ? ` · ${structure.backEdges.size} back edge(s)`
            : ''
        }`}
        bodyClassName="p-0"
      >
        <CfgGraph
          blocks={blocks}
          edges={edges}
          currentBlocks={currentBlocks}
          badges={badges}
          markedQuads={markedQuads}
          graphHeight="24rem"
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
          title={`Analysis while the pass runs: ${dataflow.name}`}
          cite={{ section: dataflow.name === 'live-variables' ? '9.2.5' : '9.2' }}
          subtitle="These events ride inside the pass trace — the pass rewrites only what this analysis proves."
          bodyClassName="flex flex-col gap-3"
        >
          {dataflow.converged ? (
            <Notice tone="ok" icon={<Check aria-hidden className="size-4 shrink-0" />}>
              {dataflow.name} converged after {dataflow.iterations} iteration
              {dataflow.iterations === 1 ? '' : 's'} — the pass now rewrites against this fixedpoint.
            </Notice>
          ) : (
            <Notice tone="info" icon={<Repeat aria-hidden className="size-4 shrink-0" />}>
              Iteration {Math.max(dataflow.iterations, 1)} in progress.
            </Notice>
          )}
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
        subtitle={`${state.changes.filter((c) => c.functionName === fn.name).length} change(s) applied so far${
          state.done ? ' · pass finished' : ''
        }`}
        actions={
          <div className="flex items-center gap-1.5">
            <Chip tone={diff.changed > 0 ? 'warn' : 'neutral'}>~ {diff.changed}</Chip>
            <Chip tone={diff.added > 0 ? 'ok' : 'neutral'}>+ {diff.added}</Chip>
            <Chip tone={diff.removed > 0 ? 'err' : 'neutral'}>− {diff.removed}</Chip>
          </div>
        }
        bodyClassName="p-0"
      >
        <DiffView
          rows={diff.rows}
          beforeLabel={`Before ${meta.short}`}
          afterLabel={state.done ? `After ${meta.short}` : 'At this step'}
          className="rounded-none border-0"
        />
      </Panel>

      {skipped.length > 0 && (
        <Panel
          title="Rewrites the pass declined"
          subtitle="Legality first: a transformation that could change the program's meaning is not applied."
          bodyClassName="flex flex-col gap-2"
        >
          {skipped.map((s, i) => (
            <div key={`${s.quadIndex}-${i}`} className="flex gap-2 text-xs">
              <CircleSlash aria-hidden className="mt-0.5 size-3.5 shrink-0 text-warn" />
              <span className="font-mono text-ink-muted">
                instruction {s.quadIndex}
              </span>
              <span className="text-ink-muted">{s.reason}</span>
            </div>
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
      title="Loop-invariant code motion"
      cite={{
        section: '9.1.5',
        rule: 'A statement is loop-invariant if each operand is constant, defined only outside the loop, or defined by a single loop-invariant statement of the loop',
      }}
      subtitle={
        loops.loops.length === 0
          ? 'Finding the natural loops first (dominators → back edges → loop bodies).'
          : `${loops.loops.length} natural loop(s) · ${entries.length} invariant statement(s) marked`
      }
      bodyClassName="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
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
        <p className="text-sm text-ink-muted">
          No statement has been marked loop-invariant yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map(([quadIndex, info]) => {
            const quad = fn.quads[quadIndex];
            const conditions = legality.get(quadIndex) ?? [];
            const allOk = conditions.length > 0 && conditions.every((c) => c.ok);
            const isFocus = focus === quadIndex;
            return (
              <li
                key={quadIndex}
                className={clsx(
                  'rounded-md border px-3 py-2',
                  isFocus ? 'border-accent bg-accent-soft' : 'border-line',
                )}
              >
                <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
                  <CornerDownRight aria-hidden className="size-3.5 text-ink-faint" />
                  <span className="text-ink-faint">{quadIndex}</span>
                  <span className="font-semibold text-ink">
                    {quad ? formatQuad(quad) : '‹removed›'}
                  </span>
                  <Chip tone="neutral">loop B{info.loopHeader}</Chip>
                  {conditions.length > 0 && (
                    <Chip tone={allOk ? 'ok' : 'err'}>
                      {allOk ? 'legal to move' : 'blocked'}
                    </Chip>
                  )}
                </div>
                <p className="mt-1 text-xs text-ink-muted">Invariant because {info.reason}.</p>
                {conditions.length > 0 && (
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {conditions.map((c) => (
                      <li key={c.condition} className="flex items-start gap-1.5 text-xs">
                        {c.ok ? (
                          <Check aria-hidden className="mt-0.5 size-3.5 shrink-0 text-ok" />
                        ) : (
                          <X aria-hidden className="mt-0.5 size-3.5 shrink-0 text-err" />
                        )}
                        <span className="text-ink-muted">
                          <span className="font-medium text-ink">
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
        <div className="rounded-md border border-accent/60 bg-accent-soft/60 px-3 py-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-ink">
            <MoveDown aria-hidden className="size-3.5" />
            Preheader created · {movedCount} statement(s) moved into it
          </div>
          <p className="mt-1 text-xs text-ink-muted">{preheaderJustification}</p>
          <div className="mt-2 flex flex-col items-start gap-1 font-mono text-[11px] text-ink-muted">
            <span className="rounded border border-dashed border-accent px-2 py-0.5">
              preheader — the moved invariants run once
            </span>
            <span className="pl-4">↓</span>
            <span className="rounded border border-line-strong px-2 py-0.5">
              loop header {blockName(loops.loops[0]?.header ?? 0)} — entered from the preheader,
              re-entered by the back edge
            </span>
          </div>
        </div>
      )}
    </Panel>
  );
}

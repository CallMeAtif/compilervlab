/**
 * `opt.pipeline` — the whole default sequence (const-fold, const-prop,
 * copy-prop, cse, licm, dce) in one trace. State is one PassState per pass, in
 * applied order, so the view is a timeline of passes plus the cumulative diff
 * from the optimizer's input to the program as of the current step.
 */
import { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { CheckCircle2, CircleDashed, Loader } from 'lucide-react';
import type { OptimizedProgram } from '@lab/core/opt/types.js';
import { formatQuad } from '@lab/core/ir/types.js';
import {
  pipelineReducer,
  type OptEvent,
  type PipelineState,
} from '@lab/core/opt/opt-events.js';
import type { Trace } from '@lab/trace';
import type { Stepper, UseStepperOptions } from '../../../lib/useStepper';
import { DiffView } from '../../../components/DiffView';
import { PASS_LIST, PASS_META, type PassId } from '../lib/optModel';
import { buildPassDiff, unchangedRows } from '../lib/passDiff';
import { useOptTrace } from '../lib/useOptTrace';
import { Chip, Notice, Panel } from '../components/OptStates';
import { FunctionPicker } from '../components/OptNav';
import { SplitTraceView } from '../components/SplitTraceView';
import { TraceGate } from '../components/TraceGate';

export interface PipelineViewProps {
  source: string;
  optimized: OptimizedProgram;
  stepperOptions: UseStepperOptions;
  onSelectPass: (pass: PassId) => void;
}

export function PipelineView({
  source,
  optimized,
  stepperOptions,
  onSelectPass,
}: PipelineViewProps) {
  const load = useOptTrace<PipelineState, OptEvent>(
    { kind: 'opt.pipeline', params: { source } },
    pipelineReducer,
  );
  const functionNames = useMemo(
    () => optimized.input.functions.map((f) => f.name),
    [optimized],
  );
  const [selected, setSelected] = useState<string | null>(null);
  const selectedFn =
    (selected && functionNames.includes(selected) ? selected : null) ?? functionNames[0] ?? '';

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Panel
        title="The default optimization pipeline"
        cite={{ section: '8.5', figureOrAlgo: '§9' }}
        subtitle="Each pass runs on the previous pass's output; basic blocks and the flow graph are recomputed between passes."
        bodyClassName="flex flex-col gap-3"
      >
        <p className="max-w-3xl text-sm text-ink-muted">
          The trace starts by partitioning the input program into basic blocks and building its
          flow graph (§8.4), then applies the six passes in order. Select a pass in the timeline
          to open its own trace.
        </p>
        <FunctionPicker functions={functionNames} selected={selectedFn} onSelect={setSelected} />
      </Panel>

      <TraceGate
        load={load}
        what="the whole optimization pipeline"
        unavailableExplanation="The pipeline runs on the three-address code, so it needs a program that compiled through intermediate-code generation."
      >
        {(trace) => (
          <SplitTraceView trace={trace} title="Pipeline" stepperOptions={stepperOptions}>
            {(stepper) => (
              <PipelineViz
                stepper={stepper}
                trace={trace}
                optimized={optimized}
                selectedFn={selectedFn}
                onSelectPass={onSelectPass}
              />
            )}
          </SplitTraceView>
        )}
      </TraceGate>
    </div>
  );
}

function PipelineViz({
  stepper,
  trace,
  optimized,
  selectedFn,
  onSelectPass,
}: {
  stepper: Stepper<PipelineState, OptEvent>;
  trace: Trace<PipelineState, OptEvent>;
  optimized: OptimizedProgram;
  selectedFn: string;
  onSelectPass: (pass: PassId) => void;
}) {
  const index = stepper.index;
  const passStates = stepper.state.passStates;
  const activePass = passStates[passStates.length - 1] ?? null;

  const beforeLines = useMemo(() => {
    const fn = optimized.input.functions.find((f) => f.name === selectedFn);
    return fn ? fn.quads.map((q) => formatQuad(q)) : [];
  }, [optimized, selectedFn]);

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

  const changesPerPass = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of passStates) if (p.pass) map.set(p.pass, p.changes.length);
    return map;
  }, [passStates]);

  const currentPassName = activePass?.pass ?? null;
  const finished = activePass?.done ?? false;

  return (
    <>
      <Panel
        title="Pass timeline"
        subtitle={
          currentPassName
            ? `Running ${currentPassName}${finished ? ' · finished' : ''}`
            : 'Building basic blocks and the flow graph of the input program (§8.4)'
        }
        bodyClassName="flex flex-col gap-1.5"
      >
        {PASS_LIST.map((meta) => {
          const seen = changesPerPass.has(meta.id);
          const isCurrent = currentPassName === meta.id && !finished;
          const done = seen && !isCurrent;
          return (
            <button
              key={meta.id}
              type="button"
              onClick={() => onSelectPass(meta.id)}
              aria-label={`Open the ${meta.label} trace`}
              className={clsx(
                'flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-left transition-colors',
                isCurrent
                  ? 'border-accent bg-accent-soft'
                  : 'border-line hover:border-line-strong',
              )}
            >
              {isCurrent ? (
                <Loader aria-hidden className="size-4 shrink-0 text-accent" />
              ) : done ? (
                <CheckCircle2 aria-hidden className="size-4 shrink-0 text-ok" />
              ) : (
                <CircleDashed aria-hidden className="size-4 shrink-0 text-ink-faint" />
              )}
              <span className="font-mono text-xs font-semibold text-ink">{meta.short}</span>
              <span className="hidden text-xs text-ink-muted sm:inline">{meta.label}</span>
              <span className="ml-auto flex items-center gap-1.5">
                <Chip tone={seen ? 'accent' : 'neutral'}>
                  {seen ? `${changesPerPass.get(meta.id) ?? 0} rewrites` : 'pending'}
                </Chip>
              </span>
            </button>
          );
        })}
      </Panel>

      <Panel
        title={`Cumulative effect on ${selectedFn}()`}
        subtitle="Optimizer input compared with the program as of this step."
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
          beforeLabel="TAC in"
          afterLabel="At this step"
          className="rounded-none border-0"
        />
      </Panel>

      {passStates.length === 0 && (
        <Notice tone="info">
          Nothing has been rewritten yet: the pipeline first finds the leaders of every function
          and builds the flow graphs the passes will analyse (§8.4.1, §8.4.3). Those steps are in
          the trace — step forward to watch them.
        </Notice>
      )}

      {activePass && activePass.pass && (
        <Panel
          title={`Now applying: ${PASS_META[activePass.pass as PassId]?.label ?? activePass.pass}`}
          cite={PASS_META[activePass.pass as PassId]?.citation}
          bodyClassName="flex flex-col gap-2"
        >
          <p className="text-sm text-ink-muted">
            {PASS_META[activePass.pass as PassId]?.blurb ?? ''}
          </p>
          <button
            type="button"
            onClick={() => onSelectPass(activePass.pass as PassId)}
            className="flex h-11 w-fit cursor-pointer items-center rounded-md border border-control px-3 text-xs font-medium text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
          >
            Open this pass on its own, with its analysis
          </button>
        </Panel>
      )}
    </>
  );
}

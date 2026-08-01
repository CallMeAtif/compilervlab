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
import { CitationBadge } from '../../../components/CitationBadge';
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
    <div className="flex min-w-0 flex-col">
      {/* ONE band: title, citation, counts and the function picker on a row. */}
      <header className="section-head">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <h2 className="section-title">Pipeline</h2>
          <CitationBadge cite={{ section: '8.5', figureOrAlgo: '§9' }} />
        </div>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="section-meta">6 passes</span>
          <FunctionPicker
            functions={functionNames}
            selected={selectedFn}
            onSelect={setSelected}
            label="fn"
          />
        </div>
      </header>

      <div className="min-w-0">
        <TraceGate
          load={load}
          what="the whole optimization pipeline"
          unavailableExplanation="The pipeline needs a program that reached intermediate-code generation."
        >
          {(trace) => (
            <SplitTraceView trace={trace} stepperOptions={stepperOptions}>
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
        actions={
          <span className="section-meta">
            {currentPassName
              ? `${currentPassName}${finished ? ' · finished' : ' · running'}`
              : 'blocks + flow graph (§8.4)'}
          </span>
        }
        bodyClassName="flex flex-col"
      >
        {PASS_LIST.map((meta, i) => {
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
                'flex min-h-11 cursor-pointer items-center gap-2.5 border-t border-line px-3 py-2 text-left transition-colors duration-[var(--dur-fast)] first:border-t-0',
                isCurrent
                  ? 'bg-accent-soft shadow-[inset_3px_0_0_var(--accent)]'
                  : 'hover:bg-raised',
              )}
            >
              <span className="w-4 shrink-0 font-mono type-code text-ink-faint tabular-nums">
                {i + 1}
              </span>
              {isCurrent ? (
                <Loader aria-hidden className="size-4 shrink-0 text-accent" />
              ) : done ? (
                <CheckCircle2 aria-hidden className="size-4 shrink-0 text-ok" />
              ) : (
                <CircleDashed aria-hidden className="size-4 shrink-0 text-ink-faint" />
              )}
              <span
                className={clsx(
                  'font-mono text-xs',
                  isCurrent ? 'font-semibold text-ink' : 'text-ink',
                )}
              >
                {meta.short}
              </span>
              <span className="hidden text-sm text-ink-muted sm:inline">{meta.label}</span>
              <span className="ml-auto flex shrink-0 items-center gap-1.5">
                <Chip tone={seen ? 'accent' : 'neutral'}>
                  {seen ? `${changesPerPass.get(meta.id) ?? 0} rewrites` : 'pending'}
                </Chip>
              </span>
            </button>
          );
        })}
      </Panel>

      <Panel
        title={`Cumulative diff · ${selectedFn}()`}
        actions={
          <div className="flex items-center gap-1.5">
            <Chip tone={diff.changed > 0 ? 'warn' : 'neutral'}>~ {diff.changed}</Chip>
            <Chip tone={diff.added > 0 ? 'ok' : 'neutral'}>+ {diff.added}</Chip>
            <Chip tone={diff.removed > 0 ? 'err' : 'neutral'}>− {diff.removed}</Chip>
          </div>
        }
      >
        <DiffView
          rows={diff.rows}
          beforeLabel="TAC in"
          afterLabel="At this step"
          className="diff-editorial"
        />
      </Panel>

      {passStates.length === 0 && (
        <Notice tone="info">Blocks and flow graphs first. Step forward.</Notice>
      )}

      {activePass && activePass.pass && (
        <Panel
          title={PASS_META[activePass.pass as PassId]?.label ?? activePass.pass}
          cite={PASS_META[activePass.pass as PassId]?.citation}
          actions={<span className="section-meta">applying</span>}
        >
          <button
            type="button"
            onClick={() => onSelectPass(activePass.pass as PassId)}
            className="flex h-11 w-fit cursor-pointer items-center text-sm font-medium text-accent underline decoration-accent/40 underline-offset-4 transition-colors hover:decoration-accent"
          >
            Open this pass on its own →
          </button>
        </Panel>
      )}
    </>
  );
}

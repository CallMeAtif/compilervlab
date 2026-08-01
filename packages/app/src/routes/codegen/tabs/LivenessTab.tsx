/**
 * Tab 2 — LIVENESS (`codegen.liveness`, §8.4.2 use/def + §9.2.5 equations).
 *
 * A classic live-range chart: one row per value, one column per instruction,
 * a bar wherever the value is live-in. The chart is sized once from the
 * converged analysis (stable layout) and fills in as the backward passes run.
 */
import { useMemo, useState } from 'react';
import { livenessReducer } from '@lab/core/codegen/liveness.js';
import type { LivenessEvent, LivenessState } from '@lab/core/codegen/liveness.js';
import { formatVInstr } from '@lab/core/codegen/cg-events.js';
import type { VInstr } from '@lab/core/codegen/cg-events.js';
import type { Trace } from '@lab/trace';
import { clsx } from 'clsx';
import { CheckCircle2, Repeat } from 'lucide-react';
import { FullscreenTransport } from '../../../components/Fullscreen';
import { useCodegenTrace } from '../useCodegenTrace';
import { useSelectedCode } from '../useSelectedCode';
import { prefixLatest } from '../traceScan';
import {
  AutoMicroSteps,
  FunctionPicker,
  Legend,
  LoadingPanel,
  Panel,
  Tag,
  TraceGate,
  TraceSplit,
  cgControl,
  pickFunctionName,
  useStepSync,
} from '../shared';

/** Cell width of the live-range chart, in px. */
const CELL = 15;

export function LivenessTab({ source }: { source: string }) {
  const result = useCodegenTrace<LivenessState, LivenessEvent>(
    'codegen.liveness',
    { source },
    livenessReducer,
  );
  const code = useSelectedCode(source);

  if (code.status === 'loading' || code.status === 'idle') {
    return <LoadingPanel label="Loading the selected code…" />;
  }

  return (
    <TraceGate
      result={result}
      label="Iterating the live-variable equations…"
      unavailableTitle="No liveness trace"
    >
      {(trace) => <LivenessView trace={trace} byName={code.byName} />}
    </TraceGate>
  );
}

function LivenessView({
  trace,
  byName,
}: {
  trace: Trace<LivenessState, LivenessEvent>;
  byName: ReadonlyMap<string, { name: string; code: VInstr[] }>;
}) {
  const stepperOptions = useStepSync();
  const [pinned, setPinned] = useState<string | null>(null);

  const final = useMemo(() => trace.final(), [trace]);
  const names = useMemo(() => final.functions.map((f) => f.functionName), [final]);

  /** Row set + instruction count, taken from the CONVERGED analysis so the
   *  chart never changes shape while stepping (PLAN.md layout stability). */
  const shape = useMemo(() => {
    const out = new Map<string, { rows: string[]; count: number }>();
    for (const fn of final.functions) {
      const seen = new Set<string>();
      for (const s of fn.liveIn) for (const n of s) seen.add(n);
      for (const s of fn.liveOut) for (const n of s) seen.add(n);
      const rows = [...seen].sort((a, b) => {
        const pa = a.startsWith('%') ? 1 : 0;
        const pb = b.startsWith('%') ? 1 : 0;
        return pa - pb || (a < b ? -1 : a > b ? 1 : 0);
      });
      out.set(fn.functionName, { rows, count: fn.liveIn.length });
    }
    return out;
  }, [final]);

  const fnAt = useMemo(
    () =>
      prefixLatest<LivenessEvent, string>(trace, (s) =>
        'functionName' in s.event ? s.event.functionName : null,
      ),
    [trace],
  );
  const iterAt = useMemo(
    () =>
      prefixLatest<LivenessEvent, number>(trace, (s) =>
        s.event.kind === 'iterStart' || s.event.kind === 'instrLive' ? s.event.iter : null,
      ),
    [trace],
  );

  const passSections = useMemo(
    () =>
      trace
        .sections()
        .filter((s) => / liveness pass \d+$/.test(s.name))
        .map((s) => ({
          ...s,
          fn: s.name.slice(0, s.name.indexOf(':')),
          pass: Number.parseInt(s.name.slice(s.name.lastIndexOf(' ') + 1), 10),
        })),
    [trace],
  );

  return (
    <TraceSplit trace={trace} stepperOptions={stepperOptions}>
      {(stepper) => {
        const state = stepper.state;
        const active = pickFunctionName(names, fnAt[stepper.index] ?? null, pinned);
        const fnState = state.functions.find((f) => f.functionName === active) ?? null;
        const geom = active !== null ? shape.get(active) : undefined;
        const rows = geom?.rows ?? [];
        const count = geom?.count ?? 0;
        const instrs = active !== null ? (byName.get(active)?.code ?? []) : [];

        const step = stepper.currentStep;
        const ev = step?.event;
        const atIndex = ev !== undefined && ev.kind === 'instrLive' ? ev.index : null;
        const iter = iterAt[stepper.index] ?? 0;
        const converged = (fnState?.iterations ?? 0) > 0;

        return (
          <>
            <AutoMicroSteps stepper={stepper} />
            <div className="section flex flex-wrap items-center gap-x-6 gap-y-2">
              <FunctionPicker
                names={names}
                value={active}
                pinned={pinned !== null}
                onPick={setPinned}
                onFollow={() => setPinned(null)}
              />
              <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
                <span className="mr-1 font-mono text-2xs text-ink-faint">pass</span>
                {passSections
                  .filter((s) => s.fn === active)
                  .map((s) => (
                    <button
                      key={s.name}
                      type="button"
                      aria-pressed={s.pass === iter}
                      onClick={() => stepper.jumpTo(s.startIndex)}
                      className={clsx(cgControl(s.pass === iter), 'gap-1 font-mono text-xs')}
                    >
                      <Repeat aria-hidden className="size-3" />
                      {s.pass}
                    </button>
                  ))}
              </div>
            </div>

            <Panel
              title="Live ranges"
              actions={
                <span className="section-meta flex items-center gap-1.5">
                  {converged && (
                    <>
                      <CheckCircle2 aria-hidden className="size-3 text-ok" />
                      converged · {fnState?.iterations} pass
                      {fnState?.iterations === 1 ? '' : 'es'}
                      <span aria-hidden className="text-ink-faint">
                        ·
                      </span>
                    </>
                  )}
                  {active !== null ? `${rows.length} values × ${count} instructions` : ''}
                </span>
              }
              frame
              bodyClassName="p-3"
              fullscreen={{
                label: 'the live ranges',
                controls: <FullscreenTransport stepper={stepper} />,
              }}
            >
              {/* A key, set as one caption line — not prose. */}
              <div className="mb-3">
                <Legend
                  items={[
                    {
                      swatch: <span aria-hidden className="cg-live inline-block h-2.5 w-5" />,
                      label: 'live-in',
                    },
                    {
                      swatch: (
                        <span
                          aria-hidden
                          className="inline-block h-2.5 w-5 rounded-sm bg-raised ring-1 ring-line"
                        />
                      ),
                      label: 'dead',
                    },
                    {
                      swatch: (
                        <span
                          aria-hidden
                          className="inline-block h-3 w-1 rounded-sm bg-accent-strong"
                        />
                      ),
                      label: 'cursor',
                    },
                  ]}
                />
              </div>
              <div className="artifact-scroll">
                <div className="min-w-max">
                  {/* instruction-index ruler */}
                  <div className="flex items-end border-b border-line pb-1">
                    <div className="w-28 shrink-0 pr-2 text-right font-mono text-2xs text-ink-faint">
                      instruction →
                    </div>
                    <div className="flex">
                      {Array.from({ length: count }, (_, i) => (
                        <div
                          key={i}
                          className={clsx(
                            'text-center font-mono text-3xs tabular-nums',
                            i === atIndex ? 'font-bold text-accent' : 'text-ink-faint',
                          )}
                          style={{ width: CELL }}
                        >
                          {i % 5 === 0 || i === atIndex ? i : ''}
                        </div>
                      ))}
                    </div>
                  </div>

                  {rows.length === 0 && (
                    <p className="prose-note py-6">No values yet. Step forward.</p>
                  )}

                  {rows.map((name) => {
                    const live = (i: number) => (fnState?.liveIn[i] ?? []).includes(name);
                    return (
                      <div key={name} className="flex items-center">
                        <div
                          className={clsx(
                            'w-28 shrink-0 truncate pr-2 text-right font-mono text-2xs',
                            name.startsWith('%') ? 'text-ink-faint italic' : 'text-ink',
                          )}
                          title={
                            name.startsWith('%')
                              ? `${name} — physical register pinned by a tile (precolored)`
                              : `${name} — pseudo-register`
                          }
                        >
                          {name}
                        </div>
                        <div className="flex h-4.5 items-center">
                          {Array.from({ length: count }, (_, i) => {
                            const on = live(i);
                            return (
                              <div
                                key={i}
                                title={on ? `${name} is live-in at instruction ${i}` : undefined}
                                className={clsx(
                                  'h-3',
                                  on && 'cg-live',
                                  on && !live(i - 1) && 'cg-live-start',
                                  on && !live(i + 1) && 'cg-live-end',
                                  !on && 'bg-raised',
                                  i === atIndex &&
                                    'shadow-[inset_0_0_0_1px_var(--accent-strong)]',
                                )}
                                style={{ width: CELL - 1, marginRight: 1 }}
                              />
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Panel>

            <Panel
              title="Instruction listing"
              frame
              bodyClassName="max-h-96"
              fullscreen={{
                label: 'the instruction listing',
                controls: <FullscreenTransport stepper={stepper} />,
              }}
            >
              <table className="w-full border-collapse font-mono type-code">
                <thead className="sticky top-0 z-10 bg-surface text-2xs tracking-wide text-ink-faint uppercase">
                  <tr>
                    <th
                      scope="col"
                      className="w-10 border-b border-line px-2 py-2 text-right font-medium"
                    >
                      #
                    </th>
                    <th scope="col" className="border-b border-line px-2 py-2 text-left font-medium">
                      instruction
                    </th>
                    <th scope="col" className="border-b border-line px-2 py-2 text-left font-medium">
                      use
                    </th>
                    <th scope="col" className="border-b border-line px-2 py-2 text-left font-medium">
                      def
                    </th>
                    <th scope="col" className="border-b border-line px-2 py-2 text-left font-medium">
                      in
                    </th>
                    <th scope="col" className="border-b border-line px-2 py-2 text-left font-medium">
                      out
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: count }, (_, i) => {
                    const instr = instrs[i];
                    const isCurrent = i === atIndex;
                    return (
                      <tr
                        key={i}
                        aria-current={isCurrent ? 'step' : undefined}
                        className={clsx(
                          'border-b border-line/60 align-top',
                          isCurrent && 'bg-accent-soft shadow-[inset_3px_0_0_var(--accent)]',
                        )}
                      >
                        <td className="px-2 py-1 text-right text-2xs text-ink-faint tabular-nums">
                          {i}
                        </td>
                        <td
                          className={clsx(
                            'px-2 py-1 whitespace-pre',
                            instr?.kind === 'label' ? 'text-ink-muted' : 'text-ink',
                            isCurrent && 'font-semibold',
                          )}
                        >
                          {instr ? formatVInstr(instr) : '—'}
                        </td>
                        <td className="px-2 py-1 text-xs text-ink-muted">
                          {isCurrent && ev?.kind === 'instrLive' ? ev.use.join(' ') : ''}
                        </td>
                        <td className="px-2 py-1 text-xs text-ink-muted">
                          {isCurrent && ev?.kind === 'instrLive' ? ev.def.join(' ') : ''}
                        </td>
                        <td className="px-2 py-1 text-xs text-ink-muted">
                          {(fnState?.liveIn[i] ?? []).join(' ')}
                        </td>
                        <td className="px-2 py-1 text-xs text-ink-muted">
                          {(fnState?.liveOut[i] ?? []).join(' ')}
                            {isCurrent && ev?.kind === 'instrLive' && (
                              <Tag
                                tone={ev.changed ? 'accent' : 'neutral'}
                                className="ml-2"
                                title={
                                  ev.changed
                                    ? 'this instruction’s sets grew — another pass will be needed'
                                    : 'sets unchanged by this visit'
                                }
                              >
                                {ev.changed ? (
                                  'changed'
                                ) : (
                                  <>
                                    <CheckCircle2 aria-hidden className="size-3" />
                                    stable
                                  </>
                                )}
                              </Tag>
                            )}
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
    </TraceSplit>
  );
}

/**
 * Tab 6 — RUN (`codegen.exec`).
 *
 * The x86-64 subset interpreter executing the program this phase just emitted —
 * the oracle that must agree with the TAC interpreter. Stepping moves the
 * program counter through the real listing; the payoff is the halt step, where
 * main's return value appears.
 *
 * Note on scope: `AsmExecState` records the program counter, the instruction
 * text, the step count and the halt outcome — it does not snapshot register or
 * memory *values*, so this view shows the machine's control state and the
 * static register map (which value each register holds), never invented values.
 */
import { useMemo } from 'react';
import { asmExecReducer } from '@lab/core/interp/asm.js';
import type { AsmExecEvent, AsmExecState } from '@lab/core/interp/asm.js';
import { emitReducer } from '@lab/core/codegen/emit.js';
import type { EmitEvent, EmitState } from '@lab/core/codegen/emit.js';
import { colorReducer } from '@lab/core/codegen/color.js';
import type { ColorEvent, ColorState } from '@lab/core/codegen/color.js';
import { GP_REGISTERS } from '@lab/core/codegen/types.js';
import type { AsmLine } from '@lab/core/codegen/types.js';
import type { Trace } from '@lab/trace';
import { clsx } from 'clsx';
import { CircleCheck, CircleSlash, Cpu, Flag, OctagonAlert } from 'lucide-react';
import { useCodegenTrace } from '../useCodegenTrace';
import { prefixLatest } from '../traceScan';
import {
  AutoMicroSteps,
  LoadingPanel,
  Notice,
  Panel,
  Tag,
  TraceGate,
  TraceSplit,
  useStepSync,
} from '../shared';

/** Above this many recorded steps the per-line execution counts are skipped. */
const HEATMAP_STEP_CAP = 50_000;

export function RunTab({ source }: { source: string }) {
  const result = useCodegenTrace<AsmExecState, AsmExecEvent>(
    'codegen.exec',
    { source },
    asmExecReducer,
  );
  const emit = useCodegenTrace<EmitState, EmitEvent>('codegen.emit', { source }, emitReducer);
  const color = useCodegenTrace<ColorState, ColorEvent>('codegen.color', { source }, colorReducer);

  const lines = emit.trace?.final().lines ?? [];
  const registerMap = useMemo(() => {
    const out = new Map<string, Map<string, string>>();
    for (const fn of color.trace?.final().functions ?? []) {
      const regs = new Map<string, string>();
      for (const [node, a] of Object.entries(fn.assignment)) {
        if ('reg' in a) regs.set(a.reg, node);
      }
      out.set(fn.functionName, regs);
    }
    return out;
  }, [color.trace]);

  if (emit.status === 'loading' || emit.status === 'idle') {
    return <LoadingPanel label="Loading the emitted program…" />;
  }

  return (
    <TraceGate
      result={result}
      label="Executing the emitted program…"
      unavailableTitle="The emitted program could not be run"
    >
      {(trace) => <RunView trace={trace} lines={lines} registerMap={registerMap} />}
    </TraceGate>
  );
}

function RunView({
  trace,
  lines,
  registerMap,
}: {
  trace: Trace<AsmExecState, AsmExecEvent>;
  lines: readonly AsmLine[];
  registerMap: ReadonlyMap<string, ReadonlyMap<string, string>>;
}) {
  const stepperOptions = useStepSync();
  const heatmapEnabled = trace.length <= HEATMAP_STEP_CAP;
  /** Last instruction executed at or before the cursor: the halt step carries
   *  no pc of its own, and the marker should stay on the `ret` that ended it. */
  const pcAt = useMemo(
    () => prefixLatest<AsmExecEvent, number>(trace, (s) => (s.event.kind === 'exec' ? s.event.pc : null)),
    [trace],
  );

  return (
    <TraceSplit trace={trace} stepperOptions={stepperOptions}>
      {(stepper) => {
        const state = stepper.state;
        const pc = pcAt[stepper.index] ?? null;

        // Per-line execution counts + the recent tape, from the recorded events
        // applied so far (aggregation, not simulation).
        const counts = new Map<number, number>();
        const tape: Array<{ step: number; pc: number; text: string }> = [];
        let calls = 0;
        let rets = 0;
        if (heatmapEnabled) {
          for (let i = 0; i < stepper.index; i++) {
            const s = trace.steps[i];
            if (!s || s.event.kind !== 'exec') continue;
            counts.set(s.event.pc, (counts.get(s.event.pc) ?? 0) + 1);
            const mnemonic = s.event.text.trim().split(/\s+/)[0] ?? '';
            if (mnemonic === 'call') calls++;
            else if (mnemonic === 'ret') rets++;
            tape.push({ step: s.event.steps, pc: s.event.pc, text: s.event.text });
          }
        }
        const recent = tape.slice(-10).reverse();
        const maxCount = Math.max(1, ...counts.values());
        const depth = Math.max(1, 1 + calls - rets);

        const currentLine = pc !== null ? (lines[pc] ?? null) : null;
        const currentFn = currentLine?.functionName ?? null;
        const regs = currentFn !== null ? registerMap.get(currentFn) : undefined;

        return (
          <>
            <AutoMicroSteps stepper={stepper} />
            <ResultCard state={state} atEnd={stepper.atEnd} />

            <div className="cg-row mt-8 grid gap-8 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
              <Panel
                title="Program counter"
                actions={
                  <span className="section-meta">
                    {lines.length} lines{heatmapEnabled ? ' · ×n = runs' : ''}
                  </span>
                }
                frame
                bodyClassName="max-h-[34rem] bg-code"
              >
                {/* `w-max min-w-full`: a long directive widens the FIGURE and the
                    frame scrolls, instead of running off the edge of its row.
                    The execution counts therefore live in the LEFT gutter, next
                    to the line numbers, where they stay visible unscrolled —
                    the usual place a profiler puts them. */}
                <ul className="w-max min-w-full py-1 font-mono type-code">
                  {lines.map((l) => {
                    const n = counts.get(l.index) ?? 0;
                    const isPc = l.index === pc;
                    return (
                      <li
                        key={l.index}
                        aria-current={isPc ? 'step' : undefined}
                        className={clsx(
                          'flex items-center gap-2 py-0.5 pr-3',
                          isPc && 'bg-accent-soft shadow-[inset_3px_0_0_var(--accent)]',
                        )}
                      >
                        <span aria-hidden className="w-3 shrink-0 pl-1 text-accent">
                          {isPc ? '▸' : ''}
                        </span>
                        <span className="w-8 shrink-0 text-right text-2xs text-ink-faint tabular-nums">
                          {l.index}
                        </span>
                        {heatmapEnabled && (
                          <span
                            className="flex w-16 shrink-0 items-center justify-end gap-1 border-r border-line pr-2"
                            title={n > 0 ? `executed ${n} time(s)` : undefined}
                          >
                            {n > 0 && (
                              <>
                                <span
                                  aria-hidden
                                  className="block h-1.5 rounded-full bg-accent"
                                  style={{ width: `${Math.max(3, (n / maxCount) * 26)}px` }}
                                />
                                <span className="w-6 text-right text-2xs text-ink-faint tabular-nums">
                                  ×{n}
                                </span>
                              </>
                            )}
                          </span>
                        )}
                        {!heatmapEnabled && (
                          <span aria-hidden className="h-4 shrink-0 border-r border-line" />
                        )}
                        <span
                          className={clsx(
                            'min-w-0 flex-1 pl-1 whitespace-pre',
                            l.kind === 'directive' && 'text-ink-faint',
                            l.kind === 'label' && 'font-semibold text-ink',
                            l.kind === 'instr' && (n > 0 ? 'text-ink' : 'text-ink-muted'),
                            isPc && 'font-semibold',
                          )}
                        >
                          {l.kind === 'instr' ? `    ${l.text}` : l.text}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </Panel>

              <div className="flex min-w-0 flex-col">
                <Panel title="Machine">
                  <dl className="flex flex-col">
                    {(
                      [
                        ['instructions executed', state.steps.toLocaleString()],
                        ['call depth', heatmapEnabled ? String(depth) : '—'],
                        ['pc', pc === null ? '—' : String(pc)],
                        ['current function', currentFn ?? '—'],
                      ] as const
                    ).map(([term, value]) => (
                      <div
                        key={term}
                        className="flex items-baseline justify-between gap-4 border-b border-line/60 py-1.5 last:border-b-0"
                      >
                        <dt className="text-sm text-ink-muted">{term}</dt>
                        <dd className="font-mono type-code text-ink tabular-nums">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </Panel>

                <Panel
                  title="Register map"
                  actions={
                    <span className="section-meta">{currentFn ? `${currentFn}()` : 'no frame'}</span>
                  }
                >
                  <ul className="flex flex-wrap gap-1.5 font-mono text-xs">
                    {GP_REGISTERS.map((r) => {
                      const held = regs?.get(r);
                      return (
                        <li
                          key={r}
                          className={clsx(
                            'flex min-w-24 flex-col rounded-sm border px-2 py-1',
                            held !== undefined
                              ? 'border-line-strong bg-raised text-ink'
                              : 'border-dashed border-line text-ink-faint',
                          )}
                        >
                          <span className="font-semibold">{r}</span>
                          <span className="text-3xs">{held ?? 'unused'}</span>
                        </li>
                      );
                    })}
                    <li className="flex min-w-24 flex-col rounded-sm border border-line px-2 py-1 text-ink-muted">
                      <span className="font-semibold">%rax</span>
                      <span className="text-3xs">return value / division</span>
                    </li>
                  </ul>
                </Panel>

                <Panel title="Recent instructions" frame bodyClassName="max-h-56">
                  <ol className="font-mono type-code">
                    {recent.length === 0 && (
                      <li className="px-3 py-4 font-sans text-sm text-ink-faint">
                        Press play to run.
                      </li>
                    )}
                    {recent.map((t, i) => (
                      <li
                        key={`${t.step}-${t.pc}`}
                        className={clsx(
                          'flex items-center gap-2 border-b border-line/50 px-2 py-1',
                          i === 0 ? 'font-semibold text-ink' : 'text-ink-muted',
                        )}
                      >
                        <span className="w-10 shrink-0 text-right text-2xs text-ink-faint tabular-nums">
                          {t.step}
                        </span>
                        <span className="w-8 shrink-0 text-right text-2xs text-ink-faint tabular-nums">
                          @{t.pc}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{t.text}</span>
                      </li>
                    ))}
                  </ol>
                </Panel>
              </div>
            </div>

            {!heatmapEnabled && (
              <Notice
                tone="info"
                title={`Over ${HEATMAP_STEP_CAP.toLocaleString()} steps: per-line counts off.`}
                className="mt-8"
              />
            )}
          </>
        );
      }}
    </TraceSplit>
  );
}

function ResultCard({ state, atEnd }: { state: AsmExecState; atEnd: boolean }) {
  if (state.halted && state.error !== null) {
    return (
      <Notice tone="error" title="Runtime error">
        <p className="text-sm">
          {state.error} — after {state.steps.toLocaleString()} instruction(s).
        </p>
      </Notice>
    );
  }
  if (state.halted) {
    return (
      <section
        aria-label="Execution result"
        // The payoff of the whole phase: a headline, set in type — with a
        // double rule under the value so it survives greyscale.
        className="section flex flex-wrap items-baseline gap-x-4 gap-y-1 border-l-2 border-l-ok pl-4"
      >
        <CircleCheck aria-hidden className="size-5 shrink-0 translate-y-1 text-ok" />
        <p className="state-title">
          main returned{' '}
          <span className="font-mono text-ok underline decoration-double decoration-ok/60 underline-offset-4">
            {state.returnValue ?? '—'}
          </span>
        </p>
        <p className="prose-note w-full">
          {state.steps.toLocaleString()} instructions executed.
        </p>
      </section>
    );
  }
  return (
    <section
      aria-label="Execution result"
      className="section flex flex-wrap items-baseline gap-x-4 gap-y-1 border-l-2 border-l-line-strong pl-4"
    >
      {atEnd ? (
        <OctagonAlert aria-hidden className="size-5 shrink-0 translate-y-1 text-warn" />
      ) : state.steps > 0 ? (
        <Cpu aria-hidden className="size-5 shrink-0 translate-y-1 text-accent" />
      ) : (
        <Flag aria-hidden className="size-5 shrink-0 translate-y-1 text-ink-faint" />
      )}
      <h2 className="state-title">
        {state.steps === 0 ? 'Ready to run' : `Running · ${state.steps} instructions`}
      </h2>
      {state.steps > 0 && !state.halted && (
        <Tag tone="neutral">
          <CircleSlash aria-hidden className="size-2.5" />
          not halted
        </Tag>
      )}
    </section>
  );
}

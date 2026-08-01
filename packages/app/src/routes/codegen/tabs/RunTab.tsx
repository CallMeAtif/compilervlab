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

            <div className="grid gap-3 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
              <Panel
                title="Program counter"
                subtitle={
                  heatmapEnabled
                    ? 'the emitted listing; the bar shows how often each line has run'
                    : 'the emitted listing'
                }
                bodyClassName="p-0"
              >
                <div className="max-h-[34rem] overflow-auto">
                  <ul className="font-mono text-xs">
                    {lines.map((l) => {
                      const n = counts.get(l.index) ?? 0;
                      const isPc = l.index === pc;
                      return (
                        <li
                          key={l.index}
                          aria-current={isPc ? 'step' : undefined}
                          className={clsx(
                            'flex items-center gap-2 px-2 py-1',
                            isPc && 'bg-accent-soft',
                          )}
                        >
                          <span className="w-4 shrink-0 text-accent">
                            {isPc ? '▸' : ''}
                          </span>
                          <span className="w-8 shrink-0 text-right text-[10px] text-ink-faint">
                            {l.index}
                          </span>
                          <span
                            className={clsx(
                              'min-w-0 flex-1 whitespace-pre',
                              l.kind === 'directive' && 'text-ink-faint',
                              l.kind === 'label' && 'font-semibold text-ink',
                              l.kind === 'instr' && (n > 0 ? 'text-ink' : 'text-ink-muted'),
                              isPc && 'font-semibold',
                            )}
                          >
                            {l.kind === 'instr' ? `    ${l.text}` : l.text}
                          </span>
                          {heatmapEnabled && n > 0 && (
                            <span className="flex shrink-0 items-center gap-1">
                              <span
                                aria-hidden
                                className="block h-1.5 rounded-full bg-accent"
                                style={{ width: `${Math.max(4, (n / maxCount) * 44)}px` }}
                              />
                              <span className="w-6 text-right text-[10px] text-ink-faint">
                                ×{n}
                              </span>
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </Panel>

              <div className="flex min-w-0 flex-col gap-3">
                <Panel title="Machine" bodyClassName="p-3">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <dt className="text-xs text-ink-faint">instructions executed</dt>
                    <dd className="font-mono text-ink">{state.steps.toLocaleString()}</dd>
                    <dt className="text-xs text-ink-faint">call depth</dt>
                    <dd className="font-mono text-ink">{heatmapEnabled ? depth : '—'}</dd>
                    <dt className="text-xs text-ink-faint">pc</dt>
                    <dd className="font-mono text-ink">{pc ?? '—'}</dd>
                    <dt className="text-xs text-ink-faint">current function</dt>
                    <dd className="font-mono text-ink">{currentFn ?? '—'}</dd>
                  </dl>
                  <p className="mt-3 border-t border-line pt-2 text-xs text-ink-faint">
                    The oracle trace records the program counter, the instruction and the step
                    count — not a snapshot of every register and stack cell — so this view shows
                    control state and the allocator's register map rather than invented values.
                    The return value below is recorded, and is the value the TAC interpreter must
                    agree with.
                  </p>
                </Panel>

                <Panel
                  title="Register map"
                  subtitle={
                    currentFn !== null
                      ? `which value the allocator put in each register in '${currentFn}'`
                      : 'select a function by stepping into it'
                  }
                  bodyClassName="p-3"
                >
                  <ul className="flex flex-wrap gap-2 font-mono text-xs">
                    {GP_REGISTERS.map((r) => {
                      const held = regs?.get(r);
                      return (
                        <li
                          key={r}
                          className={clsx(
                            'flex min-w-24 flex-col rounded-md border px-2 py-1',
                            held !== undefined
                              ? 'border-line-strong bg-raised text-ink'
                              : 'border-dashed border-line text-ink-faint',
                          )}
                        >
                          <span className="font-semibold">{r}</span>
                          <span className="text-[10px]">{held ?? 'unused'}</span>
                        </li>
                      );
                    })}
                    <li className="flex min-w-24 flex-col rounded-md border border-line px-2 py-1 text-ink-muted">
                      <span className="font-semibold">%rax</span>
                      <span className="text-[10px]">return value / division</span>
                    </li>
                  </ul>
                </Panel>

                <Panel title="Recent instructions" bodyClassName="p-0">
                  <ol className="max-h-56 overflow-auto font-mono text-xs">
                    {recent.length === 0 && (
                      <li className="px-3 py-4 text-ink-faint">
                        Nothing executed yet — press play to run the program.
                      </li>
                    )}
                    {recent.map((t, i) => (
                      <li
                        key={`${t.step}-${t.pc}`}
                        className={clsx(
                          'flex items-center gap-2 border-b border-line/50 px-2 py-1',
                          i === 0 ? 'text-ink' : 'text-ink-muted',
                        )}
                      >
                        <span className="w-10 shrink-0 text-right text-[10px] text-ink-faint">
                          {t.step}
                        </span>
                        <span className="w-8 shrink-0 text-right text-[10px] text-ink-faint">
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
              <Notice tone="info" title="Long run — per-line counts disabled">
                <p className="text-sm">
                  This program executes more than {HEATMAP_STEP_CAP.toLocaleString()} recorded
                  steps, so the execution-count bars and the recent-instruction tape are turned
                  off to keep stepping responsive.
                </p>
              </Notice>
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
      <Notice tone="error" title="The emitted program stopped with a runtime error">
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
        className="flex flex-wrap items-center gap-4 rounded-lg border border-ok/40 bg-ok-soft px-4 py-3"
      >
        <CircleCheck aria-hidden className="size-6 shrink-0 text-ok" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-ok">
            main returned{' '}
            <span className="font-mono text-lg">{state.returnValue ?? '—'}</span>
          </p>
          <p className="text-xs text-ok/90">
            {state.steps.toLocaleString()} instruction(s) executed. The generated code and the TAC
            interpreter must produce this same value — that agreement is the lab's end-to-end
            correctness oracle.
          </p>
        </div>
      </section>
    );
  }
  return (
    <section
      aria-label="Execution result"
      className="flex flex-wrap items-center gap-4 rounded-lg border border-line bg-surface px-4 py-3"
    >
      {atEnd ? (
        <OctagonAlert aria-hidden className="size-6 shrink-0 text-warn" />
      ) : state.steps > 0 ? (
        <Cpu aria-hidden className="size-6 shrink-0 text-accent" />
      ) : (
        <Flag aria-hidden className="size-6 shrink-0 text-ink-faint" />
      )}
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">
          {state.steps === 0 ? 'Ready to run' : `Running — ${state.steps} instruction(s) so far`}
        </p>
        <p className="text-xs text-ink-muted">
          Execution starts at <span className="font-mono">main</span> with a sentinel return
          address on the stack; it ends when control returns from it.
        </p>
      </div>
      {state.steps > 0 && !state.halted && (
        <Tag tone="neutral" className="ml-auto">
          <CircleSlash aria-hidden className="size-2.5" />
          not halted
        </Tag>
      )}
    </section>
  );
}

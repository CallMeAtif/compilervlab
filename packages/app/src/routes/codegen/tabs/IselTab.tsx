/**
 * Tab 1 — INSTRUCTION SELECTION (`codegen.isel`, §8.6 / §8.9.2).
 *
 * The optimized TAC and the x86-64 it is tiled into, side by side: one row per
 * quad, the right-hand cell filling in as the trace emits each instruction.
 * The matched tile's name rides along in the ExplainCard prose.
 */
import { useMemo, useState } from 'react';
import type { Compilation } from '@lab/core';
import { iselReducer } from '@lab/core/codegen/isel.js';
import type { IselEvent, IselState } from '@lab/core/codegen/isel.js';
import { formatVInstr } from '@lab/core/codegen/cg-events.js';
import type { FrameSlot, VInstr } from '@lab/core/codegen/cg-events.js';
import { formatQuad } from '@lab/core/ir/types.js';
import type { TacFunction } from '@lab/core/ir/types.js';
import type { Trace } from '@lab/trace';
import { clsx } from 'clsx';
import { ArrowRight, CornerDownRight } from 'lucide-react';
import { FullscreenTransport } from '../../../components/Fullscreen';
import { useCodegenTrace } from '../useCodegenTrace';
import { prefixLatest } from '../traceScan';
import {
  AutoMicroSteps,
  FunctionPicker,
  Legend,
  Notice,
  Panel,
  Tag,
  TraceGate,
  TraceSplit,
  pickFunctionName,
  useStepSync,
} from '../shared';

interface TileMark {
  functionName: string;
  tacIndex: number;
  tileName: string;
}

export function IselTab({ source, compilation }: { source: string; compilation: Compilation }) {
  const result = useCodegenTrace<IselState, IselEvent>('codegen.isel', { source }, iselReducer);
  const tacFunctions = compilation.optimized?.output.functions ?? [];

  return (
    <TraceGate
      result={result}
      label="Tiling the optimized TAC into x86-64…"
      unavailableTitle="No instruction-selection trace"
    >
      {(trace) => <IselView trace={trace} tacFunctions={tacFunctions} />}
    </TraceGate>
  );
}

function IselView({
  trace,
  tacFunctions,
}: {
  trace: Trace<IselState, IselEvent>;
  tacFunctions: readonly TacFunction[];
}) {
  const stepperOptions = useStepSync();
  const [pinned, setPinned] = useState<string | null>(null);

  const tileAt = useMemo(
    () =>
      prefixLatest<IselEvent, TileMark>(trace, (s) =>
        s.event.kind === 'tile'
          ? {
              functionName: s.event.functionName,
              tacIndex: s.event.tacIndex,
              tileName: s.event.tileName,
            }
          : null,
      ),
    [trace],
  );
  const fnAt = useMemo(
    () =>
      prefixLatest<IselEvent, string>(trace, (s) =>
        'functionName' in s.event ? s.event.functionName : null,
      ),
    [trace],
  );

  const names = useMemo(() => tacFunctions.map((f) => f.name), [tacFunctions]);

  return (
    <TraceSplit trace={trace} stepperOptions={stepperOptions}>
      {(stepper) => {
        const state = stepper.state;
        const active = pickFunctionName(names, fnAt[stepper.index] ?? null, pinned);
        const tacFn = tacFunctions.find((f) => f.name === active) ?? null;
        const vfn = state.functions.find((f) => f.name === active) ?? null;

        const tile = tileAt[stepper.index] ?? null;
        const currentTile = tile !== null && tile.functionName === active ? tile : null;
        const justEmitted =
          stepper.currentStep?.event.kind === 'instr' ||
          stepper.currentStep?.event.kind === 'entryMove';

        // Emitted instructions bucketed by the quad that selected them.
        const byQuad = new Map<number, VInstr[]>();
        const preamble: VInstr[] = [];
        for (const instr of vfn?.code ?? []) {
          if (instr.tacIndex === null) preamble.push(instr);
          else {
            const list = byQuad.get(instr.tacIndex);
            if (list) list.push(instr);
            else byQuad.set(instr.tacIndex, [instr]);
          }
        }

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
            </div>

            <Panel
              title="Quad → tile → x86-64"
              // The key sits in the head of the artifact it explains, the same
              // place every other view puts it.
              actions={
                <span className="flex flex-wrap items-center gap-x-4">
                  <span className="section-meta">
                    {tacFn
                      ? `${tacFn.quads.length} quads · ${vfn?.code.length ?? 0} selected · AT&T`
                      : 'AT&T'}
                  </span>
                  <Legend
                    items={[
                      {
                        swatch: <ArrowRight aria-hidden className="size-3.5 text-accent" />,
                        label: 'tiling',
                      },
                      { swatch: <Tag tone="accent">tile</Tag>, label: 'matched pattern' },
                      {
                        swatch: (
                          <span
                            aria-hidden
                            className="inline-block h-2.5 w-4 rounded-sm border border-dashed border-line-strong"
                          />
                        ),
                        label: 'pending',
                      },
                    ]}
                  />
                </span>
              }
              frame
              bodyClassName="max-h-[34rem]"
              fullscreen={{
                label: 'the selection listing',
                controls: <FullscreenTransport stepper={stepper} />,
              }}
            >
              <table className="w-full border-collapse font-mono type-code">
                <thead className="sticky top-0 z-10 bg-surface text-2xs tracking-wide text-ink-faint uppercase">
                  <tr>
                    <th
                      scope="col"
                      className="w-12 border-b border-line px-2 py-2 text-right font-medium"
                    >
                      #
                    </th>
                    <th scope="col" className="border-b border-line px-2 py-2 text-left font-medium">
                      three-address code
                    </th>
                    <th scope="col" className="border-b border-line px-2 py-2 text-left font-medium">
                      selected x86-64
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {preamble.length > 0 && (
                    <tr className="border-b border-line/60 align-top">
                      <td className="px-2 py-1.5 text-right text-ink-faint">—</td>
                      <td className="px-2 py-1.5 font-sans text-sm text-ink-muted italic">
                        procedure entry
                      </td>
                      <td className="px-2 py-1.5">
                        <InstrList instrs={preamble} />
                      </td>
                    </tr>
                  )}
                  {(tacFn?.quads ?? []).map((q) => {
                    const instrs = byQuad.get(q.index) ?? [];
                    const isCurrent = currentTile?.tacIndex === q.index;
                    const reached = instrs.length > 0 || isCurrent;
                    return (
                      <tr
                        key={q.index}
                        aria-current={isCurrent ? 'step' : undefined}
                        className={clsx(
                          'border-b border-line/60 align-top',
                          isCurrent && 'bg-accent-soft shadow-[inset_3px_0_0_var(--accent)]',
                        )}
                      >
                        <td
                          className={clsx(
                            'px-2 py-1.5 text-right text-2xs tabular-nums',
                            reached ? 'text-ink-muted' : 'text-ink-faint',
                          )}
                        >
                          {isCurrent && (
                            <ArrowRight aria-hidden className="mr-1 inline size-3 text-accent" />
                          )}
                          {q.index}
                        </td>
                        <td
                          className={clsx(
                            'px-2 py-1.5',
                            isCurrent && 'font-semibold text-ink',
                            !isCurrent && reached && 'text-ink',
                            !reached && 'text-ink-faint',
                          )}
                        >
                          <span className="whitespace-pre">{formatQuad(q)}</span>
                          {isCurrent && currentTile !== null && (
                            <Tag tone="accent" className="ml-2">
                              {currentTile.tileName}
                            </Tag>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          {instrs.length > 0 ? (
                            <InstrList instrs={instrs} highlightLast={isCurrent && justEmitted} />
                          ) : (
                            <span className="text-ink-faint">{isCurrent ? 'matching…' : '·'}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Panel>

            <div className="cg-row mt-8 grid gap-8 md:grid-cols-2">
              <FramePanel slots={vfn?.frame.slots ?? []} size={vfn?.frame.size ?? 0} />
              <Panel title="Statically allocated">
                {state.globals.length === 0 && state.floatConsts.length === 0 ? (
                  <p className="prose-note">None.</p>
                ) : (
                  <ul className="flex flex-col gap-1 font-mono type-code text-ink-muted">
                    {state.globals.map((g) => (
                      <li key={g.name}>
                        <span className="text-ink">.comm {g.name}</span>, {g.size} bytes — addressed{' '}
                        {g.name}(%rip)
                      </li>
                    ))}
                    {state.floatConsts.map((fc) => (
                      <li key={fc.label}>
                        <span className="text-ink">{fc.label}:</span> .double {fc.value}
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>

            {state.diagnostics.length > 0 && (
              <Notice tone="warn" title="Selection diagnostics" className="mt-8">
                <ul className="mt-1 list-disc pl-5 text-sm">
                  {state.diagnostics.map((d, i) => (
                    <li key={i}>{d.message}</li>
                  ))}
                </ul>
              </Notice>
            )}
          </>
        );
      }}
    </TraceSplit>
  );
}

function InstrList({
  instrs,
  highlightLast,
}: {
  instrs: readonly VInstr[];
  highlightLast?: boolean;
}) {
  return (
    <ul className="flex flex-col">
      {instrs.map((instr, i) => {
        const last = highlightLast === true && i === instrs.length - 1;
        return (
          <li
            key={i}
            className={clsx(
              'flex items-center gap-1 whitespace-pre',
              last ? 'font-semibold text-ink' : 'text-ink-muted',
            )}
          >
            {last && <CornerDownRight aria-hidden className="size-3 shrink-0 text-accent" />}
            {formatVInstr(instr)}
          </li>
        );
      })}
    </ul>
  );
}

function FramePanel({ slots, size }: { slots: readonly FrameSlot[]; size: number }) {
  // Per-slot reasons, as noun phrases in the row itself.
  const reasonLabel: Record<FrameSlot['reason'], string> = {
    array: 'array',
    'addr-taken': 'address taken',
    spill: 'spill slot',
    float: 'float',
  };
  return (
    <Panel
      title="Frame layout"
      actions={<span className="section-meta">{size} bytes below %rbp</span>}
    >
      {slots.length === 0 ? (
        <p className="prose-note">No stack slots.</p>
      ) : (
        <ul className="flex flex-col gap-1 font-mono type-code">
          {slots.map((s) => (
            <li key={`${s.name}-${s.offset}`} className="flex flex-wrap items-center gap-2">
              <span className="text-ink">{s.offset}(%rbp)</span>
              <span className="text-ink-muted">{s.name}</span>
              <Tag tone={s.reason === 'spill' ? 'warn' : 'neutral'}>{s.size}B</Tag>
              <span className="text-2xs text-ink-faint">{reasonLabel[s.reason]}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

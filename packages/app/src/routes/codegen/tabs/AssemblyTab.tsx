/**
 * Tab 5 — ASSEMBLY (`codegen.emit`, §8.6 + §7.2 activation records).
 *
 * The final AT&T listing, emitted one line per step, with full provenance:
 * focus or hover a line and its quad and the source text it came from light up
 * in the CodeStrip. Prologue, epilogue and spill traffic are annotated from the
 * emit trace's own step metadata.
 */
import { useMemo, useState } from 'react';
import type { Compilation } from '@lab/core';
import { emitReducer } from '@lab/core/codegen/emit.js';
import type { EmitEvent, EmitState } from '@lab/core/codegen/emit.js';
import { formatQuad } from '@lab/core/ir/types.js';
import type { Trace } from '@lab/trace';
import { clsx } from 'clsx';
import { CornerDownLeft, CornerUpRight, Save } from 'lucide-react';
import { CodeStrip } from '../../../components/viz/CodeStrip';
import { useCodegenTrace } from '../useCodegenTrace';
import { prefixLatest } from '../traceScan';
import { lineNotes, quadFor, spanFor, type LineRole } from '../provenance';
import {
  AutoMicroSteps,
  Legend,
  Panel,
  Tag,
  TraceGate,
  TraceSplit,
  useStepSync,
} from '../shared';

const ROLE_TAG: Partial<Record<LineRole, { label: string; tone: 'neutral' | 'accent' | 'warn' }>> =
  {
    prologue: { label: 'prologue', tone: 'accent' },
    epilogue: { label: 'epilogue', tone: 'accent' },
    header: { label: 'header', tone: 'neutral' },
    data: { label: 'data', tone: 'neutral' },
  };

export function AssemblyTab({
  source,
  compilation,
}: {
  source: string;
  compilation: Compilation;
}) {
  const result = useCodegenTrace<EmitState, EmitEvent>('codegen.emit', { source }, emitReducer);

  return (
    <TraceGate
      result={result}
      label="Emitting AT&T assembly…"
      unavailableTitle="No emission trace"
    >
      {(trace) => <AssemblyView trace={trace} compilation={compilation} />}
    </TraceGate>
  );
}

function AssemblyView({
  trace,
  compilation,
}: {
  trace: Trace<EmitState, EmitEvent>;
  compilation: Compilation;
}) {
  const stepperOptions = useStepSync();
  const [hovered, setHovered] = useState<number | null>(null);
  const notes = useMemo(() => lineNotes(trace), [trace]);
  /** Last line emitted at or before the cursor — so the provenance panel stays
   *  meaningful on the trailing `done` step. */
  const lineAt = useMemo(
    () =>
      prefixLatest<EmitEvent, number>(trace, (s) =>
        s.event.kind === 'line' ? s.event.line.index : null,
      ),
    [trace],
  );

  return (
    <TraceSplit trace={trace} stepperOptions={stepperOptions}>
      {(stepper) => {
        const lines = stepper.state.lines;
        const currentIndex = lineAt[stepper.index] ?? null;

        const focusIndex = hovered ?? currentIndex;
        const focusLine =
          focusIndex === null ? null : (lines.find((l) => l.index === focusIndex) ?? null);
        const quad = focusLine
          ? quadFor(compilation, focusLine.functionName, focusLine.tacIndex)
          : null;
        const span = spanFor(compilation, quad);

        return (
          <>
            <AutoMicroSteps stepper={stepper} />
            <Legend
              items={[
                { swatch: <Tag tone="accent">prologue</Tag>, label: 'sets up the frame (§7.2)' },
                { swatch: <Tag tone="accent">epilogue</Tag>, label: 'tears it down and returns' },
                {
                  swatch: (
                    <Tag tone="warn">
                      <Save aria-hidden className="size-2.5" />
                      spill
                    </Tag>
                  ),
                  label: 'load/store for a spilled value',
                },
                {
                  swatch: <span aria-hidden className="font-mono text-[11px] text-ink-faint">t4</span>,
                  label: 'quad that selected the line',
                },
              ]}
            />

            <div className="grid gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
              <Panel
                title="Emitted assembly"
                subtitle={`${lines.length} line(s) — hover or focus a line for its provenance`}
                bodyClassName="p-0"
              >
                <div className="max-h-[36rem] overflow-auto">
                  <ul className="font-mono text-xs">
                    {lines.map((l) => {
                      const note = notes.get(l.index);
                      const role = note?.role ?? 'other';
                      const roleTag = ROLE_TAG[role];
                      const isCurrent = l.index === currentIndex;
                      const isFocus = l.index === focusIndex;
                      return (
                        <li key={l.index}>
                          <button
                            type="button"
                            onMouseEnter={() => setHovered(l.index)}
                            onMouseLeave={() => setHovered(null)}
                            onFocus={() => setHovered(l.index)}
                            onBlur={() => setHovered(null)}
                            aria-current={isCurrent ? 'step' : undefined}
                            aria-label={`Line ${l.index}: ${l.text}${
                              l.tacIndex !== null ? `, from quad ${l.tacIndex}` : ''
                            }`}
                            className={clsx(
                              'flex w-full cursor-default items-center gap-2 px-2 py-1 text-left transition-colors',
                              isCurrent && 'bg-accent-soft',
                              !isCurrent && isFocus && 'bg-raised',
                              note?.spillOf !== null &&
                                note?.spillOf !== undefined &&
                                'cg-hatch-warn',
                            )}
                          >
                            <span className="w-8 shrink-0 text-right text-[10px] text-ink-faint">
                              {l.index}
                            </span>
                            <span
                              className={clsx(
                                'min-w-0 flex-1 whitespace-pre',
                                l.kind === 'directive' && 'text-ink-faint',
                                l.kind === 'label' && 'font-semibold text-ink',
                                l.kind === 'instr' && 'text-ink',
                                l.kind === 'instr' && role !== 'body' && 'text-ink-muted',
                              )}
                            >
                              {l.kind === 'instr' ? `    ${l.text}` : l.text}
                            </span>
                            {note?.spillOf != null && (
                              <Tag tone="warn" title={`spill traffic for ${note.spillOf}`}>
                                <Save aria-hidden className="size-2.5" />
                                {note.spillOf}
                              </Tag>
                            )}
                            {roleTag && role !== 'body' && (
                              <Tag tone={roleTag.tone}>
                                {role === 'prologue' && (
                                  <CornerDownLeft aria-hidden className="size-2.5" />
                                )}
                                {role === 'epilogue' && (
                                  <CornerUpRight aria-hidden className="size-2.5" />
                                )}
                                {roleTag.label}
                              </Tag>
                            )}
                            {l.tacIndex !== null && (
                              <span className="shrink-0 text-[10px] text-ink-faint">
                                q{l.tacIndex}
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                    {lines.length === 0 && (
                      <li className="px-3 py-6 text-ink-faint">
                        Nothing emitted yet — step forward to write the first directive.
                      </li>
                    )}
                  </ul>
                </div>
              </Panel>

              <div className="flex min-w-0 flex-col gap-3">
                <Panel title="Provenance" bodyClassName="p-3">
                  {focusLine === null ? (
                    <p className="text-sm text-ink-faint">
                      Hover a line (or step forward) to trace it back through the TAC to the
                      source.
                    </p>
                  ) : (
                    <dl className="flex flex-col gap-2 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <dt className="text-xs text-ink-faint">asm</dt>
                        <dd className="font-mono text-ink">{focusLine.text}</dd>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <dt className="text-xs text-ink-faint">function</dt>
                        <dd className="font-mono text-ink-muted">
                          {focusLine.functionName ?? '— (module level)'}
                        </dd>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <dt className="text-xs text-ink-faint">quad</dt>
                        <dd className="font-mono text-ink-muted">
                          {quad ? (
                            <>
                              <Tag tone="accent" className="mr-2">
                                {quad.index}
                              </Tag>
                              {formatQuad(quad)}
                            </>
                          ) : (
                            'none — frame management, not a translated quad'
                          )}
                        </dd>
                      </div>
                    </dl>
                  )}
                </Panel>

                <Panel
                  title="Source"
                  subtitle={span ? `line ${span.line}, column ${span.col}` : 'no span'}
                  bodyClassName="p-2"
                >
                  <CodeStrip
                    source={compilation.source}
                    spans={span ? [span] : []}
                    maxHeight="22rem"
                  />
                </Panel>
              </div>
            </div>
          </>
        );
      }}
    </TraceSplit>
  );
}

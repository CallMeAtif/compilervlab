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
import { FullscreenTransport } from '../../../components/Fullscreen';
import { useCodegenTrace } from '../useCodegenTrace';
import { prefixLatest } from '../traceScan';
import { lineNotes, quadFor, spanFor, type LineRole } from '../provenance';
import {
  AutoMicroSteps,
  Disclosure,
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
            {/* The tags in the listing name themselves, so the key is one
                interaction away rather than a permanent line above it. */}
            <Disclosure summary="Key">
              <Legend
                items={[
                  { swatch: <Tag tone="accent">prologue</Tag>, label: 'frame setup (§7.2)' },
                  { swatch: <Tag tone="accent">epilogue</Tag>, label: 'teardown' },
                  {
                    swatch: (
                      <Tag tone="warn">
                        <Save aria-hidden className="size-2.5" />
                        spill
                      </Tag>
                    ),
                    label: 'spill traffic',
                  },
                  {
                    swatch: (
                      <span aria-hidden className="font-mono text-2xs text-ink-faint">
                        q4
                      </span>
                    ),
                    label: 'source quad',
                  },
                ]}
              />
            </Disclosure>

            <div className="cg-row mt-6 grid gap-8 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
              <Panel
                title="Emitted assembly"
                actions={<span className="section-meta">{lines.length} lines · AT&T</span>}
                frame
                /* A code figure: its own paper, its own frame, its own measure. */
                bodyClassName="max-h-[36rem] bg-code"
                fullscreen={{
                  label: 'the assembly listing',
                  controls: <FullscreenTransport stepper={stepper} />,
                  bodyClassName: 'bg-code',
                }}
              >
                {/* `w-max min-w-full`: a long directive makes the FIGURE wider
                    and the frame scrolls, instead of the line running under the
                    role tag at the right edge. */}
                <ul className="w-max min-w-full py-1 font-mono type-code">
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
                            'flex w-full cursor-default items-center gap-2 py-0.5 pr-2 text-left transition-colors duration-[var(--dur-fast)]',
                            isCurrent && 'bg-accent-soft shadow-[inset_3px_0_0_var(--accent)]',
                            !isCurrent && isFocus && 'bg-raised',
                            note?.spillOf !== null &&
                              note?.spillOf !== undefined &&
                              'cg-hatch-warn',
                          )}
                        >
                          {/* A real gutter: a rule separates the numbers from the code. */}
                          <span className="w-10 shrink-0 border-r border-line pr-2 text-right text-2xs text-ink-faint tabular-nums">
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
                            <span className="shrink-0 text-2xs text-ink-faint">q{l.tacIndex}</span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                  {lines.length === 0 && (
                    <li className="px-3 py-6 text-ink-faint">Nothing emitted yet.</li>
                  )}
                </ul>
              </Panel>

              <div className="flex min-w-0 flex-col">
                <Panel title="Provenance">
                  {focusLine === null ? (
                    <p className="prose-note">Hover a line, or step forward.</p>
                  ) : (
                    <dl className="flex flex-col">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line/60 py-1.5">
                        <dt className="w-16 shrink-0 font-mono text-2xs text-ink-faint">asm</dt>
                        <dd className="min-w-0 font-mono type-code text-ink">{focusLine.text}</dd>
                      </div>
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line/60 py-1.5">
                        <dt className="w-16 shrink-0 font-mono text-2xs text-ink-faint">function</dt>
                        <dd className="min-w-0 font-mono type-code text-ink-muted">
                          {focusLine.functionName ?? '— (module level)'}
                        </dd>
                      </div>
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-1.5">
                        <dt className="w-16 shrink-0 font-mono text-2xs text-ink-faint">quad</dt>
                        <dd className="min-w-0 font-mono type-code text-ink-muted">
                          {quad ? (
                            <>
                              <Tag tone="accent" className="mr-2">
                                {quad.index}
                              </Tag>
                              {formatQuad(quad)}
                            </>
                          ) : (
                            'none — frame management'
                          )}
                        </dd>
                      </div>
                    </dl>
                  )}
                </Panel>

                <Panel
                  title="Source"
                  actions={
                    <span className="section-meta">
                      {span ? `line ${span.line}, col ${span.col}` : 'no span'}
                    </span>
                  }
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

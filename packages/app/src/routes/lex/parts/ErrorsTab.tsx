/**
 * Tab (d) — lexical diagnostics as teaching cards (§3.1.4).
 *
 * Each card carries the four things a student needs: what failed, the rule of
 * the C-subset lexical spec that failed (the trace's own citation), a hint at
 * how to fix it, and the span — clickable, so the source strip highlights it
 * and the trace seeks to the step where recovery happened.
 */
import { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { BookOpen, CircleCheck, Lightbulb, TriangleAlert } from 'lucide-react';
import type { SourceSpan } from '@lab/trace';
import type { Diagnostic } from '@lab/core/common/types.js';
import { scanReducer, type ScanEvent, type ScanState } from '@lab/core/lex/reducers.js';
import { CodeStrip } from '../../../components/viz/CodeStrip';
import type { Stepper } from '../../../lib/useStepper';
import { useLexTrace } from '../useLexTrace';
import { columnAt, lineTextAt } from '../source';
import { LoadingPanel, Note, Panel, TraceSplit, UnavailablePanel } from './ui';

interface LexErrorCard {
  stepIndex: number;
  message: string;
  hint: string | null;
  /** The lexical rule that failed, from the step's mandatory citation. */
  rule: string | null;
  section: string;
  span: SourceSpan;
}

function ErrorCard({
  card,
  source,
  selected,
  onSelect,
}: {
  card: LexErrorCard;
  source: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const line = lineTextAt(source, card.span.start);
  const col = columnAt(source, card.span.start);
  const width = Math.min(40, Math.max(1, card.span.end - card.span.start));
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        className={clsx(
          'flex w-full cursor-pointer flex-col gap-2 border-l-2 py-2 pl-3 text-left transition-colors',
          selected
            ? 'border-err bg-err-soft shadow-[inset_2px_0_0_var(--err)]'
            : 'border-err/50 hover:bg-raised',
        )}
      >
        <span className="flex flex-wrap items-center gap-2">
          <TriangleAlert aria-hidden className="size-4 shrink-0 text-err" />
          <span className="font-semibold text-ink">{card.message}</span>
          <span className="ml-auto font-mono text-[11px] text-ink-faint">
            line {card.span.line}:{card.span.col}
          </span>
        </span>

        <span className="block overflow-x-auto rounded-md bg-code px-2 py-1.5 font-mono text-xs whitespace-pre text-ink">
          {line || ' '}
          {'\n'}
          <span className="text-err">
            {' '.repeat(Math.max(0, col - 1))}
            {'^'.repeat(width)}
          </span>
        </span>

        {card.rule && (
          <span className="flex items-start gap-2 text-xs text-ink-muted">
            <BookOpen aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <span>
              <span className="font-mono text-2xs text-ink-faint">§{card.section}</span>{' '}
              {card.rule}
            </span>
          </span>
        )}
        {card.hint && (
          <span className="flex items-start gap-2 text-xs text-ink-muted">
            <Lightbulb aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <span>{card.hint}</span>
          </span>
        )}
      </button>
    </li>
  );
}

function ErrorsBody({
  source,
  stepper,
}: {
  source: string;
  stepper: Stepper<ScanState, ScanEvent>;
}) {
  const { trace } = stepper;
  const [selected, setSelected] = useState<number | null>(null);

  const cards = useMemo<LexErrorCard[]>(
    () =>
      trace.steps.flatMap((s) =>
        s.event.kind === 'lexError'
          ? [
              {
                stepIndex: s.index,
                message: s.event.message,
                hint: s.event.hint,
                rule: s.meta.cite.rule ?? null,
                section: s.meta.cite.section,
                span: s.event.span,
              },
            ]
          : [],
      ),
    [trace],
  );

  const spans = useMemo<SourceSpan[]>(() => {
    if (selected !== null) {
      const c = cards.find((x) => x.stepIndex === selected);
      return c ? [c.span] : [];
    }
    return cards.map((c) => c.span);
  }, [cards, selected]);

  return (
    <>
      <Panel
        title="Source"
        subtitle={
          cards.length === 0
            ? 'no error spans'
            : selected === null
              ? `${cards.length} error span${cards.length === 1 ? '' : 's'}`
              : 'the selected error'
        }
      >
        <CodeStrip source={source} spans={spans} maxHeight="15rem" />
      </Panel>

      <Panel
        title="Lexical diagnostics"
        subtitle={`${cards.length} error${cards.length === 1 ? '' : 's'} · §3.1.4`}
      >
        {cards.length === 0 ? (
          <p className="flex items-center gap-2 py-2 text-base text-ink">
            <CircleCheck aria-hidden className="size-4 shrink-0 text-ok" strokeWidth={1.75} />
            No lexical errors
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {cards.map((c) => (
              <ErrorCard
                key={c.stepIndex}
                card={c}
                source={source}
                selected={selected === c.stepIndex}
                onSelect={() => {
                  setSelected(c.stepIndex);
                  stepper.jumpTo(c.stepIndex + 1);
                }}
              />
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

/** Fallback when the scan trace is unavailable: the store's own diagnostics. */
function DiagnosticList({ diagnostics }: { diagnostics: readonly Diagnostic[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {diagnostics.map((d, i) => (
        <li key={i} className="border-l-2 border-err/50 py-1 pl-3">
          <p className="font-semibold text-ink">{d.message}</p>
          <p className="font-mono text-[11px] text-ink-faint">
            line {d.span.line}:{d.span.col}
          </p>
          {d.rule && <p className="mt-1 text-xs text-ink-muted">{d.rule}</p>}
          {d.hint && <p className="mt-1 text-xs text-ink-muted">{d.hint}</p>}
        </li>
      ))}
    </ul>
  );
}

export function ErrorsTab({
  source,
  compilationId,
  initialStep,
  diagnostics,
}: {
  source: string;
  compilationId: string;
  initialStep: number | null;
  diagnostics: readonly Diagnostic[];
}) {
  const traceState = useLexTrace<ScanState, ScanEvent>(
    { kind: 'lex.scan', params: { source } },
    scanReducer,
  );

  if (traceState.status === 'loading' || traceState.status === 'idle') {
    return <LoadingPanel label="Looking for lexical errors…" />;
  }
  if (traceState.status === 'failed' || traceState.status === 'unavailable') {
    return (
      <div className="flex flex-col gap-3">
        {traceState.status === 'failed' ? (
          <Note tone="error" title="The worker could not record the scan">
            {traceState.message}
          </Note>
        ) : (
          <UnavailablePanel title="No scan trace" diagnostics={traceState.diagnostics} />
        )}
        {diagnostics.length > 0 ? (
          <DiagnosticList diagnostics={diagnostics} />
        ) : (
          <Note tone="info" title="No lexical diagnostics were reported" />
        )}
      </div>
    );
  }

  return (
    <TraceSplit
      key={`errors:${compilationId}`}
      trace={traceState.trace}
      initialStep={initialStep}
      jumpTargets={[
        { label: 'error', predicate: (s) => s.event.kind === 'lexError' },
        { label: 'token', predicate: (s) => s.event.kind === 'tokenEmitted' },
      ]}
    >
      {(stepper) => <ErrorsBody source={source} stepper={stepper} />}
    </TraceSplit>
  );
}

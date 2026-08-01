/**
 * Predictive parsing table M[A, a] — §4.4.3, Algorithm 4.31 (Fig 4.17).
 *
 * One cell per step. A cell that ends up holding two productions is the proof
 * that the grammar is not LL(1); those cells are hatched (not merely coloured)
 * and every one gets a popover naming both productions and why their prediction
 * sets overlap.
 */
import { useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Info, X } from 'lucide-react';
import { clsx } from 'clsx';
import type { Trace } from '@lab/trace';
import { formatProduction } from '@lab/core/grammar/grammar.js';
import {
  ll1TableReducer,
  type LL1Conflict,
  type LL1TableEvent,
  type LL1TableState,
} from '@lab/core/grammar/ll1-table.js';
import { useStepper } from '../../../lib/useStepper';
import { VirtualTable, type VTableColumn, type VTableRow } from '../../../components/viz/VirtualTable';
import { useTrace } from '../lib/useTrace';
import type { ViewContext } from '../lib/view';
import { terminalColumns, symbols } from '../lib/grammars';
import { GrammarRail, productionRefs } from '../components/GrammarRail';
import { ViewGrid } from '../components/Layout';
import { Diagnostics, Legend, Panel, Skeleton, StepPanel, Stat } from '../components/ui';
import { FullscreenTransport } from '../../../components/Fullscreen';

export function Ll1TableView(ctx: ViewContext) {
  const { trace, phase, diagnostics } = useTrace<LL1TableState, LL1TableEvent>(
    'syntax.ll1-table',
    { grammarId: ctx.grammarId },
    ll1TableReducer,
  );
  if (trace) return <Ready ctx={ctx} trace={trace} />;
  if (phase === 'unavailable') {
    return <Diagnostics title="The LL(1) table could not be built" diagnostics={diagnostics} />;
  }
  return <Skeleton label="Building the predictive parsing table…" />;
}

function Ready({ ctx, trace }: { ctx: ViewContext; trace: Trace<LL1TableState, LL1TableEvent> }) {
  const stepper = useStepper(trace, ctx.stepperOptions);
  const state = stepper.state;
  const g = ctx.grammar;
  const terminals = useMemo(() => terminalColumns(g), [g]);
  const compact = g.productions.length > 12;

  const ev = stepper.currentStep?.event ?? null;
  const current =
    ev && (ev.kind === 'll1.insert' || ev.kind === 'll1.conflict')
      ? { nt: ev.nonterminal, t: ev.terminal }
      : null;
  const currentProduction =
    ev && ev.kind === 'll1.production' ? g.productions[ev.production] ?? null : null;
  const firstAlpha = ev && ev.kind === 'll1.production' ? ev.firstAlpha : null;

  const conflictAt = useMemo(() => {
    const m = new Map<string, LL1Conflict>();
    for (const c of state.conflicts) m.set(`${c.nonterminal}|${c.terminal}`, c);
    return m;
  }, [state.conflicts]);

  const columns = useMemo<VTableColumn[]>(
    () =>
      terminals.map((t) => ({
        key: t,
        header: t,
        width: compact ? 62 : 140,
      })),
    [terminals, compact],
  );

  const rows = useMemo<VTableRow[]>(
    () =>
      g.nonterminals.map((nt) => {
        const cells: VTableRow['cells'] = {};
        const row = state.table[nt] ?? {};
        for (const t of terminals) {
          const entries = row[t] ?? [];
          if (entries.length === 0) continue;
          const conflict = conflictAt.get(`${nt}|${t}`);
          const text = compact
            ? entries.map((e) => `p${e.prod}`).join(' | ')
            : entries.map((e) => symbols(g.productions[e.prod]?.rhs ?? [])).join(' | ');
          cells[t] = {
            text,
            current: current?.nt === nt && current.t === t,
            highlight: true,
            conflict: conflict !== undefined,
            title: entries
              .map((e) => `${formatProduction(g.productions[e.prod]!)}  (via ${e.via.toUpperCase()})`)
              .join('   —   '),
          };
        }
        return { id: nt, header: nt, cells };
      }),
    [g, terminals, state.table, conflictAt, current, compact],
  );

  const filled = useMemo(
    () =>
      Object.values(state.table).reduce(
        (n, row) => n + Object.values(row).filter((c) => c.length > 0).length,
        0,
      ),
    [state.table],
  );

  return (
    <ViewGrid
      rail={
        <GrammarRail
          grammar={g}
          augmented={false}
          highlighted={productionRefs(stepper.currentStep)}
          leftRecursive={ctx.leftRecursive}
        />
      }
      main={
        <>
          <Panel
            title="M[A, a]"
            subtitle={`${filled} cell${filled === 1 ? '' : 's'} filled · ${state.conflicts.length} conflict${state.conflicts.length === 1 ? '' : 's'}`}
            bodyClassName="flex flex-col gap-3"
          >
            <VirtualTable
              aria-label="LL(1) predictive parsing table"
              cornerLabel="A \ a"
              columns={columns}
              rows={rows}
              // Fits the nonterminals, which are FIXED for the grammar — the
              // table never resizes as the trace steps (layout-stability rule).
              height={Math.min(440, 34 * (g.nonterminals.length + 1) + 14)}
              controls={<FullscreenTransport stepper={stepper} />}
            />
            <Legend
              items={[
                {
                  label: compact ? 'production id' : 'production body',
                  swatch: <span aria-hidden className="inline-block h-3 w-4 rounded-sm border border-line bg-surface" />,
                },
                {
                  label: 'just written',
                  swatch: <span aria-hidden className="inline-block h-3 w-4 rounded-sm border-2 border-accent bg-accent-soft" />,
                },
                {
                  label: 'conflict',
                  swatch: <span aria-hidden className="cell-conflict inline-block h-3 w-4 rounded-sm" />,
                },
              ]}
            />
          </Panel>

          <Panel title="Conflicts" bodyClassName="flex flex-col gap-3">
            <ConflictList
              conflicts={state.conflicts}
              onSelect={(c) => {
                const idx = trace.findIndex(
                  (s) =>
                    s.event.kind === 'll1.conflict' &&
                    s.event.nonterminal === c.nonterminal &&
                    s.event.terminal === c.terminal,
                  0,
                );
                if (idx >= 0) stepper.jumpTo(idx + 1);
              }}
              total={trace.final().conflicts.length}
            />
          </Panel>
        </>
      }
      panel={
        <StepPanel
          stepper={stepper}
          jumps={[
            { label: 'next production', pred: (s) => s.event.kind === 'll1.production' },
            { label: 'next conflict', pred: (s) => s.event.kind === 'll1.conflict' },
          ]}
        >
          <Panel title="Current production" bodyClassName="flex flex-col gap-3">
            {currentProduction ? (
              <>
                <p className="font-mono text-sm text-ink">
                  <span className="mr-2 text-[10px] text-ink-faint">p{currentProduction.id}</span>
                  {formatProduction(currentProduction)}
                </p>
                <p className="text-xs text-ink-muted">
                  FIRST({symbols(currentProduction.rhs)}) ={' '}
                  <span className="font-mono text-ink">{`{ ${(firstAlpha ?? []).join(', ')} }`}</span>
                </p>
              </>
            ) : (
              <p className="prose-note text-sm">Step to a production.</p>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1 pt-2">
              <Stat label="cells" value={filled} />
              <Stat label="conflicts" value={state.conflicts.length} />
            </div>
          </Panel>
        </StepPanel>
      }
    />
  );
}

function ConflictList({
  conflicts,
  onSelect,
  total,
}: {
  conflicts: readonly LL1Conflict[];
  onSelect: (c: LL1Conflict) => void;
  total: number;
}) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  if (conflicts.length === 0) {
    return (
      <p className="prose-note text-sm">
        {total === 0
          ? 'None. No cell holds two productions, so this grammar is LL(1).'
          : `None yet. ${total} appear${total === 1 ? 's' : ''} later.`}
      </p>
    );
  }
  return (
    <ul className="artifact-scroll flex max-h-64 flex-col gap-2">
      {conflicts.map((c, i) => (
        <li
          key={`${c.nonterminal}|${c.terminal}|${i}`}
          className="flex flex-wrap items-center gap-2 border-l-2 border-err py-1 pl-2.5"
        >
          <span aria-hidden className="cell-conflict size-3 shrink-0 rounded-sm" />
          <span className="font-mono text-2xs text-ink">
            M[{c.nonterminal}, {c.terminal}]
          </span>
          <span className="font-mono text-3xs font-semibold text-err">
            {c.entries.length} productions
          </span>
          <span className="flex-1" />
          <button
            type="button"
            aria-label={`Jump to the conflict at M[${c.nonterminal}, ${c.terminal}]`}
            onClick={() => onSelect(c)}
            className="h-7 cursor-pointer rounded-sm px-2 text-2xs text-ink-muted underline decoration-line-strong underline-offset-4 transition-colors hover:text-ink hover:decoration-accent"
          >
            go to step
          </button>
          <Popover.Root open={openIdx === i} onOpenChange={(o) => setOpenIdx(o ? i : null)}>
            <Popover.Trigger asChild>
              <button
                type="button"
                aria-label={`Explain the conflict at M[${c.nonterminal}, ${c.terminal}]`}
                className="flex size-7 cursor-pointer items-center justify-center rounded text-ink-faint transition-colors hover:bg-surface hover:text-accent"
              >
                <Info aria-hidden className="size-3.5" />
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                side="left"
                sideOffset={6}
                collisionPadding={8}
                className="overlay-panel z-50 w-80 rounded-md p-3 text-sm leading-relaxed text-ink"
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-semibold text-ink-muted">
                    M[{c.nonterminal}, {c.terminal}] — not LL(1)
                  </span>
                  <Popover.Close asChild>
                    <button
                      type="button"
                      aria-label="Close"
                      className="flex size-6 cursor-pointer items-center justify-center rounded text-ink-faint hover:bg-raised hover:text-ink"
                    >
                      <X aria-hidden className="size-3.5" />
                    </button>
                  </Popover.Close>
                </div>
                <ul className="mb-2 flex flex-col gap-1">
                  {c.entries.map((e) => (
                    <li
                      key={e.prod}
                      className={clsx(
                        'rounded border border-line bg-canvas px-2 py-1 font-mono text-xs',
                      )}
                    >
                      <span className="mr-1.5 text-[10px] text-ink-faint">p{e.prod}</span>
                      inserted via the {e.via.toUpperCase()} case
                    </li>
                  ))}
                </ul>
                <p className="text-xs">{c.explanation}</p>
                <Popover.Arrow className="fill-line" />
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </li>
      ))}
    </ul>
  );
}

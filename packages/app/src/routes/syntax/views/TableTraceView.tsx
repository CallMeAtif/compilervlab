/**
 * ACTION/GOTO construction for SLR(1) (§4.6.4, Algorithm 4.46 / Fig 4.37) and
 * canonical LR(1) (§4.7.3, Algorithm 4.56 / Fig 4.42) — the two traces whose
 * reduced state is exactly `TableFields`, so they share one view.
 */
import { useMemo, type ReactNode } from 'react';
import type { Reducer, Trace } from '@lab/trace';
import type { TableEvent, TableFields } from '@lab/core/grammar/lr-events.js';
import { slrReducer } from '@lab/core/grammar/slr-table.js';
import { lr1TableReducer } from '@lab/core/grammar/lr1-items.js';
import { useStepper } from '../../../lib/useStepper';
import { useTrace } from '../lib/useTrace';
import type { ViewContext } from '../lib/view';
import { LR1_VIEWS, type Lr1View as Lr1SubView } from '../lib/algorithms';
import { terminalColumns } from '../lib/grammars';
import { GrammarRail, productionRefs } from '../components/GrammarRail';
import { ViewGrid } from '../components/Layout';
import { ConflictList, CurrentRowStrip, LrTable } from '../components/LrTable';
import {
  Diagnostics,
  Note,
  Panel,
  Segmented,
  Skeleton,
  StepPanel,
  Stat,
  TextButton,
} from '../components/ui';

export function SlrView(ctx: ViewContext) {
  return (
    <TableTrace
      ctx={ctx}
      kind="syntax.slr"
      reducer={slrReducer}
      title="SLR(1) ACTION / GOTO"
      subtitle="§4.6.4 · Algorithm 4.46 (Fig 4.37)"
      explainer="SLR uses the LR(0) automaton and reduces by A → α on every terminal of FOLLOW(A). That is an over-approximation: a lookahead may be in FOLLOW(A) without being viable in this particular state, and when it collides with a shift the grammar is declared not SLR(1) even though it may still be LR(1)."
      showFollow
      loadingLabel="Building the SLR(1) table…"
      failureTitle="The SLR(1) table could not be built"
    />
  );
}

export function Lr1TableView({
  ctx,
  subView,
  onSubView,
}: {
  ctx: ViewContext;
  subView: Lr1SubView;
  onSubView: (v: Lr1SubView) => void;
}) {
  return (
    <TableTrace
      ctx={ctx}
      kind="syntax.lr1-table"
      reducer={lr1TableReducer}
      title="Canonical LR(1) ACTION / GOTO"
      subtitle="§4.7.3 · Algorithm 4.56 (Fig 4.42)"
      explainer="Canonical LR(1) reduces by A → α only on the lookahead the item itself carries — not on all of FOLLOW(A). That precision is what removes the SLR conflicts, at the cost of the state explosion the item-set view shows."
      headerActions={
        <Segmented label="LR(1) view" value={subView} options={LR1_VIEWS} onChange={onSubView} size="sm" />
      }
      loadingLabel="Building the canonical LR(1) table…"
      failureTitle="No canonical LR(1) table for this grammar"
      failureExtra={
        <Note
          tone="warn"
          title="The canonical LR(1) table cannot be built from a truncated collection"
          actions={
            <>
              <TextButton emphasis onClick={() => ctx.selectAlgo('lalr')}>
                Build the LALR(1) table instead
              </TextButton>
              <TextButton onClick={() => ctx.selectAlgo('lr1')}>
                See where the collection was cut off
              </TextButton>
            </>
          }
        >
          Algorithm 4.56 fills one row per LR(1) state, so it needs the whole collection. This
          grammar exceeds the lab’s 400-state cap, and the construction refuses rather than
          producing a table with missing rows. That is not a limitation of the lab: it is the
          practical reason canonical LR(1) tables are not used. LALR(1) merges the same-core states
          first and produces a table with exactly as many rows as the LR(0) machine.
        </Note>
      }
    />
  );
}

function TableTrace({
  ctx,
  kind,
  reducer,
  title,
  subtitle,
  explainer,
  showFollow,
  headerActions,
  loadingLabel,
  failureTitle,
  failureExtra,
}: {
  ctx: ViewContext;
  kind: 'syntax.slr' | 'syntax.lr1-table';
  reducer: Reducer<TableFields, TableEvent>;
  title: string;
  subtitle: string;
  explainer: string;
  showFollow?: boolean;
  headerActions?: ReactNode;
  loadingLabel: string;
  failureTitle: string;
  failureExtra?: ReactNode;
}) {
  const { trace, phase, diagnostics } = useTrace<TableFields, TableEvent>(
    kind,
    { grammarId: ctx.grammarId },
    reducer,
  );
  if (trace) {
    return (
      <Ready
        ctx={ctx}
        trace={trace}
        title={title}
        subtitle={subtitle}
        explainer={explainer}
        showFollow={showFollow}
        headerActions={headerActions}
      />
    );
  }
  if (phase === 'unavailable') {
    return (
      <div className="flex flex-col gap-3">
        {failureExtra}
        <Diagnostics title={failureTitle} diagnostics={diagnostics} />
      </div>
    );
  }
  return <Skeleton label={phase === 'replaying' ? 'Replaying the construction locally…' : loadingLabel} />;
}

function Ready({
  ctx,
  trace,
  title,
  subtitle,
  explainer,
  showFollow,
  headerActions,
}: {
  ctx: ViewContext;
  trace: Trace<TableFields, TableEvent>;
  title: string;
  subtitle: string;
  explainer: string;
  showFollow?: boolean;
  headerActions?: ReactNode;
}) {
  const stepper = useStepper(trace, ctx.stepperOptions);
  const state = stepper.state;
  const ag = ctx.augmented;
  const terminals = useMemo(() => terminalColumns(ctx.grammar), [ctx.grammar]);
  // GOTO columns are the ORIGINAL nonterminals: ag.nonterminals also holds the
  // synthetic start symbol, and in Grammar 4.28 that name (E′) collides with a
  // real nonterminal, so filtering by name would drop a legitimate column.
  const nonterminals = ctx.grammar.nonterminals;

  const ev = stepper.currentStep?.event ?? null;
  const currentRow =
    ev && (ev.kind === 'table/row' || ev.kind === 'table/action' || ev.kind === 'table/goto')
      ? ev.state
      : ev && ev.kind === 'table/conflict'
        ? ev.conflict.state
        : null;
  const current =
    ev && ev.kind === 'table/action'
      ? { state: ev.state, symbol: ev.symbol }
      : ev && ev.kind === 'table/goto'
        ? { state: ev.state, symbol: ev.nonterminal }
        : ev && ev.kind === 'table/conflict'
          ? { state: ev.conflict.state, symbol: ev.conflict.symbol }
          : null;

  const totalRows = useMemo(() => trace.final().action.length, [trace]);

  return (
    <ViewGrid
      rail={
        <GrammarRail
          grammar={ag}
          augmented
          highlighted={productionRefs(stepper.currentStep)}
          leftRecursive={ctx.leftRecursive}
        />
      }
      main={
        <>
          <Panel
            title={title}
            subtitle={`${state.action.length} / ${totalRows} rows`}
            actions={headerActions}
            bodyClassName="flex flex-col gap-3"
          >
            <p className="text-xs leading-relaxed text-ink-muted">{explainer}</p>
            <LrTable
              ag={ag}
              action={state.action}
              goto={state.goto}
              conflicts={state.conflicts}
              terminals={terminals}
              nonterminals={nonterminals}
              rowName={(i) => String(i)}
              current={current}
            />
          </Panel>

          {showFollow && (
            <Panel
              title="FOLLOW sets used for the reduce entries"
              subtitle={`${Object.keys(state.follow).length} nonterminals`}
              bodyClassName="max-h-64 overflow-auto"
            >
              <ul className="flex flex-col gap-0.5 font-mono text-xs">
                {Object.entries(state.follow).map(([nt, set]) => (
                  <li key={nt} className="flex gap-2">
                    <span className="w-32 shrink-0 truncate font-semibold text-ink">FOLLOW({nt})</span>
                    <span className="text-ink-muted">{`{ ${set.join(', ')} }`}</span>
                  </li>
                ))}
                {Object.keys(state.follow).length === 0 && (
                  <li className="text-ink-faint">Step forward — the FOLLOW sets are reported first.</li>
                )}
              </ul>
            </Panel>
          )}
        </>
      }
      panel={
        <StepPanel
          stepper={stepper}
          jumps={[
            { label: 'next row', pred: (s) => s.event.kind === 'table/row' },
            { label: 'next conflict', pred: (s) => s.event.kind === 'table/conflict' },
            {
              label: 'accept entry',
              pred: (s) => s.event.kind === 'table/action' && s.event.action.type === 'accept',
            },
          ]}
        >
          <Panel title="Row being filled" bodyClassName="flex flex-col gap-2">
            <div className="flex flex-wrap gap-1.5">
              <Stat label="rows" value={`${state.action.length} / ${totalRows}`} />
              <Stat label="conflicts" value={state.conflicts.length} />
            </div>
            <CurrentRowStrip
              ag={ag}
              state={currentRow}
              name={currentRow === null ? '—' : String(currentRow)}
              action={currentRow === null ? undefined : state.action[currentRow]}
              goto={currentRow === null ? undefined : state.goto[currentRow]}
            />
          </Panel>

          <Panel title="Conflicts" bodyClassName="flex flex-col gap-2">
            <ConflictList
              ag={ag}
              conflicts={state.conflicts}
              emptyLabel={
                trace.final().conflicts.length === 0
                  ? 'Every cell is claimed by exactly one action: this grammar is handled by this method without a conflict.'
                  : `None yet — ${trace.final().conflicts.length} appear later in the construction.`
              }
              onSelect={(c) => {
                const idx = trace.findIndex(
                  (s) =>
                    s.event.kind === 'table/conflict' &&
                    s.event.conflict.state === c.state &&
                    s.event.conflict.symbol === c.symbol,
                  0,
                );
                if (idx >= 0) stepper.jumpTo(idx + 1);
              }}
            />
          </Panel>
        </StepPanel>
      }
    />
  );
}

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
import { FullscreenTransport } from '../../../components/Fullscreen';
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
          Algorithm 4.56 needs one row per LR(1) state, and this grammar passes the 400-state cap.
          LALR(1) merges the same-core states first, so its table is LR(0)-sized.
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
  showFollow,
  headerActions,
}: {
  ctx: ViewContext;
  trace: Trace<TableFields, TableEvent>;
  title: string;
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
          >
            <LrTable
              ag={ag}
              action={state.action}
              goto={state.goto}
              conflicts={state.conflicts}
              terminals={terminals}
              nonterminals={nonterminals}
              rowName={(i) => String(i)}
              current={current}
              controls={<FullscreenTransport stepper={stepper} />}
            />
          </Panel>

          {showFollow && (
            <Panel
              title="FOLLOW sets"
              subtitle={`${Object.keys(state.follow).length} nonterminals`}
              bodyClassName="framed artifact-scroll max-h-64 p-3"
            >
              <ul className="flex flex-col gap-0.5 font-mono text-xs">
                {Object.entries(state.follow).map(([nt, set]) => (
                  <li key={nt} className="flex gap-2">
                    <span className="w-32 shrink-0 truncate font-semibold text-ink">FOLLOW({nt})</span>
                    <span className="text-ink-muted">{`{ ${set.join(', ')} }`}</span>
                  </li>
                ))}
                {Object.keys(state.follow).length === 0 && (
                  <li className="text-ink-faint">Step forward.</li>
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
          <Panel title="Row being filled" bodyClassName="flex flex-col gap-3">
            <div className="flex flex-wrap gap-x-4 gap-y-1 pb-1">
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

          <Panel title="Conflicts" bodyClassName="flex flex-col gap-3">
            <ConflictList
              ag={ag}
              conflicts={state.conflicts}
              emptyLabel={
                trace.final().conflicts.length === 0
                  ? 'None. Every cell has exactly one action.'
                  : `None yet. ${trace.final().conflicts.length} appear later.`
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

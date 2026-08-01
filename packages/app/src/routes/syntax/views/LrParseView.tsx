/**
 * The LR driver — §4.6.3, Algorithm 4.44 (Fig 4.36), rendered as the Fig 4.38
 * configuration table plus the parse forest each reduction builds.
 *
 * The same driver runs the SLR and the LALR table; switching the table is the
 * point of the toggle. On the C grammars every input symbol carries its source
 * span, so the code strip follows the parse.
 */
import { useMemo } from 'react';
import { clsx } from 'clsx';
import type { Trace } from '@lab/trace';
import { formatProduction } from '@lab/core/grammar/grammar.js';
import {
  lrParseReducer,
  type LrParseEvent,
  type LrParseUiState,
  type PtNodeJson,
} from '@lab/core/grammar/lr-parse.js';
import { useStepper } from '../../../lib/useStepper';
import { CodeStrip } from '../../../components/viz/CodeStrip';
import { FullscreenTransport } from '../../../components/Fullscreen';
import { useTrace } from '../lib/useTrace';
import type { ViewContext } from '../lib/view';
import { LR_TABLES, type LrTableChoice } from '../lib/algorithms';
import { grammarMeta } from '../lib/grammars';
import { GrammarRail, productionRefs } from '../components/GrammarRail';
import { ViewGrid } from '../components/Layout';
import { Diagnostics, Note, Panel, Segmented, Skeleton, StepPanel, Stat } from '../components/ui';
import { MoveTable, TreePanel, useForest } from '../components/parse';
import { NoParseInput } from './guards';

export function LrParseView({
  ctx,
  table,
  onTable,
}: {
  ctx: ViewContext;
  table: LrTableChoice;
  onTable: (t: LrTableChoice) => void;
}) {
  const noInput = ctx.source.trim().length === 0;
  const { trace, phase, diagnostics } = useTrace<LrParseUiState, LrParseEvent>(
    'syntax.lr-parse',
    noInput ? null : { grammarId: ctx.grammarId, table, source: ctx.source },
    lrParseReducer,
  );

  // augment() names the new start S′; in Grammar 4.28 that name is already
  // taken by a real nonterminal, so the generated table has no GOTO column for
  // it and the driver cannot reduce to it. Worth saying out loud rather than
  // leaving as a bare internal error.
  const startNameCollision = ctx.grammar.nonterminals.includes(ctx.augmented.start);

  if (noInput) return <NoParseInput ctx={ctx} />;
  if (trace) return <Ready ctx={ctx} trace={trace} table={table} onTable={onTable} />;
  if (phase === 'unavailable') {
    return (
      <div className="flex flex-col gap-3">
        {startNameCollision && (
          <Note
            tone="warn"
            title={`This grammar already uses ${ctx.augmented.start} as a nonterminal`}
          >
            Augmentation (§4.6.3) needs a fresh start symbol, so the table has no GOTO column for{' '}
            <span className="font-mono">{ctx.augmented.start}</span>. The item-set and table views
            still run. Use <span className="font-mono">dragon-4.1</span> for the Fig 4.38 parse.
          </Note>
        )}
        <Diagnostics title="The LR parse could not be run" diagnostics={diagnostics} />
      </div>
    );
  }
  return (
    <Skeleton
      label={
        phase === 'replaying'
          ? 'Replaying the parse locally…'
          : `Building the ${table.toUpperCase()} table and running the driver…`
      }
    />
  );
}

function Ready({
  ctx,
  trace,
  table,
  onTable,
}: {
  ctx: ViewContext;
  trace: Trace<LrParseUiState, LrParseEvent>;
  table: LrTableChoice;
  onTable: (t: LrTableChoice) => void;
}) {
  const stepper = useStepper(trace, ctx.stepperOptions);
  const state = stepper.state;
  const g = ctx.grammar;
  const isC = grammarMeta(ctx.grammarId).input === 'c';

  const ev = stepper.currentStep?.event ?? null;
  const currentIds = useMemo(() => {
    if (!ev) return [];
    if (ev.kind === 'parse/shift' || ev.kind === 'parse/reduce') {
      // The node the reducer just appended is the last one in the current state.
      const last = state.nodes[state.nodes.length - 1];
      return last ? [`n${last.id}`] : [];
    }
    return [];
  }, [ev, state.nodes]);

  const { root, count } = useForest<PtNodeJson>(
    state.nodes,
    state.roots,
    (n) => (n.lexeme && n.lexeme !== n.symbol ? `${n.symbol}(${n.lexeme})` : n.symbol),
    (n) => (n.prod === null ? 'terminal' : 'nonterminal'),
  );

  const spans = stepper.currentStep?.meta.srcSpans ?? [];
  const lookahead = state.input[state.cursor];

  const reduceProd =
    ev && ev.kind === 'parse/reduce' ? (g.productions[ev.prod] ?? null) : null;

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
            title="Configurations (Fig 4.38)"
            subtitle={`${state.log.length} move${state.log.length === 1 ? '' : 's'}`}
            actions={<Segmented label="Parsing table" value={table} options={LR_TABLES} onChange={onTable} size="sm" />}
            bodyClassName="flex flex-col gap-3"
          >
            <StackStrip stack={state.stack} symbols={state.symbols} />
            <MoveTable
              ariaLabel="LR parser configurations"
              columns={[
                { key: 'stack', header: 'State stack' },
                { key: 'symbols', header: 'Symbols', grow: true },
                { key: 'input', header: 'Remaining input' },
                { key: 'action', header: 'Action', grow: true },
              ]}
              rows={state.log}
            />
          </Panel>

          {isC && ctx.source.length > 0 && (
            <Panel title="Source">
              <CodeStrip source={ctx.source} spans={spans} maxHeight="14rem" />
            </Panel>
          )}

          <Panel
            title="Parse forest"
            subtitle={`${count} node${count === 1 ? '' : 's'} · ${state.roots.length} root${state.roots.length === 1 ? '' : 's'}`}
                      >
            <TreePanel
              root={root}
              nodeCount={count}
              currentIds={currentIds}
              emptyLabel="Shift a token to begin."
              controls={<FullscreenTransport stepper={stepper} />}
            />
          </Panel>
        </>
      }
      panel={
        <StepPanel
          stepper={stepper}
          jumps={[
            { label: 'next shift', pred: (s) => s.event.kind === 'parse/shift' },
            { label: 'next reduce', pred: (s) => s.event.kind === 'parse/reduce' },
            { label: 'accept', pred: (s) => s.event.kind === 'parse/accept' },
            { label: 'error', pred: (s) => s.event.kind === 'parse/error' },
          ]}
        >
          <Panel title="Driver state" bodyClassName="flex flex-col gap-3">
            <div className="flex flex-wrap gap-x-4 gap-y-1 pb-1">
              <Stat label="table" value={table.toUpperCase()} />
              <Stat label="state" value={state.stack[state.stack.length - 1] ?? '—'} />
              <Stat label="lookahead" value={lookahead ? (lookahead.lexeme ?? lookahead.term) : '—'} />
              <Stat label="input" value={`${state.cursor} / ${Math.max(0, state.input.length - 1)}`} />
            </div>
            {reduceProd && (
              <p className="border-l-2 border-line-strong py-1 pl-3 font-mono text-xs text-ink">
                <span className="mr-2 text-[10px] text-ink-faint">p{reduceProd.id}</span>
                {formatProduction(reduceProd)}
                <span className="mt-1 block text-[11px] text-ink-muted">
                  pop {reduceProd.rhs.length} · push GOTO
                </span>
              </p>
            )}
            {state.error && (
              <Note tone="error" title="Syntax error — blank ACTION entry">
                <p className="font-mono text-xs">
                  state {state.error.state} · found ‘{state.error.found}’
                </p>
                <p className="mt-1">
                  Only <span className="font-mono">{`{ ${state.error.expected.join(', ')} }`}</span>{' '}
                  can continue here (§4.6.3).
                </p>
              </Note>
            )}
            {state.accepted && (
              <Note tone="info" title="Accepted">
                ACTION[state, $] = acc.
              </Note>
            )}
          </Panel>
        </StepPanel>
      }
    />
  );
}

/** The state stack with the grammar symbols interleaved, as in Fig 4.38. */
function StackStrip({ stack, symbols }: { stack: readonly number[]; symbols: readonly string[] }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="group-label">Stack (bottom → top)</span>
      <div className="framed artifact-scroll flex max-h-20 flex-wrap items-center gap-0.5 p-1.5 font-mono text-2xs">
        {stack.map((s, i) => (
          <span key={i} className="flex items-center gap-0.5">
            {i > 0 && (
              <span className="inline-flex h-6 items-center rounded border border-line bg-surface px-1.5 text-ink">
                {symbols[i - 1]}
              </span>
            )}
            <span
              className={clsx(
                'inline-flex h-6 items-center rounded px-1.5 font-semibold',
                i === stack.length - 1
                  ? 'bg-accent text-on-accent shadow-[0_0_0_2px_var(--surface),0_0_0_3px_var(--accent)]'
                  : 'bg-raised text-ink-muted',
              )}
            >
              {s}
            </span>
          </span>
        ))}
        {stack.length === 0 && <span className="text-ink-faint">(not initialized)</span>}
      </div>
    </div>
  );
}

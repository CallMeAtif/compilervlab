/**
 * LALR(1) — §4.7.4, Algorithm 4.59 (Fig 4.43).
 *
 * One trace, three acts: merge the same-core LR(1) states (unioning their
 * lookaheads), remap the transitions, then fill ACTION/GOTO exactly as canonical
 * LR(1) does. The merge act is where the lab spends its attention, because the
 * union of lookaheads is the only place a reduce/reduce conflict can be born.
 */
import { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import type { Trace } from '@lab/trace';
import { formatDotted } from '@lab/core/grammar/lr-events.js';
import { lalrReducer, type LalrEvent, type LalrUiState } from '@lab/core/grammar/lalr.js';
import { useStepper } from '../../../lib/useStepper';
import { useTrace } from '../lib/useTrace';
import type { ViewContext } from '../lib/view';
import { terminalColumns } from '../lib/grammars';
import { GrammarRail, productionRefs } from '../components/GrammarRail';
import { ViewGrid } from '../components/Layout';
import { GotoGraph, type GotoGraphState } from '../components/GotoGraph';
import { ItemSets, mergeItemRows, type ItemSetState } from '../components/ItemSets';
import { ConflictList, CurrentRowStrip, LrTable } from '../components/LrTable';
import { Diagnostics, Note, Panel, Skeleton, StepPanel, Stat } from '../components/ui';

export function LalrView(ctx: ViewContext) {
  // The pipeline parser resolves the dangling else by shifting (§4.8.2); the
  // study grammars show their conflicts raw. Both are worth seeing, so it is a
  // toggle rather than a hidden constant.
  const [resolveElse, setResolveElse] = useState(ctx.grammarId === 'c-subset');
  const { trace, phase, diagnostics } = useTrace<LalrUiState, LalrEvent>(
    'syntax.lalr',
    { grammarId: ctx.grammarId, resolveDanglingElseByShift: resolveElse },
    lalrReducer,
  );

  if (trace) {
    return (
      <Ready ctx={ctx} trace={trace} resolveElse={resolveElse} onResolveElse={setResolveElse} />
    );
  }
  if (phase === 'unavailable') {
    return <Diagnostics title="The LALR(1) table could not be built" diagnostics={diagnostics} />;
  }
  return (
    <Skeleton
      label={
        phase === 'replaying'
          ? 'Replaying the merge and the table locally…'
          : 'Building the LR(1) collection, merging same-core states, filling ACTION/GOTO…'
      }
    />
  );
}

function Ready({
  ctx,
  trace,
  resolveElse,
  onResolveElse,
}: {
  ctx: ViewContext;
  trace: Trace<LalrUiState, LalrEvent>;
  resolveElse: boolean;
  onResolveElse: (v: boolean) => void;
}) {
  const stepper = useStepper(trace, ctx.stepperOptions);
  const state = stepper.state;
  const ag = ctx.augmented;
  const final = useMemo(() => trace.final(), [trace]);
  const dotted = useMemo(() => (prod: number, dot: number) => formatDotted(ag, prod, dot), [ag]);

  const terminals = useMemo(() => terminalColumns(ctx.grammar), [ctx.grammar]);
  const nonterminals = ctx.grammar.nonterminals;

  const ev = stepper.currentStep?.event ?? null;
  const mergeEvent = ev && ev.kind === 'lalr/merge' ? ev : null;
  const currentStateId =
    mergeEvent?.state.id ??
    (ev && ev.kind === 'lalr/transition'
      ? ev.from
      : ev && (ev.kind === 'table/row' || ev.kind === 'table/action' || ev.kind === 'table/goto')
        ? ev.state
        : ev && ev.kind === 'table/conflict'
          ? ev.conflict.state
          : null);
  const currentEdge =
    ev && ev.kind === 'lalr/transition' ? { from: ev.from, symbol: ev.symbol, to: ev.to } : null;
  const currentCell =
    ev && ev.kind === 'table/action'
      ? { state: ev.state, symbol: ev.symbol }
      : ev && ev.kind === 'table/goto'
        ? { state: ev.state, symbol: ev.nonterminal }
        : ev && ev.kind === 'table/conflict'
          ? { state: ev.conflict.state, symbol: ev.conflict.symbol }
          : null;

  const nameOf = useMemo(() => {
    const m = new Map<number, string>();
    for (const s of final.states) m.set(s.id, s.name);
    return (id: number) => m.get(id) ?? String(id);
  }, [final.states]);

  const graphStates = useMemo<GotoGraphState[]>(
    () =>
      final.states.map((s) => ({
        id: s.id,
        name: s.name,
        itemCount: s.items.length,
        detail: mergeItemRows(s.items, dotted)
          .map((r) => `[${r.dotted}, ${r.lookaheads.join('/')}]`)
          .join('\n'),
      })),
    [final.states, dotted],
  );

  const itemSets = useMemo<ItemSetState[]>(
    () => state.states.map((s) => ({ id: s.id, name: s.name, rows: mergeItemRows(s.items, dotted) })),
    [state.states, dotted],
  );

  const visited = useMemo(() => new Set(state.states.map((s) => s.id)), [state.states]);
  const merges = useMemo(() => final.states.filter((s) => s.sources.length > 1), [final.states]);
  const mergesSoFar = state.states.filter((s) => s.sources.length > 1).length;

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
            title="Merging same-core LR(1) states"
            subtitle="§4.7.4 · Algorithm 4.59"
            actions={
              <label className="flex h-11 cursor-pointer items-center gap-2 rounded-md border border-control px-3 text-xs text-ink-muted transition-colors hover:border-line-strong">
                <input
                  type="checkbox"
                  checked={resolveElse}
                  onChange={(e) => onResolveElse(e.target.checked)}
                  className="size-4 accent-[var(--accent)]"
                  aria-label="Resolve dangling-else shift/reduce conflicts by shifting"
                />
                resolve dangling else by shift (§4.8.2)
              </label>
            }
            bodyClassName="flex flex-col gap-3"
          >
            <div className="flex flex-wrap gap-1.5">
              <Stat label="LR(1) states" value={final.lr1StateCount || state.lr1StateCount} />
              <Stat label="LALR states" value={final.states.length} />
              <Stat label="merges" value={`${mergesSoFar} / ${merges.length}`} />
            </div>
            <p className="text-xs leading-relaxed text-ink-muted">
              Two LR(1) states have the same <em>core</em> when they hold the same items ignoring
              lookaheads. Algorithm 4.59 replaces every such group by one state whose items carry
              the union of the lookaheads. The automaton keeps its shape (same-core states have
              same-core successors), the table shrinks to the size of the LR(0) machine, and the
              only new risk is a reduce/reduce conflict between two complete items whose lookaheads
              were kept apart in the canonical collection.
            </p>

            {mergeEvent && (
              <div
                className={clsx(
                  'flex flex-col gap-2 rounded-lg border p-3 transition-colors',
                  mergeEvent.merged ? 'border-accent bg-accent-soft' : 'border-line bg-canvas',
                )}
              >
                <p className="font-mono text-sm text-ink">
                  {mergeEvent.state.sources.map((s) => `I${s}`).join(' ∪ ')}
                  <span className="mx-2 text-ink-faint">→</span>
                  <span className="font-semibold">I{mergeEvent.state.name}</span>
                  {!mergeEvent.merged && (
                    <span className="ml-2 font-sans text-xs text-ink-muted">(unique core — carried over)</span>
                  )}
                </p>
                {mergeEvent.merged && (
                  <div className="max-h-52 overflow-auto rounded border border-line bg-surface">
                    <table className="w-full border-collapse font-mono text-[11px]">
                      <thead className="sticky top-0 bg-raised text-ink-muted">
                        <tr>
                          <th scope="col" className="px-2 py-1 text-left font-semibold">
                            core
                          </th>
                          {mergeEvent.state.sources.map((s) => (
                            <th key={s} scope="col" className="px-2 py-1 text-left font-semibold">
                              from I{s}
                            </th>
                          ))}
                          <th scope="col" className="px-2 py-1 text-left font-semibold">
                            union
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {mergeEvent.lookaheadUnions.map((u) => (
                          <tr key={u.core} className="border-t border-line/60 align-top">
                            <td className="px-2 py-1 text-ink">[{u.core}]</td>
                            {u.parts.map((p) => (
                              <td key={p.source} className="px-2 py-1 text-ink-muted">
                                {p.las.length === 0 ? '—' : p.las.join(' / ')}
                              </td>
                            ))}
                            <td className="px-2 py-1 font-semibold text-accent">
                              {u.union.join(' / ')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            <GotoGraph
              states={graphStates}
              transitions={final.transitions}
              currentStateId={currentStateId}
              visitedStateIds={visited}
              currentEdge={currentEdge}
            />
          </Panel>

          <Panel
            title="LALR(1) ACTION / GOTO"
            subtitle={`${state.action.length} / ${final.action.length} rows`}
            bodyClassName="flex flex-col gap-3"
          >
            <LrTable
              ag={ag}
              action={state.action}
              goto={state.goto}
              conflicts={state.conflicts}
              terminals={terminals}
              nonterminals={nonterminals}
              rowName={nameOf}
              current={currentCell}
              height={380}
            />
            <CurrentRowStrip
              ag={ag}
              state={currentCell?.state ?? null}
              name={currentCell ? nameOf(currentCell.state) : '—'}
              action={currentCell ? state.action[currentCell.state] : undefined}
              goto={currentCell ? state.goto[currentCell.state] : undefined}
            />
          </Panel>
        </>
      }
      panel={
        <StepPanel
          stepper={stepper}
          jumps={[
            {
              label: 'next real merge',
              pred: (s) => s.event.kind === 'lalr/merge' && s.event.merged,
            },
            { label: 'first table row', pred: (s) => s.event.kind === 'table/row' },
            { label: 'next conflict', pred: (s) => s.event.kind === 'table/conflict' },
          ]}
        >
          <Panel title="Merged item sets" bodyClassName="flex flex-col gap-2">
            <ItemSets
              states={itemSets}
              currentStateId={currentStateId}
              added={null}
              justifies={null}
              emptyLabel="Step forward to start merging the canonical LR(1) states."
            />
          </Panel>

          <Panel title="Conflicts" bodyClassName="flex flex-col gap-2">
            {ctx.grammarId === 'c-subset' && (
              <Note
                tone={resolveElse ? 'warn' : 'error'}
                title={
                  resolveElse
                    ? 'Dangling else: a real shift/reduce conflict, resolved by shifting'
                    : 'Dangling else: shown raw (unresolved)'
                }
              >
                <span className="font-mono">IfStmt → if ( Expr ) Stmt</span> and{' '}
                <span className="font-mono">IfStmt → if ( Expr ) Stmt else Stmt</span> collide on{' '}
                <span className="font-mono">else</span>: the parser can reduce the short form or
                shift the <span className="font-mono">else</span>. The grammar is genuinely
                ambiguous here.{' '}
                {resolveElse
                  ? 'Resolving in favour of the shift attaches each else to the nearest unmatched if — the rule every C compiler follows (§4.8.2). The conflict is not removed from the grammar, only decided.'
                  : 'Left undecided, the first-registered action wins and the else could attach to the wrong if. Turn the toggle above on to apply the §4.8.2 resolution the pipeline parser uses.'}
              </Note>
            )}
            <ConflictList
              ag={ag}
              conflicts={state.conflicts}
              emptyLabel={
                final.conflicts.length === 0
                  ? 'No cell is ever claimed twice: merging introduced no reduce/reduce conflict, so this grammar is LALR(1).'
                  : `None yet — ${final.conflicts.length} appear later in the construction.`
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

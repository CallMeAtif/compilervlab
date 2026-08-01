/**
 * Stage 2 of the constructions chain — the subset construction
 * (Algorithm 3.20, §3.7.1).
 *
 * Three synchronized panels:
 *   • the Dstates worker table, laid out exactly like Fig 3.36/3.37 —
 *     D-state name, its NFA state set, the marked/unmarked flag, and one
 *     column per input symbol holding Dtran[T, a];
 *   • the ε-closure stack of Fig 3.33 while it runs (input set, stack, closure);
 *   • the DFA graph, revealed D-state by D-state over a layout computed once.
 */
import { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { subsetReducer, type SubsetEvent, type SubsetState } from '@lab/core/lex/reducers.js';
import { ElkGraph, elkHiddenIds } from '../../../components/viz/ElkGraph';
import {
  VirtualTable,
  type VTableColumn,
  type VTableRow,
} from '../../../components/viz/VirtualTable';
import type { Stepper } from '../../../lib/useStepper';
import { useLexTrace } from '../useLexTrace';
import type { LexTokenClass } from '../tokenClasses';
import type { TokenClassId } from '../lexUrl';
import { dfaEdgeId, dfaGraph, isHeavyGraph, showSymbol } from '../graph';
import {
  HeavyGate,
  LabButton,
  LoadingPanel,
  Note,
  Panel,
  TraceSplit,
  UnavailablePanel,
} from './ui';
import { AutomatonLegend, SetText, StatChips } from './bits';

const SET_COL_W = 260;

function DstatesTable({
  state,
  currentStep,
}: {
  state: SubsetState;
  currentStep: { event: SubsetEvent } | null;
}) {
  const columns = useMemo<VTableColumn[]>(
    () => [
      { key: '__mark', header: '✓', width: 40 },
      { key: '__set', header: 'ε-closure (NFA states)', width: SET_COL_W },
      ...state.alphabet.map((a) => ({ key: `s:${a}`, header: showSymbol(a), width: 46 })),
    ],
    [state.alphabet],
  );

  const transIndex = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of state.trans) m.set(`${t.from} ${t.symbol}`, t.to);
    return m;
  }, [state.trans]);

  const marked = useMemo(() => new Set(state.marked), [state.marked]);

  const e = currentStep?.event;
  const currentDstate =
    e &&
    (e.kind === 'dstateCreated'
      ? e.id
      : e.kind === 'dstateMarked'
        ? e.id
        : e.kind === 'dtranSet' || e.kind === 'emptyMove'
          ? e.from
          : null);
  const currentSymbol = e && (e.kind === 'dtranSet' || e.kind === 'emptyMove') ? e.symbol : null;

  const rows = useMemo<VTableRow[]>(
    () =>
      state.states.map((s) => {
        const isMarked = marked.has(s.id);
        const cells: VTableRow['cells'] = {
          __mark: {
            text: isMarked ? '✓' : '○',
            title: isMarked ? 'marked (processed)' : 'unmarked (still in the worklist)',
            highlight: isMarked,
          },
          __set: {
            text: `{${s.nfaStates.join(', ')}}${s.accept ? `  ⇒ ${s.accept.token}` : ''}`,
            title: s.accept ? `accepting: ${s.accept.token}` : 'nonaccepting',
            highlight: s.accept !== null,
          },
        };
        for (const a of state.alphabet) {
          const to = transIndex.get(`${s.id} ${a}`);
          cells[`s:${a}`] = {
            // An empty cell is "current" too when the step is the ∅ move that
            // deliberately left it undefined.
            text: to ?? '',
            current: s.id === currentDstate && a === currentSymbol,
            highlight: to !== undefined,
          };
        }
        return { id: s.id, header: s.id === state.start ? `▸${s.id}` : s.id, cells };
      }),
    [state.states, state.alphabet, state.start, transIndex, marked, currentDstate, currentSymbol],
  );

  return (
    <VirtualTable
      columns={columns}
      rows={rows}
      cornerLabel="Dstate"
      height={300}
      aria-label="Dstates and Dtran (Fig 3.36 / 3.37)"
      className="rounded-none border-0"
    />
  );
}

function EclosurePanel({ state, currentStep }: { state: SubsetState; currentStep: { event: SubsetEvent } | null }) {
  const working = state.working;
  const e = currentStep?.event;
  const popped = e && e.kind === 'eclosurePop' ? e.state : null;
  const added = e && e.kind === 'eclosureAdd' ? e.state : null;

  if (!working) {
    return (
      <p className="text-sm text-ink-muted">
        No ε-closure in progress. Turn on <span className="font-medium">micro steps</span> in the
        controls to watch the Fig 3.33 stack algorithm run for every{' '}
        <code className="font-mono">move(T, a)</code>.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink">
        Computing <span className="font-mono">ε-closure</span> of{' '}
        <SetText values={working.input} /> for{' '}
        <span className="font-mono text-ink-muted">{working.context}</span>.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <h4 className="mb-1 text-xs font-semibold text-ink-muted">stack (top on the right)</h4>
          <div className="flex min-h-9 flex-wrap items-center gap-1 rounded-md border border-line bg-raised p-1.5">
            {working.stack.length === 0 ? (
              <span className="px-1 text-xs text-ink-faint">empty — the closure is complete</span>
            ) : (
              working.stack.map((s, i) => (
                <span
                  key={`${s}-${i}`}
                  className={clsx(
                    'flex h-6 min-w-6 items-center justify-center rounded border px-1 font-mono text-xs',
                    i === working.stack.length - 1
                      ? 'border-accent bg-accent-soft text-ink'
                      : 'border-line bg-surface text-ink-muted',
                  )}
                >
                  {s}
                </span>
              ))
            )}
          </div>
        </div>
        <div>
          <h4 className="mb-1 text-xs font-semibold text-ink-muted">closure so far</h4>
          <div className="flex min-h-9 flex-wrap items-center gap-1 rounded-md border border-line bg-raised p-1.5">
            {working.closure.map((s) => (
              <span
                key={s}
                className={clsx(
                  'flex h-6 min-w-6 items-center justify-center rounded border px-1 font-mono text-xs',
                  s === added
                    ? 'border-accent bg-accent-soft text-ink'
                    : s === popped
                      ? 'border-ink-faint bg-surface text-ink'
                      : 'border-line bg-surface text-ink-muted',
                )}
              >
                {s === added ? `+${s}` : s}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SubsetBody({ cls, stepper }: { cls: LexTokenClass; stepper: Stepper<SubsetState, SubsetEvent> }) {
  const { trace, state, currentStep } = stepper;
  const final = useMemo(() => trace.final(), [trace]);

  const graph = useMemo(
    () =>
      dfaGraph(final.states, final.trans, {
        start: final.start,
        // Stable per graph: the accepting token of a D-state never changes.
        labelOf: (id) => {
          const st = final.states.find((s) => s.id === id);
          return st?.accept ? `${id} ◎ ${st.accept.token}` : id;
        },
      }),
    [final],
  );

  const revealed = useMemo(() => {
    const out = new Set<string>();
    for (const s of state.states) out.add(s.id);
    for (const t of state.trans) out.add(dfaEdgeId(t.from, t.to));
    return out;
  }, [state]);

  const current = useMemo(() => {
    const out = new Set<string>();
    const e = currentStep?.event;
    if (!e) return out;
    if (e.kind === 'dstateCreated' || e.kind === 'dstateMarked') out.add(e.id);
    if (e.kind === 'emptyMove') out.add(e.from);
    if (e.kind === 'dtranSet') {
      out.add(e.from);
      out.add(dfaEdgeId(e.from, e.to));
    }
    return out;
  }, [currentStep]);

  // D-states / Dtran entries the construction has not reached yet: laid out
  // with everything else, dimmed until the trace builds them.
  const hidden = useMemo(
    () => elkHiddenIds(graph.nodes, graph.edges, revealed, current),
    [graph, revealed, current],
  );

  const unmarked = state.states.length - state.marked.length;

  return (
    <>
      <Panel
        title="Dstates / Dtran"
        subtitle="Fig 3.36 (the D-states) and Fig 3.37 (the transition table), filled in one entry per step"
        actions={
          <StatChips
            items={[
              ['D-states', String(state.states.length)],
              ['unmarked', String(unmarked)],
              ['alphabet', String(state.alphabet.length)],
            ]}
          />
        }
        bodyClassName="p-0"
      >
        <DstatesTable state={state} currentStep={currentStep} />
        <p className="border-t border-line px-3 py-2 text-xs text-ink-muted">
          ✓ = marked (its transitions are all computed) · ○ = still unmarked in the worklist ·
          ▸ marks the start state. A cell holds <code className="font-mono">Dtran[T, a]</code>;
          empty means the DFA has no move on that symbol.
        </p>
      </Panel>

      <Panel title="ε-closure worklist" subtitle="Fig 3.33 — the stack algorithm">
        <EclosurePanel state={state} currentStep={currentStep} />
      </Panel>

      <Panel
        title="DFA under construction"
        subtitle={`${state.states.length} of ${final.states.length} D-states built`}
        actions={<AutomatonLegend kind="dfa" />}
        bodyClassName="p-0"
      >
        <HeavyGate
          render={isHeavyGraph(graph)}
          title={`${final.states.length} D-states and ${graph.edges.length} edges is a lot to draw`}
          reason={
            <p>
              Every character of the alphabet gets its own transition — nothing merges — so this
              DFA is far denser than the book's five-state example. The Dstates table above holds
              exactly the same information.
            </p>
          }
        >
          <ElkGraph
            nodes={graph.nodes}
            edges={graph.edges}
            visitedIds={revealed}
            currentNodeIds={current}
            currentEdgeIds={current}
            hiddenIds={hidden}
            direction="RIGHT"
            height="24rem"
            className="lex-graph rounded-none border-0"
          />
        </HeavyGate>
        <p className="border-t border-line px-3 py-2 text-xs text-ink-muted">
          Note how many D-states there are: ε-closure(move(A, '0')) and ε-closure(move(A, '1'))
          are different NFA state sets, so the subset construction keeps one state per character.
          Stage 3 is what collapses them — {cls.def.name} minimizes to a handful of states.
        </p>
      </Panel>
    </>
  );
}

export function SubsetView({
  cls,
  initialStep,
  onSelectClass,
}: {
  cls: LexTokenClass;
  initialStep: number | null;
  onSelectClass: (id: TokenClassId) => void;
}) {
  // `id` blows the recorder's 200 000-event cap and would ship a ~100 MB
  // payload across the worker boundary, so it is loaded only on request.
  const [forced, setForced] = useState(false);
  const gated = cls.heavy && !forced;

  const traceState = useLexTrace<SubsetState, SubsetEvent>(
    gated ? null : { kind: 'lex.subset', params: { classIndex: cls.index } },
    subsetReducer,
  );

  if (gated) {
    return (
      <Note
        tone="warn"
        title="This subset construction does not fit in a trace"
        actions={
          <>
            <LabButton emphasis onClick={() => onSelectClass('intconst')}>
              Show digit digit* instead
            </LabButton>
            <LabButton onClick={() => setForced(true)}>Record it anyway (slow)</LabButton>
          </>
        }
      >
        <p>
          <code className="font-mono">{cls.def.display}</code> expands{' '}
          <code className="font-mono">letter</code> into {cls.alphabet.length} literal symbols, and
          Algorithm 3.20 walks the ε-closure stack once per (D-state, symbol) pair. The recording
          runs past the trace recorder's 200 000-event cap and the payload reaches roughly 100 MB —
          it would freeze the tab for a long time.
        </p>
        <p className="mt-1">
          This blow-up is the lesson: production scanners keep transitions on{' '}
          <em>character classes</em> rather than on individual characters. The two constant classes
          run the identical algorithm at a readable size.
        </p>
      </Note>
    );
  }

  if (traceState.status === 'loading' || traceState.status === 'idle') {
    return <LoadingPanel label={`Running the subset construction for ${cls.def.name}…`} />;
  }
  if (traceState.status === 'failed') {
    return (
      <Note tone="error" title="The worker could not record the subset construction">
        {traceState.message}
      </Note>
    );
  }
  if (traceState.status === 'unavailable') {
    return (
      <UnavailablePanel title="No subset-construction trace" diagnostics={traceState.diagnostics}>
        The worker declined to build <code className="font-mono">lex.subset</code> for class index{' '}
        {cls.index}.
      </UnavailablePanel>
    );
  }

  return (
    <TraceSplit
      key={`subset:${cls.index}`}
      trace={traceState.trace}
      title={`Subset construction · ${cls.def.name}`}
      initialStep={initialStep}
      jumpTargets={[
        { label: 'new D-state', predicate: (s) => s.event.kind === 'dstateCreated' },
        { label: 'mark', predicate: (s) => s.event.kind === 'dstateMarked' },
        { label: 'Dtran entry', predicate: (s) => s.event.kind === 'dtranSet' },
        { label: 'done', predicate: (s) => s.event.kind === 'complete' },
      ]}
    >
      {(stepper) => <SubsetBody cls={cls} stepper={stepper} />}
    </TraceSplit>
  );
}

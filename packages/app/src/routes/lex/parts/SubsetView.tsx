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
import { useMemo, useState, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { subsetReducer, type SubsetEvent, type SubsetState } from '@lab/core/lex/reducers.js';
import { ElkGraph, elkHiddenIds } from '../../../components/viz/ElkGraph';
import { FullscreenTransport } from '../../../components/Fullscreen';
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
import { useLexemeRun, type DfaShape } from '../lexemeRun';
import { LexemeRun } from './LexemeRun';
import {
  HeavyGate,
  LabButton,
  LoadingPanel,
  Note,
  Panel,
  Reveal,
  TraceSplit,
  UnavailablePanel,
} from './ui';
import { AutomatonLegend, SetText, StatChips } from './bits';

const SET_COL_W = 260;

function DstatesTable({
  state,
  currentStep,
  controls,
}: {
  state: SubsetState;
  currentStep: { event: SubsetEvent } | null;
  /** Transport, so the table stays steppable once it fills the screen. */
  controls?: ReactNode;
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
      controls={controls}
    />
  );
}

function EclosurePanel({ state, currentStep }: { state: SubsetState; currentStep: { event: SubsetEvent } | null }) {
  const working = state.working;
  const e = currentStep?.event;
  const popped = e && e.kind === 'eclosurePop' ? e.state : null;
  const added = e && e.kind === 'eclosureAdd' ? e.state : null;

  if (!working) {
    return <p className="prose-note text-sm">No closure running. Turn on micro steps.</p>;
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
          <p className="group-label mb-1.5 block">stack (top on the right)</p>
          <div className="framed flex min-h-9 flex-wrap items-center gap-1 p-1.5">
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
          <p className="group-label mb-1.5 block">closure so far</p>
          <div className="framed flex min-h-9 flex-wrap items-center gap-1 p-1.5">
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

function SubsetBody({
  stepper,
  cls,
}: {
  stepper: Stepper<SubsetState, SubsetEvent>;
  cls: LexTokenClass;
}) {
  const { trace, state, currentStep } = stepper;
  const final = useMemo(() => trace.final(), [trace]);

  const acceptIds = useMemo(
    () => new Set(final.states.filter((s) => s.accept !== null).map((s) => s.id)),
    [final],
  );

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

  // The lexeme is walked over the DFA this panel draws, so every state it
  // visits and every transition it takes has something to highlight.
  const walkable = useMemo<DfaShape>(
    () => ({
      start: final.start,
      trans: final.trans,
      isAccepting: (id) => acceptIds.has(id),
    }),
    [final, acceptIds],
  );
  const run = useLexemeRun(cls, walkable);
  const walk = run.walk;

  // D-states / Dtran entries the construction has not reached yet: laid out
  // with everything else, dimmed until the trace builds them. A walked path is
  // never ghosted — the reader asked for it.
  const hidden = useMemo(
    () => elkHiddenIds(graph.nodes, graph.edges, revealed, current, walk?.nodeIds, walk?.edgeIds),
    [graph, revealed, current, walk],
  );

  const unmarked = state.states.length - state.marked.length;

  return (
    <>
      <Panel
        title="Dstates / Dtran"
        subtitle="Fig 3.36 · 3.37"
        actions={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <StatChips
              items={[
                ['D-states', String(state.states.length)],
                ['unmarked', String(unmarked)],
                ['alphabet', String(state.alphabet.length)],
              ]}
            />
            <Reveal label="key">
              <ul className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-2xs text-ink-faint">
                <li>✓ marked</li>
                <li>○ unmarked</li>
                <li>▸ start state</li>
                <li>cell = Dtran[T, a]; empty = no move</li>
              </ul>
            </Reveal>
          </div>
        }
      >
        <DstatesTable
          state={state}
          currentStep={currentStep}
          controls={<FullscreenTransport stepper={stepper} />}
        />
      </Panel>

      <Panel title="ε-closure worklist" subtitle="Fig 3.33">
        <EclosurePanel state={state} currentStep={currentStep} />
      </Panel>

      <Panel
        title="DFA under construction"
        subtitle={`${state.states.length} / ${final.states.length} D-states`}
        actions={
          <Reveal label="key">
            <AutomatonLegend kind="dfa" />
          </Reveal>
        }
      >
        <HeavyGate
          render={isHeavyGraph(graph)}
          title={`${final.states.length} D-states and ${graph.edges.length} edges is a lot to draw`}
          reason={<p>The Dstates table above holds the same information.</p>}
        >
          <ElkGraph
            nodes={graph.nodes}
            edges={graph.edges}
            visitedIds={revealed}
            // A picked lexeme takes the accent: its path is the current thing.
            currentNodeIds={walk ? walk.nodeIds : current}
            currentEdgeIds={walk ? walk.edgeIds : current}
            hiddenIds={hidden}
            direction="RIGHT"
            height="24rem"
            // Fullscreen hides the trace panel; the DFA keeps its own transport.
            controls={<FullscreenTransport stepper={stepper} />}
            className="lex-graph"
          />
        </HeavyGate>
        <LexemeRun cls={cls} model={run} isAccepting={(id) => acceptIds.has(id)} />
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
          {cls.alphabet.length} literal symbols blows past the recorder's 200 000-event cap
          (~100 MB). The constant classes run the same algorithm at a readable size.
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
      initialStep={initialStep}
      jumpTargets={[
        { label: 'new D-state', predicate: (s) => s.event.kind === 'dstateCreated' },
        { label: 'mark', predicate: (s) => s.event.kind === 'dstateMarked' },
        { label: 'Dtran entry', predicate: (s) => s.event.kind === 'dtranSet' },
        { label: 'done', predicate: (s) => s.event.kind === 'complete' },
      ]}
    >
      {(stepper) => <SubsetBody stepper={stepper} cls={cls} />}
    </TraceSplit>
  );
}

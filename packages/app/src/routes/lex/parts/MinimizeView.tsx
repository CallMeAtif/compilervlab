/**
 * Stage 3 of the constructions chain — partition refinement into the
 * minimum-state DFA (Algorithm 3.39, §3.9.6).
 *
 * The partition Π is the star of the view: every group gets a colour AND a
 * pattern swatch, is written {A, C} the way the book writes it, and the DFA
 * graph carries the same swatch on every state so a split is legible at a
 * glance. When a group splits, the distinguishing input symbol is called out
 * and its column in the signature table is patterned.
 *
 * The DFA being refined is rebuilt locally by the same (untraced) subset
 * construction the worker runs — the minimize trace names states but does not
 * carry the transition table for singleton groups.
 */
import { useEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { Scissors } from 'lucide-react';
import { minimizeReducer, type MinimizeEvent, type MinimizeState } from '@lab/core/lex/reducers.js';
import type { Dfa } from '@lab/core/lex/types.js';
import { ElkGraph } from '../../../components/viz/ElkGraph';
import {
  VirtualTable,
  type VTableColumn,
  type VTableRow,
} from '../../../components/viz/VirtualTable';
import type { Stepper } from '../../../lib/useStepper';
import { useLexTrace } from '../useLexTrace';
import { dfaFor, type LexTokenClass } from '../tokenClasses';
import { dfaGraph, isHeavyGraph, showSymbol } from '../graph';
import { HeavyGate, LoadingPanel, Note, Panel, TraceSplit, UnavailablePanel } from './ui';
import { AutomatonLegend, GroupSwatch, StatChips } from './bits';

const DEAD = '∅';

/** Deferred, memoized local build of the DFA the trace refines. */
function useLocalDfa(cls: LexTokenClass): Dfa | null {
  const [dfa, setDfa] = useState<Dfa | null>(null);
  useEffect(() => {
    setDfa(null);
    // Yield a frame first: `id` takes ~180 ms to build and the skeleton must paint.
    const id = window.setTimeout(() => setDfa(dfaFor(cls)), 0);
    return () => window.clearTimeout(id);
  }, [cls]);
  return dfa;
}

function PartitionPanel({
  state,
  splitting,
  acceptOf,
}: {
  state: MinimizeState;
  splitting: readonly string[] | null;
  acceptOf: (id: string) => string | null;
}) {
  if (state.partition.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        The initial partition has not been formed yet — step forward to split the states into
        nonaccepting and accepting groups.
      </p>
    );
  }
  const splittingKey = splitting ? splitting.join(' ') : null;
  return (
    <ul className="flex flex-wrap gap-2">
      {state.partition.map((group, gi) => {
        const token = acceptOf(group[0] ?? '');
        const isSplitting = splittingKey !== null && group.join(' ') === splittingKey;
        return (
          <li
            key={`${gi}:${group.join(',')}`}
            className={clsx(
              'flex min-w-40 flex-col gap-1 rounded-md border px-2.5 py-2',
              isSplitting ? 'border-accent bg-accent-soft' : 'border-line bg-raised',
            )}
          >
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-muted">
              <GroupSwatch group={gi} />
              G{gi}
              {token !== null && (
                <span className="ml-auto inline-flex items-center gap-1 font-mono text-[10px] text-ink-faint">
                  ◎ accepts {token}
                </span>
              )}
              {token === null && (
                <span className="ml-auto font-mono text-[10px] text-ink-faint">nonaccepting</span>
              )}
            </span>
            <span className="font-mono text-xs break-words text-ink">
              {`{${group.join(', ')}}`}
            </span>
            <span className="font-mono text-[10px] text-ink-faint">
              {group.length} state{group.length === 1 ? '' : 's'}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function SignatureTable({
  signatures,
  alphabet,
  distinguishing,
}: {
  signatures: ReadonlyArray<{ state: string; row: ReadonlyArray<{ symbol: string; to: string; group: number }> }>;
  alphabet: readonly string[];
  distinguishing: string | null;
}) {
  const columns = useMemo<VTableColumn[]>(
    () => alphabet.map((a) => ({ key: `s:${a}`, header: showSymbol(a), width: 76 })),
    [alphabet],
  );
  const rows = useMemo<VTableRow[]>(
    () =>
      signatures.map((s) => {
        const cells: VTableRow['cells'] = {};
        for (const c of s.row) {
          cells[`s:${c.symbol}`] = {
            text: `${c.to}·G${c.group}`,
            title: `on '${c.symbol}', ${s.state} → ${c.to}, which is in group G${c.group}`,
            conflict: c.symbol === distinguishing,
          };
        }
        return { id: s.state, header: s.state, cells };
      }),
    [signatures, distinguishing],
  );

  if (signatures.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        No group under examination. Turn on <span className="font-medium">micro steps</span> to see
        each state's signature — the group its transition on every input symbol lands in — as it is
        computed.
      </p>
    );
  }

  return (
    <VirtualTable
      columns={columns}
      rows={rows}
      cornerLabel="state"
      height={Math.min(320, 32 * (rows.length + 1) + 8)}
      aria-label="Signatures of the group under examination"
      className="rounded-none border-0"
    />
  );
}

function MinResultTable({ state }: { state: MinimizeState }) {
  const result = state.result;
  const columns = useMemo<VTableColumn[]>(
    () => [
      { key: '__members', header: 'merged states', width: 200 },
      { key: '__accept', header: 'accepts', width: 90 },
      ...(result?.alphabet ?? []).map((a) => ({ key: `s:${a}`, header: showSymbol(a), width: 46 })),
    ],
    [result],
  );
  const rows = useMemo<VTableRow[]>(() => {
    if (!result) return [];
    const t = new Map<string, string>();
    for (const e of result.trans) t.set(`${e.from} ${e.symbol}`, e.to);
    return result.states.map((s) => {
      const cells: VTableRow['cells'] = {
        __members: { text: `{${s.members.join(', ')}}`, highlight: s.members.length > 1 },
        __accept: { text: s.accept ? `◎ ${s.accept.token}` : '—', highlight: s.accept !== null },
      };
      for (const a of result.alphabet) {
        const to = t.get(`${s.id} ${a}`);
        cells[`s:${a}`] = { text: to ?? '', highlight: to !== undefined };
      }
      return { id: s.id, header: s.id === result.start ? `▸${s.id}` : s.id, cells };
    });
  }, [result]);

  if (!result) {
    return (
      <p className="text-sm text-ink-muted">
        The minimum-state transition table is written once the partition reaches its fixpoint and
        every group has chosen a representative.
      </p>
    );
  }
  return (
    <VirtualTable
      columns={columns}
      rows={rows}
      cornerLabel="state"
      height={Math.min(280, 32 * (rows.length + 1) + 8)}
      aria-label="Minimum-state DFA transition table"
      className="rounded-none border-0"
    />
  );
}

function MinimizeBody({
  cls,
  stepper,
  dfa,
}: {
  cls: LexTokenClass;
  stepper: Stepper<MinimizeState, MinimizeEvent>;
  dfa: Dfa;
}) {
  const { trace, state, index, currentStep } = stepper;
  const e = currentStep?.event ?? null;

  // `split` / `groupUnchanged` clear `working`, so the signatures that justify
  // the decision live in the state one step back.
  const prev = useMemo(() => (index > 0 ? trace.stateAt(index - 1) : trace.initial), [trace, index]);
  const working =
    state.working ?? (e && (e.kind === 'split' || e.kind === 'groupUnchanged') ? prev.working : null);

  const acceptOf = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const s of dfa.states) m.set(s.id, s.accept?.token ?? null);
    return (id: string) => m.get(id) ?? null;
  }, [dfa]);

  const groupOf = useMemo(() => {
    const m = new Map<string, number>();
    state.partition.forEach((g, gi) => g.forEach((s) => m.set(s, gi)));
    return m;
  }, [state.partition]);

  const missing = useMemo(() => {
    const have = new Set(dfa.trans.map((t) => `${t.from} ${t.symbol}`));
    const out: Array<{ from: string; symbol: string; to: string }> = [];
    for (const s of dfa.states) {
      for (const a of dfa.alphabet) {
        if (!have.has(`${s.id} ${a}`)) out.push({ from: s.id, symbol: a, to: DEAD });
      }
    }
    return out;
  }, [dfa]);

  const graph = useMemo(
    () =>
      dfaGraph(dfa.states, [...dfa.trans, ...missing], {
        start: dfa.start,
        extraNodes: missing.length > 0 ? [{ id: DEAD, kind: 'dead' }] : [],
        acceptOf: (id) => acceptOf(id),
        // The group swatch changes every step, so it cannot live in `label`
        // (which ELK hashes). `label` only reserves the box width here; the
        // visible content comes from `decorate`.
        labelOf: (id) => `${id} ▪ G0`,
        decorate: (id) => {
          const g = groupOf.get(id);
          return (
            <span className="flex items-center gap-1.5">
              {g !== undefined && <GroupSwatch group={g} />}
              <span>{id}</span>
              {g !== undefined && <span className="text-[10px] text-ink-faint">G{g}</span>}
            </span>
          );
        },
      }),
    // `groupOf` changes every step: only `reactNode` depends on it, and
    // ElkGraph does not hash reactNode, so the layout is untouched.
    [dfa, missing, acceptOf, groupOf],
  );

  const splitting = e && e.kind === 'split' ? e.from : null;
  const currentNodes = useMemo(() => {
    if (!e) return [];
    if (e.kind === 'split') return e.from;
    if (e.kind === 'groupUnchanged') return e.states;
    if (e.kind === 'signature') return [e.state];
    if (e.kind === 'representative') return e.members;
    return [];
  }, [e]);

  return (
    <>
      <Panel
        title="Partition Π"
        subtitle={`round ${state.round}${state.done ? ' · fixpoint reached' : ''}`}
        actions={
          <StatChips
            items={[
              ['DFA states', String(dfa.states.length)],
              ['groups', String(state.partition.length)],
              ['rounds', String(state.round)],
            ]}
          />
        }
      >
        <PartitionPanel state={state} splitting={splitting} acceptOf={acceptOf} />
        {e && e.kind === 'split' && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-accent bg-accent-soft px-3 py-2 text-sm text-ink">
            <Scissors aria-hidden className="mt-0.5 size-4 shrink-0" />
            <p>
              Distinguishing symbol{' '}
              <code className="rounded bg-surface px-1 font-mono">{showSymbol(e.symbol)}</code>:
              members of <span className="font-mono">{`{${e.from.join(', ')}}`}</span> reach
              different groups on it, so the group splits into{' '}
              {e.into.map((g, i) => (
                <span key={i} className="font-mono">
                  {i > 0 ? ' and ' : ''}
                  {`{${g.join(', ')}}`}
                </span>
              ))}
              .
            </p>
          </div>
        )}
        {state.deadState !== null && (
          <p className="mt-3 text-xs text-ink-muted">
            Algorithm 3.39 needs a transition on every symbol, so the dead state{' '}
            <span className="font-mono">∅</span> (dashed in the graph) absorbs the{' '}
            {missing.length} missing transitions. It is removed again once the fixpoint is reached.
          </p>
        )}
      </Panel>

      <Panel
        title="Signatures of the group under examination"
        subtitle="two states stay together iff every input symbol sends them into the same group of Π"
        bodyClassName="p-0"
      >
        <SignatureTable
          signatures={working?.signatures ?? []}
          alphabet={dfa.alphabet}
          distinguishing={e && e.kind === 'split' ? e.symbol : null}
        />
      </Panel>

      <Panel
        title="The DFA, coloured by group"
        subtitle="the same swatch as the partition above; layout is fixed, only the swatches move"
        actions={<AutomatonLegend kind="dfa" />}
        bodyClassName="p-0"
      >
        <HeavyGate
          render={isHeavyGraph(graph)}
          title={`${dfa.states.length} DFA states and ${graph.edges.length} edges is a lot to draw`}
          reason={
            <p>
              The <code className="font-mono">{cls.def.display}</code> DFA has {dfa.states.length}{' '}
              states over {dfa.alphabet.length} symbols. The partition panel and the signature table
              above tell the whole story without the drawing.
            </p>
          }
        >
          <ElkGraph
            nodes={graph.nodes}
            edges={graph.edges}
            currentNodeIds={currentNodes}
            direction="RIGHT"
            height="24rem"
            className="lex-graph rounded-none border-0"
          />
        </HeavyGate>
      </Panel>

      <Panel
        title="Minimum-state DFA"
        subtitle={
          state.result
            ? `${state.result.states.length} states after ${state.result.rounds} rounds`
            : 'pending'
        }
        bodyClassName="p-0"
      >
        <MinResultTable state={state} />
      </Panel>
    </>
  );
}

export function MinimizeView({
  cls,
  initialStep,
}: {
  cls: LexTokenClass;
  initialStep: number | null;
}) {
  const traceState = useLexTrace<MinimizeState, MinimizeEvent>(
    { kind: 'lex.minimize', params: { classIndex: cls.index } },
    minimizeReducer,
  );
  const dfa = useLocalDfa(cls);

  if (traceState.status === 'loading' || traceState.status === 'idle' || dfa === null) {
    return <LoadingPanel label={`Refining the ${cls.def.name} DFA…`} />;
  }
  if (traceState.status === 'failed') {
    return (
      <Note tone="error" title="The worker could not record the minimization">
        {traceState.message}
      </Note>
    );
  }
  if (traceState.status === 'unavailable') {
    return (
      <UnavailablePanel title="No minimization trace" diagnostics={traceState.diagnostics}>
        The worker declined to build <code className="font-mono">lex.minimize</code> for class index{' '}
        {cls.index}.
      </UnavailablePanel>
    );
  }

  return (
    <TraceSplit
      key={`minimize:${cls.index}`}
      trace={traceState.trace}
      title={`Minimization · ${cls.def.name}`}
      initialStep={initialStep}
      jumpTargets={[
        { label: 'split', predicate: (s) => s.event.kind === 'split' },
        { label: 'fixpoint', predicate: (s) => s.event.kind === 'fixpoint' },
        { label: 'representative', predicate: (s) => s.event.kind === 'representative' },
        { label: 'final table', predicate: (s) => s.event.kind === 'finalTable' },
      ]}
    >
      {(stepper) => <MinimizeBody cls={cls} stepper={stepper} dfa={dfa} />}
    </TraceSplit>
  );
}

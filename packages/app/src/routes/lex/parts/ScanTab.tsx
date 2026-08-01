/**
 * Tab (b) — the scanner driver on the real program (§3.8.1–3.8.3, Fig 3.54).
 *
 * This is the tab that proves the scanner is a DFA simulation and not a pile of
 * regexes: the combined minimized DFA is drawn from the transitions the trace
 * actually takes, the current state is highlighted, `lastAccept` is marked, and
 * the retraction that longest match performs is drawn on the input buffer with
 * the retracted characters struck through.
 */
import { useMemo } from 'react';
import { clsx } from 'clsx';
import { Undo2 } from 'lucide-react';
import type { SourceSpan } from '@lab/trace';
import { scanReducer, type ScanEvent, type ScanState } from '@lab/core/lex/reducers.js';
import type { DtranEntry } from '@lab/core/lex/types.js';
import { CodeStrip } from '../../../components/viz/CodeStrip';
import { ElkGraph, elkHiddenIds } from '../../../components/viz/ElkGraph';
import type { Stepper } from '../../../lib/useStepper';
import { useLexTrace } from '../useLexTrace';
import { dfaEdgeId, dfaGraph } from '../graph';
import { LoadingPanel, Note, Panel, TraceSplit, UnavailablePanel } from './ui';
import { AutomatonLegend, InputTape, StatChips, TokenChip } from './bits';
import { spanAt } from '../source';

/** The part of the combined DFA this program exercises, derived once per trace. */
function useScannedDfa(steps: ReadonlyArray<{ event: ScanEvent }>) {
  return useMemo(() => {
    const states = new Set<string>();
    const accepts = new Map<string, string>();
    const trans: DtranEntry[] = [];
    const seen = new Set<string>();
    let start: string | null = null;

    for (const { event } of steps) {
      if (event.kind === 'tokenStart') {
        states.add(event.dfaState);
        start ??= event.dfaState;
      } else if (event.kind === 'advance') {
        states.add(event.from);
        states.add(event.to);
        if (event.accepting !== null) accepts.set(event.to, event.accepting);
        const k = `${event.from} ${event.ch} ${event.to}`;
        if (!seen.has(k)) {
          seen.add(k);
          trans.push({ from: event.from, symbol: event.ch, to: event.to });
        }
      }
    }
    return { states: [...states], accepts, trans, start };
  }, [steps]);
}

function ScanBody({ source, stepper }: { source: string; stepper: Stepper<ScanState, ScanEvent> }) {
  const { trace, state, currentStep } = stepper;
  const dfa = useScannedDfa(trace.steps);

  const emitStepOf = useMemo(() => {
    const m = new Map<number, number>();
    trace.steps.forEach((s) => {
      if (s.event.kind === 'tokenEmitted') m.set(s.event.token.index, s.index);
    });
    return m;
  }, [trace]);

  const graph = useMemo(
    () =>
      dfaGraph(
        dfa.states.map((id) => ({ id, accept: null })),
        dfa.trans,
        {
          start: dfa.start,
          acceptOf: (id) => dfa.accepts.get(id) ?? null,
          // Stable per graph: which token a state accepts is a fact about the
          // DFA, not about the step.
          labelOf: (id) => {
            const token = dfa.accepts.get(id);
            return token ? `${id} ◎ ${token}` : id;
          },
        },
      ),
    [dfa],
  );

  const cursor = state.current;
  const e = currentStep?.event ?? null;
  const rollback =
    e && e.kind === 'rollback'
      ? { from: e.fromPos, to: e.toPos, reason: e.reason, toState: e.toState }
      : null;

  const stateSet = useMemo(() => new Set(dfa.states), [dfa.states]);
  const currentNodes = useMemo(() => {
    const s = cursor?.dfaState;
    return s && stateSet.has(s) ? [s] : [];
  }, [cursor, stateSet]);

  /** `keyword` / `id` / `charconst:*` are not states of the combined DFA. */
  const pseudoStateNote =
    cursor && !stateSet.has(cursor.dfaState)
      ? cursor.dfaState === 'keyword' || cursor.dfaState === 'id'
        ? 'keyword-table lookup — §3.4.2, not a DFA state'
        : cursor.dfaState.startsWith('charconst:')
          ? 'dedicated character-constant automaton — §3.4.4'
          : 'not a state of the combined DFA'
      : null;

  const currentEdges = useMemo(
    () => (e && e.kind === 'advance' ? [dfaEdgeId(e.from, e.to)] : []),
    [e],
  );

  const visited = useMemo(() => {
    // Everything the program has exercised *so far*: nodes and merged edges.
    const out = new Set<string>();
    const upTo = stepper.index;
    for (let i = 0; i < upTo; i++) {
      const ev = trace.steps[i]!.event;
      if (ev.kind === 'tokenStart') out.add(ev.dfaState);
      else if (ev.kind === 'advance') {
        out.add(ev.from);
        out.add(ev.to);
        out.add(dfaEdgeId(ev.from, ev.to));
      }
    }
    return out;
  }, [trace, stepper.index]);

  const hidden = useMemo(
    () => elkHiddenIds(graph.nodes, graph.edges, visited, currentNodes, currentEdges),
    [graph, visited, currentNodes, currentEdges],
  );

  // The lexeme so far, plus a true zero-width caret at `forward`. When
  // lexemeBegin === forward the lexeme is empty: that is a cursor position, not
  // a one-character span, and CodeStrip now draws it as one.
  const spans = useMemo<SourceSpan[]>(() => {
    if (cursor) return [spanAt(source, cursor.startPos, Math.max(cursor.startPos, state.pos))];
    const last = state.tokens[state.tokens.length - 1];
    if (last) return [last.span];
    return [];
  }, [cursor, source, state]);

  const carets = useMemo(() => [Math.min(state.pos, source.length)], [state.pos, source.length]);

  const lastEmitted = state.tokens[state.tokens.length - 1];

  return (
    <>
      <Panel
        title="Source under the scanner"
        subtitle={`character ${state.pos} of ${source.length}`}
        actions={
          <StatChips
            items={[
              ['tokens', String(state.tokens.length)],
              ['identifiers', String(state.symbols.length)],
              ['errors', String(state.errors.length)],
            ]}
          />
        }
        bodyClassName="p-0"
      >
        <CodeStrip
          source={source}
          spans={spans}
          carets={carets}
          maxHeight="14rem"
          className="rounded-none border-0"
        />
        <div className="border-t border-line p-3">
          <InputTape
            source={source}
            pos={state.pos}
            start={cursor?.startPos ?? null}
            lastAccept={cursor?.lastAccept?.pos ?? null}
            retracted={rollback}
          />
          <p className="mt-2 text-xs text-ink-muted">
            The two pointers of §3.2: <span className="font-mono">lexemeBegin</span> stays at the
            start of the token, <span className="font-mono">forward</span> runs ahead through the
            DFA. When the DFA dies, forward retracts to{' '}
            <span className="font-mono">lastAccept</span>.
          </p>
        </div>
      </Panel>

      <Panel
        title="Scanner state"
        subtitle="Fig 3.54 — simulate, remember the last accepting state, retract on failure"
      >
        {rollback && (
          <div className="mb-3 flex items-start gap-2 rounded-md border border-warn/60 bg-warn-soft px-3 py-2 text-sm text-warn">
            <Undo2 aria-hidden className="mt-0.5 size-4 shrink-0" />
            <p>
              <span className="font-semibold">Retraction.</span>{' '}
              {rollback.reason === 'endOfInput' ? (
                <>
                  The input ran out at position <span className="font-mono">{rollback.from}</span>{' '}
                  in a non-accepting state,
                </>
              ) : (
                <>
                  The DFA had no move at position <span className="font-mono">{rollback.from}</span>
                  ,
                </>
              )}{' '}
              so forward is pushed back to <span className="font-mono">{rollback.to}</span> — the
              last position where an accepting state was seen, and the machine is back in state{' '}
              <span className="font-mono">{rollback.toState}</span>. The struck-through characters
              above are re-scanned as part of the next token. That is the longest-match rule.
            </p>
          </div>
        )}
        <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1.5 font-mono text-xs">
          <dt className="text-ink-muted">DFA state</dt>
          <dd className="text-ink">
            {cursor ? (
              <span
                className={clsx(
                  'rounded border px-1.5 py-0.5',
                  currentNodes.length > 0
                    ? 'border-accent bg-accent-soft'
                    : 'border-line-strong bg-raised',
                )}
              >
                {cursor.dfaState}
              </span>
            ) : (
              <span className="text-ink-faint">between tokens</span>
            )}
            {pseudoStateNote && (
              <span className="ml-2 text-[10px] text-ink-faint">{pseudoStateNote}</span>
            )}
          </dd>
          <dt className="text-ink-muted">lexemeBegin</dt>
          <dd className="text-ink">{cursor ? cursor.startPos : '—'}</dd>
          <dt className="text-ink-muted">forward</dt>
          <dd className="text-ink">{state.pos}</dd>
          <dt className="text-ink-muted">lexeme so far</dt>
          <dd className="text-ink">{cursor ? `"${cursor.lexeme}"` : '—'}</dd>
          <dt className="text-ink-muted">lastAccept</dt>
          <dd className={cursor?.lastAccept ? 'text-ink' : 'text-ink-faint'}>
            {cursor?.lastAccept
              ? `${cursor.lastAccept.token} @ ${cursor.lastAccept.pos}`
              : 'none yet — the DFA has not passed an accepting state'}
          </dd>
        </dl>
      </Panel>

      <Panel
        title="The combined DFA, live"
        subtitle={`${dfa.states.length} states exercised by this program`}
        actions={<AutomatonLegend kind="dfa" />}
        bodyClassName="p-0"
      >
        <ElkGraph
          nodes={graph.nodes}
          edges={graph.edges}
          visitedIds={visited}
          currentNodeIds={currentNodes}
          currentEdgeIds={currentEdges}
          hiddenIds={hidden}
          direction="RIGHT"
          height="22rem"
          className="lex-graph rounded-none border-0"
        />
        <p className="border-t border-line px-3 py-2 text-xs text-ink-muted">
          Drawn from the transitions this program actually takes through the scanner's minimized
          DFA — states it never reaches are not shown. Edge labels condense the characters that
          share a transition.
        </p>
      </Panel>

      <Panel
        title="Token stream"
        subtitle={lastEmitted ? `last: ${lastEmitted.type} "${lastEmitted.lexeme}"` : 'nothing emitted yet'}
      >
        {state.tokens.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No tokens yet — each one appears the moment Fig 3.54 emits it.
          </p>
        ) : (
          <div className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto">
            {state.tokens.map((t) => (
              <TokenChip
                key={t.index}
                token={t}
                active={t.index === lastEmitted?.index}
                onClick={() => {
                  const at = emitStepOf.get(t.index);
                  if (at !== undefined) stepper.jumpTo(at + 1);
                }}
              />
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}

export function ScanTab({
  source,
  compilationId,
  initialStep,
}: {
  source: string;
  compilationId: string;
  initialStep: number | null;
}) {
  const traceState = useLexTrace<ScanState, ScanEvent>(
    { kind: 'lex.scan', params: { source } },
    scanReducer,
  );

  if (traceState.status === 'loading' || traceState.status === 'idle') {
    return <LoadingPanel label="Running the scanner over your source…" />;
  }
  if (traceState.status === 'failed') {
    return (
      <Note tone="error" title="The worker could not record the scan">
        {traceState.message}
      </Note>
    );
  }
  if (traceState.status === 'unavailable') {
    return (
      <UnavailablePanel title="No scan trace" diagnostics={traceState.diagnostics}>
        A lexical error is a step in this trace rather than a reason to withhold it, so this is
        unexpected — the diagnostics above are what the worker reported.
      </UnavailablePanel>
    );
  }

  return (
    <TraceSplit
      key={`scan:${compilationId}`}
      trace={traceState.trace}
      title="Scanner driver"
      initialStep={initialStep}
      jumpTargets={[
        { label: 'token', predicate: (s) => s.event.kind === 'tokenEmitted' },
        { label: 'retraction', predicate: (s) => s.event.kind === 'rollback' },
        { label: 'keyword', predicate: (s) => s.event.kind === 'keywordLookup' },
        { label: 'error', predicate: (s) => s.event.kind === 'lexError' },
      ]}
    >
      {(stepper) => <ScanBody source={source} stepper={stepper} />}
    </TraceSplit>
  );
}

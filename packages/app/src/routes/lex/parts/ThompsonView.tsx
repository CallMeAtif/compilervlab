/**
 * Stage 1 of the constructions chain — Thompson's construction
 * (Algorithm 3.23, §3.7.4): the regex parse tree on the left, the NFA it
 * induces growing fragment-by-fragment on the right.
 *
 * The NFA graph is handed the FINAL automaton every render so ELK lays it out
 * once; each step only moves state/edge ids into the revealed and current sets.
 */
import { useMemo } from 'react';
import type { RegexAst } from '@lab/core/csubset/regex.js';
import {
  thompsonReducer,
  type ThompsonEvent,
  type ThompsonState,
} from '@lab/core/lex/reducers.js';
import { ElkGraph, elkHiddenIds } from '../../../components/viz/ElkGraph';
import { TidyTree, type TidyTreeNode } from '../../../components/viz/TidyTree';
import { FullscreenTransport } from '../../../components/Fullscreen';
import type { Stepper } from '../../../lib/useStepper';
import { useLexTrace } from '../useLexTrace';
import type { LexTokenClass } from '../tokenClasses';
import { isHeavyGraph, nfaEdgeId, nfaGraph, showSymbol } from '../graph';
import { HeavyGate, LoadingPanel, Note, Panel, Reveal, TraceSplit, UnavailablePanel } from './ui';
import { AutomatonLegend, StatChips } from './bits';

function regexTree(node: RegexAst): TidyTreeNode {
  switch (node.kind) {
    case 'char':
      return { id: String(node.id), label: showSymbol(node.ch), kind: 'char' };
    case 'epsilon':
      return { id: String(node.id), label: 'ε', kind: 'epsilon' };
    case 'star':
      return { id: String(node.id), label: '*', kind: 'star', children: [regexTree(node.inner)] };
    case 'concat':
      return {
        id: String(node.id),
        label: '·',
        kind: 'concat',
        children: [regexTree(node.left), regexTree(node.right)],
      };
    case 'union':
      return {
        id: String(node.id),
        label: '|',
        kind: 'union',
        children: [regexTree(node.left), regexTree(node.right)],
      };
  }
}

/** Step meta, not standing copy: this line changes on every step. */
const RULE_NAME: Record<ThompsonEvent['kind'], string> = {
  leafChar: 'Rule 2 · N(a)',
  leafEpsilon: 'Rule 1 · N(ε)',
  union: 'Rule 3 · N(s|t)',
  concat: 'Rule 4 · N(st)',
  star: 'Rule 5 · N(s*)',
  complete: 'complete',
};

function ThompsonBody({
  cls,
  stepper,
}: {
  cls: LexTokenClass;
  stepper: Stepper<ThompsonState, ThompsonEvent>;
}) {
  const { trace, state, index, currentStep } = stepper;
  const final = useMemo(() => trace.final(), [trace]);
  const prev = useMemo(() => (index > 0 ? trace.stateAt(index - 1) : trace.initial), [trace, index]);

  const tree = useMemo(() => regexTree(cls.def.regex), [cls]);

  const visitedRegexIds = useMemo(() => {
    const out = new Set<string>();
    for (let i = 0; i < index; i++) {
      const e = trace.steps[i]!.event;
      if ('regexNodeId' in e) out.add(String(e.regexNodeId));
    }
    return out;
  }, [trace, index]);

  const currentRegexIds = useMemo(() => {
    const e = currentStep?.event;
    return e && 'regexNodeId' in e ? [String(e.regexNodeId)] : [];
  }, [currentStep]);

  const graph = useMemo(
    () => nfaGraph(final.states, final.edges, final.start, final.accept),
    [final],
  );

  const revealed = useMemo(() => {
    const out = new Set<string>();
    for (const s of state.states) out.add(String(s));
    for (let i = 0; i < state.edges.length; i++) out.add(nfaEdgeId(i));
    return out;
  }, [state]);

  const current = useMemo(() => {
    const out = new Set<string>();
    const e = currentStep?.event;
    if (!e) return out;
    if ('createdStates' in e) for (const s of e.createdStates) out.add(String(s));
    for (let i = prev.edges.length; i < state.edges.length; i++) out.add(nfaEdgeId(i));
    return out;
  }, [currentStep, prev, state]);

  // Everything the construction has NOT produced yet stays laid out but dimmed
  // (ElkGraph `hiddenIds`) — the graph is measured once, never re-laid-out.
  const hidden = useMemo(
    () => elkHiddenIds(graph.nodes, graph.edges, revealed, current),
    [graph, revealed, current],
  );

  const built = state.states.length;

  // Fullscreen drops the trace panel, so every stepped artifact on this view
  // carries the transport itself. One bar object, shared: the stepper is the
  // same one, and only the artifact that is actually fullscreen renders it.
  const bar = <FullscreenTransport stepper={stepper} />;

  return (
    <>
      <Panel
        title="Regex parse tree"
        subtitle={<code className="font-mono">{cls.def.display}</code>}
        actions={
          <StatChips
            items={[
              ['alphabet', String(cls.alphabet.length)],
              ['NFA states', `${built} / ${final.states.length}`],
            ]}
          />
        }
      >
        <TidyTree
          root={tree}
          currentIds={currentRegexIds}
          visitedIds={visitedRegexIds}
          controls={bar}
          className="max-h-[22rem]"
        />
      </Panel>

      <Panel
        title="NFA under construction"
        subtitle={currentStep ? RULE_NAME[currentStep.event.kind] : 'nothing built yet'}
        actions={
          <Reveal label="key">
            <AutomatonLegend kind="nfa" />
          </Reveal>
        }
      >
        <HeavyGate
          render={isHeavyGraph(graph)}
          title={`${final.states.length} NFA states is a lot to draw`}
          reason={
            <p>
              {cls.alphabet.length} character alternatives → {final.states.length} states,{' '}
              {final.edges.length} edges. Only the drawing is held back.
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
            height="26rem"
            controls={bar}
            className="lex-graph"
          />
        </HeavyGate>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-line pt-2 font-mono text-2xs text-ink-faint">
          <dt>fragment start</dt>
          <dd className="text-ink">
            {currentStep && 'start' in currentStep.event ? currentStep.event.start : '—'}
          </dd>
          <dt>fragment accept</dt>
          <dd className="text-ink">
            {currentStep && 'end' in currentStep.event
              ? currentStep.event.end
              : currentStep && 'accept' in currentStep.event
                ? currentStep.event.accept
                : '—'}
          </dd>
          <dt>states so far</dt>
          <dd className="text-ink">{built}</dd>
        </dl>
      </Panel>
    </>
  );
}

export function ThompsonView({
  cls,
  initialStep,
}: {
  cls: LexTokenClass;
  initialStep: number | null;
}) {
  const traceState = useLexTrace<ThompsonState, ThompsonEvent>(
    { kind: 'lex.thompson', params: { classIndex: cls.index } },
    thompsonReducer,
  );

  if (traceState.status === 'loading' || traceState.status === 'idle') {
    return <LoadingPanel label={`Building the Thompson NFA for ${cls.def.name}…`} />;
  }
  if (traceState.status === 'failed') {
    return (
      <Note tone="error" title="The worker could not record this construction">
        {traceState.message}
      </Note>
    );
  }
  if (traceState.status === 'unavailable') {
    return (
      <UnavailablePanel
        title="No Thompson trace for this token class"
        diagnostics={traceState.diagnostics}
      >
        The worker declined to build <code className="font-mono">lex.thompson</code> for class
        index {cls.index}.
      </UnavailablePanel>
    );
  }

  return (
    <TraceSplit
      key={`thompson:${cls.index}`}
      trace={traceState.trace}
      initialStep={initialStep}
      jumpTargets={[
        { label: 'union', predicate: (s) => s.event.kind === 'union' },
        { label: 'concat', predicate: (s) => s.event.kind === 'concat' },
        { label: 'star', predicate: (s) => s.event.kind === 'star' },
        { label: 'complete', predicate: (s) => s.event.kind === 'complete' },
      ]}
    >
      {(stepper) => <ThompsonBody cls={cls} stepper={stepper} />}
    </TraceSplit>
  );
}

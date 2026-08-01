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
import type { Stepper } from '../../../lib/useStepper';
import { useLexTrace } from '../useLexTrace';
import type { LexTokenClass } from '../tokenClasses';
import { isHeavyGraph, nfaEdgeId, nfaGraph, showSymbol } from '../graph';
import { HeavyGate, LoadingPanel, Note, Panel, TraceSplit, UnavailablePanel } from './ui';
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

const RULE_NAME: Record<ThompsonEvent['kind'], string> = {
  leafChar: 'Rule 2 — N(a): a single labelled edge',
  leafEpsilon: 'Rule 1 — N(ε): a single ε edge',
  union: 'Rule 3 — N(s|t): a new start and accept joined by four ε edges',
  concat: 'Rule 4 — N(st): accept of N(s) is merged with start of N(t)',
  star: 'Rule 5 — N(s*): a new start/accept pair plus the loop-back ε edge',
  complete: 'The NFA is complete — one start state, one accepting state',
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
        bodyClassName="p-0"
      >
        <TidyTree
          root={tree}
          currentIds={currentRegexIds}
          visitedIds={visitedRegexIds}
          className="max-h-[22rem] border-0"
        />
        <p className="border-t border-line px-3 py-2 text-xs text-ink-muted">
          Thompson's construction walks this tree bottom-up. The highlighted node is the
          sub-expression whose NFA fragment the current step builds; filled nodes are already
          translated. Click any node to collapse its subtree.
        </p>
      </Panel>

      <Panel
        title="NFA under construction"
        subtitle={
          currentStep
            ? RULE_NAME[currentStep.event.kind]
            : 'Nothing built yet — step forward to translate the first leaf'
        }
        actions={<AutomatonLegend kind="nfa" />}
        bodyClassName="p-0"
      >
        <HeavyGate
          render={isHeavyGraph(graph)}
          title={`${final.states.length} NFA states is a lot to draw`}
          reason={
            <>
              <p>
                <code className="font-mono">letter</code> expands to{' '}
                {cls.alphabet.length} character alternatives, so Thompson's construction produces{' '}
                {final.states.length} states and {final.edges.length} edges. The layout is computed
                once and then only re-highlighted, but the first layout takes a moment.
              </p>
              <p className="mt-1">
                The step list, the parse tree and the citations all work regardless — this gate
                only holds back the drawing.
              </p>
            </>
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
            className="lex-graph rounded-none border-0"
          />
        </HeavyGate>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-line px-3 py-2 font-mono text-xs text-ink-muted">
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
      title={`Thompson's construction · ${cls.def.name}`}
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

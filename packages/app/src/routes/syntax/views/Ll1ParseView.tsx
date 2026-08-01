/**
 * Table-driven predictive parse — §4.4.4, Algorithm 4.34 (Fig 4.19/4.21).
 *
 * The three-column moves table (matched · stack · input · action) is exactly
 * Fig 4.21, and it is synchronized with the parse tree the expansions build.
 */
import { useMemo } from 'react';
import type { Trace } from '@lab/trace';
import { isNonterminal } from '@lab/core/grammar/grammar.js';
import {
  ll1ParseReducer,
  type LL1ParseEvent,
  type LL1ParseState,
  type LL1ParseTreeNode,
} from '@lab/core/grammar/ll1-parse.js';
import { useStepper } from '../../../lib/useStepper';
import { FullscreenTransport } from '../../../components/Fullscreen';
import { useTrace } from '../lib/useTrace';
import type { ViewContext } from '../lib/view';
import { GrammarRail, productionRefs } from '../components/GrammarRail';
import { ViewGrid } from '../components/Layout';
import { Diagnostics, Note, Panel, Skeleton, StepPanel, Stat } from '../components/ui';
import { InputRibbon, MoveTable, TreePanel, useForest } from '../components/parse';
import { NoParseInput, TopDownBlocked, isTopDownBlocked } from './guards';

export function Ll1ParseView(ctx: ViewContext) {
  const noInput = ctx.source.trim().length === 0;
  const blocked = isTopDownBlocked(ctx) || noInput;
  const { trace, phase, diagnostics } = useTrace<LL1ParseState, LL1ParseEvent>(
    'syntax.ll1-parse',
    blocked ? null : { grammarId: ctx.grammarId, source: ctx.source },
    ll1ParseReducer,
  );

  if (isTopDownBlocked(ctx)) {
    return (
      <TopDownBlocked
        ctx={ctx}
        algorithm="predictive parse"
        onGoToTransforms={() => ctx.selectAlgo('transforms')}
      />
    );
  }
  if (noInput) return <NoParseInput ctx={ctx} />;
  if (trace) return <Ready ctx={ctx} trace={trace} />;
  if (phase === 'unavailable') {
    return <Diagnostics title="This sentence could not be parsed predictively" diagnostics={diagnostics} />;
  }
  return <Skeleton label="Running the predictive parser…" />;
}

function Ready({ ctx, trace }: { ctx: ViewContext; trace: Trace<LL1ParseState, LL1ParseEvent> }) {
  const stepper = useStepper(trace, ctx.stepperOptions);
  const state = stepper.state;
  const g = ctx.grammar;

  const ev = stepper.currentStep?.event ?? null;
  const currentIds = useMemo(() => {
    if (!ev) return [];
    if (ev.kind === 'll1p.expand') return [`n${ev.node}`, ...ev.children.map((c) => `n${c}`)];
    return [];
  }, [ev]);

  const { root, count } = useForest<LL1ParseTreeNode>(
    state.nodes,
    [0],
    (n) => n.symbol,
    (n) => (n.symbol === 'ε' ? 'epsilon' : isNonterminal(g, n.symbol) ? 'nonterminal' : 'terminal'),
  );

  const stackTop = state.stack[state.stack.length - 1];

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
            title="Moves (Fig 4.21)"
            subtitle={`${state.log.length} row${state.log.length === 1 ? '' : 's'} · ${state.status}`}
            bodyClassName="flex flex-col gap-3"
          >
            <InputRibbon symbols={state.input} pos={state.pos} />
            <MoveTable
              ariaLabel="Predictive parser moves"
              columns={[
                { key: 'matched', header: 'Matched' },
                { key: 'stack', header: 'Stack (top → bottom)', grow: true },
                { key: 'input', header: 'Input' },
                { key: 'action', header: 'Action', grow: true },
              ]}
              rows={state.log}
            />
          </Panel>

          <Panel
            title="Parse tree"
            subtitle={`${count} node${count === 1 ? '' : 's'} so far`}
                      >
            <TreePanel
              root={root}
              nodeCount={count}
              currentIds={currentIds}
              emptyLabel="Step forward to expand the start symbol."
              controls={<FullscreenTransport stepper={stepper} />}
            />
          </Panel>
        </>
      }
      panel={
        <StepPanel
          stepper={stepper}
          jumps={[
            { label: 'next expansion', pred: (s) => s.event.kind === 'll1p.expand' },
            { label: 'next match', pred: (s) => s.event.kind === 'll1p.match' },
            { label: 'conflict note', pred: (s) => s.event.kind === 'll1p.note' },
            { label: 'error', pred: (s) => s.event.kind === 'll1p.error' },
          ]}
        >
          <Panel title="Configuration" bodyClassName="flex flex-col gap-3">
            <div className="flex flex-wrap gap-x-4 gap-y-1 pb-1">
              <Stat label="top of stack" value={stackTop?.sym ?? '—'} />
              <Stat
                label="lookahead"
                value={state.pos < state.input.length ? state.input[state.pos]! : '$'}
              />
              <Stat label="status" value={state.status} />
            </div>
            <p className="font-mono text-[11px] break-all text-ink-muted">
              stack: {[...state.stack].reverse().map((e) => e.sym).join(' ')}
            </p>
            {state.notes.length > 0 && (
              <Note tone="warn" title={`${state.notes.length} conflict resolution(s)`}>
                <ul className="flex flex-col gap-1 text-xs">
                  {state.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </Note>
            )}
            {state.error && (
              <Note
                tone="error"
                title={
                  state.error.kind === 'divergence' ? 'Parse did not terminate' : 'Syntax error'
                }
              >
                <p>{state.error.message}</p>
                <p className="mt-1 font-mono text-xs">
                  found ‘{state.error.found}’
                  {state.error.expected.length > 0
                    ? ` · expected { ${state.error.expected.join(', ')} }`
                    : ''}{' '}
                  · at position {state.error.pos}
                </p>
              </Note>
            )}
            {state.status === 'accepted' && (
              <Note tone="info" title="Accepted">
                Stack and input hit $ together. The tree is the leftmost derivation.
              </Note>
            )}
          </Panel>
        </StepPanel>
      }
    />
  );
}

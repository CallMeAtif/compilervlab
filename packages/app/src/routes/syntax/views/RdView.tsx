/**
 * Recursive descent — §4.4.1 (Fig 4.13/4.14).
 *
 * The visualization is the call tree as it grows, plus the live call stack: one
 * procedure per nonterminal, entered on `call`, committed to an alternative on
 * `select` (with the lookahead that justified it), and popped on `return`.
 */
import { useMemo } from 'react';
import type { Trace } from '@lab/trace';
import { formatProduction, isNonterminal } from '@lab/core/grammar/grammar.js';
import {
  rdReducer,
  type RDEvent,
  type RDNode,
  type RDState,
} from '@lab/core/grammar/recursive-descent.js';
import { useStepper } from '../../../lib/useStepper';
import { useTrace } from '../lib/useTrace';
import type { ViewContext } from '../lib/view';
import { GrammarRail, productionRefs } from '../components/GrammarRail';
import { ViewGrid } from '../components/Layout';
import { Diagnostics, Note, Panel, Skeleton, StepPanel, Stat } from '../components/ui';
import { InputRibbon, TreePanel, useForest } from '../components/parse';
import { NoParseInput, TopDownBlocked, isTopDownBlocked } from './guards';

export function RdView(ctx: ViewContext) {
  const noInput = ctx.source.trim().length === 0;
  const blocked = isTopDownBlocked(ctx) || noInput;
  const { trace, phase, diagnostics } = useTrace<RDState, RDEvent>(
    'syntax.rd',
    blocked ? null : { grammarId: ctx.grammarId, source: ctx.source },
    rdReducer,
  );

  if (isTopDownBlocked(ctx)) {
    return (
      <TopDownBlocked
        ctx={ctx}
        algorithm="recursive-descent parser"
        onGoToTransforms={() => ctx.selectAlgo('transforms')}
      />
    );
  }
  if (noInput) return <NoParseInput ctx={ctx} />;
  if (trace) return <Ready ctx={ctx} trace={trace} />;
  if (phase === 'unavailable') {
    return <Diagnostics title="The recursive-descent parse could not be run" diagnostics={diagnostics} />;
  }
  return <Skeleton label="Running the recursive-descent parser…" />;
}

function Ready({ ctx, trace }: { ctx: ViewContext; trace: Trace<RDState, RDEvent> }) {
  const stepper = useStepper(trace, ctx.stepperOptions);
  const state = stepper.state;
  const g = ctx.grammar;

  const ev = stepper.currentStep?.event ?? null;
  const currentIds = useMemo(() => {
    if (!ev) return [];
    if (ev.kind === 'rd.call' || ev.kind === 'rd.select' || ev.kind === 'rd.return') return [`n${ev.node}`];
    if (ev.kind === 'rd.match') return [`n${ev.node}`, `n${ev.parent}`];
    if (ev.kind === 'rd.error') return [`n${ev.node}`];
    return [];
  }, [ev]);

  const visitedIds = useMemo(
    () => state.nodes.filter((n) => n.status === 'done').map((n) => `n${n.id}`),
    [state.nodes],
  );

  const { root, count } = useForest<RDNode>(
    state.nodes,
    state.nodes.length > 0 ? [0] : [],
    (n) => n.symbol,
    (n) => (n.status === 'leaf' ? 'terminal' : n.status),
  );

  const callStack = useMemo(() => state.nodes.filter((n) => n.status === 'active'), [state.nodes]);
  const selected =
    ev && ev.kind === 'rd.select'
      ? { production: g.productions[ev.production.id] ?? null, lookahead: ev.lookahead, why: ev.justification }
      : null;

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
          <Panel title="Input" bodyClassName="flex flex-col gap-2">
            <InputRibbon symbols={state.input} pos={state.pos} label="Token stream" />
          </Panel>
          <Panel
            title="Call tree"
            subtitle={`${count} node${count === 1 ? '' : 's'} · ${callStack.length} procedure${callStack.length === 1 ? '' : 's'} on the stack`}
            bodyClassName="p-2"
          >
            <TreePanel
              root={root}
              nodeCount={count}
              currentIds={currentIds}
              visitedIds={visitedIds}
              emptyLabel="Step forward to call the procedure for the start symbol."
            />
          </Panel>
        </>
      }
      panel={
        <StepPanel
          stepper={stepper}
          jumps={[
            { label: 'next call', pred: (s) => s.event.kind === 'rd.call' },
            { label: 'next choice', pred: (s) => s.event.kind === 'rd.select' },
            { label: 'ambiguity note', pred: (s) => s.event.kind === 'rd.note' },
            { label: 'error', pred: (s) => s.event.kind === 'rd.error' },
          ]}
        >
          <Panel title="Chosen production" bodyClassName="flex flex-col gap-2">
            {selected?.production ? (
              <>
                <p className="font-mono text-sm text-ink">
                  <span className="mr-2 text-[10px] text-ink-faint">p{selected.production.id}</span>
                  {formatProduction(selected.production)}
                </p>
                <p className="text-xs leading-relaxed text-ink-muted">
                  Lookahead <span className="font-mono text-ink">{selected.lookahead}</span> —{' '}
                  {selected.why}.
                </p>
              </>
            ) : (
              <p className="text-xs leading-relaxed text-ink-muted">
                On <span className="font-mono">select</span> steps this shows the alternative the
                lookahead picked and the FIRST/FOLLOW membership that justified it.
              </p>
            )}
          </Panel>

          <Panel title="Call stack" bodyClassName="flex flex-col gap-2">
            <div className="flex flex-wrap gap-1.5">
              <Stat label="pos" value={`${state.pos} / ${state.input.length}`} />
              <Stat
                label="lookahead"
                value={state.pos < state.input.length ? state.input[state.pos]! : '$'}
              />
              <Stat label="status" value={state.status} />
            </div>
            <ol className="flex max-h-48 flex-col gap-0.5 overflow-auto rounded-md border border-line bg-canvas p-1.5 font-mono text-[11px]">
              {callStack.map((n, i) => (
                <li key={n.id} className="flex items-baseline gap-2">
                  <span className="text-ink-faint">{i}</span>
                  <span className={isNonterminal(g, n.symbol) ? 'text-ink' : 'text-ink-muted'}>
                    {n.symbol}
                  </span>
                  {n.production !== null && (
                    <span className="text-ink-faint">p{n.production}</span>
                  )}
                </li>
              ))}
              {callStack.length === 0 && <li className="text-ink-faint">(empty)</li>}
            </ol>
            {state.notes.length > 0 && (
              <Note tone="warn" title={`${state.notes.length} ambiguity note(s)`}>
                <ul className="flex flex-col gap-1 text-xs">
                  {state.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </Note>
            )}
            {state.error && (
              <Note tone="error" title="Syntax error">
                <p>{state.error.message}</p>
                <p className="mt-1 font-mono text-xs">
                  expected {`{ ${state.error.expected.join(', ')} }`} · found ‘{state.error.found}’
                </p>
              </Note>
            )}
            {state.status === 'accepted' && (
              <Note tone="info" title="Accepted">
                The start procedure returned and the input was exhausted — the call tree is the
                parse tree.
              </Note>
            )}
          </Panel>
        </StepPanel>
      }
    />
  );
}

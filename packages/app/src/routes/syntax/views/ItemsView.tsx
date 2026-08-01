/**
 * The canonical collections of item sets: LR(0) (§4.6.2, Algorithm 4.32 /
 * Fig 4.31) and canonical LR(1) (§4.7.2, Algorithm 4.53 / Fig 4.41).
 *
 * The GOTO automaton is laid out once from the FINAL collection and only
 * highlighted as the cursor moves; CLOSURE micro-steps pair the item that was
 * added with the item that justified it.
 */
import { useMemo, type ReactNode } from 'react';
import type { StepRecord, Trace } from '@lab/trace';
import { formatDotted } from '@lab/core/grammar/lr-events.js';
import { lr0Reducer, type Lr0Event, type Lr0UiState } from '@lab/core/grammar/lr0-items.js';
import { lr1Reducer, type Lr1Event, type Lr1UiState } from '@lab/core/grammar/lr1-items.js';
import { useStepper, type Stepper } from '../../../lib/useStepper';
import { FullscreenTransport } from '../../../components/Fullscreen';
import { useTrace } from '../lib/useTrace';
import type { ViewContext } from '../lib/view';
import { LR1_VIEWS, type Lr1View as Lr1SubView } from '../lib/algorithms';
import { GrammarRail, productionRefs } from '../components/GrammarRail';
import { ViewGrid } from '../components/Layout';
import { GotoGraph, type GotoGraphState } from '../components/GotoGraph';
import { ItemSets, mergeItemRows, type ItemMark, type ItemSetState } from '../components/ItemSets';
import {
  Diagnostics,
  Note,
  Panel,
  Segmented,
  Skeleton,
  StepPanel,
  Stat,
  TextButton,
} from '../components/ui';

interface AnyItem {
  prod: number;
  dot: number;
  kernel: boolean;
  la?: string;
}
interface AnyState {
  id: number;
  items: AnyItem[];
}
interface Snapshot {
  states: AnyState[];
  transitions: Array<{ from: number; symbol: string; to: number }>;
  truncated: boolean;
}

// ── LR(0) ────────────────────────────────────────────────────────────────────

export function Lr0View(ctx: ViewContext) {
  const { trace, phase, diagnostics } = useTrace<Lr0UiState, Lr0Event>(
    'syntax.lr0',
    { grammarId: ctx.grammarId },
    lr0Reducer,
  );
  if (trace) return <Lr0Ready ctx={ctx} trace={trace} />;
  if (phase === 'unavailable') {
    return <Diagnostics title="The LR(0) collection could not be built" diagnostics={diagnostics} />;
  }
  return (
    <Skeleton
      label={
        phase === 'replaying'
          ? 'Replaying the collection locally…'
          : 'Building the canonical collection of LR(0) item sets…'
      }
    />
  );
}

function Lr0Ready({ ctx, trace }: { ctx: ViewContext; trace: Trace<Lr0UiState, Lr0Event> }) {
  const stepper = useStepper(trace, ctx.stepperOptions);
  const final = useMemo<Snapshot>(() => {
    const f = trace.final();
    return { states: f.states, transitions: f.transitions, truncated: false };
  }, [trace]);
  const now = useMemo<Snapshot>(
    () => ({ states: stepper.state.states, transitions: stepper.state.transitions, truncated: false }),
    [stepper.state],
  );

  const ev = stepper.currentStep?.event ?? null;
  const currentStateId =
    ev?.kind === 'lr0/state'
      ? ev.id
      : ev?.kind === 'lr0/closureItem'
        ? ev.state
        : ev?.kind === 'lr0/goto'
          ? ev.from
          : null;
  const currentEdge = ev?.kind === 'lr0/goto' ? { from: ev.from, symbol: ev.symbol, to: ev.to } : null;
  const added: ItemMark | null =
    ev?.kind === 'lr0/closureItem' ? { stateId: ev.state, key: `${ev.item.prod}.${ev.item.dot}` } : null;
  const justifies: ItemMark | null =
    ev?.kind === 'lr0/closureItem' ? { stateId: ev.state, key: `${ev.fromProd}.${ev.fromDot}` } : null;

  return (
    <Collection
      ctx={ctx}
      stepper={stepper}
      title="Canonical LR(0) collection"
      final={final}
      now={now}
      currentStateId={currentStateId}
      currentEdge={currentEdge}
      added={added}
      justifies={justifies}
      jumps={[
        { label: 'next state', pred: (s) => s.event.kind === 'lr0/state' },
        { label: 'next GOTO', pred: (s) => s.event.kind === 'lr0/goto' },
        {
          label: 'next existing-state GOTO',
          pred: (s) => s.event.kind === 'lr0/goto' && !s.event.isNew,
        },
      ]}
    />
  );
}

// ── Canonical LR(1) ──────────────────────────────────────────────────────────

export function Lr1View({
  ctx,
  subView,
  onSubView,
}: {
  ctx: ViewContext;
  subView: Lr1SubView;
  onSubView: (v: Lr1SubView) => void;
}) {
  const { trace, phase, diagnostics } = useTrace<Lr1UiState, Lr1Event>(
    'syntax.lr1',
    { grammarId: ctx.grammarId },
    lr1Reducer,
  );
  const switcher = (
    <Segmented label="LR(1) view" value={subView} options={LR1_VIEWS} onChange={onSubView} size="sm" />
  );
  if (trace) return <Lr1Ready ctx={ctx} trace={trace} switcher={switcher} />;
  if (phase === 'unavailable') {
    return <Diagnostics title="The LR(1) collection could not be built" diagnostics={diagnostics} />;
  }
  return (
    <Skeleton
      label={
        phase === 'replaying'
          ? 'Replaying the LR(1) collection locally (it is large — that is the point)…'
          : 'Building the canonical collection of LR(1) item sets…'
      }
    />
  );
}

function Lr1Ready({
  ctx,
  trace,
  switcher,
}: {
  ctx: ViewContext;
  trace: Trace<Lr1UiState, Lr1Event>;
  switcher: ReactNode;
}) {
  const stepper = useStepper(trace, ctx.stepperOptions);
  const final = useMemo<Snapshot>(() => {
    const f = trace.final();
    return { states: f.states, transitions: f.transitions, truncated: f.truncated };
  }, [trace]);
  const now = useMemo<Snapshot>(
    () => ({
      states: stepper.state.states,
      transitions: stepper.state.transitions,
      truncated: stepper.state.truncated,
    }),
    [stepper.state],
  );

  const ev = stepper.currentStep?.event ?? null;
  const currentStateId =
    ev?.kind === 'lr1/state'
      ? ev.id
      : ev?.kind === 'lr1/closureItem'
        ? ev.state
        : ev?.kind === 'lr1/goto'
          ? ev.from
          : null;
  const currentEdge = ev?.kind === 'lr1/goto' ? { from: ev.from, symbol: ev.symbol, to: ev.to } : null;
  const added: ItemMark | null =
    ev?.kind === 'lr1/closureItem'
      ? { stateId: ev.state, key: `${ev.item.prod}.${ev.item.dot}`, la: ev.item.la }
      : null;
  const justifies: ItemMark | null =
    ev?.kind === 'lr1/closureItem' ? { stateId: ev.state, key: `${ev.fromProd}.${ev.fromDot}` } : null;

  return (
    <Collection
      ctx={ctx}
      stepper={stepper}
      title="Canonical LR(1) collection"
      headerActions={switcher}
      final={final}
      now={now}
      currentStateId={currentStateId}
      currentEdge={currentEdge}
      added={added}
      justifies={justifies}
      jumps={[
        { label: 'next state', pred: (s) => s.event.kind === 'lr1/state' },
        { label: 'next GOTO', pred: (s) => s.event.kind === 'lr1/goto' },
        { label: 'truncation', pred: (s) => s.event.kind === 'lr1/truncated' },
      ]}
      banner={
        final.truncated ? (
          <Note
            tone="warn"
            title={`Truncated at ${final.states.length} LR(1) states — this blowup is exactly why LALR exists`}
            actions={
              <TextButton emphasis onClick={() => ctx.selectAlgo('lalr')}>
                Show the LALR(1) construction instead
              </TextButton>
            }
          >
            The cap is 400 states. Everything below it is exact.
          </Note>
        ) : null
      }
    />
  );
}

// ── Shared presentation ──────────────────────────────────────────────────────

function Collection<S, E extends { kind: string }>({
  ctx,
  stepper,
  title,
  headerActions,
  final,
  now,
  currentStateId,
  currentEdge,
  added,
  justifies,
  jumps,
  banner,
}: {
  ctx: ViewContext;
  stepper: Stepper<S, E>;
  title: string;
  headerActions?: ReactNode;
  final: Snapshot;
  now: Snapshot;
  currentStateId: number | null;
  currentEdge: { from: number; symbol: string; to: number } | null;
  added: ItemMark | null;
  justifies: ItemMark | null;
  jumps: ReadonlyArray<{ label: string; pred: (s: StepRecord<E>) => boolean }>;
  banner?: ReactNode;
}) {
  const ag = ctx.augmented;
  const dotted = useMemo(() => (prod: number, dot: number) => formatDotted(ag, prod, dot), [ag]);

  const graphStates = useMemo<GotoGraphState[]>(
    () =>
      final.states.map((s) => ({
        id: s.id,
        name: String(s.id),
        itemCount: s.items.length,
        detail: mergeItemRows(s.items, dotted)
          .map((r) => `[${r.dotted}${r.lookaheads.length ? `, ${r.lookaheads.join('/')}` : ''}]`)
          .join('\n'),
      })),
    [final.states, dotted],
  );

  const itemSets = useMemo<ItemSetState[]>(
    () =>
      now.states.map((s) => ({
        id: s.id,
        name: String(s.id),
        rows: mergeItemRows(s.items, dotted),
      })),
    [now.states, dotted],
  );

  const visited = useMemo(() => new Set(now.states.map((s) => s.id)), [now.states]);

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
          {banner && <div className="mb-7">{banner}</div>}
          <Panel title={title} actions={headerActions}>
            <GotoGraph
              states={graphStates}
              transitions={final.transitions}
              currentStateId={currentStateId}
              visitedStateIds={visited}
              currentEdge={currentEdge}
              controls={<FullscreenTransport stepper={stepper} />}
            />
          </Panel>
        </>
      }
      panel={
        <StepPanel stepper={stepper} jumps={jumps}>
          <Panel
            title="Item sets"
            subtitle={
              <>
                <Stat label="states" value={`${now.states.length} / ${final.states.length}`} />
                <span className="ml-3">
                  <Stat
                    label="edges"
                    value={`${now.transitions.length} / ${final.transitions.length}`}
                  />
                </span>
              </>
            }
            bodyClassName="flex flex-col gap-3"
          >
            <ItemSets
              states={itemSets}
              currentStateId={currentStateId}
              added={added}
              justifies={justifies}
            />
          </Panel>
        </StepPanel>
      }
    />
  );
}

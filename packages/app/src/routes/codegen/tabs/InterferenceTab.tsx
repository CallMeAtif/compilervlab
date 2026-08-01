/**
 * Tab 3 — INTERFERENCE GRAPH (`codegen.interference`, §8.8.3–8.8.4).
 *
 * The graph is laid out ONCE from the finished edge set, then edges are
 * revealed as the trace adds them: an edge appears the moment some instruction
 * defines one value while the other is live-out. The graph is UNDIRECTED —
 * React Flow's default edges carry no marker, and pending edges are dashed so
 * the distinction is never carried by color alone.
 */
import { useMemo, useState } from 'react';
import { interferenceReducer } from '@lab/core/codegen/interference.js';
import type {
  InterferenceEvent,
  InterferenceState,
} from '@lab/core/codegen/interference.js';
import { formatVInstr } from '@lab/core/codegen/cg-events.js';
import type { VFunction } from '@lab/core/codegen/cg-events.js';
import type { Trace } from '@lab/trace';
import { clsx } from 'clsx';
import { Ban, Link2, Unlink } from 'lucide-react';
import { ElkGraph } from '../../../components/viz/ElkGraph';
import type { ElkGraphEdge, ElkGraphNode } from '../../../components/viz/ElkGraph';
import { useCodegenTrace } from '../useCodegenTrace';
import { useSelectedCode } from '../useSelectedCode';
import { prefixLatest } from '../traceScan';
import {
  AutoMicroSteps,
  FunctionPicker,
  Legend,
  LoadingPanel,
  Panel,
  Tag,
  TraceGate,
  TraceSplit,
  pickFunctionName,
  useStepSync,
} from '../shared';

const edgeId = (a: string, b: string): string => `${a}--${b}`;

/** Node box: `id` (12px) + `kind` (10px) + a `deg NN` pill, plus padding. */
const nodeWidth = (id: string, kind: string): number =>
  Math.round(Math.max(150, id.length * 8 + kind.length * 6.2 + 92));

export function InterferenceTab({ source }: { source: string }) {
  const result = useCodegenTrace<InterferenceState, InterferenceEvent>(
    'codegen.interference',
    { source },
    interferenceReducer,
  );
  const code = useSelectedCode(source);

  if (code.status === 'loading' || code.status === 'idle') {
    return <LoadingPanel label="Loading the selected code…" />;
  }

  return (
    <TraceGate
      result={result}
      label="Building the interference graph…"
      unavailableTitle="No interference trace"
    >
      {(trace) => <InterferenceView trace={trace} byName={code.byName} />}
    </TraceGate>
  );
}

function InterferenceView({
  trace,
  byName,
}: {
  trace: Trace<InterferenceState, InterferenceEvent>;
  byName: ReadonlyMap<string, VFunction>;
}) {
  const stepperOptions = useStepSync();
  const [pinned, setPinned] = useState<string | null>(null);

  const final = useMemo(() => trace.final(), [trace]);
  const names = useMemo(() => final.functions.map((f) => f.graph.functionName), [final]);

  const fnAt = useMemo(
    () =>
      prefixLatest<InterferenceEvent, string>(trace, (s) =>
        'functionName' in s.event ? s.event.functionName : null,
      ),
    [trace],
  );

  return (
    <TraceSplit trace={trace} stepperOptions={stepperOptions}>
      {(stepper) => {
        const state = stepper.state;
        const active = pickFunctionName(names, fnAt[stepper.index] ?? null, pinned);
        const finalFn = final.functions.find((f) => f.graph.functionName === active) ?? null;
        const liveFn = state.functions.find((f) => f.graph.functionName === active) ?? null;
        const vfn = active !== null ? (byName.get(active) ?? null) : null;

        const ev = stepper.currentStep?.event;
        const currentEdge =
          ev !== undefined && ev.kind === 'edge' && ev.functionName === active
            ? { a: ev.a, b: ev.b, atIndex: ev.atIndex, def: ev.def, liveOut: ev.liveOut }
            : null;
        const currentException =
          ev !== undefined && ev.kind === 'moveException' && ev.functionName === active
            ? ev
            : null;
        const currentForbid =
          ev !== undefined && ev.kind === 'forbid' && ev.functionName === active ? ev : null;

        // Edges the trace has added so far (from state, never re-derived).
        const added = new Set((liveFn?.graph.edges ?? []).map((e) => edgeId(e.a, e.b)));
        const degree = new Map<string, number>();
        for (const e of liveFn?.graph.edges ?? []) {
          degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
          degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
        }

        // Layout inputs: the FINISHED graph, so ELK runs once per function.
        const nodes: ElkGraphNode[] = (finalFn?.graph.nodes ?? []).map((n) => ({
          id: n.id,
          label: n.id,
          // DECLARED box: wide enough for the name, the kind and a two-digit
          // degree badge. It depends only on the finished graph, so the content
          // can change every step (the degree does) without moving anything.
          width: nodeWidth(n.id, n.kind),
          height: 34,
          reactNode: (
            <span className="flex items-center gap-1.5">
              <span className="font-semibold">{n.id}</span>
              <span className="text-[10px] text-ink-faint">{n.kind}</span>
              <span className="rounded-full bg-raised px-1.5 text-[10px] text-ink-muted">
                deg {degree.get(n.id) ?? 0}
              </span>
            </span>
          ),
        }));
        const edges: ElkGraphEdge[] = (finalFn?.graph.edges ?? []).map((e) => ({
          id: edgeId(e.a, e.b),
          source: e.a,
          target: e.b,
        }));

        const justifyingInstr =
          currentEdge !== null && vfn ? (vfn.code[currentEdge.atIndex] ?? null) : null;

        return (
          <>
            <AutoMicroSteps stepper={stepper} />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <FunctionPicker
                names={names}
                value={active}
                pinned={pinned !== null}
                onPick={setPinned}
                onFollow={() => setPinned(null)}
              />
              <Legend
                items={[
                  {
                    swatch: (
                      <svg aria-hidden width="26" height="8" className="overflow-visible">
                        <line
                          x1="0"
                          y1="4"
                          x2="26"
                          y2="4"
                          stroke="var(--ink-faint)"
                          strokeWidth="2"
                        />
                      </svg>
                    ),
                    label: 'interference recorded',
                  },
                  {
                    swatch: (
                      <svg aria-hidden width="26" height="8" className="overflow-visible">
                        <line
                          x1="0"
                          y1="4"
                          x2="26"
                          y2="4"
                          stroke="var(--line-strong)"
                          strokeWidth="2"
                          strokeDasharray="3 5"
                        />
                      </svg>
                    ),
                    label: 'not derived yet',
                  },
                  {
                    swatch: (
                      <span
                        aria-hidden
                        className="inline-block size-3 rounded-full ring-2 ring-accent ring-offset-1 ring-offset-canvas"
                      />
                    ),
                    label: 'endpoints of this step’s edge',
                  },
                ]}
              />
            </div>

            <Panel
              title="Interference graph"
              subtitle={
                finalFn
                  ? `${finalFn.graph.nodes.length} node(s) · ${added.size} of ${finalFn.graph.edges.length} edge(s) derived — undirected, so no arrowheads`
                  : undefined
              }
              bodyClassName="p-2"
            >
              <div className="cg-graph">
                <ElkGraph
                  nodes={nodes}
                  edges={edges}
                  direction="RIGHT"
                  visitedIds={added}
                  currentEdgeIds={currentEdge ? [edgeId(currentEdge.a, currentEdge.b)] : []}
                  currentNodeIds={
                    currentEdge
                      ? [currentEdge.a, currentEdge.b]
                      : currentForbid
                        ? [currentForbid.node]
                        : currentException
                          ? [currentException.def, currentException.src]
                          : []
                  }
                  height="26rem"
                />
              </div>
            </Panel>

            <Panel
              title="Why this edge?"
              subtitle="every edge is justified by one defining instruction"
              bodyClassName="p-3"
            >
              {currentEdge !== null ? (
                <div className="flex flex-col gap-2 text-sm">
                  <p className="flex flex-wrap items-center gap-2">
                    <Link2 aria-hidden className="size-4 text-accent" />
                    <span className="font-mono text-ink">
                      {currentEdge.a} — {currentEdge.b}
                    </span>
                    <Tag tone="accent">instruction {currentEdge.atIndex}</Tag>
                  </p>
                  <pre className="overflow-x-auto rounded-md bg-code px-3 py-2 font-mono text-xs text-ink">
                    {currentEdge.atIndex}: {justifyingInstr ? formatVInstr(justifyingInstr) : '—'}
                  </pre>
                  <p className="text-ink-muted">
                    It defines <span className="font-mono text-ink">{currentEdge.def}</span> while{' '}
                    <span className="font-mono text-ink">
                      {currentEdge.liveOut.join(', ') || '∅'}
                    </span>{' '}
                    is live-out. Two values live at the same point cannot share a register, so an
                    edge is added.
                  </p>
                </div>
              ) : currentException !== null ? (
                <div className="flex flex-col gap-2 text-sm">
                  <p className="flex flex-wrap items-center gap-2">
                    <Unlink aria-hidden className="size-4 text-warn" />
                    <span className="font-mono text-ink">
                      {currentException.def} ← {currentException.src}
                    </span>
                    <Tag tone="warn">no edge</Tag>
                  </p>
                  <p className="text-ink-muted">
                    Chaitin's move-related exception: a copy's source and target hold the same
                    value at that point, so they may share a register — no interference is
                    recorded (instruction {currentException.atIndex}).
                  </p>
                </div>
              ) : currentForbid !== null ? (
                <div className="flex flex-col gap-2 text-sm">
                  <p className="flex flex-wrap items-center gap-2">
                    <Ban aria-hidden className="size-4 text-warn" />
                    <span className="font-mono text-ink">
                      {currentForbid.node} ≠ {currentForbid.reg}
                    </span>
                    <Tag tone="warn">precolored</Tag>
                  </p>
                  <p className="text-ink-muted">
                    A physical register pinned by a tile behaves as a precolored node: because it
                    is live across instruction {currentForbid.atIndex}, {currentForbid.node} must
                    not be colored {currentForbid.reg}.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-ink-faint">
                  Step forward — each step either adds one edge, records a precoloring constraint,
                  or explains why a copy does <em>not</em> create interference.
                </p>
              )}
            </Panel>

            <div className="grid gap-3 md:grid-cols-2">
              <Panel
                title="Precoloring constraints"
                subtitle="registers a value may not receive"
                bodyClassName="p-3"
              >
                {Object.keys(liveFn?.forbidden ?? {}).length === 0 ? (
                  <p className="text-sm text-ink-faint">None recorded yet.</p>
                ) : (
                  <ul className="flex flex-col gap-1 font-mono text-xs">
                    {Object.entries(liveFn?.forbidden ?? {}).map(([node, regs]) => (
                      <li key={node} className="flex flex-wrap items-center gap-2">
                        <span className="text-ink">{node}</span>
                        <span className="text-ink-faint">must avoid</span>
                        {regs.map((r) => (
                          <Tag key={r} tone="warn">
                            {r}
                          </Tag>
                        ))}
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
              <Panel
                title="Move-related pairs"
                subtitle="candidates for coalescing"
                bodyClassName="p-3"
              >
                {(liveFn?.moves.length ?? 0) === 0 ? (
                  <p className="text-sm text-ink-faint">No register-to-register copies yet.</p>
                ) : (
                  <ul className="flex flex-wrap gap-2 font-mono text-xs">
                    {(liveFn?.moves ?? []).map((m) => (
                      <li
                        key={`${m.a}-${m.b}`}
                        className={clsx(
                          'rounded-md border border-line bg-raised px-2 py-1 text-ink-muted',
                        )}
                      >
                        {m.a} ↔ {m.b}
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
          </>
        );
      }}
    </TraceSplit>
  );
}

/**
 * Tab 4 — REGISTER COLORING (`codegen.color`, §8.8.4).
 *
 * Kempe/Chaitin simplify–select, animated by emphasis only: nodes stay where
 * ELK put them and move into the STACK column beside the graph as SIMPLIFY
 * removes them; SELECT pops them back and each one is given the lowest-numbered
 * register its neighbours left free. Registers are identified by their NAME,
 * never by color alone.
 */
import { useMemo, useState } from 'react';
import { colorReducer } from '@lab/core/codegen/color.js';
import type { ColorEvent, ColorState } from '@lab/core/codegen/color.js';
import { interferenceReducer } from '@lab/core/codegen/interference.js';
import type {
  InterferenceEvent,
  InterferenceState,
} from '@lab/core/codegen/interference.js';
import { GP_REGISTERS } from '@lab/core/codegen/types.js';
import type { Trace } from '@lab/trace';
import { clsx } from 'clsx';
import { ArrowDownToLine, ArrowUpFromLine, Ban, CircleCheck, Layers, Square } from 'lucide-react';
import { ElkGraph } from '../../../components/viz/ElkGraph';
import type { ElkGraphEdge, ElkGraphNode } from '../../../components/viz/ElkGraph';
import { useCodegenTrace } from '../useCodegenTrace';
import { prefixLatest } from '../traceScan';
import {
  AutoMicroSteps,
  FunctionPicker,
  Legend,
  Notice,
  Panel,
  Tag,
  TraceGate,
  TraceSplit,
  pickFunctionName,
  useStepSync,
} from '../shared';

const DEFAULT_K = GP_REGISTERS.length;

/** Node box: `id` (12px) plus the widest badge, a `▣ -000(%rbp)` spill slot. */
const nodeWidth = (id: string): number => Math.round(Math.max(158, id.length * 8 + 118));

/** One recorded coloring decision, tagged with the cursor position that reveals it. */
interface Mark {
  at: number;
  fn: string;
  round: number;
  kind: ColorEvent['kind'];
  node: string;
  degree: number | null;
  forbidden: readonly string[] | null;
  slot: number | null;
  scratch: string | null;
  atIndex: number | null;
}

export function ColorTab({
  source,
  k,
  onChangeK,
}: {
  source: string;
  k: number | null;
  onChangeK: (k: number | null) => void;
}) {
  const params = useMemo(
    () => (k === null ? { source } : { source, k }),
    [source, k],
  );
  const result = useCodegenTrace<ColorState, ColorEvent>('codegen.color', params, colorReducer);
  const interference = useCodegenTrace<InterferenceState, InterferenceEvent>(
    'codegen.interference',
    { source },
    interferenceReducer,
  );
  const effectiveK = k ?? DEFAULT_K;

  return (
    <div className="flex flex-col gap-4">
      <KPicker k={k} onChangeK={onChangeK} />
      <TraceGate
        result={result}
        label={`Coloring the interference graph with K = ${effectiveK}…`}
        unavailableTitle={`No coloring with K = ${effectiveK}`}
      >
        {(trace) => (
          <ColorView
            trace={trace}
            k={effectiveK}
            interference={interference.trace?.final() ?? null}
          />
        )}
      </TraceGate>
    </div>
  );
}

function KPicker({ k, onChangeK }: { k: number | null; onChangeK: (k: number | null) => void }) {
  const options = [1, 2, 3, 4, 5, 6, 7, 8];
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
          K — registers offered to the allocator
        </span>
        <div
          role="group"
          aria-label="Number of available general-purpose registers"
          className="flex flex-wrap gap-1"
        >
          {options.map((n) => {
            const selected = (k ?? DEFAULT_K) === n;
            return (
              <button
                key={n}
                type="button"
                aria-pressed={selected}
                aria-label={`Color with ${n} register${n === 1 ? '' : 's'}`}
                onClick={() => onChangeK(n === DEFAULT_K ? null : n)}
                className={clsx(
                  'h-11 w-11 cursor-pointer rounded-md border font-mono text-sm transition-colors',
                  selected
                    ? 'border-accent bg-accent-soft text-ink'
                    : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink',
                )}
              >
                {n}
              </button>
            );
          })}
        </div>
      </div>
      <p className="text-xs text-ink-faint">
        SELECT colours from{' '}
        <span className="font-mono">GP_REGISTERS.slice(0, K)</span> ={' '}
        <span className="font-mono text-ink-muted">
          {GP_REGISTERS.slice(0, k ?? DEFAULT_K).join(', ')}
        </span>
        . Lower K to force real spills; K = 1 usually cannot converge at all, and the lab reports
        that instead of looping.
      </p>
    </div>
  );
}

function ColorView({
  trace,
  k,
  interference,
}: {
  trace: Trace<ColorState, ColorEvent>;
  k: number;
  interference: InterferenceState | null;
}) {
  const stepperOptions = useStepSync();
  const [pinned, setPinned] = useState<string | null>(null);

  const final = useMemo(() => trace.final(), [trace]);
  const names = useMemo(() => final.functions.map((f) => f.functionName), [final]);

  const fnAt = useMemo(
    () =>
      prefixLatest<ColorEvent, string>(trace, (s) =>
        'functionName' in s.event ? s.event.functionName : null,
      ),
    [trace],
  );

  /** Every decision, with the cursor position that reveals it. */
  const marks = useMemo(() => {
    const out: Mark[] = [];
    let round = 1;
    for (const step of trace.steps) {
      const e = step.event;
      if (e.kind === 'roundStart') round = e.round;
      if (
        e.kind === 'simplifyPush' ||
        e.kind === 'spillCandidate' ||
        e.kind === 'select' ||
        e.kind === 'actualSpill' ||
        e.kind === 'spillRewrite'
      ) {
        out.push({
          at: step.index + 1,
          fn: e.functionName,
          round,
          kind: e.kind,
          node: e.node,
          degree: e.kind === 'simplifyPush' || e.kind === 'spillCandidate' ? e.degree : null,
          forbidden:
            e.kind === 'select' || e.kind === 'actualSpill' ? e.forbiddenColors : null,
          slot: e.kind === 'actualSpill' ? e.spillSlot : null,
          scratch: e.kind === 'spillRewrite' ? e.scratch : null,
          atIndex: e.kind === 'spillRewrite' ? e.atIndex : null,
        });
      }
    }
    return out;
  }, [trace]);

  const roundAt = useMemo(
    () =>
      prefixLatest<ColorEvent, number>(trace, (s) =>
        s.event.kind === 'roundStart' ? s.event.round : s.event.kind === 'fnStart' ? 1 : null,
      ),
    [trace],
  );

  const roundSections = useMemo(
    () =>
      trace
        .sections()
        .filter((s) => / coloring round \d+$/.test(s.name))
        .map((s) => ({
          ...s,
          fn: s.name.slice(0, s.name.indexOf(':')),
          round: Number.parseInt(s.name.slice(s.name.lastIndexOf(' ') + 1), 10),
        })),
    [trace],
  );

  const palette = GP_REGISTERS.slice(0, Math.max(1, k));

  return (
    <TraceSplit trace={trace} stepperOptions={stepperOptions}>
      {(stepper) => {
        const state = stepper.state;
        const active = pickFunctionName(names, fnAt[stepper.index] ?? null, pinned);
        const fnState = state.functions.find((f) => f.functionName === active) ?? null;
        const round = roundAt[stepper.index] ?? 1;

        const seen = marks.filter(
          (m) => m.at <= stepper.index && m.fn === active && m.round === round,
        );
        const pushInfo = new Map(
          seen
            .filter((m) => m.kind === 'simplifyPush' || m.kind === 'spillCandidate')
            .map((m) => [m.node, m]),
        );
        const assignInfo = new Map(
          seen.filter((m) => m.kind === 'select' || m.kind === 'actualSpill').map((m) => [m.node, m]),
        );
        const rewrites = seen.filter((m) => m.kind === 'spillRewrite');

        const ev = stepper.currentStep?.event;
        const phase =
          ev === undefined
            ? 'idle'
            : ev.kind === 'simplifyPush' || ev.kind === 'spillCandidate'
              ? 'simplify'
              : ev.kind === 'select' || ev.kind === 'actualSpill'
                ? 'select'
                : ev.kind === 'spillRewrite'
                  ? 'rewrite'
                  : 'idle';
        const currentNode =
          ev !== undefined && 'node' in ev && 'functionName' in ev && ev.functionName === active
            ? ev.node
            : null;

        const stack = fnState?.stack ?? [];
        const onStack = new Set(stack);
        const assignment = fnState?.assignment ?? {};

        // Round 1 shares its graph with the interference tab; later rounds run
        // on spill-rewritten code whose graph the color trace does not carry.
        const graph =
          round === 1
            ? (interference?.functions.find((f) => f.graph.functionName === active)?.graph ?? null)
            : null;

        const remainingDegree = (id: string): number => {
          let d = 0;
          for (const e of graph?.edges ?? []) {
            if (e.a === id && !onStack.has(e.b)) d++;
            else if (e.b === id && !onStack.has(e.a)) d++;
          }
          return d;
        };

        const nodes: ElkGraphNode[] = (graph?.nodes ?? []).map((n) => {
          const a = assignment[n.id];
          const stacked = onStack.has(n.id);
          return {
            id: n.id,
            label: n.id,
            // DECLARED box, sized for the widest badge a node can ever show
            // (a spill slot, `-000(%rbp)`). It depends only on the node id, so
            // the badge can change every step without re-running layout.
            width: nodeWidth(n.id),
            height: 34,
            reactNode: (
              <span className="flex items-center gap-1.5">
                <span className={clsx('font-semibold', stacked && 'text-ink-faint line-through')}>
                  {n.id}
                </span>
                {a !== undefined && 'reg' in a && (
                  <span className="flex items-center gap-1 rounded-full bg-ok-soft px-1.5 text-[10px] text-ok">
                    <CircleCheck aria-hidden className="size-2.5" />
                    {a.reg}
                  </span>
                )}
                {a !== undefined && 'spillSlot' in a && (
                  <span className="cg-hatch-warn flex items-center gap-1 rounded-full px-1.5 text-[10px] text-warn ring-1 ring-warn/60">
                    <Square aria-hidden className="size-2.5" />
                    {a.spillSlot}(%rbp)
                  </span>
                )}
                {a === undefined && stacked && (
                  <span className="flex items-center gap-1 rounded-full bg-raised px-1.5 text-[10px] text-ink-faint">
                    <ArrowUpFromLine aria-hidden className="size-2.5" />
                    on stack
                  </span>
                )}
                {a === undefined && !stacked && (
                  <span className="rounded-full bg-raised px-1.5 text-[10px] text-ink-muted">
                    deg {remainingDegree(n.id)}
                  </span>
                )}
              </span>
            ),
          };
        });
        const edges: ElkGraphEdge[] = (graph?.edges ?? []).map((e) => ({
          id: `${e.a}--${e.b}`,
          source: e.a,
          target: e.b,
        }));
        // Edges still constraining the graph (both endpoints present) are drawn
        // solid; edges to a removed node fall back to the dashed "pending"
        // style, which is exactly what "no longer counted in the degree" means.
        const liveEdgeIds = (graph?.edges ?? [])
          .filter((e) => !onStack.has(e.a) && !onStack.has(e.b))
          .map((e) => `${e.a}--${e.b}`);

        const holder = new Map<string, string>();
        for (const [node, a] of Object.entries(assignment)) {
          if ('reg' in a) holder.set(a.reg, node);
        }

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
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-ink-faint">round</span>
                {roundSections
                  .filter((s) => s.fn === active)
                  .map((s) => (
                    <button
                      key={s.name}
                      type="button"
                      aria-pressed={s.round === round}
                      onClick={() => stepper.jumpTo(s.startIndex)}
                      className={clsx(
                        'h-7 cursor-pointer rounded-md border px-2 font-mono text-xs transition-colors',
                        s.round === round
                          ? 'border-accent bg-accent-soft text-ink'
                          : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink',
                      )}
                    >
                      {s.round}
                    </button>
                  ))}
              </div>
              <Tag tone={phase === 'idle' ? 'neutral' : 'accent'}>
                {phase === 'simplify' && <ArrowUpFromLine aria-hidden className="size-3" />}
                {phase === 'select' && <ArrowDownToLine aria-hidden className="size-3" />}
                {phase === 'rewrite' && <Layers aria-hidden className="size-3" />}
                {phase === 'idle' ? 'K = ' + k : phase.toUpperCase()}
              </Tag>
            </div>

            <RegisterFile palette={palette} holder={holder} k={k} />

            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_13rem]">
              <Panel
                title={round === 1 ? 'Interference graph' : `Round ${round} graph`}
                subtitle={
                  graph
                    ? `${graph.nodes.length} node(s) · ${graph.edges.length} edge(s) · a node is removable when its degree < K`
                    : undefined
                }
                bodyClassName="p-2"
              >
                {graph ? (
                  <div className="cg-graph">
                    <ElkGraph
                      nodes={nodes}
                      edges={edges}
                      direction="RIGHT"
                      visitedIds={[...liveEdgeIds, ...stack]}
                      currentNodeIds={currentNode !== null ? [currentNode] : []}
                      height="26rem"
                    />
                  </div>
                ) : (
                  <div>
                    <Notice tone="info" title={`Round ${round} runs on rewritten code`}>
                      <p className="text-sm">
                        After a spill, liveness and interference are recomputed on the code with
                        the loads and stores inserted — a different graph, with fresh scratch
                        temporaries. The coloring trace records the decisions, not that new graph,
                        so the stack and assignment below are the round-{round} view.
                      </p>
                    </Notice>
                  </div>
                )}
              </Panel>

              <Panel
                title="Stack"
                subtitle={`${stack.length} node(s)`}
                bodyClassName="p-2"
                className="lg:sticky lg:top-20"
              >
                <ol className="flex flex-col gap-1" aria-label="Simplify stack, top first">
                  {stack.length === 0 && (
                    <li className="px-1 py-6 text-center text-xs text-ink-faint">
                      empty — nodes pushed here during SIMPLIFY, popped during SELECT
                    </li>
                  )}
                  {[...stack].reverse().map((node, i) => {
                    const info = pushInfo.get(node);
                    const potential = info?.kind === 'spillCandidate';
                    return (
                      <li
                        key={node}
                        className={clsx(
                          'flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 font-mono text-xs',
                          potential
                            ? 'cg-hatch-warn border-warn/60 text-warn'
                            : 'border-line bg-raised text-ink',
                          node === currentNode && 'ring-2 ring-accent',
                        )}
                        title={
                          potential
                            ? `${node} was pushed as a POTENTIAL SPILL (degree ${info?.degree ?? '?'} ≥ K)`
                            : `${node} had degree ${info?.degree ?? '?'} < K when it was removed`
                        }
                      >
                        <span className="flex items-center gap-1">
                          {i === 0 && <ArrowDownToLine aria-hidden className="size-3" />}
                          {node}
                        </span>
                        <span className="text-[10px] opacity-80">
                          {potential ? '⚠ deg ' : 'deg '}
                          {info?.degree ?? '?'}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </Panel>
            </div>

            <Panel
              title="Assignment"
              subtitle="each pop takes the lowest-numbered register its neighbours left free"
              bodyClassName="p-0"
            >
              <div className="max-h-80 overflow-auto">
                <table className="w-full border-collapse font-mono text-xs">
                  <thead className="sticky top-0 z-10 bg-raised text-[11px] text-ink-muted">
                    <tr>
                      <th scope="col" className="px-2 py-1.5 text-left font-semibold">
                        value
                      </th>
                      <th scope="col" className="px-2 py-1.5 text-left font-semibold">
                        forbidden (neighbours + precoloring)
                      </th>
                      <th scope="col" className="px-2 py-1.5 text-left font-semibold">
                        result
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.keys(assignment).length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-2 py-4 text-ink-faint">
                          Nothing selected yet — SELECT starts once SIMPLIFY has emptied the
                          graph.
                        </td>
                      </tr>
                    )}
                    {Object.entries(assignment).map(([node, a]) => {
                      const info = assignInfo.get(node);
                      return (
                        <tr
                          key={node}
                          aria-current={node === currentNode ? 'step' : undefined}
                          className={clsx(
                            'border-b border-line/60',
                            node === currentNode && 'bg-accent-soft',
                          )}
                        >
                          <td className="px-2 py-1.5 text-ink">{node}</td>
                          <td className="px-2 py-1.5">
                            {info?.forbidden && info.forbidden.length > 0 ? (
                              <span className="flex flex-wrap gap-1">
                                {info.forbidden.map((r) => (
                                  <Tag key={r} tone="neutral" title={`${r} is taken`}>
                                    <Ban aria-hidden className="size-2.5" />
                                    {r}
                                  </Tag>
                                ))}
                              </span>
                            ) : (
                              <span className="text-ink-faint">∅ — nothing taken</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5">
                            {'spillSlot' in a ? (
                              <Tag tone="warn">
                                <Square aria-hidden className="size-2.5" />
                                spilled to {a.spillSlot}(%rbp)
                              </Tag>
                            ) : (
                              <Tag tone="ok">
                                <CircleCheck aria-hidden className="size-2.5" />
                                {a.reg}
                              </Tag>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>

            {(fnState?.spilled.length ?? 0) > 0 && (
              <Notice
                tone="warn"
                title={`${fnState?.spilled.length} actual spill(s): ${fnState?.spilled.join(', ')}`}
              >
                <p className="text-sm">
                  A spilled value lives in memory: a load is inserted before every use and a store
                  after every definition, and the whole allocation is retried on the rewritten
                  code — which is why round {round > 1 ? round : 2} exists.
                </p>
              </Notice>
            )}

            {rewrites.length > 0 && (
              <Panel
                title={`Spill rewriting — round ${round}`}
                subtitle={`${rewrites.length} instruction(s) rewritten`}
                bodyClassName="p-3"
              >
                <ul className="flex flex-col gap-1 font-mono text-xs text-ink-muted">
                  {rewrites.map((m, i) => (
                    <li key={`${m.node}-${m.atIndex}-${i}`}>
                      instruction {m.atIndex}: <span className="text-ink">{m.node}</span> →
                      scratch <span className="text-ink">{m.scratch}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            <Legend
              items={[
                {
                  swatch: <CircleCheck aria-hidden className="size-3.5 text-ok" />,
                  label: 'colored (register named on the node)',
                },
                {
                  swatch: (
                    <span aria-hidden className="cg-hatch-warn inline-block h-3 w-6 ring-1 ring-warn/60" />
                  ),
                  label: 'potential / actual spill (hatched)',
                },
                {
                  swatch: <ArrowUpFromLine aria-hidden className="size-3.5 text-ink-faint" />,
                  label: 'on the stack (struck through in the graph)',
                },
              ]}
            />
          </>
        );
      }}
    </TraceSplit>
  );
}

function RegisterFile({
  palette,
  holder,
  k,
}: {
  palette: readonly string[];
  holder: ReadonlyMap<string, string>;
  k: number;
}) {
  return (
    <Panel
      title="Register file"
      subtitle={`K = ${k} of ${GP_REGISTERS.length} general-purpose registers`}
      bodyClassName="p-3"
    >
      <ul className="flex flex-wrap gap-2">
        {GP_REGISTERS.map((r) => {
          const available = palette.includes(r);
          const held = holder.get(r);
          return (
            <li
              key={r}
              className={clsx(
                'flex min-w-24 flex-col gap-0.5 rounded-md border px-2 py-1 font-mono text-xs',
                !available && 'border-dashed border-line text-ink-faint',
                available && held !== undefined && 'border-ok/50 bg-ok-soft text-ok',
                available && held === undefined && 'border-line bg-raised text-ink-muted',
              )}
            >
              <span className="font-semibold">{r}</span>
              <span className="text-[10px]">
                {!available ? 'not offered (K)' : (held ?? 'free')}
              </span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

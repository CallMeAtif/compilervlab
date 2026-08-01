/**
 * The GOTO automaton of an item-set collection, laid out once by ElkGraph.
 *
 * Structure comes from the FINAL collection (`trace.final()`), never from the
 * cursor: stepping only changes which nodes/edges are marked visited or current,
 * so ELK runs exactly once per grammar — the layout-stability rule.
 *
 * Nodes stay one line — the state name and its item count. The full item list
 * would make the automaton unreadable at LALR sizes, so it lives in the node’s
 * title and in the item-set panel beside the graph.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Network } from 'lucide-react';
import { ElkGraph, type ElkGraphEdge, type ElkGraphNode } from '../../../components/viz/ElkGraph';
import { Legend, Note, TextButton } from './ui';

/** Above this many states, ELK + React Flow cost more than they teach. */
const AUTO_RENDER_LIMIT = 48;

export interface GotoGraphState {
  id: number;
  name: string;
  itemCount: number;
  /** Full item list, one per line — shown as the node’s native tooltip. */
  detail: string;
}

export interface GotoGraphProps {
  states: readonly GotoGraphState[];
  transitions: ReadonlyArray<{ from: number; symbol: string; to: number }>;
  currentStateId: number | null;
  visitedStateIds: ReadonlySet<number>;
  currentEdge: { from: number; symbol: string; to: number } | null;
  /**
   * Transport for fullscreen. This is the largest artifact in the app — the
   * C-grammar LALR automaton — so fullscreen is the way it is meant to be read,
   * and it has to stay steppable there: fullscreen hides the trace panel.
   */
  controls?: ReactNode;
}

export function edgeKey(t: { from: number; symbol: string; to: number }): string {
  return `${t.from}|${t.symbol}|${t.to}`;
}

export function GotoGraph({
  states,
  transitions,
  currentStateId,
  visitedStateIds,
  currentEdge,
  controls,
}: GotoGraphProps) {
  const [forced, setForced] = useState(false);
  const show = forced || states.length <= AUTO_RENDER_LIMIT;

  const nodes = useMemo<ElkGraphNode[]>(
    () =>
      states.map((s) => ({
        id: `I${s.id}`,
        label: `I${s.name} · ${s.itemCount} items`,
        kind: s.id === 0 ? 'start' : 'state',
        reactNode: (
          <span title={s.detail} className="cursor-help">
            <span className="font-semibold">I{s.name}</span>
            <span className="text-ink-faint"> · {s.itemCount} items</span>
          </span>
        ),
      })),
    [states],
  );

  const edges = useMemo<ElkGraphEdge[]>(
    () =>
      transitions.map((t) => ({
        id: edgeKey(t),
        source: `I${t.from}`,
        target: `I${t.to}`,
        label: t.symbol,
      })),
    [transitions],
  );

  const visited = useMemo(() => {
    const set = new Set<string>();
    for (const id of visitedStateIds) set.add(`I${id}`);
    for (const t of transitions) {
      if (visitedStateIds.has(t.from) && visitedStateIds.has(t.to)) set.add(edgeKey(t));
    }
    return set;
  }, [visitedStateIds, transitions]);

  if (!show) {
    return (
      <Note
        tone="info"
        title={`${states.length} states — the GOTO graph is not drawn automatically`}
        actions={
          <TextButton onClick={() => setForced(true)}>
            Draw the {states.length}-state graph anyway
          </TextButton>
        }
      >
        A layout this size costs seconds. Step the item sets in the panel instead.
      </Note>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <ElkGraph
        nodes={nodes}
        edges={edges}
        direction="RIGHT"
        currentNodeIds={currentStateId === null ? [] : [`I${currentStateId}`]}
        currentEdgeIds={currentEdge ? [edgeKey(currentEdge)] : []}
        visitedIds={visited}
        height="24rem"
        controls={controls}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Network aria-hidden className="size-3.5 text-ink-faint" />
        <Legend
          items={[
            {
              label: 'building',
              swatch: (
                <span
                  aria-hidden
                  className="inline-block size-3 rounded-sm border-2 border-accent shadow-[0_0_0_2px_var(--surface),0_0_0_3px_var(--accent)]"
                />
              ),
            },
            {
              label: 'built',
              swatch: (
                <span aria-hidden className="inline-block size-3 rounded-sm border border-ink-faint bg-raised" />
              ),
            },
            {
              label: 'not reached',
              swatch: (
                <span aria-hidden className="inline-block size-3 rounded-sm border border-line-strong bg-surface" />
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}

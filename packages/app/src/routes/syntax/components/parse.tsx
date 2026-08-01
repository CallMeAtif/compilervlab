/**
 * Shared parse-view pieces: the input ribbon (what has been consumed, what the
 * lookahead is), the Fig 4.21 / Fig 4.38 move table, and a TidyTree wrapper that
 * refuses to draw forests big enough to freeze the tab without being asked.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { TidyTree, type TidyTreeNode } from '../../../components/viz/TidyTree';
import { Note, TextButton } from './ui';

// ── Input ribbon ─────────────────────────────────────────────────────────────

export function InputRibbon({
  symbols,
  pos,
  label = 'Input',
}: {
  symbols: readonly string[];
  /** Index of the lookahead; `symbols.length` means the endmarker $. */
  pos: number;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current?.querySelector('[data-lookahead="true"]');
    if (el instanceof HTMLElement) el.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [pos]);

  const cells = [...symbols, '$'];
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="group-label">
        {label} · {pos} / {symbols.length} consumed
      </span>
      <div
        ref={ref}
        role="list"
        aria-label={label}
        className="framed artifact-scroll flex max-h-20 flex-wrap gap-1 p-1.5"
      >
        {cells.map((sym, i) => {
          const consumed = i < pos;
          const lookahead = i === pos;
          return (
            <span
              key={`${sym}-${i}`}
              role="listitem"
              data-lookahead={lookahead || undefined}
              className={clsx(
                'inline-flex h-6 items-center rounded border px-1.5 font-mono text-[11px] transition-colors',
                lookahead && 'border-accent bg-accent-soft font-semibold text-ink shadow-[inset_0_0_0_1px_var(--accent)]',
                consumed && 'border-line bg-raised text-ink-faint line-through',
                !consumed && !lookahead && 'border-line bg-surface text-ink-muted',
              )}
            >
              {lookahead && (
                <span aria-hidden className="mr-1 text-accent">
                  ▾
                </span>
              )}
              {sym}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ── Move table ───────────────────────────────────────────────────────────────

export interface MoveColumn {
  key: string;
  header: string;
  /** Monospace, wrapping cell content. */
  grow?: boolean;
}

/** Rows are appended by the trace; only the tail is rendered for long parses. */
export function MoveTable<R extends object>({
  columns,
  rows,
  ariaLabel,
  tail = 120,
}: {
  columns: readonly MoveColumn[];
  rows: readonly R[];
  ariaLabel: string;
  tail?: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const hidden = showAll ? 0 : Math.max(0, rows.length - tail);
  const visible = hidden === 0 ? rows : rows.slice(hidden);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows.length]);

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {hidden > 0 && (
        <div className="flex items-center gap-2 text-[11px] text-ink-muted">
          <span>{hidden.toLocaleString()} earlier moves hidden</span>
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="h-7 cursor-pointer rounded border border-control px-2 text-[11px] hover:border-line-strong hover:text-ink"
          >
            show all
          </button>
        </div>
      )}
      <div
        ref={bodyRef}
        className="framed artifact-scroll max-h-96 min-w-0"
      >
        <table className="w-full border-collapse font-mono text-[11px]" aria-label={ariaLabel}>
          <thead className="sticky top-0 z-10 bg-raised text-ink-muted">
            <tr>
              <th scope="col" className="w-10 px-2 py-1.5 text-right font-semibold">
                #
              </th>
              {columns.map((c) => (
                <th key={c.key} scope="col" className="px-2 py-1.5 text-left font-semibold">
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => {
              const idx = hidden + i;
              const last = idx === rows.length - 1;
              return (
                <tr
                  key={idx}
                  className={clsx(
                    'border-t border-line/60 align-top',
                    last && 'bg-accent-soft font-semibold text-ink',
                  )}
                >
                  <td className="px-2 py-1 text-right text-ink-faint">
                    {last && (
                      <span aria-hidden className="mr-0.5 text-accent">
                        ▸
                      </span>
                    )}
                    {idx + 1}
                  </td>
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={clsx(
                        'px-2 py-1 break-all whitespace-pre-wrap',
                        c.grow ? 'text-ink' : 'text-ink-muted',
                      )}
                    >
                      {(row as Record<string, string | undefined>)[c.key] ?? ''}
                    </td>
                  ))}
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="px-2 py-6 text-center text-ink-faint">
                  Step forward to start the parse.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Trees ────────────────────────────────────────────────────────────────────

const TREE_AUTO_LIMIT = 260;

export function TreePanel({
  root,
  nodeCount,
  currentIds,
  visitedIds,
  emptyLabel,
  controls,
}: {
  root: TidyTreeNode | null;
  nodeCount: number;
  currentIds?: readonly string[];
  visitedIds?: readonly string[];
  emptyLabel: string;
  /** Transport bar for the tree's fullscreen mode (fullscreen hides the panel). */
  controls?: ReactNode;
}) {
  const [forced, setForced] = useState(false);
  if (!root || nodeCount === 0) {
    return <p className="prose-note text-sm">{emptyLabel}</p>;
  }
  if (!forced && nodeCount > TREE_AUTO_LIMIT) {
    return (
      <Note
        tone="info"
        title={`${nodeCount.toLocaleString()} nodes — the tree is not drawn automatically`}
        actions={<TextButton onClick={() => setForced(true)}>Draw it anyway</TextButton>}
      >
        A tree this size is re-laid out on every step. The move table carries the same information.
      </Note>
    );
  }
  return (
    <TidyTree
      root={root}
      currentIds={currentIds}
      visitedIds={visitedIds}
      controls={controls}
      className="max-h-[32rem]"
    />
  );
}

/** Build a TidyTree from an id-indexed node list, with a synthetic forest root. */
export function buildForest<N extends { id: number; children: readonly number[] }>(
  nodes: readonly N[],
  roots: readonly number[],
  label: (n: N) => string,
  kind?: (n: N) => string | undefined,
): { root: TidyTreeNode | null; count: number } {
  if (nodes.length === 0 || roots.length === 0) return { root: null, count: 0 };
  const byId = new Map<number, N>();
  for (const n of nodes) byId.set(n.id, n);
  let count = 0;
  const seen = new Set<number>();
  const build = (id: number): TidyTreeNode | null => {
    const n = byId.get(id);
    if (!n || seen.has(id)) return null;
    seen.add(id);
    count++;
    const children = n.children.map(build).filter((c): c is TidyTreeNode => c !== null);
    return {
      id: `n${id}`,
      label: label(n),
      ...(kind ? { kind: kind(n) } : {}),
      ...(children.length > 0 ? { children } : {}),
    };
  };
  const built = roots.map(build).filter((c): c is TidyTreeNode => c !== null);
  if (built.length === 1) return { root: built[0]!, count };
  return {
    root: { id: 'forest', label: `forest (${built.length})`, kind: 'forest', children: built },
    count: count + 1,
  };
}

export function useForest<N extends { id: number; children: readonly number[] }>(
  nodes: readonly N[],
  roots: readonly number[],
  label: (n: N) => string,
  kind?: (n: N) => string | undefined,
) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => buildForest(nodes, roots, label, kind), [nodes, roots]);
}

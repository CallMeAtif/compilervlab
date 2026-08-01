/**
 * Item-set inspector shared by LR(0), canonical LR(1) and LALR(1).
 *
 * Kernel items are bold and tagged K, closure items are dimmed and tagged C
 * (shape + text, never colour alone). During CLOSURE micro-steps the item that
 * justified the addition is outlined and labelled "justifies", and the item just
 * added is marked "new" — that pairing is the whole point of Fig 4.32/4.40.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { Pin, PinOff } from 'lucide-react';

export interface ItemRow {
  /** Core key `${prod}.${dot}` — lookaheads of one core are merged into a row. */
  key: string;
  dotted: string;
  kernel: boolean;
  lookaheads: readonly string[];
}

export interface ItemSetState {
  id: number;
  name: string;
  rows: readonly ItemRow[];
}

export interface ItemMark {
  stateId: number;
  key: string;
  la?: string;
}

export function ItemSets({
  states,
  currentStateId,
  added,
  justifies,
  emptyLabel = 'No states built yet — step forward to start the collection.',
}: {
  states: readonly ItemSetState[];
  currentStateId: number | null;
  added: ItemMark | null;
  justifies: ItemMark | null;
  emptyLabel?: string;
}) {
  const [pinned, setPinned] = useState<number | null>(null);
  const selectedId = pinned ?? currentStateId ?? states[states.length - 1]?.id ?? null;
  const selected = states.find((s) => s.id === selectedId) ?? null;

  const chipsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = chipsRef.current?.querySelector('[data-selected="true"]');
    if (el instanceof HTMLElement) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selectedId]);

  const rowMarks = useMemo(() => {
    const addedKey = added && added.stateId === selectedId ? added.key : null;
    const justKey = justifies && justifies.stateId === selectedId ? justifies.key : null;
    return { addedKey, justKey };
  }, [added, justifies, selectedId]);

  if (states.length === 0) {
    return <p className="p-2 text-sm text-ink-muted">{emptyLabel}</p>;
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div
        ref={chipsRef}
        role="tablist"
        aria-label="Item sets"
        className="flex max-h-24 flex-wrap gap-1 overflow-auto rounded-md border border-line bg-canvas p-1.5"
      >
        {states.map((s) => {
          const isCurrent = s.id === currentStateId;
          const isSelected = s.id === selectedId;
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={isSelected}
              data-selected={isSelected}
              aria-label={`Item set I${s.name}${isCurrent ? ' (being built)' : ''}`}
              onClick={() => setPinned(s.id)}
              className={clsx(
                'h-7 min-w-9 cursor-pointer rounded border px-1.5 font-mono text-[11px] transition-colors',
                isSelected
                  ? 'border-accent bg-accent-soft font-semibold text-ink'
                  : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink',
              )}
            >
              {isCurrent && (
                <span aria-hidden className="mr-0.5 text-accent">
                  ▸
                </span>
              )}
              I{s.name}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <h4 className="font-mono text-sm font-semibold text-ink">
          I{selected?.name ?? '—'}
          <span className="ml-2 font-sans text-xs font-normal text-ink-muted">
            {selected?.rows.length ?? 0} item{(selected?.rows.length ?? 0) === 1 ? '' : 's'}
          </span>
        </h4>
        <span className="flex-1" />
        <button
          type="button"
          aria-label={pinned === null ? 'Pinned to the state being built' : 'Follow the state being built'}
          onClick={() => setPinned(null)}
          disabled={pinned === null}
          className="flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-control px-2.5 text-[11px] text-ink-muted transition-colors hover:border-line-strong hover:text-ink disabled:cursor-default disabled:opacity-50"
        >
          {pinned === null ? <Pin aria-hidden className="size-3.5" /> : <PinOff aria-hidden className="size-3.5" />}
          {pinned === null ? 'following current' : 'follow current'}
        </button>
      </div>

      <ul className="flex max-h-96 min-w-0 flex-col gap-0.5 overflow-auto rounded-md border border-line bg-canvas p-1.5 font-mono text-xs">
        {(selected?.rows ?? []).map((row) => {
          const isNew = row.key === rowMarks.addedKey;
          const isWhy = row.key === rowMarks.justKey;
          return (
            <li
              key={row.key}
              className={clsx(
                'flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded px-1.5 py-1 transition-colors',
                isNew && 'bg-accent-soft',
                isWhy && 'outline-2 outline-offset-[-2px] outline-dashed outline-ink-faint',
              )}
            >
              <span
                aria-hidden
                className={clsx(
                  'w-4 shrink-0 rounded-sm text-center text-[9px] leading-4 font-semibold',
                  row.kernel ? 'bg-ink-muted text-surface' : 'bg-raised text-ink-faint',
                )}
                title={row.kernel ? 'kernel item' : 'closure item'}
              >
                {row.kernel ? 'K' : 'C'}
              </span>
              <span className={clsx('min-w-0', row.kernel ? 'font-semibold text-ink' : 'text-ink-muted')}>
                [{row.dotted}
                {row.lookaheads.length > 0 && <span className="text-ink-faint">, </span>}
                {row.lookaheads.map((la, i) => (
                  <span key={la}>
                    {i > 0 && <span className="text-ink-faint">/</span>}
                    <span className="text-accent">{la}</span>
                  </span>
                ))}
                ]
              </span>
              {isNew && (
                <span className="rounded-full bg-accent px-1.5 text-[9px] font-semibold text-on-accent">
                  new
                </span>
              )}
              {isWhy && (
                <span className="rounded-full border border-dashed border-ink-faint px-1.5 text-[9px] font-semibold text-ink-muted">
                  justifies it
                </span>
              )}
            </li>
          );
        })}
        {(selected?.rows.length ?? 0) === 0 && (
          <li className="px-1.5 py-2 text-ink-faint">This state has no items yet.</li>
        )}
      </ul>
    </div>
  );
}

/** Merge per-lookahead items of the same core into one row (book presentation). */
export function mergeItemRows(
  items: ReadonlyArray<{ prod: number; dot: number; kernel: boolean; la?: string }>,
  dotted: (prod: number, dot: number) => string,
): ItemRow[] {
  const order: string[] = [];
  const byKey = new Map<string, ItemRow & { lookaheads: string[] }>();
  for (const it of items) {
    const key = `${it.prod}.${it.dot}`;
    let row = byKey.get(key);
    if (!row) {
      row = { key, dotted: dotted(it.prod, it.dot), kernel: it.kernel, lookaheads: [] };
      byKey.set(key, row);
      order.push(key);
    }
    row.kernel = row.kernel || it.kernel;
    if (it.la !== undefined && !row.lookaheads.includes(it.la)) row.lookaheads.push(it.la);
  }
  return order.map((k) => byKey.get(k)!);
}

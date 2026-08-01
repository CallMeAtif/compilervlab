/**
 * Virtualized table for big ACTION/GOTO tables (@tanstack/react-virtual).
 * Sticky column headers + sticky row-header column, cell highlighting, and
 * patterned (not color-only) conflict cells.
 *
 * Row selection is opt-in: pass `onRowSelect` and the body becomes a keyboard
 * navigable grid (arrows / Home / End / click). `scrollToRowId` follows a row
 * imperatively — on the C grammar the filling cursor walks 147 rows off screen,
 * so a step-synchronized view must be able to say "keep this row in view"
 * without owning the scroll container.
 */
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { clsx } from 'clsx';

export interface VTableCell {
  text: string;
  /** Emphasized cell (e.g. the ACTION[s, a] entry the parse just used). */
  current?: boolean;
  /** Secondary emphasis (e.g. entries filled so far). */
  highlight?: boolean;
  /** Conflict cell — patterned background + inset ring (shape, not color). */
  conflict?: boolean;
  title?: string;
}

export interface VTableColumn {
  key: string;
  header: string;
  width?: number;
}

export interface VTableRow {
  id: string;
  /** Sticky left row header (state number, nonterminal, …). */
  header: string;
  cells: Record<string, VTableCell | undefined>;
}

/** Context handed to `renderCell`. */
export interface VTableCellContext {
  row: VTableRow;
  rowIndex: number;
  column: VTableColumn;
  selected: boolean;
}

export interface VirtualTableHandle {
  /** Scroll a row into view by id, or by 0-based index. */
  scrollToRow: (row: string | number, align?: 'auto' | 'center' | 'start') => void;
}

export interface VirtualTableProps {
  columns: VTableColumn[];
  rows: VTableRow[];
  /** Header of the sticky row-header column. */
  cornerLabel?: string;
  height?: number;
  className?: string;
  'aria-label'?: string;

  /** Selected row id — styled, `aria-selected`, and the arrow-key anchor. */
  selectedRowId?: string | null;
  /** Enables click/keyboard selection. Called with the row and its index. */
  onRowSelect?: (rowId: string, index: number) => void;
  /**
   * Row to keep in view. Scrolls whenever the value changes; pass the current
   * step's row to make the table follow the cursor.
   */
  scrollToRowId?: string | null;
  /** Imperative escape hatch for the same thing. */
  ref?: Ref<VirtualTableHandle>;
  /** Replaces a cell's body. Return undefined to fall back to `cell.text`. */
  renderCell?: (cell: VTableCell | undefined, ctx: VTableCellContext) => ReactNode;
}

const ROW_H = 32;
const HEADER_COL_W = 72;
const DEFAULT_COL_W = 68;

export function VirtualTable({
  columns,
  rows,
  cornerLabel = '',
  height = 420,
  className,
  'aria-label': ariaLabel,
  selectedRowId = null,
  onRowSelect,
  scrollToRowId = null,
  ref,
  renderCell,
}: VirtualTableProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 10,
  });

  const indexOfRow = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r, i) => m.set(r.id, i));
    return m;
  }, [rows]);

  const scrollToIndex = useCallback(
    (index: number, align: 'auto' | 'center' | 'start' = 'auto') => {
      const scroller = scrollRef.current;
      if (!scroller || index < 0 || index >= rows.length) return;
      const top = index * ROW_H;
      if (align === 'auto') {
        // The header row floats over the first ROW_H px of the scroller.
        const viewTop = scroller.scrollTop + ROW_H;
        const viewBottom = scroller.scrollTop + scroller.clientHeight - ROW_H;
        if (top >= viewTop && top <= viewBottom) return;
        scroller.scrollTop = Math.max(0, top - scroller.clientHeight / 2);
        return;
      }
      scroller.scrollTop =
        align === 'center' ? Math.max(0, top - scroller.clientHeight / 2) : Math.max(0, top - ROW_H);
    },
    [rows.length],
  );

  useImperativeHandle(
    ref,
    (): VirtualTableHandle => ({
      scrollToRow: (row, align) =>
        scrollToIndex(typeof row === 'number' ? row : (indexOfRow.get(row) ?? -1), align),
    }),
    [scrollToIndex, indexOfRow],
  );

  // Follow the requested row. Keyed on the id (not the index) so a re-derived
  // row list with the same cursor does not re-scroll and fight the user.
  useEffect(() => {
    if (scrollToRowId === null) return;
    const index = indexOfRow.get(scrollToRowId);
    if (index !== undefined) scrollToIndex(index);
  }, [scrollToRowId, indexOfRow, scrollToIndex]);

  const select = useCallback(
    (index: number) => {
      const row = rows[index];
      if (!row || !onRowSelect) return;
      onRowSelect(row.id, index);
      scrollToIndex(index);
    },
    [rows, onRowSelect, scrollToIndex],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (!onRowSelect || rows.length === 0) return;
      const at = selectedRowId === null ? -1 : (indexOfRow.get(selectedRowId) ?? -1);
      let next: number | null = null;
      if (e.key === 'ArrowDown') next = Math.min(rows.length - 1, at + 1);
      else if (e.key === 'ArrowUp') next = at <= 0 ? 0 : at - 1;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = rows.length - 1;
      if (next === null) return;
      e.preventDefault();
      select(next);
    },
    [onRowSelect, rows.length, selectedRowId, indexOfRow, select],
  );

  const totalWidth =
    HEADER_COL_W + columns.reduce((w, c) => w + (c.width ?? DEFAULT_COL_W), 0);

  const selectable = onRowSelect !== undefined;

  return (
    <div
      ref={scrollRef}
      role={selectable ? 'grid' : 'table'}
      aria-label={ariaLabel}
      aria-rowcount={rows.length + 1}
      aria-colcount={columns.length + 1}
      tabIndex={selectable ? 0 : undefined}
      onKeyDown={selectable ? onKeyDown : undefined}
      className={clsx(
        'relative overflow-auto rounded-lg border border-line bg-surface font-mono text-xs',
        className,
      )}
      style={{ height }}
    >
      {/* sticky header row */}
      <div
        role="row"
        className="sticky top-0 z-20 flex border-b border-line bg-raised font-semibold text-ink-muted"
        style={{ width: totalWidth }}
      >
        <div
          role="columnheader"
          className="sticky left-0 z-30 flex shrink-0 items-center border-r border-line bg-raised px-2"
          style={{ width: HEADER_COL_W, height: ROW_H }}
        >
          {cornerLabel}
        </div>
        {columns.map((c) => (
          <div
            key={c.key}
            role="columnheader"
            className="flex shrink-0 items-center justify-center border-r border-line/60 px-1 text-center"
            style={{ width: c.width ?? DEFAULT_COL_W, height: ROW_H }}
          >
            {c.header}
          </div>
        ))}
      </div>

      {/* virtualized body */}
      <div className="relative" style={{ height: virtualizer.getTotalSize(), width: totalWidth }}>
        {virtualizer.getVirtualItems().map((v) => {
          const row = rows[v.index];
          if (!row) return null;
          const selected = selectedRowId !== null && row.id === selectedRowId;
          return (
            <div
              key={row.id}
              role="row"
              aria-rowindex={v.index + 2}
              // aria-selected is only meaningful inside a grid; a followed row
              // in a plain table is announced with aria-current instead.
              aria-selected={selectable ? selected : undefined}
              aria-current={!selectable && selected ? 'true' : undefined}
              onClick={selectable ? () => select(v.index) : undefined}
              className={clsx(
                'absolute left-0 flex w-full border-b border-line/50',
                selectable && 'cursor-pointer',
              )}
              style={{ transform: `translateY(${v.start}px)`, height: v.size }}
            >
              <div
                role="rowheader"
                className={clsx(
                  'sticky left-0 z-10 flex shrink-0 items-center border-r border-line px-2 font-semibold',
                  selected
                    ? 'bg-accent-soft text-ink shadow-[inset_2px_0_0_var(--accent)]'
                    : 'bg-raised text-ink-muted',
                )}
                style={{ width: HEADER_COL_W }}
              >
                {row.header}
              </div>
              {columns.map((c) => {
                const cell = row.cells[c.key];
                const body = renderCell?.(cell, {
                  row,
                  rowIndex: v.index,
                  column: c,
                  selected,
                });
                // Conflict/current are drawn as a 45deg hatch and an inset ring
                // (shape, not colour). Screen readers get the same distinction
                // as words appended to the cell's accessible name.
                const state = cell?.conflict
                  ? ', conflict'
                  : cell?.current
                    ? ', current entry'
                    : '';
                return (
                  <div
                    key={c.key}
                    role={selectable ? 'gridcell' : 'cell'}
                    title={cell?.title}
                    aria-label={state ? `${cell?.text ?? 'empty'}${state}` : undefined}
                    className={clsx(
                      'flex shrink-0 items-center justify-center overflow-hidden border-r border-line/40 px-1 whitespace-nowrap',
                      cell?.conflict && 'cell-conflict font-semibold text-err',
                      !cell?.conflict && cell?.current && 'bg-accent-soft font-semibold text-ink shadow-[inset_0_0_0_1.5px_var(--accent)]',
                      !cell?.conflict && !cell?.current && cell?.highlight && 'bg-raised text-ink',
                      !cell?.conflict && !cell?.current && !cell?.highlight && 'text-ink-muted',
                    )}
                    style={{ width: c.width ?? DEFAULT_COL_W }}
                  >
                    {body !== undefined ? body : (cell?.text ?? '')}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {rows.length === 0 && (
        <div className="flex h-24 items-center justify-center text-ink-faint">
          No rows to display.
        </div>
      )}
    </div>
  );
}

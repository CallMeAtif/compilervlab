/**
 * The three representations of ONE program (§6.2.2–6.2.3), over the same quads:
 *
 *   QUADRUPLES       op · arg1 · arg2 · result — canonical; what the reducer
 *                    actually holds and what every later phase consumes.
 *   TRIPLES          no result field: a value is named by the position of the
 *                    triple that computes it, "(i)". Derived by toTriples().
 *   INDIRECT TRIPLES the same triples plus an instruction listing of pointers
 *                    into them, so code can be reordered without renumbering.
 *
 * Triples and indirect triples are derived on every render from the quads the
 * trace has emitted so far (`@lab/core/ir/views.js`) — never stored. Each
 * derived row keeps its `quadIndex`, which is what keeps highlighting,
 * hovering and provenance identical across all three tabs.
 */
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { clsx } from 'clsx';
import { ChevronRight, CornerDownRight, Link2, Circle } from 'lucide-react';
import type { Quad } from '@lab/core/ir/types.js';
import { formatQuad } from '@lab/core/ir/types.js';
import type { IrGenFunctionState, ActiveList } from '@lab/core/ir/ir-events.js';
import { toIndirectTriples, type TripleRow } from '@lab/core/ir/views.js';
import {
  hasPendingTarget,
  isJump,
  operandText,
  quadOpLabel,
} from './provenance';

export type IrRepresentation = 'quads' | 'triples' | 'indirect';

export const REPRESENTATIONS: ReadonlyArray<{
  id: IrRepresentation;
  label: string;
  cite: string;
  hint: string;
}> = [
  {
    id: 'quads',
    label: 'Quadruples',
    cite: '§6.2.2',
    hint: 'op, arg1, arg2, result. Canonical; the result field names a temporary.',
  },
  {
    id: 'triples',
    label: 'Triples',
    cite: '§6.2.3',
    hint: 'No result field: a value is the position (i) of the triple computing it.',
  },
  {
    id: 'indirect',
    label: 'Indirect triples',
    cite: '§6.2.3',
    hint: 'Triples plus a listing of pointers, so reordering renumbers nothing.',
  },
];

/** Which emphasis a row carries. Never colour alone — each state also gets a
 *  gutter glyph and a border treatment. */
export interface RowEmphasis {
  emitted: boolean;
  patched: boolean;
  linked: boolean;
  listed: boolean;
}

export interface RepresentationViewProps {
  representation: IrRepresentation;
  fn: IrGenFunctionState | null;
  emitted: ReadonlySet<number>;
  patched: ReadonlySet<number>;
  linkedInstrs: ReadonlySet<number>;
  listedInstrs: ReadonlySet<number>;
  /** instruction index → the still-open backpatch list it sits on. */
  pendingLists: ReadonlyMap<number, ActiveList>;
  pinnedInstr: number | null;
  onHoverInstr: (instr: number | null) => void;
  onPinInstr: (instr: number | null) => void;
  /**
   * The listing is filling the screen. Its 26rem cap is what makes it a figure
   * on a page; fullscreen it has to be dropped, or the reader gets the same
   * short window with black around it.
   */
  expanded?: boolean;
}

const ROLE_GLYPH: Record<ActiveList['role'], string> = {
  truelist: 'T',
  falselist: 'F',
  nextlist: 'N',
};

function emphasisOf(
  instr: number,
  p: Pick<
    RepresentationViewProps,
    'emitted' | 'patched' | 'linkedInstrs' | 'listedInstrs'
  >,
): RowEmphasis {
  return {
    emitted: p.emitted.has(instr),
    patched: p.patched.has(instr),
    linked: p.linkedInstrs.has(instr),
    listed: p.listedInstrs.has(instr),
  };
}

/**
 * The listing is a code figure, so an instruction is marked in the MARGIN — a
 * 3px bar on the leading edge plus the gutter glyph — rather than by painting
 * the whole row. Only the current instruction carries a whisper of accent fill
 * so it can be found at a glance in a long listing.
 */
function rowClass(e: RowEmphasis): string {
  if (e.patched) return 'shadow-[inset_3px_0_0_var(--accent)]';
  if (e.emitted) return 'bg-accent-soft/45 shadow-[inset_3px_0_0_var(--accent)]';
  if (e.linked) return 'shadow-[inset_3px_0_0_var(--ink-faint)]';
  if (e.listed) return 'shadow-[inset_3px_0_0_var(--warn)]';
  return '';
}

function RowMarker({ e }: { e: RowEmphasis }) {
  if (e.patched) {
    return (
      <>
        <CornerDownRight aria-hidden className="size-3.5 text-accent" />
        <span className="sr-only">target filled in by this step</span>
      </>
    );
  }
  if (e.emitted) {
    return (
      <>
        <ChevronRight aria-hidden className="size-3.5 text-accent" />
        <span className="sr-only">emitted by this step</span>
      </>
    );
  }
  if (e.linked) {
    return (
      <>
        <Link2 aria-hidden className="size-3.5 text-ink-faint" />
        <span className="sr-only">same AST node as the linked instruction</span>
      </>
    );
  }
  if (e.listed) {
    return (
      <>
        <Circle aria-hidden className="size-2.5 text-warn" />
        <span className="sr-only">on a backpatch list</span>
      </>
    );
  }
  return null;
}

/** Dashed "not yet known" target cell — the visual the backpatch fills in. */
function PendingTarget({ list }: { list: ActiveList | undefined }) {
  return (
    <span
      title={
        list
          ? `target unknown — instruction is on ${list.role} #${list.id}, waiting for backpatch (§6.7.1)`
          : 'target unknown — waiting for backpatch (§6.7.1)'
      }
      className="inline-flex items-center gap-1 rounded border border-dashed border-warn px-1.5 py-px text-warn"
    >
      <span aria-hidden>_</span>
      <span className="sr-only">target not yet filled in</span>
      {list && <span className="text-3xs font-semibold">{ROLE_GLYPH[list.role]}</span>}
    </span>
  );
}

// ── shared table chrome ──────────────────────────────────────────────────────

function TableShell({
  label,
  head,
  children,
  minWidth = '30rem',
  expanded = false,
}: {
  label: string;
  head: ReactNode;
  children: ReactNode;
  minWidth?: string;
  expanded?: boolean;
}) {
  return (
    // A code listing genuinely needs containing, so it is one of the few things
    // that earns a border (`.framed`) — everything around it is rules and air.
    <div className={clsx('framed artifact-scroll', expanded ? 'h-full max-h-none' : 'max-h-[26rem]')}>
      <table
        aria-label={label}
        className="w-full border-collapse text-left font-mono text-xs"
        style={{ minWidth }}
      >
        {/* The rule under the header is a shadow, not the <tr> border: a
            border-collapse border does not stay put under a sticky thead. */}
        <thead className="sticky top-0 z-10 bg-surface text-ink-faint shadow-[inset_0_-1px_0_var(--line-strong)]">
          {head}
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

const TH = 'h-8 px-2 font-normal tracking-wide whitespace-nowrap';
const TD = 'h-9 px-2 align-middle whitespace-nowrap';

/** Roving-tabindex focus over data rows: one tab stop for the whole table,
 *  ↑/↓/Home/End move between rows (WAI-ARIA grid pattern). */
function useRovingRows(count: number, onActivate?: (i: number) => void) {
  const [cursor, setCursor] = useState(0);
  const refs = useRef<Array<HTMLTableRowElement | null>>([]);
  const active = Math.min(cursor, Math.max(0, count - 1));

  const focusRow = useCallback(
    (i: number) => {
      const n = Math.max(0, Math.min(count - 1, i));
      setCursor(n);
      refs.current[n]?.focus();
    },
    [count],
  );

  const rowProps = (i: number) => ({
    tabIndex: i === active ? 0 : -1,
    ref: (el: HTMLTableRowElement | null) => {
      refs.current[i] = el;
    },
    onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        focusRow(i + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        focusRow(i - 1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        focusRow(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        focusRow(count - 1);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onActivate?.(i);
      }
    },
  });

  return { rowProps };
}

// ── quadruples (canonical) ───────────────────────────────────────────────────

function QuadTable({
  quads,
  props,
}: {
  quads: readonly Quad[];
  props: RepresentationViewProps;
}) {
  const togglePin = useCallback(
    (i: number) => {
      const q = quads[i];
      if (q) props.onPinInstr(props.pinnedInstr === q.index ? null : q.index);
    },
    [quads, props],
  );
  const { rowProps } = useRovingRows(quads.length, togglePin);
  return (
    <TableShell
      label="Quadruples"
      minWidth="34rem"
      expanded={props.expanded ?? false}
      head={
        <tr>
          <th className={clsx(TH, 'w-6')} aria-label="row marker" />
          <th className={clsx(TH, 'w-10 text-right')}>#</th>
          <th className={TH}>op</th>
          <th className={TH}>arg1</th>
          <th className={TH}>arg2</th>
          <th className={TH}>result</th>
          <th className={clsx(TH, 'text-ink-faint')}>three-address form</th>
        </tr>
      }
    >
      {quads.map((q, i) => {
        const e = emphasisOf(q.index, props);
        const pending = hasPendingTarget(q);
        const list = props.pendingLists.get(q.index);
        return (
          <tr
            key={q.index}
            {...rowProps(i)}
            aria-label={`instruction ${q.index}: ${formatQuad(q)}`}
            onMouseEnter={() => props.onHoverInstr(q.index)}
            onMouseLeave={() => props.onHoverInstr(null)}
            onFocus={() => props.onHoverInstr(q.index)}
            onBlur={() => props.onHoverInstr(null)}
            onClick={() =>
              props.onPinInstr(props.pinnedInstr === q.index ? null : q.index)
            }
            className={clsx(
              'cursor-pointer border-b border-line/60 transition-colors duration-150 hover:bg-raised',
              rowClass(e),
              props.pinnedInstr === q.index && 'outline-2 -outline-offset-2 outline-accent',
            )}
          >
            <td className={clsx(TD, 'px-1')}>
              <RowMarker e={e} />
            </td>
            <td className={clsx(TD, 'text-right text-ink-faint')}>{q.index}</td>
            <td className={clsx(TD, 'font-semibold text-ink')}>{quadOpLabel(q)}</td>
            <td className={clsx(TD, 'text-ink-muted')}>{operandText(q.arg1)}</td>
            <td className={clsx(TD, 'text-ink-muted')}>{operandText(q.arg2)}</td>
            <td className={clsx(TD, e.patched && 'ir-patch-fill')}>
              {pending ? (
                <PendingTarget list={list} />
              ) : (
                <span className={clsx(isJump(q) ? 'text-accent' : 'text-ink')}>
                  {operandText(q.result)}
                </span>
              )}
            </td>
            <td className={clsx(TD, 'text-ink-faint')}>{formatQuad(q)}</td>
          </tr>
        );
      })}
    </TableShell>
  );
}

// ── triples / indirect triples (derived) ─────────────────────────────────────

function TripleRows({
  rows,
  props,
  showQuadColumn,
  highlightTriple,
  onHoverTriple,
}: {
  rows: readonly TripleRow[];
  props: RepresentationViewProps;
  showQuadColumn: boolean;
  highlightTriple: number | null;
  onHoverTriple?: (index: number | null) => void;
}) {
  const togglePin = useCallback(
    (i: number) => {
      const r = rows[i];
      if (r) props.onPinInstr(props.pinnedInstr === r.quadIndex ? null : r.quadIndex);
    },
    [rows, props],
  );
  const { rowProps } = useRovingRows(rows.length, togglePin);
  return (
    <>
      {rows.map((r, i) => {
        const e = emphasisOf(r.quadIndex, props);
        const isJumpRow = r.op === 'goto' || r.op.startsWith('if');
        const pending = isJumpRow && r.target === undefined;
        const list = props.pendingLists.get(r.quadIndex);
        return (
          <tr
            key={`${r.index}`}
            {...rowProps(i)}
            aria-label={`triple ${r.index}: ${r.op} ${r.arg1} ${r.arg2}`}
            onMouseEnter={() => {
              props.onHoverInstr(r.quadIndex);
              onHoverTriple?.(r.index);
            }}
            onMouseLeave={() => {
              props.onHoverInstr(null);
              onHoverTriple?.(null);
            }}
            onFocus={() => props.onHoverInstr(r.quadIndex)}
            onBlur={() => props.onHoverInstr(null)}
            onClick={() =>
              props.onPinInstr(props.pinnedInstr === r.quadIndex ? null : r.quadIndex)
            }
            className={clsx(
              'cursor-pointer border-b border-line/60 transition-colors duration-150 hover:bg-raised',
              rowClass(e),
              highlightTriple === r.index && 'bg-raised shadow-[inset_2px_0_0_var(--accent)]',
            )}
          >
            <td className={clsx(TD, 'px-1')}>
              <RowMarker e={e} />
            </td>
            <td className={clsx(TD, 'text-right font-semibold text-accent')}>({r.index})</td>
            <td className={clsx(TD, 'font-semibold text-ink')}>{r.op}</td>
            <td className={clsx(TD, 'text-ink-muted')}>{r.arg1}</td>
            <td className={clsx(TD, 'text-ink-muted')}>{r.arg2}</td>
            <td className={clsx(TD, e.patched && 'ir-patch-fill')}>
              {pending ? (
                <PendingTarget list={list} />
              ) : (
                <span className="text-accent">{r.target ?? ''}</span>
              )}
            </td>
            {showQuadColumn && (
              <td className={clsx(TD, 'text-right text-ink-faint')}>#{r.quadIndex}</td>
            )}
          </tr>
        );
      })}
    </>
  );
}

function tripleHead(showQuadColumn: boolean) {
  return (
    <tr>
      <th className={clsx(TH, 'w-6')} aria-label="row marker" />
      <th className={clsx(TH, 'w-12 text-right')}>pos</th>
      <th className={TH}>op</th>
      <th className={TH}>arg1</th>
      <th className={TH}>arg2</th>
      <th className={TH}>target</th>
      {showQuadColumn && <th className={clsx(TH, 'text-right text-ink-faint')}>from quad</th>}
    </tr>
  );
}

// ── the view ─────────────────────────────────────────────────────────────────

export function RepresentationView(props: RepresentationViewProps) {
  const { representation, fn, expanded = false } = props;
  const quads = fn?.quads ?? [];

  // Derived views: recomputed from the quads emitted so far, never stored.
  const derived = useMemo(
    () =>
      fn
        ? toIndirectTriples({
            name: fn.name,
            symbolId: fn.symbolId,
            params: fn.params,
            quads: fn.quads,
            tempCount: fn.tempCount,
          })
        : { order: [], triples: [] },
    [fn],
  );

  const [hoverTriple, setHoverTriple] = useState<number | null>(null);

  if (quads.length === 0) {
    return <p className="prose-note text-sm">No instructions yet. Step forward.</p>;
  }

  if (representation === 'quads') {
    return <QuadTable quads={quads} props={props} />;
  }

  if (representation === 'triples') {
    return (
      <TableShell label="Triples" minWidth="32rem" expanded={expanded} head={tripleHead(true)}>
        <TripleRows
          rows={derived.triples}
          props={props}
          showQuadColumn
          highlightTriple={null}
        />
      </TableShell>
    );
  }

  // indirect: the instruction listing beside the triples
  return (
    <div
      className={clsx(
        'grid gap-4 md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]',
        expanded && 'h-full',
      )}
    >
      <div className="flex flex-col gap-1.5">
        <p className="group-label">Listing</p>
        <TableShell
          label="Instruction listing"
          minWidth="11rem"
          expanded={expanded}
          head={
            <tr>
              <th className={clsx(TH, 'w-14 text-right')}>instr</th>
              <th className={TH}>points to</th>
            </tr>
          }
        >
          {derived.order.map((triple, i) => {
            const row = derived.triples[triple];
            const e = row
              ? emphasisOf(row.quadIndex, props)
              : { emitted: false, patched: false, linked: false, listed: false };
            return (
              <tr
                key={i}
                onMouseEnter={() => {
                  setHoverTriple(triple);
                  if (row) props.onHoverInstr(row.quadIndex);
                }}
                onMouseLeave={() => {
                  setHoverTriple(null);
                  props.onHoverInstr(null);
                }}
                className={clsx(
                  'border-b border-line/60 transition-colors duration-150 hover:bg-raised',
                  rowClass(e),
                  hoverTriple === triple && 'bg-raised',
                )}
              >
                <td className={clsx(TD, 'text-right text-ink-faint')}>{i}</td>
                <td className={clsx(TD, 'font-semibold text-accent')}>({triple})</td>
              </tr>
            );
          })}
        </TableShell>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="group-label">Triples</p>
        <TableShell label="Triples" minWidth="30rem" expanded={expanded} head={tripleHead(false)}>
          <TripleRows
            rows={derived.triples}
            props={props}
            showQuadColumn={false}
            highlightTriple={hoverTriple}
            onHoverTriple={setHoverTriple}
          />
        </TableShell>
      </div>
    </div>
  );
}

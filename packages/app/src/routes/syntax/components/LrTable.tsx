/**
 * The ACTION/GOTO table shared by SLR(1), canonical LR(1) and LALR(1), filling
 * cell by cell as the construction steps. Rendered with the shared VirtualTable
 * (sticky headers, patterned conflict cells), which now FOLLOWS the cursor:
 * `scrollToRowId` keeps the row being filled on screen — on the C grammar it
 * would otherwise walk 147 rows away. The "row being filled" strip below spells
 * the same row out in full, which the 56px-wide cells cannot.
 */
import { useMemo } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { clsx } from 'clsx';
import { Info, X } from 'lucide-react';
import type { Grammar } from '@lab/core/grammar/grammar.js';
import { formatProduction } from '@lab/core/grammar/grammar.js';
import {
  actionToString,
  describeAction,
  type LrAction,
  type LrConflictJson,
} from '@lab/core/grammar/lr-events.js';
import {
  VirtualTable,
  type VTableColumn,
  type VTableRow,
} from '../../../components/viz/VirtualTable';
import { Legend } from './ui';

export interface LrTableProps {
  /** Augmented grammar — reduce actions name its productions. */
  ag: Grammar;
  action: ReadonlyArray<Record<string, LrAction>>;
  goto: ReadonlyArray<Record<string, number>>;
  conflicts: readonly LrConflictJson[];
  terminals: readonly string[];
  nonterminals: readonly string[];
  rowName: (state: number) => string;
  current: { state: number; symbol: string } | null;
  height?: number;
}

const T_PREFIX = 'a:';
const N_PREFIX = 'g:';

export function LrTable({
  ag,
  action,
  goto,
  conflicts,
  terminals,
  nonterminals,
  rowName,
  current,
  height = 460,
}: LrTableProps) {
  const conflictAt = useMemo(() => {
    const m = new Map<string, LrConflictJson>();
    for (const c of conflicts) m.set(`${c.state}|${c.symbol}`, c);
    return m;
  }, [conflicts]);

  const columns = useMemo<VTableColumn[]>(
    () => [
      ...terminals.map((t) => ({ key: `${T_PREFIX}${t}`, header: t, width: 56 })),
      ...nonterminals.map((n) => ({
        key: `${N_PREFIX}${n}`,
        header: n,
        width: Math.max(48, Math.min(120, n.length * 8 + 16)),
      })),
    ],
    [terminals, nonterminals],
  );

  const rows = useMemo<VTableRow[]>(
    () =>
      action.map((row, i) => {
        const gotoRow = goto[i] ?? {};
        const cells: VTableRow['cells'] = {};
        for (const t of terminals) {
          const a = row[t];
          const conflict = conflictAt.get(`${i}|${t}`);
          if (!a && !conflict) continue;
          cells[`${T_PREFIX}${t}`] = {
            text: a ? actionToString(a) : '⚠',
            current: current?.state === i && current.symbol === t,
            highlight: true,
            conflict: conflict !== undefined,
            title: conflict
              ? `${conflict.kind} on '${t}' in state ${i}: ${conflict.actions
                  .map((x) => describeAction(ag, x))
                  .join('  vs  ')}`
              : a
                ? describeAction(ag, a)
                : undefined,
          };
        }
        for (const n of nonterminals) {
          const to = gotoRow[n];
          if (to === undefined) continue;
          cells[`${N_PREFIX}${n}`] = {
            text: String(to),
            current: current?.state === i && current.symbol === n,
            highlight: true,
            title: `GOTO[${i}, ${n}] = ${to}`,
          };
        }
        return { id: `row-${i}`, header: rowName(i), cells };
      }),
    [action, goto, terminals, nonterminals, conflictAt, current, ag, rowName],
  );

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <VirtualTable
        aria-label="ACTION and GOTO table"
        cornerLabel="state"
        columns={columns}
        rows={rows}
        height={height}
        selectedRowId={current === null ? null : `row-${current.state}`}
        scrollToRowId={current === null ? null : `row-${current.state}`}
      />
      <Legend
        items={[
          { label: `ACTION columns: ${terminals.length} terminals (sN shift, rN reduce, acc accept)`, swatch: <span aria-hidden className="inline-block h-3 w-4 rounded-sm border border-line-strong bg-surface" /> },
          { label: `GOTO columns: ${nonterminals.length} nonterminals`, swatch: <span aria-hidden className="inline-block h-3 w-4 rounded-sm border border-line-strong bg-raised" /> },
          { label: 'conflict (hatched + ring)', swatch: <span aria-hidden className="cell-conflict inline-block h-3 w-4 rounded-sm" /> },
        ]}
      />
    </div>
  );
}

/** The row the construction is filling right now, spelled out. */
export function CurrentRowStrip({
  ag,
  state,
  name,
  action,
  goto,
}: {
  ag: Grammar;
  state: number | null;
  name: string;
  action: Record<string, LrAction> | undefined;
  goto: Record<string, number> | undefined;
}) {
  if (state === null) {
    return (
      <p className="text-xs text-ink-muted">
        No row is being filled yet — step forward to start the table.
      </p>
    );
  }
  const acts = Object.entries(action ?? {});
  const gotos = Object.entries(goto ?? {});
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="font-mono text-xs text-ink-muted">
        row <span className="font-semibold text-ink">{name}</span> · {acts.length} action
        {acts.length === 1 ? '' : 's'} · {gotos.length} goto{gotos.length === 1 ? '' : 's'}
      </p>
      <div className="flex max-h-28 flex-wrap gap-1 overflow-auto">
        {acts.map(([sym, a]) => (
          <span
            key={`a-${sym}`}
            title={describeAction(ag, a)}
            className="inline-flex h-6 items-center gap-1 rounded border border-line bg-canvas px-1.5 font-mono text-[11px] text-ink-muted"
          >
            <span className="text-ink-faint">{sym}</span>
            <span className="text-ink">{actionToString(a)}</span>
          </span>
        ))}
        {gotos.map(([sym, to]) => (
          <span
            key={`g-${sym}`}
            className="inline-flex h-6 items-center gap-1 rounded border border-dashed border-line-strong bg-canvas px-1.5 font-mono text-[11px] text-ink-muted"
          >
            <span className="text-ink-faint">{sym}</span>
            <span className="text-ink">{to}</span>
          </span>
        ))}
        {acts.length === 0 && gotos.length === 0 && (
          <span className="text-xs text-ink-faint">(still empty)</span>
        )}
      </div>
    </div>
  );
}

// ── Conflicts ────────────────────────────────────────────────────────────────

export function ConflictList({
  ag,
  conflicts,
  onSelect,
  emptyLabel,
}: {
  ag: Grammar;
  conflicts: readonly LrConflictJson[];
  onSelect?: (c: LrConflictJson) => void;
  emptyLabel: string;
}) {
  if (conflicts.length === 0) {
    return <p className="text-xs leading-relaxed text-ink-muted">{emptyLabel}</p>;
  }
  return (
    <ul className="flex max-h-72 flex-col gap-1.5 overflow-auto">
      {conflicts.map((c, i) => (
        <li
          key={`${c.state}-${c.symbol}-${i}`}
          className={clsx(
            'flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5',
            c.resolution ? 'border-warn/50 bg-warn-soft' : 'border-err/50 bg-err-soft',
          )}
        >
          <span aria-hidden className="cell-conflict size-3 shrink-0 rounded-sm" />
          <span className="font-mono text-[11px] text-ink">
            state {c.state} · ‘{c.symbol}’
          </span>
          <span
            className={clsx(
              'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
              c.resolution ? 'bg-warn/20 text-warn' : 'bg-err/20 text-err',
            )}
          >
            {c.kind}
            {c.resolution ? ' · resolved by shift' : ''}
          </span>
          <span className="flex-1" />
          {onSelect && (
            <button
              type="button"
              aria-label={`Jump to the ${c.kind} conflict in state ${c.state} on ${c.symbol}`}
              onClick={() => onSelect(c)}
              className="h-7 cursor-pointer rounded border border-control bg-surface px-2 text-[11px] text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
            >
              go to step
            </button>
          )}
          <ConflictPopover ag={ag} conflict={c} />
        </li>
      ))}
    </ul>
  );
}

function ConflictPopover({ ag, conflict }: { ag: Grammar; conflict: LrConflictJson }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`Explain the conflict in state ${conflict.state} on ${conflict.symbol}`}
          className="flex size-7 cursor-pointer items-center justify-center rounded text-ink-faint transition-colors hover:bg-surface hover:text-accent"
        >
          <Info aria-hidden className="size-3.5" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="left"
          sideOffset={6}
          collisionPadding={8}
          className="z-50 w-80 rounded-md border border-line bg-surface p-3 text-sm leading-relaxed text-ink shadow-lg"
        >
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold text-ink-muted">
              {conflict.kind} conflict — state {conflict.state}, lookahead ‘{conflict.symbol}’
            </span>
            <Popover.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="flex size-6 cursor-pointer items-center justify-center rounded text-ink-faint hover:bg-raised hover:text-ink"
              >
                <X aria-hidden className="size-3.5" />
              </button>
            </Popover.Close>
          </div>
          <ol className="flex flex-col gap-2">
            {conflict.actions.map((a, i) => (
              <li key={i} className="flex flex-col gap-0.5 rounded border border-line bg-canvas p-2">
                <span className="font-mono text-xs text-ink">
                  {actionToString(a)} — {describeAction(ag, a)}
                </span>
                <span className="font-mono text-[11px] text-ink-muted">
                  from {conflict.items[i] ?? '?'}
                </span>
              </li>
            ))}
          </ol>
          {conflict.resolution ? (
            <p className="mt-2 rounded border border-warn/50 bg-warn-soft p-2 text-xs text-warn">
              Resolved: {actionToString(conflict.resolution.action)} — {conflict.resolution.reason}.
            </p>
          ) : (
            <p className="mt-2 text-xs text-ink-muted">
              Both items demand the same cell on ‘{conflict.symbol}’, so one lookahead symbol is
              not enough to decide this state. Left unresolved, the first-registered action wins
              and the other is unreachable.
            </p>
          )}
          <p className="mt-2 text-[11px] text-ink-faint">
            {conflict.kind === 'reduce/reduce'
              ? 'Reduce/reduce: two complete items claim the same lookahead.'
              : conflict.kind === 'accept/reduce'
                ? 'Accept/reduce: [S′ → S ·] wants to finish the parse while a complete item wants to reduce on $.'
                : 'Shift/reduce: one item wants to keep reading, another wants to reduce now.'}{' '}
            Production numbering: r{'{n}'} reduces by p{'{n−1}'} of {ag.name}.
          </p>
          <Popover.Arrow className="fill-line" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

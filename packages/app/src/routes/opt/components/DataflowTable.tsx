/**
 * The IN/OUT table of an iterative data-flow problem (§9.3), with gen/kill and
 * the block currently being recomputed emphasized. Rows carry an explicit
 * "recomputing" marker (icon + text), never colour alone.
 */
import { clsx } from 'clsx';
import { ArrowDown, ArrowUp, ChevronRight } from 'lucide-react';
import type { DataflowState } from '@lab/core/opt/dataflow.js';
import { ENTRY_ID, EXIT_ID, blockName } from '../lib/optModel';
import { Chip } from './OptStates';

export function SetText({ items }: { items: readonly string[] | undefined }) {
  if (!items || items.length === 0) return <span className="text-ink-faint">∅</span>;
  return <span className="break-words">{`{${items.join(', ')}}`}</span>;
}

export interface DataflowTableProps {
  state: DataflowState;
  blockIds: readonly number[];
  currentBlock: number | null;
  /** True when the last recomputation of `currentBlock` changed its set. */
  changed?: boolean;
}

export function DataflowTable({ state, blockIds, currentBlock, changed }: DataflowTableProps) {
  const forward = state.direction === 'forward';
  const genLabel = state.name === 'live-variables' ? 'use' : 'gen';
  const killLabel = state.name === 'live-variables' ? 'def' : 'kill';
  const boundaryId = forward ? ENTRY_ID : EXIT_ID;
  const boundaryKey = String(boundaryId);
  const rows = forward ? blockIds : [...blockIds].sort((a, b) => b - a);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-140 border-collapse text-left font-mono text-xs">
        <caption className="sr-only">
          IN and OUT sets per basic block for {state.name || 'the data-flow problem'}
        </caption>
        <thead>
          <tr className="border-b border-line text-ink-muted">
            <th scope="col" className="px-2 py-1.5 font-semibold">
              Block
            </th>
            <th scope="col" className="px-2 py-1.5 font-semibold">
              {genLabel}
            </th>
            <th scope="col" className="px-2 py-1.5 font-semibold">
              {killLabel}
            </th>
            <th scope="col" className="px-2 py-1.5 font-semibold">
              IN
            </th>
            <th scope="col" className="px-2 py-1.5 font-semibold">
              OUT
            </th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-line/70 bg-raised/60">
            <th scope="row" className="px-2 py-1.5 font-semibold text-ink-muted">
              {blockName(boundaryId)}
            </th>
            <td className="px-2 py-1.5 text-ink-faint">—</td>
            <td className="px-2 py-1.5 text-ink-faint">—</td>
            <td className="px-2 py-1.5">
              <SetText items={state.in[boundaryKey]} />
            </td>
            <td className="px-2 py-1.5">
              <SetText items={state.out[boundaryKey]} />
            </td>
          </tr>
          {rows.map((id) => {
            const key = String(id);
            const isCurrent = currentBlock === id;
            return (
              <tr
                key={id}
                className={clsx(
                  'border-b border-line/50 align-top',
                  isCurrent && 'bg-accent-soft shadow-[inset_2px_0_0_var(--accent)]',
                )}
              >
                <th scope="row" className="px-2 py-1.5 font-semibold whitespace-nowrap">
                  <span className="flex items-center gap-1">
                    {isCurrent && <ChevronRight aria-hidden className="size-3 text-accent" />}
                    {blockName(id)}
                  </span>
                  {isCurrent && (
                    <span className="mt-0.5 block text-[10px] font-normal text-ink-muted">
                      {changed === undefined
                        ? 'recomputing'
                        : changed
                          ? 'changed'
                          : 'unchanged'}
                    </span>
                  )}
                </th>
                <td className="px-2 py-1.5 text-ink-muted">
                  <SetText items={state.gen[key]} />
                </td>
                <td className="px-2 py-1.5 text-ink-muted">
                  <SetText items={state.kill[key]} />
                </td>
                <td className="px-2 py-1.5">
                  <SetText items={state.in[key]} />
                </td>
                <td className="px-2 py-1.5">
                  <SetText items={state.out[key]} />
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="px-2 py-6 text-center text-ink-faint">
                The problem has not been set up yet — step forward.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-ink-muted">
        <Chip tone="neutral">
          {forward ? (
            <ArrowDown aria-hidden className="size-3" />
          ) : (
            <ArrowUp aria-hidden className="size-3" />
          )}
          {state.direction}
        </Chip>
        <Chip tone="neutral">meet = {state.meet === 'union' ? '∪' : '∩'}</Chip>
        <Chip tone="neutral">|U| = {state.domain.length}</Chip>
        <span>
          {forward
            ? 'IN[B] is the meet over predecessors; OUT[B] = gen ∪ (IN − kill).'
            : 'OUT[B] is the meet over successors; IN[B] = use ∪ (OUT − def).'}
        </span>
      </p>
    </div>
  );
}

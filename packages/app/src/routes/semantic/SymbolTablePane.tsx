/**
 * The symbol table as a table: one row per entry of every scope's table, in
 * declaration order — the same entries the nested boxes show, read the way a
 * compiler writer reads them (§2.7 / §6.3). Virtualized, because a real program
 * declares thousands.
 */
import { useMemo, type ReactNode } from 'react';
import type { SemState } from '@lab/core/sem/sem-events.js';
import type { SymbolEntry } from '@lab/core/sem/types.js';
import {
  VirtualTable,
  type VTableColumn,
  type VTableRow,
} from '../../components/viz/VirtualTable';
import { scopeTitle, typeDescription, typeLabel } from './derive';

const COLUMNS: VTableColumn[] = [
  { key: 'name', header: 'name', width: 140 },
  { key: 'type', header: 'type', width: 130 },
  { key: 'kind', header: 'kind', width: 80 },
  { key: 'scope', header: 'scope', width: 170 },
  { key: 'declared', header: 'declared at', width: 130 },
];

export interface SymbolTablePaneProps {
  state: SemState;
  /** Symbol touched by the current step (declared or resolved). */
  activeSymbolId: number | null;
  selectedSymbolId: number | null;
  totalSymbols: number;
  /**
   * Transport for fullscreen. The table follows the pass — the symbol the
   * current step touched is scrolled into view — so it has to stay steppable
   * once it fills the screen.
   */
  controls?: ReactNode;
}

export function SymbolTablePane({
  state,
  activeSymbolId,
  selectedSymbolId,
  totalSymbols,
  controls,
}: SymbolTablePaneProps) {
  const rows = useMemo<VTableRow[]>(() => {
    const scopeName = (id: number): string => {
      const sc = state.scopes.find((s) => s.id === id);
      return sc ? `${scopeTitle(sc)} #${sc.id}` : `#${id}`;
    };
    return state.symbols.map((sym: SymbolEntry) => {
      const current = sym.id === activeSymbolId;
      const highlight = sym.id === selectedSymbolId;
      const cell = (text: string, title?: string) => ({
        text,
        current,
        highlight,
        ...(title !== undefined ? { title } : {}),
      });
      return {
        id: `sym-${sym.id}`,
        header: `#${sym.id}`,
        cells: {
          name: cell(sym.name),
          type: cell(typeLabel(sym.type), typeDescription(sym.type)),
          kind: cell(sym.kind),
          scope: cell(scopeName(sym.scopeId)),
          declared: cell(`line ${sym.declSpan.line}:${sym.declSpan.col}`),
        },
      };
    });
  }, [state.symbols, state.scopes, activeSymbolId, selectedSymbolId]);

  return (
    <div className="flex flex-col gap-3">
      <p className="font-mono text-2xs text-ink-faint">
        {state.symbols.length} / {totalSymbols} entered
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-faint">No symbols yet.</p>
      ) : (
        <VirtualTable
          aria-label="Symbol table"
          cornerLabel="id"
          columns={COLUMNS}
          rows={rows}
          height={Math.min(480, 64 + rows.length * 32)}
          controls={controls}
          // Follow the pass: the symbol the current step touched stays on
          // screen even once the table is hundreds of entries long.
          scrollToRowId={
            activeSymbolId !== null
              ? `sym-${activeSymbolId}`
              : selectedSymbolId !== null
                ? `sym-${selectedSymbolId}`
                : null
          }
        />
      )}
    </div>
  );
}

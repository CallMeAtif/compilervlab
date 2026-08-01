/**
 * The chained symbol tables of §2.7 (Fig. 2.36) drawn as nested boxes: a scope
 * box opens on `scopeEnter`, fills with symbol rows as declarations are
 * processed, and is marked closed on `scopeExit`. During a lookup the boxes the
 * chain walk consults are numbered in consultation order, innermost outward,
 * and the walk ends in a hit (the found symbol row is emphasized) or a miss.
 */
import { clsx } from 'clsx';
import { ArrowUp, Check, CircleSlash, Search, SquareDot, X } from 'lucide-react';
import type { SemState } from '@lab/core/sem/sem-events.js';
import type { Scope, SymbolEntry } from '@lab/core/sem/types.js';
import { KindChip, TypeChip } from './parts';
import { scopeForest, scopeTitle, type ActiveLookup, type ScopeNode } from './derive';

export interface ScopesPaneProps {
  state: SemState;
  lookup: ActiveLookup | null;
  /** Symbol the current step declares or resolves to. */
  activeSymbolId: number | null;
  onSelectSymbol: (symbol: SymbolEntry) => void;
  selectedSymbolId: number | null;
}

interface Consultation {
  order: number;
  found: boolean;
  /** Last box of a finished walk: it either produced the hit or exhausted. */
  terminal: boolean;
}

export function ScopesPane({
  state,
  lookup,
  activeSymbolId,
  onSelectSymbol,
  selectedSymbolId,
}: ScopesPaneProps) {
  const forest = scopeForest(state.scopes);
  const openIds = new Set(state.scopeStack);
  const currentId = state.scopeStack[state.scopeStack.length - 1] ?? null;

  const consulted = new Map<number, Consultation>();
  if (lookup) {
    lookup.visits.forEach((v, i) => {
      consulted.set(v.scopeId, {
        order: v.order,
        found: v.found,
        terminal: i === lookup.visits.length - 1,
      });
    });
  }

  if (state.scopes.length === 0) {
    return (
      <p className="px-3 py-6 text-sm text-ink-faint">
        No scope is open yet. Step forward: the pass opens the global scope first, then one
        scope per function and per block.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      {!lookup && (
        <p className="flex items-start gap-1.5 rounded-md border border-dashed border-line px-2.5 py-1.5 text-[11px] leading-relaxed text-ink-muted">
          <Search aria-hidden className="mt-0.5 size-3 shrink-0" />
          Name resolution walks the chain one table at a time — those are micro steps. Turn on
          “Micro steps”, or use the “lookup” jump chip, to watch a walk consult each scope
          outward until it hits or the chain is exhausted.
        </p>
      )}

      {lookup && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-md border border-accent/50 bg-accent-soft px-2.5 py-1.5 text-xs text-ink"
        >
          <Search aria-hidden className="size-3.5 shrink-0" />
          <span className="font-mono font-semibold">{lookup.name}</span>
          <span className="text-ink-muted">
            chain walk · {lookup.visits.length} table
            {lookup.visits.length === 1 ? '' : 's'} consulted
          </span>
          {lookup.outcome === 'hit' && (
            <span className="inline-flex items-center gap-1 rounded-full border border-ok/50 px-1.5 py-0.5 font-medium text-ok">
              <Check aria-hidden className="size-3" /> hit · symbol #{lookup.symbolId}
            </span>
          )}
          {lookup.outcome === 'miss' && (
            <span className="inline-flex items-center gap-1 rounded-full border border-err/50 px-1.5 py-0.5 font-medium text-err">
              <X aria-hidden className="size-3" /> miss · chain exhausted
            </span>
          )}
          {lookup.outcome === 'walking' && (
            <span className="text-ink-muted">walking outward…</span>
          )}
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {forest.map((node) => (
          <ScopeBox
            key={node.scope.id}
            node={node}
            state={state}
            openIds={openIds}
            currentId={currentId}
            consulted={consulted}
            lookup={lookup}
            activeSymbolId={activeSymbolId}
            selectedSymbolId={selectedSymbolId}
            onSelectSymbol={onSelectSymbol}
          />
        ))}
      </ul>
    </div>
  );
}

function ScopeBox({
  node,
  state,
  openIds,
  currentId,
  consulted,
  lookup,
  activeSymbolId,
  selectedSymbolId,
  onSelectSymbol,
}: {
  node: ScopeNode;
  state: SemState;
  openIds: ReadonlySet<number>;
  currentId: number | null;
  consulted: ReadonlyMap<number, Consultation>;
  lookup: ActiveLookup | null;
  activeSymbolId: number | null;
  selectedSymbolId: number | null;
  onSelectSymbol: (symbol: SymbolEntry) => void;
}) {
  const scope: Scope = node.scope;
  const isOpen = openIds.has(scope.id);
  const isCurrent = currentId === scope.id;
  const visit = consulted.get(scope.id);
  const symbols = scope.symbolIds
    .map((id) => state.symbols.find((s) => s.id === id))
    .filter((s): s is SymbolEntry => s !== undefined);

  return (
    <li
      className={clsx(
        'rounded-lg border transition-[border-color,box-shadow] duration-200',
        isCurrent
          ? 'border-accent bg-accent-soft/40 shadow-[inset_0_0_0_1.5px_var(--accent)]'
          : isOpen
            ? 'border-line-strong bg-surface'
            : 'border-dashed border-line bg-surface opacity-75',
      )}
      aria-label={`${scopeTitle(scope)} — ${isCurrent ? 'current' : isOpen ? 'open' : 'closed'}`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2.5 py-1.5">
        <SquareDot aria-hidden className="size-3.5 shrink-0 text-ink-faint" />
        <span className="font-mono text-sm font-semibold text-ink">{scopeTitle(scope)}</span>
        <span className="font-mono text-[11px] text-ink-faint">#{scope.id}</span>
        <span className="font-mono text-[11px] text-ink-faint">
          line {scope.span.line} · {symbols.length} symbol{symbols.length === 1 ? '' : 's'}
        </span>

        {isCurrent && (
          <span className="inline-flex h-5 items-center gap-1 rounded-full border border-accent px-1.5 text-[11px] font-medium text-ink">
            <SquareDot aria-hidden className="size-3" />
            current
          </span>
        )}
        {!isOpen && (
          <span className="inline-flex h-5 items-center gap-1 rounded-full border border-line px-1.5 text-[11px] text-ink-muted">
            <CircleSlash aria-hidden className="size-3" />
            closed
          </span>
        )}

        <span className="flex-1" />

        {visit && (
          <span
            className={clsx(
              'inline-flex h-5 items-center gap-1 rounded-full border px-1.5 font-mono text-[11px] font-medium',
              visit.found
                ? 'border-ok/60 bg-ok-soft text-ok'
                : visit.terminal && lookup?.outcome === 'miss'
                  ? 'border-err/60 bg-err-soft text-err'
                  : 'border-line-strong bg-raised text-ink-muted',
            )}
            aria-label={`consulted ${visit.order}${visit.found ? ', found here' : ', not here'}`}
          >
            {visit.order}.
            {visit.found ? (
              <>
                <Check aria-hidden className="size-3" /> found
              </>
            ) : visit.terminal && lookup?.outcome === 'miss' ? (
              <>
                <X aria-hidden className="size-3" /> exhausted
              </>
            ) : (
              <>
                <ArrowUp aria-hidden className="size-3" /> not here
              </>
            )}
          </span>
        )}
      </div>

      {symbols.length > 0 && (
        <ul className="flex flex-col gap-0.5 border-t border-line/70 p-1.5">
          {symbols.map((sym) => {
            const isHit = lookup?.outcome === 'hit' && lookup.symbolId === sym.id;
            const isActive = activeSymbolId === sym.id;
            const isSelected = selectedSymbolId === sym.id;
            return (
              <li key={sym.id}>
                <button
                  type="button"
                  onClick={() => onSelectSymbol(sym)}
                  aria-label={`symbol ${sym.name}, declared at line ${sym.declSpan.line}`}
                  className={clsx(
                    'flex min-h-11 w-full cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-2 py-1 text-left transition-colors duration-200',
                    isHit
                      ? 'border-ok bg-ok-soft shadow-[inset_0_0_0_1.5px_var(--ok)]'
                      : isActive
                        ? 'border-accent bg-accent-soft'
                        : isSelected
                          ? 'border-line-strong bg-raised'
                          : 'border-transparent hover:border-line hover:bg-raised',
                  )}
                >
                  {isHit && <Check aria-hidden className="size-3.5 shrink-0 text-ok" />}
                  <span className="font-mono text-sm text-ink">{sym.name}</span>
                  <TypeChip type={sym.type} />
                  <KindChip kind={sym.kind} />
                  <span className="flex-1" />
                  <span className="font-mono text-[11px] text-ink-faint">
                    #{sym.id} · line {sym.declSpan.line}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {node.children.length > 0 && (
        <ul className="ml-3 flex flex-col gap-2 border-l border-line py-1.5 pr-1.5 pl-3">
          {node.children.map((child) => (
            <ScopeBox
              key={child.scope.id}
              node={child}
              state={state}
              openIds={openIds}
              currentId={currentId}
              consulted={consulted}
              lookup={lookup}
              activeSymbolId={activeSymbolId}
              selectedSymbolId={selectedSymbolId}
              onSelectSymbol={onSelectSymbol}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

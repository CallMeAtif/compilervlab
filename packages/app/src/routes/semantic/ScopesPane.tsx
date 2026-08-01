/**
 * The chained symbol tables of §2.7 (Fig. 2.36) drawn as an OUTLINE — nested,
 * indented regions ruled down the left margin, the way a textbook sets nested
 * structure. A region opens on `scopeEnter`, fills with symbol rows as
 * declarations are processed, and is marked closed on `scopeExit`. During a
 * lookup the regions the
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
    return <p className="prose-note p-4 text-sm">No scope open yet. Step forward.</p>;
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {lookup && (
        <p
          role="status"
          className="flex flex-wrap items-center gap-x-2 gap-y-1 border-l-2 border-accent bg-accent-soft py-1 pl-2.5 text-xs text-ink"
        >
          <Search aria-hidden className="size-3.5 shrink-0" />
          <span className="font-mono font-semibold">{lookup.name}</span>
          <span className="text-ink-muted">
            chain walk · {lookup.visits.length} table
            {lookup.visits.length === 1 ? '' : 's'} consulted
          </span>
          {lookup.outcome === 'hit' && (
            <span className="inline-flex items-center gap-1 font-mono font-medium text-ok">
              <Check aria-hidden className="size-3" /> hit · symbol #{lookup.symbolId}
            </span>
          )}
          {lookup.outcome === 'miss' && (
            <span className="inline-flex items-center gap-1 font-mono font-medium text-err">
              <X aria-hidden className="size-3" /> miss · chain exhausted
            </span>
          )}
          {lookup.outcome === 'walking' && (
            <span className="text-ink-muted">walking outward…</span>
          )}
        </p>
      )}

      <ul className="flex flex-col gap-4">
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
    /*
     * An outline entry, not a card: a 2px rule down the left margin says
     * "this region nests inside the one to my left". The rule is ALWAYS 2px —
     * only its colour and dash pattern change with state — so stepping never
     * shifts a single pixel of layout.
     */
    <li
      className={clsx(
        'border-l-2 pl-3 transition-[border-color,background-color] duration-[var(--dur)]',
        isCurrent
          ? 'border-accent bg-accent-soft/50'
          : isOpen
            ? 'border-line-strong'
            : 'border-dashed border-line opacity-75',
      )}
      aria-label={`${scopeTitle(scope)} — ${isCurrent ? 'current' : isOpen ? 'open' : 'closed'}`}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-line/70 pb-1">
        <span className="font-mono text-sm font-semibold text-ink">{scopeTitle(scope)}</span>
        <span className="font-mono text-2xs text-ink-faint">#{scope.id}</span>
        <span className="font-mono text-2xs text-ink-faint">
          line {scope.span.line} · {symbols.length} symbol{symbols.length === 1 ? '' : 's'}
        </span>

        {isCurrent && (
          <span className="inline-flex items-center gap-1 font-mono text-2xs font-semibold text-accent">
            <SquareDot aria-hidden className="size-3 translate-y-0.5" />
            current
          </span>
        )}
        {!isOpen && (
          <span className="inline-flex items-center gap-1 font-mono text-2xs text-ink-faint">
            <CircleSlash aria-hidden className="size-3 translate-y-0.5" />
            closed
          </span>
        )}

        <span className="flex-1" />

        {visit && (
          <span
            className={clsx(
              'inline-flex items-center gap-1 font-mono text-2xs font-semibold',
              visit.found
                ? 'text-ok'
                : visit.terminal && lookup?.outcome === 'miss'
                  ? 'text-err'
                  : 'text-ink-muted',
            )}
            aria-label={`consulted ${visit.order}${visit.found ? ', found here' : ', not here'}`}
          >
            {visit.order}.
            {visit.found ? (
              <>
                <Check aria-hidden className="size-3 translate-y-0.5" /> found
              </>
            ) : visit.terminal && lookup?.outcome === 'miss' ? (
              <>
                <X aria-hidden className="size-3 translate-y-0.5" /> exhausted
              </>
            ) : (
              <>
                <ArrowUp aria-hidden className="size-3 translate-y-0.5" /> not here
              </>
            )}
          </span>
        )}
      </div>

      {symbols.length > 0 && (
        <ul className="mt-1 flex flex-col">
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
                    'flex min-h-11 w-full cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 border-l-2 px-2 py-1 text-left transition-colors duration-[var(--dur)]',
                    isHit
                      ? 'border-ok bg-ok-soft'
                      : isActive
                        ? 'border-accent bg-accent-soft'
                        : isSelected
                          ? 'border-line-strong bg-raised'
                          : 'border-transparent hover:bg-raised',
                  )}
                >
                  {isHit && <Check aria-hidden className="size-3.5 shrink-0 text-ok" />}
                  <span className="font-mono text-sm text-ink">{sym.name}</span>
                  <TypeChip type={sym.type} />
                  <KindChip kind={sym.kind} />
                  <span className="flex-1" />
                  <span className="font-mono text-2xs text-ink-faint">
                    #{sym.id} · line {sym.declSpan.line}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {node.children.length > 0 && (
        <ul className="mt-3 ml-2 flex flex-col gap-4 pb-1">
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

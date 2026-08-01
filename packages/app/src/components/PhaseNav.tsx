/**
 * The one navigation row a phase route gets.
 *
 * Every route used to stack two of these — a `?algo=` tablist from
 * `lib/phases.tsx` and a second row of view tabs selecting much the same thing.
 * There is one row now, and this is it: quiet text items on a hairline, the
 * current one carrying weight and an accent rule cut into that hairline, an
 * optional selector parked on the right of the same rule.
 *
 * Keyboard: roving tabindex (WAI-ARIA Authoring Practices). The row is ONE tab
 * stop, Left/Right walk it, Home/End jump to the ends, focus follows selection.
 */
import { useCallback, useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { clsx } from 'clsx';

export interface PhaseNavItem<T extends string> {
  id: T;
  label: string;
  /** Hover/assistive detail. Never rendered as standing text. */
  hint?: string;
  /** A count or mark after the label (errors, symbol totals). */
  badge?: ReactNode;
}

export function PhaseNav<T extends string>({
  label,
  items,
  value,
  onSelect,
  aside,
}: {
  /** Accessible name of the tablist. */
  label: string;
  items: ReadonlyArray<PhaseNavItem<T>>;
  value: T;
  onSelect: (id: T) => void;
  /** A selector that filters the same views — sits on the right of the rule. */
  aside?: ReactNode;
}) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const refocus = useRef(false);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const at = items.findIndex((i) => i.id === value);
      if (at < 0) return;
      let next: number | null = null;
      if (e.key === 'ArrowRight') next = (at + 1) % items.length;
      else if (e.key === 'ArrowLeft') next = (at - 1 + items.length) % items.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = items.length - 1;
      if (next === null) return;
      e.preventDefault();
      const id = items[next]?.id;
      if (id === undefined) return;
      refocus.current = true;
      onSelect(id);
    },
    [items, value, onSelect],
  );

  // Roving tabindex would otherwise strand focus on the tab that just lost it.
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    railRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
  }, [value]);

  return (
    <div className="-mb-px flex flex-wrap items-end justify-between gap-x-6 gap-y-1 border-b border-line">
      <div
        ref={railRef}
        role="tablist"
        aria-label={label}
        aria-orientation="horizontal"
        onKeyDown={onKeyDown}
        className="flex flex-wrap items-end gap-x-1"
      >
        {items.map((item) => {
          const selected = item.id === value;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              data-nav={item.id}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              title={item.hint}
              onClick={() => onSelect(item.id)}
              className={clsx(
                // 44px target, and the current tab is marked by weight plus an
                // accent rule — never by colour alone.
                'flex h-11 cursor-pointer items-center gap-1.5 px-2 text-sm whitespace-nowrap transition-colors duration-[var(--dur-fast)] sm:px-2.5',
                selected
                  ? 'border-b-2 border-accent font-semibold text-ink'
                  : 'border-b-2 border-transparent text-ink-muted hover:border-line-strong hover:text-ink',
              )}
            >
              {item.label}
              {item.badge}
            </button>
          );
        })}
      </div>
      {aside && <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-1">{aside}</div>}
    </div>
  );
}

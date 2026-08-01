/**
 * Shared layout for the six phase routes: header (title, status, algorithm
 * picker driven by ?algo=) + a content slot the phase teams fill in.
 */
import { useCallback, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { Phase } from '@lab/core';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { ArrowLeft } from 'lucide-react';
import { PHASES, phaseInfo } from '../lib/phases';
import { useCompilationStore, stageInfo } from '../store/compilation';
import { STATUS_META, StatusIcon } from './StatusBadge';
import { usePhaseUrlState } from '../lib/urlState';

export interface PhasePageProps {
  phase: Phase;
  children: ReactNode;
}

export function PhasePage({ phase, children }: PhasePageProps) {
  const info = phaseInfo(phase);
  const compilation = useCompilationStore((s) => s.compilation);
  const stale = useCompilationStore((s) => s.stale);
  const pipeline = useCompilationStore((s) => s.pipelineInfo);
  const stage = stageInfo(compilation, stale, phase, (c) => info.summary(c, pipeline));
  const status = stage.status;
  const meta = STATUS_META[status];
  const { algo, setPhaseParams } = usePhaseUrlState();
  const Icon = info.icon;

  const activeAlgo = algo ?? info.algorithms[0]?.id ?? null;
  const ordinal = PHASES.findIndex((p) => p.phase === phase) + 1;
  const panelId = useId();
  const tabsRef = useRef<HTMLDivElement | null>(null);

  /**
   * Roving-tabindex arrow navigation for the algorithm tablist (WAI-ARIA
   * Authoring Practices): the tablist is ONE tab stop and Left/Right/Home/End
   * move between algorithms — otherwise seven algorithms means seven tab stops
   * before a keyboard user reaches the visualization.
   */
  const onTabsKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const ids = info.algorithms.map((a) => a.id);
      const at = activeAlgo ? ids.indexOf(activeAlgo) : 0;
      if (at < 0 || ids.length === 0) return;
      let next: number | null = null;
      if (e.key === 'ArrowRight') next = (at + 1) % ids.length;
      else if (e.key === 'ArrowLeft') next = (at - 1 + ids.length) % ids.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = ids.length - 1;
      if (next === null) return;
      e.preventDefault();
      const id = ids[next];
      if (!id) return;
      setPhaseParams({ algo: id, step: null });
      // Focus follows selection, as the tab pattern requires.
      tabsRef.current
        ?.querySelector<HTMLButtonElement>(`button[data-algo="${CSS.escape(id)}"]`)
        ?.focus();
    },
    [info.algorithms, activeAlgo, setPhaseParams],
  );

  return (
    <div className="mx-auto flex w-full max-w-450 flex-1 flex-col gap-4 px-3 py-4 sm:px-5">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Link
            to="/"
            className="flex h-9 items-center gap-1 rounded-md px-2 text-sm text-ink-muted transition-colors hover:bg-raised hover:text-ink"
          >
            <ArrowLeft aria-hidden className="size-4" />
            Overview
          </Link>
          <span aria-hidden className="h-5 w-px bg-line" />
          <h1 className="flex items-baseline gap-2 text-lg font-semibold tracking-tight">
            <Icon aria-hidden className="size-5 shrink-0 translate-y-0.5 text-accent" strokeWidth={2} />
            <span>
              <span aria-hidden className="mr-1.5 font-mono text-sm font-normal text-ink-faint">
                {ordinal}/{PHASES.length}
              </span>
              {info.title}
            </span>
          </h1>
          <span
            className={clsx(
              'flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium',
              meta.chip,
            )}
          >
            <StatusIcon status={status} />
            {meta.label}
            {stage.summary && (
              <>
                <span aria-hidden className="text-ink-faint">
                  ·
                </span>
                <span className="font-mono">{stage.summary}</span>
              </>
            )}
          </span>
        </div>
        <p className="max-w-3xl text-sm text-ink-muted">{info.blurb}</p>

        {info.algorithms.length > 1 && (
          <div
            ref={tabsRef}
            role="tablist"
            aria-label={`${info.title} algorithms`}
            aria-orientation="horizontal"
            onKeyDown={onTabsKeyDown}
            className="flex flex-wrap items-center gap-1.5"
          >
            {info.algorithms.map((a) => {
              const selected = a.id === activeAlgo;
              return (
                <button
                  key={a.id}
                  type="button"
                  role="tab"
                  data-algo={a.id}
                  aria-selected={selected}
                  aria-controls={panelId}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setPhaseParams({ algo: a.id, step: null })}
                  className={clsx(
                    // 36px tall (>= the 24px WCAG 2.2 minimum) and selected is
                    // marked by weight + an underline bar, not colour alone.
                    'h-9 cursor-pointer rounded-md border px-3 text-xs transition-colors duration-[var(--dur-fast)]',
                    selected
                      ? 'border-accent bg-accent-soft font-semibold text-ink shadow-[inset_0_-2px_0_var(--accent)]'
                      : 'border-control bg-surface font-medium text-ink-muted hover:bg-raised hover:text-ink',
                  )}
                >
                  {a.label}
                </button>
              );
            })}
          </div>
        )}
      </header>

      <div
        id={panelId}
        role={info.algorithms.length > 1 ? 'tabpanel' : undefined}
        aria-label={info.algorithms.length > 1 ? `${info.title} visualization` : undefined}
        className="flex-1"
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Shared layout for the six phase routes: ONE header band (back link, title,
 * status) + the algorithm tabs driven by ?algo=, then the content.
 *
 * The header used to be three stacked bands — a running head, a title and a
 * blurb — before a reader reached anything. It is one row now, and the blurb is
 * gone: docs/EDITORIAL.md budgets a page subtitle at zero words.
 */
import { useCallback, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { Phase } from '@lab/core';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { ArrowLeft } from 'lucide-react';
import { phaseInfo } from '../lib/phases';
import { useCompilationStore, stageInfo } from '../store/compilation';
import { STATUS_META, StatusIcon } from './StatusBadge';
import { usePhaseUrlState } from '../lib/urlState';

export interface PhasePageProps {
  phase: Phase;
  /**
   * Replaces the default `?algo=` tablist. Pass `null` when the route owns its
   * own single nav row — two stacked tab rows selecting the same thing was the
   * clutter this prop exists to remove.
   */
  nav?: ReactNode | null;
  children: ReactNode;
}

/**
 * The status reading, trimmed to what fits on the title line: the first two
 * segments of the phase summary. The full string stays in the `title` and in
 * the accessible name, and the overview pipeline spells every count out.
 */
function shortSummary(summary: string): string {
  const parts = summary.split(' · ');
  return parts.length <= 2 ? summary : `${parts.slice(0, 2).join(' · ')} …`;
}

/**
 * The one header band of a phase route: back link, phase name, status.
 *
 * Exported so /syntax and /codegen — which build their own header, because
 * their tab models are phase-specific and cannot come from `lib/phases.tsx` —
 * can open exactly like the other four instead of copying this markup.
 *
 * The icon is `ink-faint`, never `accent`: accent means "the current thing"
 * inside a trace and nothing else (docs/EDITORIAL.md rule 3).
 */
export function PhaseHeader({ phase }: { phase: Phase }) {
  const info = phaseInfo(phase);
  const Icon = info.icon;
  const compilation = useCompilationStore((s) => s.compilation);
  const stale = useCompilationStore((s) => s.stale);
  const pipeline = useCompilationStore((s) => s.pipelineInfo);
  const stage = stageInfo(compilation, stale, phase, (c) => info.summary(c, pipeline));
  const meta = STATUS_META[stage.status];

  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <Link
        to="/"
        aria-label="Back to the overview"
        className="-ml-1 flex h-8 shrink-0 items-center gap-1 self-center rounded-sm px-1 font-mono text-2xs tracking-[0.1em] text-ink-muted uppercase transition-colors hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-3.5" />
        Overview
      </Link>
      <span aria-hidden className="h-3 w-px self-center bg-line" />
      <h1 className="page-title flex items-baseline gap-2.5">
        <Icon
          aria-hidden
          className="size-5 shrink-0 translate-y-0.5 text-ink-faint"
          strokeWidth={1.75}
        />
        {info.title}
      </h1>
      <span aria-hidden className="hidden flex-1 sm:block" />
      <span
        title={stage.summary ? `${meta.label} — ${stage.summary}` : meta.label}
        className={clsx('flex items-center gap-1.5 self-center font-mono text-2xs', meta.text)}
      >
        <StatusIcon status={stage.status} className="size-3" />
        <span className="sr-only">{meta.label}</span>
        {stage.summary ? (
          <span className="text-ink-muted">{shortSummary(stage.summary)}</span>
        ) : (
          <span aria-hidden>{meta.label}</span>
        )}
      </span>
    </div>
  );
}

export function PhasePage({ phase, nav, children }: PhasePageProps) {
  const info = phaseInfo(phase);
  const { algo, setPhaseParams } = usePhaseUrlState();

  const activeAlgo = algo ?? info.algorithms[0]?.id ?? null;
  /** True when PhasePage draws the tablist itself (so it owns the tabpanel). */
  const ownTablist = nav === undefined && info.algorithms.length > 1;
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
    <div className="mx-auto flex w-full max-w-450 flex-1 flex-col gap-4 px-3 py-3 sm:px-5">
      <header className="flex flex-col gap-2">
        <PhaseHeader phase={phase} />

        {nav !== undefined && nav}

        {nav === undefined && info.algorithms.length > 1 && (
          <div
            ref={tabsRef}
            role="tablist"
            aria-label={`${info.title} algorithms`}
            aria-orientation="horizontal"
            onKeyDown={onTabsKeyDown}
            // Editorial navigation: one hairline under the whole row, and the
            // selected algorithm sits on an accent rule cut into it.
            className="-mb-px flex flex-wrap items-center gap-x-1 border-b border-line"
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
                    // 44px tall, and selected is marked by weight + an accent
                    // rule under the label, never by colour alone.
                    'h-11 cursor-pointer px-2 text-sm whitespace-nowrap transition-colors duration-[var(--dur-fast)] sm:px-2.5',
                    selected
                      ? 'border-b-2 border-accent font-semibold text-ink'
                      : 'border-b-2 border-transparent text-ink-muted hover:border-line-strong hover:text-ink',
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
        role={ownTablist ? 'tabpanel' : undefined}
        aria-label={ownTablist ? `${info.title} visualization` : undefined}
        className="flex-1"
      >
        {children}
      </div>
    </div>
  );
}

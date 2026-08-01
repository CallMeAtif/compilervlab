/**
 * Fullscreen for artifacts that are NOT graphs — a TAC listing, an IN/OUT
 * table, the emitted assembly.
 *
 * `ElkGraph` and `TidyTree` own their fullscreen button because they draw on a
 * canvas, where a floating control covers nothing. A table or a listing has no
 * such slack: a button floating over its top-right corner sits on the OUT
 * column, or on the first line's role tag. So here the toggle goes in the
 * region's EXISTING head — the one chrome band a `.section` already has
 * (docs/EDITORIAL.md §0) — and the body is what fills the screen.
 *
 * Three parts, composed by whichever panel owns the region:
 *   useFullscreen()   the handle (shared hook)
 *   FullscreenToggle  the button, for the `.section-head`
 *   FullscreenBody    the element that fills the screen, with its bottom bar
 *
 * Which to reach for: an artifact drawn on a CANVAS (ElkGraph, TidyTree,
 * VirtualTable) uses `viz/FullscreenChrome`, whose toggle floats over the
 * corner — there is nothing under it. An artifact whose corner is content, and
 * whose inline box is itself the scroller, uses these three instead: an
 * absolutely positioned child of a scroller scrolls away with the content.
 *
 * `FullscreenTransport` is what every stepped artifact passes as `controls`,
 * here or to `ElkGraph`/`TidyTree`/`VirtualTable`. Fullscreen hides the
 * TracePanel, so without it a diagram freezes at whatever step you left it on.
 *
 * The two paths differ ONLY inline. Once fullscreen, both render the same
 * `FullscreenBar` (from `viz/FullscreenChrome`) — transport left, exit right,
 * flush against the bottom edge — so the fullscreen chrome is identical no
 * matter which artifact on which route the reader opened.
 */
import { useCallback, type KeyboardEvent, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { Maximize2, Pause, Play, RotateCcw, StepBack, StepForward } from 'lucide-react';
import type { FullscreenHandle } from '../lib/useFullscreen';
import type { Stepper } from '../lib/useStepper';
import { FS_BUTTON, FullscreenBar } from './viz/FullscreenChrome';

// ── the transport ───────────────────────────────────────────────────────────

/**
 * Transport + counter + this step's prose, on ONE row.
 *
 * Deliberately not `<StepControls/>`: its buttons are wrapped in Radix
 * tooltips, and a Radix portal mounts on `document.body` — which is OUTSIDE
 * the element the Fullscreen API paints, so every tooltip would be invisible.
 * Native `title` attributes are used instead, and the secondary menu (speed,
 * micro steps, jump-to) stays where EDITORIAL §0 puts it: on the page, one
 * interaction away.
 *
 * No `aria-live` region either — StepControls already owns one and is still in
 * the accessibility tree while fullscreen, so a second would make a screen
 * reader announce every step twice.
 */
export function FullscreenTransport<S, E extends { kind: string }>({
  stepper,
}: {
  stepper: Stepper<S, E>;
}) {
  const { index, length, currentStep, playing, atStart, atEnd } = stepper;

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const el = e.target as HTMLElement;
      if (el !== e.currentTarget && el.closest('button')) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (e.shiftKey) stepper.nextSection();
        else stepper.next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (e.shiftKey) stepper.prevSection();
        else stepper.prev();
      } else if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        stepper.togglePlay();
      } else if (e.key === 'Home') {
        e.preventDefault();
        stepper.reset();
      } else if (e.key === 'End') {
        e.preventDefault();
        stepper.jumpTo(length);
      }
    },
    [stepper, length],
  );

  // Zero-padded to the width of the total, so playback never re-flows the row.
  const pad = String(Math.max(1, length)).length;

  return (
    <div
      role="group"
      // NOT "Step controls": the page's own StepControls group keeps that
      // name, and two groups sharing one name are ambiguous by voice.
      aria-label="Fullscreen step controls"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="flex min-w-0 flex-1 items-center gap-x-1"
    >
      <FsButton label="Reset to start (Home)" onClick={stepper.reset} disabled={atStart}>
        <RotateCcw aria-hidden className="size-4" />
      </FsButton>
      <FsButton label="Previous step (←)" onClick={stepper.prev} disabled={atStart}>
        <StepBack aria-hidden className="size-4" />
      </FsButton>
      <FsButton
        label={playing ? 'Pause (Space)' : 'Play (Space)'}
        onClick={stepper.togglePlay}
        emphasis
      >
        {playing ? (
          <Pause aria-hidden className="size-4" />
        ) : (
          <Play aria-hidden className="size-4" />
        )}
      </FsButton>
      <FsButton label="Next step (→)" onClick={stepper.next} disabled={atEnd}>
        <StepForward aria-hidden className="size-4" />
      </FsButton>

      <span
        className="ml-1 shrink-0 px-1 font-mono text-code tracking-tight tabular-nums"
        aria-hidden
      >
        <span className="text-ink">{String(index).padStart(pad, '0')}</span>
        <span className="text-ink-faint"> / {length}</span>
      </span>

      {/* The step's own prose. The ExplainCard is off-screen while fullscreen,
          so without this the artifact moves and nothing says why. */}
      <span className="ml-3 min-w-0 flex-1 truncate text-sm text-ink-muted" aria-hidden>
        {currentStep?.meta.prose ?? ''}
      </span>
    </div>
  );
}

function FsButton({
  label,
  onClick,
  disabled,
  emphasis,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  emphasis?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-sm transition-colors duration-[var(--dur-fast)]',
        emphasis
          ? 'bg-accent-soft text-accent shadow-[inset_0_0_0_1px_var(--accent)] hover:bg-accent hover:text-on-accent'
          : 'text-ink-muted hover:bg-raised hover:text-ink',
        'disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent',
      )}
    >
      {children}
    </button>
  );
}

// ── the toggle, for a `.section-head` ───────────────────────────────────────

export interface FullscreenToggleProps {
  fs: FullscreenHandle;
  /** Names the artifact in the accessible name: "View the IN/OUT table…". */
  label: string;
  className?: string;
}

/**
 * Renders nothing where the browser has no Fullscreen API — and nothing WHILE
 * fullscreen either. The head this button lives in is outside the element the
 * API promotes, so once the body fills the screen the button is unreachable;
 * leaving it mounted only put a second, invisible "Exit fullscreen" in the
 * accessibility tree next to the real one in the bar.
 */
export function FullscreenToggle({ fs, label, className }: FullscreenToggleProps) {
  if (!fs.supported || fs.isFullscreen) return null;
  return (
    <button
      type="button"
      onClick={fs.toggle}
      aria-label={`View ${label} fullscreen`}
      title="View fullscreen"
      className={clsx(FS_BUTTON, className)}
    >
      <Maximize2 aria-hidden className="size-4" />
    </button>
  );
}

// ── the body that fills the screen ──────────────────────────────────────────

export interface FullscreenBodyProps {
  fs: FullscreenHandle;
  /** Transport bar, shown along the bottom ONLY while fullscreen. */
  controls?: ReactNode;
  /** Applied only when INLINE; fullscreen supplies its own box. */
  className?: string;
  /**
   * Applied to the scrolling area only when FULLSCREEN. For the few artifacts
   * that are drawn on their own stock — a code listing is `bg-code`, not the
   * sheet — so expanding one does not change the paper it is printed on.
   */
  fullscreenClassName?: string;
  children: ReactNode;
}

/**
 * The element the Fullscreen API promotes.
 *
 * Inline it is a plain wrapper with the caller's classes (so `max-h-*`,
 * `.framed` and `bg-code` are untouched). Fullscreen it drops them — a listing
 * capped at 36rem in the middle of a black screen is the bug, not the feature —
 * restates the sheet (the API paints black behind it), scrolls the artifact,
 * and hangs the SAME `FullscreenBar` a graph gets off the bottom.
 *
 * The padding is on the scroll area's wrapper rather than on the promoted
 * element, so the bar sits flush against the bottom edge of the screen exactly
 * as it does under a graph. With `p-4` on the outer box the bar was inset by
 * 16px on three sides and the two fullscreen layouts did not match.
 */
export function FullscreenBody({
  fs,
  controls,
  className,
  fullscreenClassName,
  children,
}: FullscreenBodyProps) {
  if (!fs.isFullscreen) {
    return (
      <div ref={fs.ref} className={className}>
        {children}
      </div>
    );
  }
  return (
    <div ref={fs.ref} className="flex h-full flex-col bg-surface">
      <div className="min-h-0 min-w-0 flex-1 p-4">
        <div className={clsx('artifact-scroll h-full min-w-0', fullscreenClassName)}>
          {children}
        </div>
      </div>
      <FullscreenBar fs={fs} controls={controls} />
    </div>
  );
}

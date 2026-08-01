/**
 * Transport controls for a Stepper.
 *
 * Visible: reset / prev / play / next, the step counter, the scrubber with its
 * section tick-marks. Everything else — playback speed, micro steps, the
 * per-algorithm "jump to…" targets — lives behind ONE menu button, because a
 * reader is not using them while they step (docs/EDITORIAL.md §0, density).
 *
 * Keyboard (when the controls group has focus): ArrowLeft/Right = step,
 * Shift+Arrow = section jump, Space = play/pause.
 */
import {
  useCallback,
  useId,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import * as Slider from '@radix-ui/react-slider';
import * as Switch from '@radix-ui/react-switch';
import * as Popover from '@radix-ui/react-popover';
import {
  Pause,
  Play,
  RotateCcw,
  SlidersHorizontal,
  StepBack,
  StepForward,
} from 'lucide-react';
import { clsx } from 'clsx';
import type { StepRecord } from '@lab/trace';
import type { Stepper, PlaySpeed } from '../lib/useStepper';
import { PLAY_SPEEDS } from '../lib/useStepper';
import { Tooltip } from './ui/Tooltip';

function TransportButton({
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
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
        className={clsx(
          // 44px target (WCAG 2.5.5), no outline: on an icon-only control the
          // GLYPH is the thing that identifies it, and every glyph here is
          // ink-muted or better (>= 3:1 on the sheet in both themes).
          'flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-sm transition-colors duration-[var(--dur-fast)] ease-emphasis',
          emphasis
            ? // The one primary action keeps a ring as well as a fill.
              'bg-accent-soft text-accent shadow-[inset_0_0_0_1px_var(--accent)] hover:bg-accent hover:text-on-accent'
            : 'text-ink-muted hover:bg-raised hover:text-ink',
          'disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent',
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

/**
 * One entry of the per-algorithm "jump to…" menu (PLAN.md: next iteration /
 * next conflict / next new state / next error).
 *
 * Give it either a `predicate` over recorded steps or a precomputed list of
 * step `indices` (0-based into `trace.steps`) — indices are matched by identity,
 * so a route that already scanned the trace does not scan it again.
 */
export interface JumpTarget<E extends { kind: string } = { kind: string }> {
  label: string;
  predicate?: (step: StepRecord<E>) => boolean;
  indices?: readonly number[];
  /** Longer description, shown under the label and used as the aria-label. */
  hint?: string;
  /** Occurrences in the trace; computed from the predicate when omitted. */
  count?: number;
}

/** Predicate form of a jump target — `indices` are reduced to one. */
function targetPredicate<E extends { kind: string }>(
  t: JumpTarget<E>,
): (step: StepRecord<E>) => boolean {
  if (t.predicate) return t.predicate;
  const wanted = new Set(t.indices ?? []);
  return (step) => wanted.has(step.index);
}

/** A label over a group inside the options menu. Four words, never a sentence. */
function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <span className="px-2 pt-1 font-mono text-2xs tracking-[0.08em] text-ink-faint uppercase">
      {children}
    </span>
  );
}

/**
 * The one secondary-controls menu: playback speed, micro steps, and the
 * per-algorithm "jump to…" targets.
 *
 * Jumping searches forward from the cursor and WRAPS, which keeps every entry
 * useful at the end of a trace; `jumpToNextMatching` also reveals a hit the
 * macro filter would otherwise hide.
 *
 * The content is deliberately NOT portalled: it stays inside the `Step
 * controls` group, so the group's keyboard contract still covers it.
 */
function OptionsMenu<S, E extends { kind: string }>({
  stepper,
  targets,
}: {
  stepper: Stepper<S, E>;
  targets: readonly JumpTarget<E>[];
}) {
  const [open, setOpen] = useState(false);
  const { trace, speed, level } = stepper;
  const nonDefault = speed !== 1 || level === 'micro';

  // Counting walks the whole trace, so it only happens while the menu is open.
  const counts = useMemo<readonly number[]>(() => {
    if (!open) return targets.map(() => 0);
    return targets.map((t) => {
      if (t.count !== undefined) return t.count;
      if (t.indices) return t.indices.length;
      const pred = targetPredicate(t);
      let n = 0;
      for (const s of trace.steps) if (pred(s)) n++;
      return n;
    });
  }, [open, targets, trace]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      {/* NOT "Playback…": the transport's Play button is found by name, and a
          second control whose name starts the same way is ambiguous. */}
      <Tooltip content="Step options">
        <Popover.Trigger
          aria-label={`Step options — ${speed}× speed, micro steps ${
            level === 'micro' ? 'on' : 'off'
          }`}
          className="relative flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-sm text-ink-muted transition-colors duration-[var(--dur-fast)] hover:bg-raised hover:text-ink data-[state=open]:bg-raised data-[state=open]:text-ink"
        >
          <SlidersHorizontal aria-hidden className="size-5" />
          {/* A mark, not a colour: the menu holds a non-default setting. */}
          {nonDefault && (
            <span aria-hidden className="absolute top-2 right-2 size-1.5 rounded-full bg-accent" />
          )}
        </Popover.Trigger>
      </Tooltip>
      <Popover.Content
        side="top"
        align="end"
        sideOffset={4}
        collisionPadding={8}
        className="overlay-panel z-50 flex max-h-[70vh] w-72 flex-col gap-1 overflow-auto rounded-md p-1"
      >
        <MenuLabel>Speed</MenuLabel>
        <div role="radiogroup" aria-label="Playback speed" className="flex gap-1 px-1">
          {PLAY_SPEEDS.map((s) => {
            const active = s === speed;
            return (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={`${s}×`}
                onClick={() => stepper.setSpeed(s as PlaySpeed)}
                className={clsx(
                  // Selected carries weight and an underline rule, not colour
                  // alone, so it survives greyscale.
                  'h-11 flex-1 cursor-pointer rounded-sm border-b-2 font-mono text-sm transition-colors duration-[var(--dur-fast)]',
                  active
                    ? 'border-accent bg-accent-soft font-semibold text-ink'
                    : 'border-transparent text-ink-muted hover:bg-raised hover:text-ink',
                )}
              >
                {s}×
              </button>
            );
          })}
        </div>

        {/* The switch track is its own >= 3:1 boundary, so the label needs none. */}
        <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-sm px-2 text-sm text-ink transition-colors duration-[var(--dur-fast)] hover:bg-raised">
          <Switch.Root
            checked={level === 'micro'}
            onCheckedChange={(checked) => stepper.setLevel(checked ? 'micro' : 'macro')}
            aria-label="Show micro steps"
            className="relative h-5 w-9 shrink-0 cursor-pointer rounded-full border border-control bg-raised transition-colors duration-[var(--dur-fast)] data-[state=checked]:border-accent data-[state=checked]:bg-accent"
          >
            {/* The thumb travels: position, not just colour, reports state. */}
            <Switch.Thumb className="block size-4 translate-x-0.5 rounded-full border border-control bg-surface transition-transform duration-[var(--dur-fast)] ease-emphasis data-[state=checked]:translate-x-4 data-[state=checked]:border-accent-strong" />
          </Switch.Root>
          Micro steps
        </label>

        {targets.length > 0 && (
          <>
            <MenuLabel>Jump to next</MenuLabel>
            {targets.map((t, i) => {
              const n = counts[i] ?? 0;
              return (
                <button
                  key={t.label}
                  type="button"
                  disabled={open && n === 0}
                  aria-label={`Jump to the next ${t.hint ?? t.label}${
                    open ? ` (${n} in this trace)` : ''
                  }`}
                  onClick={() => {
                    stepper.jumpToNextMatching(targetPredicate(t), { wrap: true });
                    setOpen(false);
                  }}
                  className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 py-2 text-left text-sm text-ink transition-colors duration-[var(--dur-fast)] hover:bg-accent-soft hover:shadow-[inset_2px_0_0_var(--accent)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:shadow-none"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">{t.label}</span>
                    {t.hint && (
                      <span className="truncate text-xs text-ink-muted">{t.hint}</span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-2xs text-ink-muted">{n}</span>
                </button>
              );
            })}
          </>
        )}
        <Popover.Arrow className="fill-line-strong" />
      </Popover.Content>
    </Popover.Root>
  );
}

export interface StepControlsProps<S = unknown, E extends { kind: string } = { kind: string }> {
  stepper: Stepper<S, E>;
  /** "Jump to next…" entries, listed in the options menu when non-empty. */
  jumpTargets?: readonly JumpTarget<E>[];
  className?: string;
}

export function StepControls<S = unknown, E extends { kind: string } = { kind: string }>({
  stepper,
  jumpTargets,
  className,
}: StepControlsProps<S, E>) {
  const { index, length, currentStep, playing, atStart, atEnd, sections, speed } = stepper;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      // Let interactive children (slider, buttons, selects) keep their own keys.
      const el = e.target as HTMLElement;
      if (el !== e.currentTarget && el.closest('button, [role="slider"], [role="switch"], [role="combobox"]')) {
        return;
      }
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

  const helpId = useId();

  /*
   * The counter and the scrubber read in NAVIGABLE space, not absolute trace
   * space. At macro level next/prev walk `visibleCursors`, so an absolute
   * readout jumped "1 → 22" over twenty filtered micro steps while still
   * promising "/ 26" — positions the reader could not reach. Numbering the
   * positions you can actually stand on removes the jump; the absolute index
   * stays available in the explain card and in `?step=`.
   */
  // Cursor positions the transport can stand on: the initial state, then one
  // after each visible step (mirrors useStepper's own `visibleCursors`).
  const cursors = useMemo(
    () => [0, ...stepper.visibleIndices.map((i) => i + 1)],
    [stepper.visibleIndices],
  );
  const navPosOf = useCallback(
    (absolute: number) => {
      const i = cursors.findIndex((c) => c >= absolute);
      return i === -1 ? cursors.length - 1 : i;
    },
    [cursors],
  );
  const navPos = navPosOf(index);
  const navTotal = Math.max(1, cursors.length - 1);
  const hiddenCount = length - (cursors.length - 1);

  // Fixed-width counter: zero-padded to the width of the total, so playback
  // never re-flows the row it sits in (layout-stability rule).
  const pad = String(navTotal).length;

  return (
    <div
      role="group"
      aria-label="Step controls"
      aria-describedby={helpId}
      /*
       * ABSOLUTE trace position, for anything that needs the real step number:
       * `?step=` deep links and the e2e helpers. The slider's own aria-valuenow
       * is deliberately NOT this — it describes the slider, which moves through
       * navigable positions, and at macro level those are far fewer.
       */
      data-step-index={index}
      data-step-total={length}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className={clsx(
        // An instrument, not a card: a rule separates it from the artifact
        // above, and nothing is boxed.
        'flex flex-col gap-2 border-t border-line pt-2',
        className,
      )}
    >
      <p id={helpId} className="sr-only">
        With this group focused: Left and Right arrows step, Shift with an arrow jumps a
        section, Space plays or pauses, Home returns to the start and End goes to the last
        step.
      </p>

      {/* transport row */}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
        <TransportButton label="Reset to start (Home)" onClick={stepper.reset} disabled={atStart}>
          <RotateCcw aria-hidden className="size-5" />
        </TransportButton>
        <TransportButton label="Previous step (←)" onClick={stepper.prev} disabled={atStart}>
          <StepBack aria-hidden className="size-5" />
        </TransportButton>
        <TransportButton
          label={playing ? 'Pause (Space)' : 'Play (Space)'}
          onClick={stepper.togglePlay}
          emphasis
        >
          {playing ? (
            <Pause aria-hidden className="size-5" />
          ) : (
            <Play aria-hidden className="size-5" />
          )}
        </TransportButton>
        <TransportButton label="Next step (→)" onClick={stepper.next} disabled={atEnd}>
          <StepForward aria-hidden className="size-5" />
        </TransportButton>

        {/* Tabular step counter — the reading on the instrument. */}
        <span
          className="ml-1 shrink-0 px-1 font-mono text-code tracking-tight tabular-nums"
          aria-hidden
        >
          <span className="text-ink">{String(navPos).padStart(pad, '0')}</span>
          <span className="text-ink-faint"> / {navTotal}</span>
        </span>
        {/* Say WHY the total is smaller than the trace, so a reader who wonders
            where the other steps went can find the switch that shows them. */}
        {hiddenCount > 0 && (
          <span
            title={`${hiddenCount} micro steps are filtered out. Turn on “Micro steps” in step options to walk them.`}
            className="shrink-0 font-mono text-3xs text-ink-faint tabular-nums"
          >
            +{hiddenCount} micro
          </span>
        )}

        <span className="flex-1" />

        <OptionsMenu stepper={stepper} targets={jumpTargets ?? []} />
      </div>

      {/* scrubber row */}
      <div className="relative px-1.5 pt-1 pb-5">
        <Slider.Root
          // Navigable space, like the counter: one slider notch per position
          // the transport can actually stop at.
          value={[navPos]}
          min={0}
          max={navTotal}
          step={1}
          disabled={length === 0}
          onValueChange={(v) => {
            const pos = v[0];
            if (pos === undefined) return;
            const target = cursors[Math.min(pos, cursors.length - 1)];
            if (target !== undefined) stepper.scrubTo(target);
          }}
          aria-label="Step scrubber"
          className="relative flex h-6 w-full touch-none items-center select-none"
        >
          {/* The empty track needs its own >=3:1 outline — `bg-raised` alone is
              ~1.1:1 against the panel in both themes. */}
          {/* A measured rule rather than a pill: the empty track still needs its
              own >= 3:1 outline — `bg-raised` alone is ~1.1:1 in both themes. */}
          <Slider.Track className="relative h-1 grow rounded-xs bg-raised shadow-[inset_0_0_0_1px_var(--control)]">
            <Slider.Range className="absolute h-full rounded-xs bg-accent" />
          </Slider.Track>
          <Slider.Thumb
            aria-label={`Step ${navPos} of ${navTotal}`}
            className="block size-4 cursor-grab rounded-full border-2 border-surface bg-accent shadow-[0_0_0_1px_var(--accent-strong)] active:cursor-grabbing"
          />
        </Slider.Root>

        {/*
          Section tick-marks, rendered AFTER the slider so tab order matches the
          visual order (scrubber first, then the marks beneath it). The visible
          mark is 3x10px but the hit area is 24x24 (WCAG 2.2 SC 2.5.8 minimum);
          44px is unreachable here because the targets' spacing is determined by
          the trace itself — the standard's "essential" exception.
        */}
        {length > 0 &&
          sections.map((s) => (
            <Tooltip key={`${s.name}-${s.startIndex}`} content={s.name} side="bottom">
              <button
                type="button"
                aria-label={`Jump to section: ${s.name}`}
                onClick={() => stepper.jumpTo(s.startIndex)}
                className="group absolute bottom-0 z-10 flex size-6 -translate-x-1/2 cursor-pointer items-start justify-center pt-1"
                style={{ left: `${(navPosOf(s.startIndex) / navTotal) * 100}%` }}
              >
                <span
                  aria-hidden
                  className="block h-2.5 w-0.75 rounded-sm bg-ink-faint transition-colors duration-[var(--dur-fast)] group-hover:bg-accent"
                />
              </button>
            </Tooltip>
          ))}
      </div>

      {/*
        Screen-reader step announcement. During playback the text is held
        CONSTANT: at 4x a per-step message queues faster than any screen reader
        can speak it, so the user hears a backlog instead of where they are.
        Pausing changes the text back to the step, which announces normally.
      */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {playing
          ? `Playing at ${speed} times speed. Press Space to pause and hear the current step.`
          : currentStep
            ? `Step ${index} of ${length}. ${currentStep.meta.prose}`
            : `At initial state. ${length} steps available.`}
      </div>
    </div>
  );
}

/**
 * Transport controls for a Stepper: prev/next/play/pause/reset, speed select,
 * macro-micro switch, scrubber with section tick-marks, step counter, and a
 * polite aria-live region announcing the current step.
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
import * as Select from '@radix-ui/react-select';
import * as Switch from '@radix-ui/react-switch';
import * as Popover from '@radix-ui/react-popover';
import {
  Check,
  ChevronDown,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
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
          // 44px target (WCAG 2.5.5). `border-control` is the >=3:1 outline that
          // makes the button identifiable — `border-line` is not.
          'flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md border transition-colors duration-[var(--dur-fast)] ease-emphasis',
          emphasis
            ? 'border-accent bg-accent text-on-accent hover:bg-accent-strong'
            : 'border-control bg-surface text-ink-muted hover:bg-raised hover:text-ink',
          'disabled:cursor-not-allowed disabled:opacity-40',
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

/**
 * The per-algorithm "jump to…" menu. Searching forward from the cursor and
 * WRAPPING keeps every entry useful at the end of a trace; `jumpToNextMatching`
 * reveals a hit that the macro filter would otherwise hide.
 */
function JumpMenu<S, E extends { kind: string }>({
  stepper,
  targets,
}: {
  stepper: Stepper<S, E>;
  targets: readonly JumpTarget<E>[];
}) {
  const [open, setOpen] = useState(false);
  const { trace } = stepper;

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
      <Popover.Trigger
        className="flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-control bg-surface px-3 text-sm text-ink-muted transition-colors duration-[var(--dur-fast)] hover:bg-raised hover:text-ink"
        aria-label="Jump to a step"
      >
        <SkipForward aria-hidden className="size-4" />
        Jump to
        <ChevronDown aria-hidden className="size-4" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className="overlay-panel z-50 flex max-h-96 w-72 flex-col gap-0.5 overflow-auto rounded-md p-1"
        >
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
                  {t.hint && <span className="truncate text-xs text-ink-muted">{t.hint}</span>}
                </span>
                <span className="shrink-0 font-mono text-2xs text-ink-muted">{n}</span>
              </button>
            );
          })}
          <Popover.Arrow className="fill-line-strong" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export interface StepControlsProps<S = unknown, E extends { kind: string } = { kind: string }> {
  stepper: Stepper<S, E>;
  /** Renders the "Jump to…" menu when non-empty. */
  jumpTargets?: readonly JumpTarget<E>[];
  className?: string;
}

export function StepControls<S = unknown, E extends { kind: string } = { kind: string }>({
  stepper,
  jumpTargets,
  className,
}: StepControlsProps<S, E>) {
  const {
    index,
    length,
    currentStep,
    playing,
    atStart,
    atEnd,
    sections,
    level,
    speed,
  } = stepper;

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

  return (
    <div
      role="group"
      aria-label="Step controls"
      aria-describedby={helpId}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className={clsx(
        'flex flex-col gap-3 rounded-lg border border-line bg-surface p-3',
        className,
      )}
    >
      <p id={helpId} className="sr-only">
        With this group focused: Left and Right arrows step, Shift with an arrow jumps a
        section, Space plays or pauses, Home returns to the start and End goes to the last
        step.
      </p>

      {/* transport row */}
      <div className="flex flex-wrap items-center gap-2">
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

        <span className="min-w-24 px-1 font-mono text-sm text-ink-muted" aria-hidden>
          Step {index} / {length}
        </span>

        {jumpTargets && jumpTargets.length > 0 && (
          <JumpMenu stepper={stepper} targets={jumpTargets} />
        )}

        <span className="flex-1" />

        {/* speed */}
        <Select.Root
          value={String(speed)}
          onValueChange={(v) => stepper.setSpeed(Number(v) as PlaySpeed)}
        >
          <Select.Trigger
            aria-label="Playback speed"
            className="flex h-11 min-w-19 cursor-pointer items-center justify-between gap-1 rounded-md border border-control bg-surface px-3 font-mono text-sm text-ink-muted transition-colors duration-[var(--dur-fast)] hover:bg-raised hover:text-ink"
          >
            <Select.Value />
            <Select.Icon>
              <ChevronDown aria-hidden className="size-4" />
            </Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Content
              position="popper"
              sideOffset={4}
              className="overlay-panel z-50 min-w-24 rounded-md p-1"
            >
              <Select.Viewport>
                {PLAY_SPEEDS.map((s) => (
                  <Select.Item
                    key={s}
                    value={String(s)}
                    className="flex min-h-9 cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 font-mono text-sm text-ink outline-none select-none data-[highlighted]:bg-accent-soft data-[highlighted]:shadow-[inset_2px_0_0_var(--accent)]"
                  >
                    <Select.ItemText>{s}×</Select.ItemText>
                    <Select.ItemIndicator>
                      <Check aria-hidden className="size-3.5 text-accent" />
                    </Select.ItemIndicator>
                  </Select.Item>
                ))}
              </Select.Viewport>
            </Select.Content>
          </Select.Portal>
        </Select.Root>

        {/* macro / micro */}
        <label className="flex h-11 cursor-pointer items-center gap-2 rounded-md border border-control bg-surface px-3 text-sm text-ink-muted transition-colors duration-[var(--dur-fast)] hover:bg-raised hover:text-ink">
          <Switch.Root
            checked={level === 'micro'}
            onCheckedChange={(checked) => stepper.setLevel(checked ? 'micro' : 'macro')}
            aria-label="Show micro steps"
            className="relative h-5 w-9 shrink-0 cursor-pointer rounded-full border border-control bg-raised transition-colors duration-[var(--dur-fast)] data-[state=checked]:border-accent data-[state=checked]:bg-accent"
          >
            {/* The thumb also travels — position, not just colour, reports state. */}
            <Switch.Thumb className="block size-4 translate-x-0.5 rounded-full border border-control bg-surface transition-transform duration-[var(--dur-fast)] ease-emphasis data-[state=checked]:translate-x-4 data-[state=checked]:border-accent-strong" />
          </Switch.Root>
          Micro steps
        </label>
      </div>

      {/* scrubber row */}
      <div className="relative px-1.5 pt-3 pb-6">
        <Slider.Root
          value={[index]}
          min={0}
          max={Math.max(1, length)}
          step={1}
          disabled={length === 0}
          onValueChange={(v) => {
            const target = v[0];
            if (target !== undefined) stepper.scrubTo(target);
          }}
          aria-label="Step scrubber"
          className="relative flex h-6 w-full touch-none items-center select-none"
        >
          {/* The empty track needs its own >=3:1 outline — `bg-raised` alone is
              ~1.1:1 against the panel in both themes. */}
          <Slider.Track className="relative h-1.5 grow rounded-full bg-raised shadow-[inset_0_0_0_1px_var(--control)]">
            <Slider.Range className="absolute h-full rounded-full bg-accent" />
          </Slider.Track>
          <Slider.Thumb
            aria-label={`Step ${index} of ${length}`}
            className="block size-5 cursor-grab rounded-full border-2 border-surface bg-accent shadow-[0_0_0_1px_var(--accent-strong)] active:cursor-grabbing"
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
                style={{ left: `${(s.startIndex / length) * 100}%` }}
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

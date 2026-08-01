/**
 * The step machinery: turns a recorded Trace<S, E> into an interactive cursor
 * with macro/micro filtering, playback, section jumps and predicate search.
 *
 * Cursor semantics follow Trace.stateAt: cursor `index` in [0, length] is the
 * state AFTER applying steps[0 .. index-1]; index 0 is the initial state.
 * The step "at" the cursor (what ExplainCard shows) is steps[index - 1].
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StepLevel, StepRecord, Trace } from '@lab/trace';

export type PlaySpeed = 0.5 | 1 | 2 | 4;
export const PLAY_SPEEDS: readonly PlaySpeed[] = [0.5, 1, 2, 4];

/** Base delay between steps at 1x. */
const BASE_STEP_MS = 700;

/**
 * Playback stops on the first error event (errors are pedagogical stopping
 * points, per PLAN.md).
 *
 * Two vocabularies express an error, and both must be recognised:
 *   • a `kind` that says so — `lexError`, `ll1p.error`, `rd.error`,
 *     `parse/error`;
 *   • a `{ kind: 'diagnostic', diagnostic }` event, which is how the semantic
 *     pass (core/src/sem/sem-events.ts) and code generation
 *     (core/src/codegen/cg-events.ts) report theirs. Only `severity: 'error'`
 *     stops playback — a warning (e.g. a missing return on a checked path) is
 *     advisory and must not interrupt the run.
 */
export function isErrorEvent(event: { kind: string }): boolean {
  if (event.kind.toLowerCase().includes('error')) return true;
  if (event.kind === 'diagnostic') {
    const { diagnostic } = event as { diagnostic?: { severity?: string } };
    return diagnostic?.severity === 'error';
  }
  return false;
}

export interface Section {
  name: string;
  startIndex: number;
}

export interface Stepper<S, E extends { kind: string }> {
  trace: Trace<S, E>;
  /** Cursor position in [0, length]. */
  index: number;
  /** Reduced state at the cursor. */
  state: S;
  /** Step whose effect the cursor just applied (null at index 0). */
  currentStep: StepRecord<E> | null;
  /** Total step count (= trace.length). */
  length: number;

  /** Macro/micro filter. */
  level: StepLevel;
  setLevel: (level: StepLevel) => void;
  /** groupIds whose micro steps stay visible while filtering at macro level. */
  expandedGroups: ReadonlySet<string>;
  toggleGroup: (groupId: string) => void;
  /** Step indices visible under the current filter (ascending). */
  visibleIndices: readonly number[];

  atStart: boolean;
  atEnd: boolean;
  next: () => void;
  prev: () => void;
  reset: () => void;
  /** Exact jump (deep links); clamped to [0, length]. */
  jumpTo: (index: number) => void;
  /** Scrubber jump: snaps to the nearest visible cursor position. */
  scrubTo: (index: number) => void;
  /** Jump past the first step at/after the cursor matching pred; expands its
   *  group if it is filtered out. No-op when nothing matches.
   *  With `{ wrap: true }` the search restarts from the top instead of giving
   *  up, so a "jump to next …" affordance always does something. */
  jumpToNextMatching: (
    pred: (s: StepRecord<E>) => boolean,
    options?: { wrap?: boolean },
  ) => void;

  sections: readonly Section[];
  nextSection: () => void;
  prevSection: () => void;

  playing: boolean;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  speed: PlaySpeed;
  setSpeed: (s: PlaySpeed) => void;
}

export interface UseStepperOptions {
  /** Initial cursor (e.g. from ?step= deep link). */
  initialIndex?: number;
  /** Called after the cursor settles (debouncing is the caller's concern —
   *  urlState already debounces writes). */
  onIndexChange?: (index: number) => void;
}

export function useStepper<S, E extends { kind: string }>(
  trace: Trace<S, E>,
  options: UseStepperOptions = {},
): Stepper<S, E> {
  const { initialIndex, onIndexChange } = options;
  const clamp = useCallback(
    (i: number) => Math.max(0, Math.min(trace.length, Math.round(i))),
    [trace],
  );

  const [index, setIndexRaw] = useState(() => clamp(initialIndex ?? 0));
  const [level, setLevelRaw] = useState<StepLevel>('macro');
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(new Set());
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaySpeed>(1);

  // Reset the cursor when a different trace is supplied.
  const traceRef = useRef(trace);
  useEffect(() => {
    if (traceRef.current !== trace) {
      traceRef.current = trace;
      setIndexRaw(clamp(initialIndex ?? 0));
      setPlaying(false);
      setExpandedGroups(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trace]);

  const indexRef = useRef(index);
  indexRef.current = index;

  const setIndex = useCallback(
    (i: number) => {
      const next = clamp(i);
      setIndexRaw(next);
      indexRef.current = next;
      onIndexChange?.(next);
    },
    [clamp, onIndexChange],
  );

  const visibleIndices = useMemo<readonly number[]>(() => {
    if (level === 'micro') return trace.steps.map((s) => s.index);
    const out: number[] = [];
    for (const s of trace.steps) {
      if (s.meta.level === 'macro') out.push(s.index);
      else if (s.meta.groupId && expandedGroups.has(s.meta.groupId)) out.push(s.index);
    }
    return out;
  }, [trace, level, expandedGroups]);

  /** Valid cursor positions under the filter: 0, then i+1 per visible step. */
  const visibleCursors = useMemo<readonly number[]>(
    () => [0, ...visibleIndices.map((i) => i + 1)],
    [visibleIndices],
  );

  const nextCursorAfter = useCallback(
    (from: number): number | null => {
      for (const c of visibleCursors) if (c > from) return c;
      return null;
    },
    [visibleCursors],
  );

  const prevCursorBefore = useCallback(
    (from: number): number | null => {
      for (let i = visibleCursors.length - 1; i >= 0; i--) {
        const c = visibleCursors[i]!;
        if (c < from) return c;
      }
      return null;
    },
    [visibleCursors],
  );

  const next = useCallback(() => {
    const c = nextCursorAfter(indexRef.current);
    if (c !== null) setIndex(c);
  }, [nextCursorAfter, setIndex]);

  const prev = useCallback(() => {
    const c = prevCursorBefore(indexRef.current);
    if (c !== null) setIndex(c);
  }, [prevCursorBefore, setIndex]);

  const reset = useCallback(() => {
    setPlaying(false);
    setIndex(0);
  }, [setIndex]);

  const jumpTo = useCallback((i: number) => setIndex(i), [setIndex]);

  const scrubTo = useCallback(
    (i: number) => {
      const target = clamp(i);
      let best = 0;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const c of visibleCursors) {
        const d = Math.abs(c - target);
        if (d < bestDist) {
          best = c;
          bestDist = d;
        }
      }
      setIndex(best);
    },
    [clamp, visibleCursors, setIndex],
  );

  const jumpToNextMatching = useCallback(
    (pred: (s: StepRecord<E>) => boolean, options?: { wrap?: boolean }) => {
      let found = trace.findIndex(pred, indexRef.current);
      if (found < 0 && options?.wrap) found = trace.findIndex(pred, 0);
      if (found < 0) return;
      const step = trace.steps[found];
      if (step && step.meta.level === 'micro' && level === 'macro') {
        const gid = step.meta.groupId;
        if (gid !== undefined) {
          setExpandedGroups((prevSet) => {
            if (prevSet.has(gid)) return prevSet;
            const nextSet = new Set(prevSet);
            nextSet.add(gid);
            return nextSet;
          });
        } else {
          // Ungrouped micro step: nothing to expand, so coarsen the filter
          // instead of seeking to a cursor the transport cannot reach.
          setLevelRaw('micro');
        }
      }
      setIndex(found + 1);
    },
    [trace, level, setIndex],
  );

  const sections = useMemo<readonly Section[]>(() => trace.sections(), [trace]);

  const nextSection = useCallback(() => {
    for (const s of sections) {
      if (s.startIndex > indexRef.current) {
        setIndex(s.startIndex);
        return;
      }
    }
    setIndex(trace.length); // past the last section start: go to the end
  }, [sections, setIndex, trace]);

  const prevSection = useCallback(() => {
    for (let i = sections.length - 1; i >= 0; i--) {
      const s = sections[i]!;
      if (s.startIndex < indexRef.current) {
        setIndex(s.startIndex);
        return;
      }
    }
    setIndex(0);
  }, [sections, setIndex]);

  const setLevel = useCallback((l: StepLevel) => setLevelRaw(l), []);

  const toggleGroup = useCallback((groupId: string) => {
    setExpandedGroups((prevSet) => {
      const nextSet = new Set(prevSet);
      if (nextSet.has(groupId)) nextSet.delete(groupId);
      else nextSet.add(groupId);
      return nextSet;
    });
  }, []);

  const play = useCallback(() => {
    // Restart from the top when play is pressed at the end.
    if (indexRef.current >= trace.length) setIndex(0);
    setPlaying(true);
  }, [trace, setIndex]);

  const pause = useCallback(() => setPlaying(false), []);
  const togglePlay = useCallback(() => {
    if (playing) setPlaying(false);
    else play();
  }, [playing, play]);

  // Playback loop: advance through VISIBLE cursors; stop at the end or on the
  // first error-kind event (after revealing it).
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      const c = nextCursorAfter(indexRef.current);
      if (c === null) {
        setPlaying(false);
        return;
      }
      setIndex(c);
      const landed = trace.steps[c - 1];
      if ((landed && isErrorEvent(landed.event)) || c >= trace.length) {
        setPlaying(false);
      }
    }, BASE_STEP_MS / speed);
    return () => window.clearInterval(id);
  }, [playing, speed, nextCursorAfter, setIndex, trace]);

  const state = useMemo(() => trace.stateAt(index), [trace, index]);
  const currentStep = index > 0 ? (trace.steps[index - 1] ?? null) : null;

  return {
    trace,
    index,
    state,
    currentStep,
    length: trace.length,
    level,
    setLevel,
    expandedGroups,
    toggleGroup,
    visibleIndices,
    atStart: index <= 0,
    atEnd: index >= trace.length,
    next,
    prev,
    reset,
    jumpTo,
    scrubTo,
    jumpToNextMatching,
    sections,
    nextSection,
    prevSection,
    playing,
    play,
    pause,
    togglePlay,
    speed,
    setSpeed,
  };
}

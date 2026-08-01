/**
 * Deep-link query-param helpers.
 *
 * `?algo=&step=&pass=` are the three params every phase shares (PLAN.md), but a
 * phase may add its own — `?tab=`, `?class=`, `?grammar=`, `?stage=`, `?table=`,
 * `?view=`, `?k=`. Those go through the SAME writer instead of a second raw
 * `useSearchParams`, so a phase-specific selection and a step write can never
 * race each other into two conflicting history entries.
 *
 * Reads are live. Writes are merged, always use `replace` (Back returns to the
 * previous page, not the previous step) and come in two flavours:
 *   • `setPhaseParams`  — debounced; for continuous writes (scrubbing).
 *   • `setPhaseParamsNow` — immediate; for click-driven selections. It flushes
 *     anything the debounced writer still had pending, so a selection cannot be
 *     overwritten by an in-flight step write.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

export interface PhaseUrlState {
  algo: string | null;
  step: number | null;
  pass: string | null;
}

/** `null` deletes a param; numbers are stringified. */
export type PhaseParamValue = string | number | null | undefined;

export type PhaseUrlPatch = {
  algo?: string | null;
  step?: number | null;
  pass?: string | null;
} & Record<string, PhaseParamValue>;

const WRITE_DEBOUNCE_MS = 250;

function parseStep(raw: string | null): number | null {
  if (raw === null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export interface PhaseUrlApi extends PhaseUrlState {
  /** Raw read of any query param (phase-specific keys included). */
  param: (key: string) => string | null;
  /** Read a param constrained to a known set of values. */
  pick: <T extends string>(key: string, allowed: readonly T[], fallback: T) => T;
  /** Same, but `null` when the param is absent or not in `allowed`. */
  pickOrNull: <T extends string>(key: string, allowed: readonly T[]) => T | null;
  /** Read an integer param, optionally clamped to `[min, max]`. */
  int: (key: string, range?: { min?: number; max?: number }) => number | null;
  /** Debounced merged write. */
  setPhaseParams: (patch: PhaseUrlPatch) => void;
  /** Immediate merged write; flushes and cancels any pending debounced write. */
  setPhaseParamsNow: (patch: PhaseUrlPatch) => void;
}

export function usePhaseUrlState(): PhaseUrlApi {
  const [searchParams, setSearchParams] = useSearchParams();

  const algo = searchParams.get('algo');
  const step = parseStep(searchParams.get('step'));
  const pass = searchParams.get('pass');

  const pendingRef = useRef<PhaseUrlPatch>({});
  const timerRef = useRef<number | null>(null);
  /** Pathname the pending patch was scheduled against — see `flush`. */
  const pendingPathRef = useRef<string | null>(null);
  const setSearchParamsRef = useRef(setSearchParams);
  setSearchParamsRef.current = setSearchParams;

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const flush = useCallback(() => {
    const pending = pendingRef.current;
    const scheduledPath = pendingPathRef.current;
    pendingRef.current = {};
    pendingPathRef.current = null;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const keys = Object.keys(pending);
    if (keys.length === 0) return;
    // Drop a write whose route is no longer the one on screen.
    //
    // The phase routes are lazy chunks: clicking another phase chip PUSHES the
    // new path while React keeps the old route mounted until the chunk resolves.
    // A debounced `?step=` write firing in that window would call
    // setSearchParams(…, { replace: true }) from the old route, which resolves
    // against the OLD pathname and replaces the entry that was just pushed —
    // silently bouncing the reader back to the phase they left. A write that
    // was scheduled for a pathname we are no longer on has nothing useful to
    // say about the page now showing, so it is discarded.
    if (scheduledPath !== null && scheduledPath !== window.location.pathname) return;
    setSearchParamsRef.current(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const key of keys) {
          const value = pending[key];
          if (value === null || value === undefined) next.delete(key);
          else next.set(key, String(value));
        }
        return next;
      },
      { replace: true },
    );
  }, []);

  const setPhaseParams = useCallback(
    (patch: PhaseUrlPatch) => {
      pendingRef.current = { ...pendingRef.current, ...patch };
      pendingPathRef.current = window.location.pathname;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(flush, WRITE_DEBOUNCE_MS);
    },
    [flush],
  );

  const setPhaseParamsNow = useCallback(
    (patch: PhaseUrlPatch) => {
      pendingRef.current = { ...pendingRef.current, ...patch };
      pendingPathRef.current = window.location.pathname;
      flush();
    },
    [flush],
  );

  const readers = useMemo(() => {
    const param = (key: string) => searchParams.get(key);
    const pickOrNull = <T extends string>(key: string, allowed: readonly T[]): T | null => {
      const raw = searchParams.get(key);
      return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
    };
    return {
      param,
      pickOrNull,
      pick: <T extends string>(key: string, allowed: readonly T[], fallback: T): T =>
        pickOrNull(key, allowed) ?? fallback,
      int: (key: string, range?: { min?: number; max?: number }): number | null => {
        const n = Number.parseInt(searchParams.get(key) ?? '', 10);
        if (!Number.isFinite(n)) return null;
        if (range?.min !== undefined && n < range.min) return null;
        if (range?.max !== undefined && n > range.max) return null;
        return n;
      },
    };
  }, [searchParams]);

  return { algo, step, pass, ...readers, setPhaseParams, setPhaseParamsNow };
}

/**
 * Text that assembles as it arrives.
 *
 * Three effects, each used where it MEANS something rather than everywhere:
 *
 *   <Typed>     a source file being written. Variable cadence — a newline is a
 *               pause, a space is quick, a `{` gets a beat — so it reads as
 *               someone typing rather than as a ticker.
 *   <Decode>    a mono artifact resolving out of noise. This is the token
 *               stream arriving and the instruction being selected; the
 *               scramble alphabet is drawn from the text's own characters, so
 *               `movq %rcx, %rax` never resolves out of Latin gibberish.
 *   <Counter>   a figure counting up when it enters view.
 *
 * All three obey `prefers-reduced-motion` by rendering the finished string on
 * the first paint, and all three keep the true text in the accessibility tree
 * at all times — the animated glyphs are `aria-hidden`, with the real value in
 * a visually hidden span. A screen reader never hears `m0v¶ %r¢x`.
 */
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { usePrefersReducedMotion } from '../usePrefersReducedMotion';

// ── Enter-view trigger ───────────────────────────────────────────────────────

/** True once the element has been on screen. Never resets, so nothing replays. */
export function useInView<T extends HTMLElement>(
  rootMargin = '0px 0px -15% 0px',
): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin, threshold: 0.1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen, rootMargin]);

  return [ref, seen];
}

// ── Typing ───────────────────────────────────────────────────────────────────

/**
 * Per-character cost, in arbitrary beats. Typing is not uniform: you pause at a
 * line break, you rest after an opening brace, and you rattle through a word.
 */
function cadence(text: string): number[] {
  const costs: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    let cost = 1;
    if (c === '\n') cost = 5.5;
    else if (c === ' ') cost = 0.7;
    else if (c === '{' || c === '}' || c === ';') cost = 2.4;
    else if (c === '(' || c === ')') cost = 1.5;
    // A tiny deterministic wobble, so the rhythm is not a metronome.
    cost *= 0.82 + ((Math.sin(i * 17.13) + 1) / 2) * 0.36;
    costs.push(cost);
  }
  return costs;
}

/** Cumulative cadence normalised to 0…1 — feed it a progress, get a length. */
export function typingProfile(text: string): (progress: number) => number {
  const costs = cadence(text);
  const cumulative: number[] = [];
  let total = 0;
  for (const c of costs) {
    total += c;
    cumulative.push(total);
  }
  return (progress: number) => {
    const want = Math.max(0, Math.min(1, progress)) * total;
    // Monotone array — a scan is faster than a binary search at this length.
    let n = 0;
    while (n < cumulative.length && cumulative[n]! <= want) n++;
    return n;
  };
}

interface TypedProps {
  text: string;
  /** 0…1. When omitted the component runs its own clock on first paint. */
  progress?: number;
  /** Milliseconds for the self-driven run. */
  duration?: number;
  className?: string;
  /** Show the blinking caret. */
  caret?: boolean;
}

export function Typed({ text, progress, duration = 2100, className, caret = true }: TypedProps) {
  const reduced = usePrefersReducedMotion();
  const profile = useMemo(() => typingProfile(text), [text]);
  const [selfProgress, setSelfProgress] = useState(progress === undefined ? 0 : 1);

  useEffect(() => {
    if (progress !== undefined || reduced) {
      setSelfProgress(1);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      setSelfProgress(p);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [progress, duration, reduced]);

  const p = reduced ? 1 : progress !== undefined ? progress : selfProgress;
  const shown = reduced ? text.length : profile(p);
  const done = shown >= text.length;

  return (
    <span className={className}>
      <span aria-hidden>{text.slice(0, shown)}</span>
      {caret && !reduced && (
        <span aria-hidden className={clsx('site-caret', done && 'site-caret-rest')} />
      )}
      <span className="sr-only">{text}</span>
    </span>
  );
}

// ── Decode ───────────────────────────────────────────────────────────────────

interface DecodeProps {
  text: string;
  className?: string;
  /** Milliseconds to resolve. */
  duration?: number;
  /** Beats before this line starts, so a listing resolves top-down. */
  delay?: number;
  /** Run immediately instead of waiting for the element to enter view. */
  now?: boolean;
}

const NOISE = '#$%&*+-/<>=@_|~^!?:;';

/**
 * Scramble-then-resolve. Characters lock in left to right; the ones still
 * unresolved cycle through the string's own symbol vocabulary plus a little
 * punctuation noise, which keeps an assembly listing looking like assembly the
 * whole way through.
 */
export function Decode({ text, className, duration = 620, delay = 0, now = false }: DecodeProps) {
  const reduced = usePrefersReducedMotion();
  // Positive bottom margin: the scramble is armed while the line is still BELOW
  // the fold, so by the time it is on screen it is already resolving. That also
  // means the initial state below can safely be the real text — if the observer
  // never fires at all (no IO, a crawler, a stalled rAF) the reader gets the
  // listing rather than a row of blanks. A decorative effect must never be the
  // only thing standing between a reader and a compiler artifact.
  const [ref, seen] = useInView<HTMLSpanElement>('0px 0px 20% 0px');
  // The frame loop writes `textContent` directly rather than calling setState.
  // Ten of these resolve at once in the codegen panel; at 60fps that would be
  // ten React renders per frame competing with the WebGL stage for the same
  // 16ms, and it showed up as dropped frames in the scroll trace.
  const out = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (reduced) return;
    if (!seen && !now) return;

    const alphabet = (text.replace(/\s/g, '') + NOISE).split('');
    let raf = 0;
    let start = 0;
    const step = (t: number) => {
      if (!start) start = t + delay;
      const elapsed = t - start;
      if (elapsed < 0) {
        raf = requestAnimationFrame(step);
        return;
      }
      const p = Math.min(1, elapsed / duration);
      const locked = Math.floor(p * p * text.length);
      let next = text.slice(0, locked);
      for (let i = locked; i < text.length; i++) {
        const c = text[i]!;
        next += c === ' ' ? ' ' : alphabet[(Math.floor(t / 34) + i * 7) % alphabet.length]!;
      }
      if (out.current) out.current.textContent = p < 1 ? next : text;
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      if (out.current) out.current.textContent = text;
    };
  }, [seen, now, text, duration, delay, reduced]);

  return (
    // `relative` so the visually-hidden copy is contained. `sr-only` is
    // `position: absolute`, and a scroll container is not a containing block
    // unless it is positioned — so inside `.artifact-scroll` the hidden span
    // escaped to the initial containing block, took its static position from
    // the end of a listing WIDER than the box, and added a pixel of horizontal
    // scroll to the whole document at 375. Positioning the wrapper keeps it in
    // the box that already clips its visible twin.
    <span ref={ref} className={clsx('relative', className)}>
      <span ref={out} aria-hidden>
        {text}
      </span>
      <span className="sr-only">{text}</span>
    </span>
  );
}

// ── Counting ─────────────────────────────────────────────────────────────────

interface CounterProps {
  to: number;
  className?: string;
  duration?: number;
  /** Rendered after the number, inside the same element. */
  suffix?: ReactNode;
}

export function Counter({ to, className, duration = 1400, suffix }: CounterProps) {
  const reduced = usePrefersReducedMotion();
  const [ref, seen] = useInView<HTMLSpanElement>();
  // Same reasoning as Decode: the digits are written to the DOM node, so five
  // figures counting at once cost five text writes a frame, not five renders.
  // The final value is what React rendered, so the DOM is correct even if the
  // animation never runs.
  const out = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (reduced || !seen) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      // Decelerating: fast enough to feel immediate, slow enough to be read.
      const eased = 1 - Math.pow(1 - p, 4);
      const value = p < 1 ? Math.round(to * eased) : to;
      if (out.current) out.current.textContent = value.toLocaleString('en-US');
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    // Start from zero only once the run is actually about to happen.
    if (out.current) out.current.textContent = '0';
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      if (out.current) out.current.textContent = to.toLocaleString('en-US');
    };
  }, [seen, to, duration, reduced]);

  return (
    <span ref={ref} className={className}>
      <span ref={out} aria-hidden>
        {to.toLocaleString('en-US')}
      </span>
      <span className="sr-only">{to.toLocaleString('en-US')}</span>
      {suffix}
    </span>
  );
}

// ── Split reveal ─────────────────────────────────────────────────────────────

interface SplitProps {
  text: string;
  className?: string;
  /** Milliseconds between words. */
  stagger?: number;
  /** Milliseconds before the first word. */
  delay?: number;
}

/**
 * A heading that assembles word by word on load. Words, not characters: a
 * display line set in a serif reads as language, and shattering it into
 * letters makes the reader wait for a sentence they cannot yet parse.
 */
export function SplitWords({ text, className, stagger = 42, delay = 0 }: SplitProps) {
  const reduced = usePrefersReducedMotion();
  const words = useMemo(() => text.split(' '), [text]);
  return (
    <span className={className}>
      <span aria-hidden>
        {words.map((w, i) => (
          // The inter-word space lives OUTSIDE the masked span: inside it, the
          // `overflow: hidden` that makes the rise possible eats the space and
          // the headline sets as one word.
          <Fragment key={`${w}-${i}`}>
            <span className="site-split-word">
              <span
                className={clsx(!reduced && 'site-split-inner')}
                style={{ animationDelay: `${delay + i * stagger}ms` }}
              >
                {w}
              </span>
            </span>
            {i < words.length - 1 ? ' ' : ''}
          </Fragment>
        ))}
      </span>
      <span className="sr-only">{text}</span>
    </span>
  );
}

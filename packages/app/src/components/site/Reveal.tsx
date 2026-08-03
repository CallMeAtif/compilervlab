/**
 * Reveal — scroll-triggered entrance for a block on the public pages.
 *
 * Two rules it obeys:
 *
 *  1. Content is NEVER stranded invisible. The hidden class is applied only
 *     after the effect has run and an IntersectionObserver exists to clear it,
 *     so a browser without IO, a crawler, or a JS failure all render the page
 *     fully visible. (The naive version — `opacity: 0` in the markup, cleared
 *     by an observer — hides your whole page if anything goes wrong.)
 *  2. Reduced motion opts out: `.site-reveal` resets itself under
 *     `prefers-reduced-motion: reduce`, and the observer is skipped entirely.
 *
 * Only opacity and transform animate. Nothing here affects layout.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

interface RevealProps {
  children: ReactNode;
  /** Extra classes for the wrapper element. */
  className?: string;
  /** Element to render. Sections pass their own tag so landmarks stay correct. */
  as?: 'div' | 'section' | 'li';
}

export function Reveal({ children, className, as: Tag = 'div' }: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);
  const reduced = usePrefersReducedMotion();
  // `armed` flips on only once the observer is wired up — see rule 1 above.
  const [armed, setArmed] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || reduced || typeof IntersectionObserver === 'undefined') return;

    // Anything already on screen at mount (the hero's neighbours) should not
    // flash: mark it armed and shown in the same commit.
    setArmed(true);

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);

  return (
    <Tag
      ref={ref as React.Ref<never>}
      className={clsx(armed && 'site-reveal', armed && shown && 'site-reveal-in', className)}
    >
      {children}
    </Tag>
  );
}

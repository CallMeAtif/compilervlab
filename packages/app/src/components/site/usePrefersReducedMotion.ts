/**
 * `prefers-reduced-motion: reduce`, as live state.
 *
 * The global rule in styles/index.css already collapses every transition and
 * animation, but that is not enough for content that MOVES ON ITS OWN: the
 * Transform in the hero must stop advancing, not advance instantly. So the
 * components that own a timer read this and turn the timer off.
 *
 * Subscribes to the query, so toggling the OS setting takes effect live.
 */
import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(QUERY);
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

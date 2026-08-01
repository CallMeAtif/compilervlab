import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Fullscreen for a single artifact (a graph, a tree, a listing).
 *
 * These diagrams get large — a hundred-state NFA or the LALR GOTO graph is
 * unreadable in a 22rem panel — so every one of them can take over the screen.
 *
 * Uses the real Fullscreen API rather than a fixed-position overlay so the
 * browser chrome gets out of the way too, and listens for `fullscreenchange`
 * so pressing Escape (which never reaches our handler) still syncs the state.
 */
export interface FullscreenHandle {
  /** Attach to the element that should fill the screen. */
  ref: React.RefObject<HTMLDivElement | null>;
  isFullscreen: boolean;
  toggle: () => void;
  /** True when the browser supports it; the control hides itself when false. */
  supported: boolean;
}

export function useFullscreen(): FullscreenHandle {
  const ref = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const supported =
    typeof document !== 'undefined' && Boolean(document.fullscreenEnabled);

  useEffect(() => {
    const sync = () => setIsFullscreen(document.fullscreenElement === ref.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  const toggle = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (document.fullscreenElement === el) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      // A rejection here is normal (user gesture required, or an iframe policy);
      // the artifact simply stays inline.
      void el.requestFullscreen().catch(() => undefined);
    }
  }, []);

  return { ref, isFullscreen, toggle, supported };
}

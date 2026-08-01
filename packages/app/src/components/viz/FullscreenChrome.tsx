/**
 * The fullscreen affordance every artifact renders — ONE component, so the
 * graph, the tree and the ACTION table all present an identical control in an
 * identical place instead of three drifting copies.
 *
 * It renders one thing at a time inside the element that `useFullscreen` made
 * fullscreen (so the parent must be `relative`, and must be the fullscreen
 * target rather than a scrolling box — an absolutely positioned child of a
 * scroller scrolls away with the content):
 *
 *   - INLINE: the toggle, absolutely positioned over the top-right corner.
 *   - FULLSCREEN: `FullscreenBar` along the bottom — the transport on the left,
 *     the way out on the right. Fullscreen hides the trace panel, so an
 *     artifact that is stepped has to carry the transport itself or it freezes
 *     at whatever step you left it on.
 *
 * The floating toggle is deliberately NOT kept while fullscreen. It used to be,
 * which left the app with two different ways out depending on which artifact
 * you had opened: a graph put "exit" in the top-right corner over the canvas,
 * while a listing (`components/Fullscreen`, whose section head is off-screen
 * once its body is promoted) put it at the right end of the bottom bar. One
 * feature, two places. There is now exactly one — the bar, which both paths
 * share, so the fullscreen chrome is identical on every route.
 *
 * The bar is in NORMAL FLOW, not absolute, and every host lays itself out as a
 * `flex flex-col` in fullscreen with the artifact as a `flex-1 min-h-0` child.
 * That makes the artifact's box genuinely end where the bar begins, so React
 * Flow's zoom cluster, the deepest row of a tree and the last table row are all
 * clear of it by construction — no magic offset that a two-line controls node
 * would silently invalidate.
 */
import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { Maximize2, Minimize2 } from 'lucide-react';
import type { FullscreenHandle } from '../../lib/useFullscreen';

/** 44px hit target, 16px glyph — the same button in every place it appears. */
export const FS_BUTTON =
  'flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-sm text-ink-muted transition-colors duration-[var(--dur-fast)] hover:bg-raised hover:text-ink';

/**
 * The bottom bar, shared by `FullscreenChrome` (canvas artifacts) and
 * `FullscreenBody` (listings and tables) so the two cannot drift.
 *
 * `border-line-strong`, not `line`: this rule separates CHROME from CONTENT,
 * which is the job the token vocabulary gives `line-strong` (it is the edge
 * `.overlay-panel` uses). Measured on the sheet, `line` is 1.27:1 in dark —
 * and now that the graph canvas is painted `--surface` rather than xyflow's
 * own #141414, a `line` rule left the transport floating in the same field as
 * the artifact with nothing visible between them.
 */
export function FullscreenBar({ fs, controls }: { fs: FullscreenHandle; controls?: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-line-strong bg-surface px-4 py-2">
      {controls}
      {/* Escape exits too, but that is keyboard-only and the inline toggle is
          off-screen now, so the way out has to be reachable by pointer from in
          here. `ml-auto` holds it at the right edge even for an artifact that
          passes no transport. */}
      <button
        type="button"
        onClick={fs.toggle}
        aria-label="Exit fullscreen"
        title="Exit fullscreen (Esc)"
        className={clsx(FS_BUTTON, 'ml-auto')}
      >
        <Minimize2 aria-hidden className="size-4" />
      </button>
    </div>
  );
}

export interface FullscreenChromeProps {
  fs: FullscreenHandle;
  /**
   * Noun for the accessible name — "View this {label} fullscreen". Say what the
   * artifact is, so a screen-reader user with four toggles on one page can tell
   * them apart.
   */
  label?: string;
  /** Step controls, shown in the bottom bar only in fullscreen. */
  controls?: ReactNode;
  /**
   * Give the toggle an opaque chip. Needed over artifacts whose top-right
   * corner already has content (a table's column headers); a graph canvas is
   * empty there and reads cleaner without the extra edge.
   */
  solid?: boolean;
}

export function FullscreenChrome({
  fs,
  label = 'diagram',
  controls,
  solid = false,
}: FullscreenChromeProps) {
  if (!fs.supported) return null;
  if (fs.isFullscreen) return <FullscreenBar fs={fs} controls={controls} />;
  return (
    <button
      type="button"
      onClick={fs.toggle}
      // The NAME carries what the control does; there is no `aria-pressed` as
      // well, because a toggle that announces "View fullscreen, not pressed"
      // says the same thing twice.
      aria-label={`View this ${label} fullscreen`}
      title="View fullscreen"
      className={clsx(
        'absolute top-2 right-2 z-30',
        FS_BUTTON,
        // `line-strong` is the system's edge for chrome that floats over
        // content (`.overlay-panel`); plain `line` measures 1.36:1 and would
        // leave the chip indistinguishable from the header row beneath it.
        solid && 'bg-surface shadow-[0_0_0_1px_var(--line-strong)]',
      )}
    >
      <Maximize2 aria-hidden className="size-4" />
    </button>
  );
}

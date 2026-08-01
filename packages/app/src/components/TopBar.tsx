/**
 * Persistent top bar: the wordmark, the six-phase rail, the theme toggle.
 *
 * The rail is EDITORIAL NAVIGATION, not a row of buttons: each phase is its
 * name set in mono small-caps with a one-character status mark beside it, and
 * the phase you are reading is marked by an accent rule along the bottom of the
 * bar plus a heavier label — never by an outline, and never by colour alone.
 * The rail scrolls horizontally under lg; the theme toggle never scrolls away.
 */
import { Link, NavLink } from 'react-router-dom';
import { Moon, Sun } from 'lucide-react';
import { clsx } from 'clsx';
import { useCompilationStore, stageInfo } from '../store/compilation';
import { PHASES } from '../lib/phases';
import { useTheme } from '../lib/theme';
import { STATUS_META, StatusMark } from './StatusBadge';
import { Tooltip } from './ui/Tooltip';

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const dark = theme === 'dark';
  return (
    <Tooltip content={dark ? 'Switch to light theme' : 'Switch to dark theme'}>
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
        // Icon-only: the glyph itself is the affordance (>= 3:1 in both
        // themes), so the control needs no outline drawn around it.
        className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-sm text-ink-muted transition-colors duration-[var(--dur-fast)] hover:bg-raised hover:text-ink"
      >
        {dark ? <Sun aria-hidden className="size-4.5" /> : <Moon aria-hidden className="size-4.5" />}
      </button>
    </Tooltip>
  );
}

export function TopBar() {
  const compilation = useCompilationStore((s) => s.compilation);
  const stale = useCompilationStore((s) => s.stale);
  const pipeline = useCompilationStore((s) => s.pipelineInfo);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/95 backdrop-blur">
      {/*
        Skip link — first tab stop on every page, so a keyboard user is not
        forced through the six phase links to reach the visualization. The
        <main> landmark in App.tsx carries `id="main" tabIndex={-1}`, so this is
        a plain fragment link that works with JavaScript disabled; the handler
        only adds the scroll-into-view Safari does not do for a -1 target.
      */}
      <a
        href="#main"
        onClick={() => {
          const main = document.getElementById('main');
          main?.scrollIntoView({ block: 'start' });
        }}
        className="sr-only z-50 focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:flex focus:h-11 focus:items-center focus:rounded-md focus:border focus:border-accent focus:bg-surface focus:px-4 focus:text-sm focus:font-semibold focus:text-ink"
      >
        Skip to main content
      </a>

      {/*
        Below lg the bar becomes two rows: the wordmark, then the phase rail with
        the theme toggle pinned OUTSIDE the scroll region so it stays reachable
        at 375px. DOM order is wordmark → rail → toggle in both layouts, so tab
        order always matches reading order.
      */}
      <div className="mx-auto max-w-450 px-3 sm:px-5">
        <div className="flex min-h-14 flex-col justify-center gap-0.5 py-1 lg:flex-row lg:items-center lg:gap-6 lg:py-0">
          <Link
            to="/"
            className="flex shrink-0 items-baseline gap-2 self-start rounded-sm py-1.5 lg:self-auto"
          >
            <span className="font-serif text-base font-semibold tracking-tight text-ink">
              <span className="hidden sm:inline">Compiler Virtual Lab</span>
              <span className="sm:hidden">CVL</span>
            </span>
          </Link>

          <div className="flex min-w-0 items-center gap-1 lg:flex-1 lg:justify-end">
            <nav
              aria-label="Compilation phases"
              // The rail scrolls in x only; 2px of vertical padding leaves room
              // for the focus ring without clipping it.
              className="flex min-w-0 flex-1 items-center overflow-x-auto overflow-y-hidden py-0.5 [overscroll-behavior-x:contain]"
            >
              {PHASES.map((p, i) => {
                const info = stageInfo(compilation, stale, p.phase, (c) =>
                  p.summary(c, pipeline),
                );
                const meta = STATUS_META[info.status];
                const detail = info.summary ? `${meta.label} — ${info.summary}` : meta.label;
                return (
                  <Tooltip key={p.phase} content={`${p.title} — ${detail}`}>
                    <NavLink
                      to={p.path}
                      aria-label={`Phase ${i + 1} of ${PHASES.length}: ${p.title}, ${detail}`}
                      className={({ isActive }) =>
                        clsx(
                          // 44px tall (WCAG 2.5.5) with the label centred on the
                          // bar's own baseline; no border, ever.
                          'group relative flex h-11 shrink-0 cursor-pointer items-center gap-1.5 px-2.5 whitespace-nowrap transition-colors duration-[var(--dur-fast)] sm:px-3',
                          isActive ? 'text-ink' : 'text-ink-muted hover:text-ink',
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <span
                            className={clsx(
                              'font-mono text-2xs tracking-[0.13em] uppercase',
                              isActive ? 'font-semibold' : 'font-medium',
                            )}
                          >
                            {p.short}
                          </span>
                          <StatusMark
                            status={info.status}
                            count={info.errors > 0 ? info.errors : undefined}
                          />
                          {/* Current phase = an accent rule under the name.
                              Hover shows the same rule in ink, so the shape is
                              what changes, not only the colour. */}
                          <span
                            aria-hidden
                            className={clsx(
                              'absolute inset-x-1.5 bottom-0 h-0.5 transition-colors duration-[var(--dur-fast)]',
                              isActive
                                ? 'bg-accent'
                                : 'bg-transparent group-hover:bg-line-strong',
                            )}
                          />
                        </>
                      )}
                    </NavLink>
                  </Tooltip>
                );
              })}
            </nav>

            <span aria-hidden className="h-5 w-px shrink-0 bg-line" />
            <ThemeToggle />
          </div>
        </div>
      </div>
    </header>
  );
}

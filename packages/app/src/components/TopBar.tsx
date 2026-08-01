/**
 * Persistent top bar: app title, six pipeline stage chips (status-driven),
 * theme toggle. Chips scroll horizontally under lg.
 */
import { Link, NavLink } from 'react-router-dom';
import { FlaskConical, Moon, Sun } from 'lucide-react';
import { clsx } from 'clsx';
import { useCompilationStore, stageInfo } from '../store/compilation';
import { PHASES } from '../lib/phases';
import { useTheme } from '../lib/theme';
import { STATUS_META, StatusIcon } from './StatusBadge';
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
        className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md border border-control bg-surface text-ink-muted transition-colors duration-[var(--dur-fast)] hover:bg-raised hover:text-ink"
      >
        {dark ? <Sun aria-hidden className="size-5" /> : <Moon aria-hidden className="size-5" />}
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
        forced through the six phase chips to reach the visualization. The
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
        <div className="flex min-h-14 flex-col justify-center gap-1 py-1.5 lg:flex-row lg:items-center lg:gap-3 lg:py-0">
          <Link
            to="/"
            className="flex shrink-0 items-center gap-2 self-start rounded-md px-1.5 py-2 font-semibold tracking-tight text-ink lg:self-auto"
          >
            <FlaskConical aria-hidden className="size-5 text-accent" strokeWidth={2.25} />
            <span className="hidden sm:inline">Compiler Virtual Lab</span>
            <span className="sm:hidden">CVL</span>
          </Link>

          <div className="flex min-w-0 items-center gap-2 lg:flex-1">
            <nav
              aria-label="Compilation phases"
              // px/py leave room for the 4px focus ring; the rail scrolls in x
              // only, and the toggle beside it never scrolls out of reach.
              className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto overflow-y-hidden px-1 py-2 [overscroll-behavior-x:contain]"
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
                          'flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs whitespace-nowrap transition-colors duration-[var(--dur-fast)]',
                          meta.chip,
                          // Current page = ring AND weight, never colour alone.
                          isActive
                            ? 'font-semibold ring-2 ring-accent ring-offset-1 ring-offset-canvas'
                            : 'font-medium hover:border-line-strong',
                        )
                      }
                    >
                      <StatusIcon status={info.status} />
                      {p.short}
                      {info.errors > 0 && (
                        <span
                          aria-hidden
                          className="ml-0.5 rounded-full bg-err px-1.5 text-3xs leading-4 font-semibold text-on-err"
                        >
                          {info.errors}
                        </span>
                      )}
                    </NavLink>
                  </Tooltip>
                );
              })}
            </nav>

            <ThemeToggle />
          </div>
        </div>
      </div>
    </header>
  );
}

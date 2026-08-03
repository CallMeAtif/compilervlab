/**
 * SiteHeader — the one chrome band on `/` and `/about`.
 *
 * Institute mark, two links, the theme toggle, and the way in. It is token-
 * themed throughout, which the old `LandingNav` was not: the app defaults to
 * dark (lib/theme.tsx), so a hard-coded white bar left the public pages broken
 * in the app's own default theme.
 *
 * The theme toggle lives here because the public pages have no TopBar — before
 * this, a reader who landed on `/` in dark had no way to switch.
 * `LandingNav` is untouched and still serves /login, /signup and
 * /forgot-password, whose layouts have not been redesigned.
 */
import { Link, NavLink } from 'react-router-dom';
import { Moon, Sun } from 'lucide-react';
import { clsx } from 'clsx';
import logoUrl from '../../assets/kjsieit-logo.svg';
import { useTheme } from '../../lib/theme';

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const dark = theme === 'dark';
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xs text-ink-muted transition-colors duration-[var(--dur-fast)] hover:bg-raised hover:text-ink"
    >
      {dark ? <Sun aria-hidden className="size-4.5" /> : <Moon aria-hidden className="size-4.5" />}
    </button>
  );
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  clsx(
    'relative flex min-h-11 items-center px-2 font-mono text-2xs tracking-[0.14em] uppercase transition-colors duration-[var(--dur-fast)] sm:px-3',
    isActive ? 'text-ink' : 'text-ink-faint hover:text-ink',
  );

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/92 backdrop-blur">
      <a
        href="#main"
        onClick={() => document.getElementById('main')?.scrollIntoView({ block: 'start' })}
        className="sr-only z-50 focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:flex focus:h-11 focus:items-center focus:rounded-xs focus:border focus:border-somaiya focus:bg-surface focus:px-4 focus:font-inter focus:text-sm focus:font-semibold focus:text-ink"
      >
        Skip to content
      </a>

      <div className="mx-auto flex max-w-[84rem] items-center justify-between gap-2 px-4 py-2 sm:px-6 sm:py-2.5">
        <Link
          to="/"
          className="flex min-h-11 shrink-0 items-center"
          aria-label="Compiler Virtual Lab — home"
        >
          <img
            src={logoUrl}
            alt="K J Somaiya Institute of Technology"
            // The mark is wide (roundel + wordmark + institute line), so its
            // HEIGHT sets how much horizontal room it takes. At 375 the large
            // size pushed the nav and Sign in past the viewport edge; it scales
            // back up from `sm` where there is room for it.
            className="site-mark h-7 w-auto sm:h-10 lg:h-12"
          />
        </Link>

        <nav aria-label="Main" className="flex items-center gap-0.5 sm:gap-1">
          <NavLink to="/" end className={linkClass}>
            {({ isActive }) => (
              <>
                Home
                <span
                  aria-hidden
                  className={clsx(
                    'absolute inset-x-2 bottom-1 h-px sm:inset-x-3',
                    isActive ? 'bg-somaiya' : 'bg-transparent',
                  )}
                />
              </>
            )}
          </NavLink>
          <NavLink to="/about" className={linkClass}>
            {({ isActive }) => (
              <>
                About
                <span
                  aria-hidden
                  className={clsx(
                    'absolute inset-x-2 bottom-1 h-px sm:inset-x-3',
                    isActive ? 'bg-somaiya' : 'bg-transparent',
                  )}
                />
              </>
            )}
          </NavLink>
          <ThemeToggle />
          <Link
            to="/login"
            className="flex min-h-11 shrink-0 items-center rounded-xs border border-somaiya px-3 font-inter text-sm font-semibold text-somaiya-strong transition-colors duration-[var(--dur-fast)] hover:bg-somaiya hover:text-on-somaiya sm:px-4"
          >
            Sign in
          </Link>
        </nav>
      </div>
    </header>
  );
}

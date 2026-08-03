/**
 * LandingNav — shared navigation bar for the landing page, login, sign-up,
 * and about pages. Mirrors the Somaiya Vidyavihar design shown in the mockups.
 *
 * Layout: Logo left | Home · About · Login button right.
 * The Login button is hidden when we're already on the login / sign-up page.
 */
import { Link, NavLink, useLocation } from 'react-router-dom';
import logoUrl from '../assets/kjsieit-logo.svg';

export function LandingNav() {
  const { pathname } = useLocation();
  const isAuthPage = pathname === '/login' || pathname === '/signup';

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white shadow-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
        {/* Logo */}
        <Link to="/" className="flex shrink-0 items-center">
          <img
            src={logoUrl}
            alt="K J Somaiya Institute of Technology"
            className="h-10 w-auto sm:h-12"
          />
        </Link>

        {/* Right nav */}
        <nav className="flex items-center gap-2 sm:gap-4">
          <NavLink
            to="/"
            className={({ isActive }) =>
              `rounded px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'text-somaiya'
                  : 'text-gray-600 hover:text-somaiya'
              }`
            }
          >
            Home
          </NavLink>
          <NavLink
            to="/about"
            className={({ isActive }) =>
              `rounded px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'text-somaiya'
                  : 'text-gray-600 hover:text-somaiya'
              }`
            }
          >
            About
          </NavLink>
          {!isAuthPage && (
            <Link
              to="/login"
              className="rounded-full bg-somaiya px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-somaiya-dark"
            >
              Login
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

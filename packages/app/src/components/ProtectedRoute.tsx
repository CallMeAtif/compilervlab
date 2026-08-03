/**
 * ProtectedRoute — renders children only when authenticated.
 *
 * Loading state: shows a branded full-page spinner so the user sees
 * something immediately rather than a blank white flash.
 * Unauthenticated: redirects to /login, preserving the intended path
 * in `state.from` so the login page can redirect back after sign-in.
 */
import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../lib/auth';

interface Props {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: Props) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-somaiya-light">
        <img
          src="/assets/kjsieit-logo.svg"
          alt="K J Somaiya Institute of Technology"
          className="h-12 opacity-80"
        />
        <Loader2 className="size-8 animate-spin text-somaiya" />
        <p className="text-sm text-somaiya/70">Loading…</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

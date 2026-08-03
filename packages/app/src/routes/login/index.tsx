/**
 * Login page ("/login") — email/password + Google OAuth.
 *
 * Design matches mockup Image 2:
 *   Left:  crimson panel with welcome copy
 *   Right: white form with email, password, remember-me, forgot-password,
 *          login button, Google sign-in, sign-up link
 *
 * Redirects to /lab (or state.from) on successful authentication.
 * If the user is already authenticated, redirects immediately.
 */
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, User } from 'lucide-react';
import { clsx } from 'clsx';
import { LandingNav } from '../../components/LandingNav';
import { useAuth } from '../../lib/auth';

export default function LoginRoute() {
  const { user, loading, error, clearError, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/lab';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Already signed in — go straight to the lab.
  if (!loading && user) {
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    clearError();
    setSubmitting(true);
    await signIn(email, password, remember);
    setSubmitting(false);
    if (!error) navigate(from, { replace: true });
  }



  return (
    <div className="flex min-h-dvh flex-col bg-somaiya-light font-inter">
      <LandingNav />

      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-3xl animate-fade-in overflow-hidden rounded-2xl shadow-2xl">
          <div className="flex flex-col sm:flex-row">

            {/* ── Left panel ───────────────────────────────────────────── */}
            <div
              className="relative flex flex-col items-center justify-center gap-5 overflow-hidden px-8 py-12 text-center sm:w-2/5"
            >
              <div 
                className="absolute inset-0 -z-10"
                style={{
                  background: 'radial-gradient(circle at top left, #a90000 0%, #5a0000 100%)',
                }}
              />
              <div 
                className="absolute inset-0 -z-10 opacity-30 mix-blend-overlay"
                style={{
                  backgroundImage: 'radial-gradient(circle at 80% 80%, rgba(255,255,255,0.2) 0%, transparent 50%)',
                }}
              />
              {/* Avatar circle */}
              <div className="flex size-24 items-center justify-center rounded-full bg-white/10">
                <User className="size-12 text-white/80" aria-hidden />
              </div>
              <h2 className="text-2xl font-bold text-white">Welcome Back!</h2>
              <p className="text-sm leading-relaxed text-white/80">
                Sign in to Compiler Virtual Lab using your Somaiya email address.
              </p>
            </div>

            {/* ── Right panel (form) ───────────────────────────────────── */}
            <div className="flex flex-1 flex-col justify-center bg-white px-8 py-10">
              <h1 className="mb-1 text-2xl font-bold text-gray-900">
                Login to your Account
              </h1>
              <p className="mb-7 text-sm text-gray-400">
                Enter your credentials to access your account
              </p>

              {/* Error banner */}
              {error && (
                <div
                  role="alert"
                  className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                >
                  {error}
                </div>
              )}

              <form onSubmit={(e) => void handleSubmit(e)} noValidate className="flex flex-col gap-5">
                {/* Email */}
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="login-email" className="text-sm font-medium text-gray-700">
                    Email <span aria-hidden className="text-somaiya">*</span>
                  </label>
                  <input
                    id="login-email"
                    type="email"
                    autoComplete="email"
                    required
                    placeholder="name@somaiya.edu"
                    value={email}
                    onChange={(e) => { clearError(); setEmail(e.target.value); }}
                    className={clsx(
                      'h-11 w-full rounded-lg border px-4 text-sm text-gray-900 placeholder:text-gray-300',
                      'outline-none transition-colors',
                      'focus:border-somaiya focus:ring-2 focus:ring-somaiya/20',
                      error ? 'border-red-300' : 'border-gray-200',
                    )}
                  />
                </div>

                {/* Password */}
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="login-password" className="text-sm font-medium text-gray-700">
                    Password <span aria-hidden className="text-somaiya">*</span>
                  </label>
                  <div className="relative">
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      required
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => { clearError(); setPassword(e.target.value); }}
                      className={clsx(
                        'h-11 w-full rounded-lg border px-4 pr-11 text-sm text-gray-900 placeholder:text-gray-300',
                        'outline-none transition-colors',
                        'focus:border-somaiya focus:ring-2 focus:ring-somaiya/20',
                        error ? 'border-red-300' : 'border-gray-200',
                      )}
                    />
                    <button
                      type="button"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-600"
                    >
                      {showPassword ? (
                        <EyeOff className="size-4" aria-hidden />
                      ) : (
                        <Eye className="size-4" aria-hidden />
                      )}
                    </button>
                  </div>
                </div>

                {/* Remember me + Forgot password */}
                <div className="flex items-center justify-between gap-2">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600 select-none">
                    <input
                      type="checkbox"
                      id="login-remember"
                      checked={remember}
                      onChange={(e) => setRemember(e.target.checked)}
                      className="size-4 rounded border-gray-300 text-somaiya accent-somaiya"
                    />
                    Remember me
                  </label>
                  <Link
                    to="/forgot-password"
                    className="text-sm font-medium text-somaiya hover:underline"
                  >
                    Forgot Password?
                  </Link>
                </div>

                {/* Submit */}
                <button
                  type="submit"
                  disabled={submitting}
                  className="h-11 w-full rounded-lg bg-somaiya text-sm font-semibold text-white transition-colors hover:bg-somaiya-dark disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? 'Signing in…' : 'Login'}
                </button>
              </form>



              {/* Sign-up link */}
              <p className="mt-4 text-center text-sm text-gray-500">
                Don't have an account?{' '}
                <Link to="/signup" className="font-medium text-somaiya hover:underline">
                  Sign Up
                </Link>
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

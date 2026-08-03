/**
 * Sign-up page ("/signup") — email/password registration only.
 * Mirrors the login card layout (crimson left, white form right).
 */
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, UserPlus } from 'lucide-react';
import { clsx } from 'clsx';
import { LandingNav } from '../../components/LandingNav';
import { useAuth } from '../../lib/auth';

export default function SignUpRoute() {
  const { user, loading, error, clearError, signUp } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user) {
    return <Navigate to="/lab" replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    clearError();
    setLocalError(null);

    if (password !== confirm) {
      setLocalError('Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      setLocalError('Password must be at least 6 characters.');
      return;
    }

    setSubmitting(true);
    await signUp(email, password);
    setSubmitting(false);
    if (!error && !localError) navigate('/lab', { replace: true });
  }

  const displayError = localError ?? error;

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
              <div className="flex size-24 items-center justify-center rounded-full bg-white/10">
                <UserPlus className="size-12 text-white/80" aria-hidden />
              </div>
              <h2 className="text-2xl font-bold text-white">Join the Lab!</h2>
              <p className="text-sm leading-relaxed text-white/80">
                Create your Compiler Virtual Lab account using your Somaiya email address.
              </p>
            </div>

            {/* ── Right panel (form) ───────────────────────────────────── */}
            <div className="flex flex-1 flex-col justify-center bg-white px-8 py-10">
              <h1 className="mb-1 text-2xl font-bold text-gray-900">Create an Account</h1>
              <p className="mb-7 text-sm text-gray-400">
                Use your @somaiya.edu email to register.
              </p>

              {displayError && (
                <div
                  role="alert"
                  className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                >
                  {displayError}
                </div>
              )}

              <form onSubmit={(e) => void handleSubmit(e)} noValidate className="flex flex-col gap-5">
                {/* Email */}
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="signup-email" className="text-sm font-medium text-gray-700">
                    Email <span aria-hidden className="text-somaiya">*</span>
                  </label>
                  <input
                    id="signup-email"
                    type="email"
                    autoComplete="email"
                    required
                    placeholder="name@somaiya.edu"
                    value={email}
                    onChange={(e) => { clearError(); setLocalError(null); setEmail(e.target.value); }}
                    className={clsx(
                      'h-11 w-full rounded-lg border px-4 text-sm text-gray-900 placeholder:text-gray-300',
                      'outline-none transition-colors focus:border-somaiya focus:ring-2 focus:ring-somaiya/20',
                      displayError ? 'border-red-300' : 'border-gray-200',
                    )}
                  />
                </div>

                {/* Password */}
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="signup-password" className="text-sm font-medium text-gray-700">
                    Password <span aria-hidden className="text-somaiya">*</span>
                  </label>
                  <div className="relative">
                    <input
                      id="signup-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      required
                      placeholder="At least 6 characters"
                      value={password}
                      onChange={(e) => { clearError(); setLocalError(null); setPassword(e.target.value); }}
                      className={clsx(
                        'h-11 w-full rounded-lg border px-4 pr-11 text-sm text-gray-900 placeholder:text-gray-300',
                        'outline-none transition-colors focus:border-somaiya focus:ring-2 focus:ring-somaiya/20',
                        displayError ? 'border-red-300' : 'border-gray-200',
                      )}
                    />
                    <button
                      type="button"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-600"
                    >
                      {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                    </button>
                  </div>
                </div>

                {/* Confirm password */}
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="signup-confirm" className="text-sm font-medium text-gray-700">
                    Confirm Password <span aria-hidden className="text-somaiya">*</span>
                  </label>
                  <div className="relative">
                    <input
                      id="signup-confirm"
                      type={showConfirm ? 'text' : 'password'}
                      autoComplete="new-password"
                      required
                      placeholder="Re-enter your password"
                      value={confirm}
                      onChange={(e) => { clearError(); setLocalError(null); setConfirm(e.target.value); }}
                      className={clsx(
                        'h-11 w-full rounded-lg border px-4 pr-11 text-sm text-gray-900 placeholder:text-gray-300',
                        'outline-none transition-colors focus:border-somaiya focus:ring-2 focus:ring-somaiya/20',
                        displayError ? 'border-red-300' : 'border-gray-200',
                      )}
                    />
                    <button
                      type="button"
                      aria-label={showConfirm ? 'Hide password' : 'Show password'}
                      onClick={() => setShowConfirm((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-600"
                    >
                      {showConfirm ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="h-11 w-full rounded-lg bg-somaiya text-sm font-semibold text-white transition-colors hover:bg-somaiya-dark disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? 'Creating account…' : 'Create Account'}
                </button>
              </form>

              <p className="mt-6 text-center text-sm text-gray-500">
                Already have an account?{' '}
                <Link to="/login" className="font-medium text-somaiya hover:underline">
                  Sign In
                </Link>
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

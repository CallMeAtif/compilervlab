/**
 * Forgot Password page ("/forgot-password").
 * Sends a Firebase password-reset email to the provided @somaiya.edu address.
 */
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Mail } from 'lucide-react';
import { clsx } from 'clsx';
import { LandingNav } from '../../components/LandingNav';
import { useAuth } from '../../lib/auth';

export default function ForgotPasswordRoute() {
  const { error, clearError, resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    clearError();
    setSubmitting(true);
    await resetPassword(email);
    setSubmitting(false);
    if (!error) setSent(true);
  }

  return (
    <div className="flex min-h-dvh flex-col bg-somaiya-light font-inter">
      <LandingNav />

      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md rounded-2xl bg-white px-8 py-10 shadow-xl">
          {/* Icon */}
          <div className="mb-6 flex justify-center">
            <div className="flex size-16 items-center justify-center rounded-full bg-somaiya-light">
              <Mail className="size-8 text-somaiya" aria-hidden />
            </div>
          </div>

          {sent ? (
            /* Success state */
            <div className="text-center">
              <h1 className="mb-2 text-2xl font-bold text-gray-900">Check your inbox</h1>
              <p className="mb-6 text-sm text-gray-500">
                We've sent a password-reset link to{' '}
                <span className="font-medium text-gray-700">{email}</span>.
                Check your inbox (and spam folder).
              </p>
              <Link
                to="/login"
                className="inline-block rounded-lg bg-somaiya px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-somaiya-dark"
              >
                Back to Login
              </Link>
            </div>
          ) : (
            /* Form state */
            <>
              <h1 className="mb-1 text-2xl font-bold text-gray-900">Forgot Password?</h1>
              <p className="mb-7 text-sm text-gray-400">
                Enter your @somaiya.edu email and we'll send you a reset link.
              </p>

              {error && (
                <div
                  role="alert"
                  className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                >
                  {error}
                </div>
              )}

              <form onSubmit={(e) => void handleSubmit(e)} noValidate className="flex flex-col gap-5">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="forgot-email" className="text-sm font-medium text-gray-700">
                    Email <span aria-hidden className="text-somaiya">*</span>
                  </label>
                  <input
                    id="forgot-email"
                    type="email"
                    autoComplete="email"
                    required
                    placeholder="name@somaiya.edu"
                    value={email}
                    onChange={(e) => { clearError(); setEmail(e.target.value); }}
                    className={clsx(
                      'h-11 w-full rounded-lg border px-4 text-sm text-gray-900 placeholder:text-gray-300',
                      'outline-none transition-colors focus:border-somaiya focus:ring-2 focus:ring-somaiya/20',
                      error ? 'border-red-300' : 'border-gray-200',
                    )}
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="h-11 w-full rounded-lg bg-somaiya text-sm font-semibold text-white transition-colors hover:bg-somaiya-dark disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? 'Sending…' : 'Send Reset Link'}
                </button>
              </form>

              <p className="mt-6 text-center text-sm text-gray-500">
                Remembered it?{' '}
                <Link to="/login" className="font-medium text-somaiya hover:underline">
                  Back to Login
                </Link>
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

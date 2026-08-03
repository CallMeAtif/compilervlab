/**
 * App — the root routing tree.
 *
 * Public routes  (no auth required):
 *   /                → Landing page
 *   /about           → About page
 *   /login           → Login
 *   /signup          → Sign-up
 *   /forgot-password → Forgot-password
 *
 * Protected routes (must be authenticated to reach):
 *   /lab             → Overview (compiler / DBMS lab)
 *   /lab/lex         → Lexer phase
 *   /lab/syntax      → Syntax phase
 *   /lab/semantic    → Semantic phase
 *   /lab/ir          → IR phase
 *   /lab/opt         → Optimisation phase
 *   /lab/codegen     → Code-gen phase
 *
 * The lab layout retains the existing TopBar and wraps each route in a
 * Suspense boundary. Public pages have no TopBar — they use LandingNav.
 */
import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { TopBar } from './components/TopBar';
import { TooltipProvider } from './components/ui/Tooltip';
import { ProtectedRoute } from './components/ProtectedRoute';
import OverviewRoute from './routes/overview';

// ── Public pages (lazy) ───────────────────────────────────────────────────────
const LandingRoute = lazy(() => import('./routes/landing'));
const LoginRoute = lazy(() => import('./routes/login'));
const SignUpRoute = lazy(() => import('./routes/signup'));
const ForgotPasswordRoute = lazy(() => import('./routes/forgot-password'));
const AboutRoute = lazy(() => import('./routes/about'));

// ── Lab phase routes (lazy, heavy) ────────────────────────────────────────────
const LexRoute = lazy(() => import('./routes/lex'));
const SyntaxRoute = lazy(() => import('./routes/syntax'));
const SemanticRoute = lazy(() => import('./routes/semantic'));
const IrRoute = lazy(() => import('./routes/ir'));
const OptRoute = lazy(() => import('./routes/opt'));
const CodegenRoute = lazy(() => import('./routes/codegen'));

function RouteFallback() {
  return (
    <div className="prose-note flex flex-1 items-center justify-center gap-2 py-24 text-ink-faint">
      <Loader2 aria-hidden className="size-4 animate-spin" />
      Loading…
    </div>
  );
}

/** The inner lab layout — TopBar + main content area. */
function LabLayout({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider>
      <div className="flex min-h-dvh flex-col">
        <TopBar />
        <main id="main" tabIndex={-1} className="flex flex-1 flex-col outline-none">
          <Suspense fallback={<RouteFallback />}>{children}</Suspense>
        </main>
      </div>
    </TooltipProvider>
  );
}

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        {/* ── Public ─────────────────────────────────────────────────────── */}
        <Route path="/" element={<LandingRoute />} />
        <Route path="/about" element={<AboutRoute />} />
        <Route path="/login" element={<LoginRoute />} />
        <Route path="/signup" element={<SignUpRoute />} />
        <Route path="/forgot-password" element={<ForgotPasswordRoute />} />

        {/* ── Protected lab ──────────────────────────────────────────────── */}
        <Route
          path="/lab"
          element={
            <ProtectedRoute>
              <LabLayout>
                <OverviewRoute />
              </LabLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/lab/lex"
          element={
            <ProtectedRoute>
              <LabLayout>
                <LexRoute />
              </LabLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/lab/syntax"
          element={
            <ProtectedRoute>
              <LabLayout>
                <SyntaxRoute />
              </LabLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/lab/semantic"
          element={
            <ProtectedRoute>
              <LabLayout>
                <SemanticRoute />
              </LabLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/lab/ir"
          element={
            <ProtectedRoute>
              <LabLayout>
                <IrRoute />
              </LabLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/lab/opt"
          element={
            <ProtectedRoute>
              <LabLayout>
                <OptRoute />
              </LabLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/lab/codegen"
          element={
            <ProtectedRoute>
              <LabLayout>
                <CodegenRoute />
              </LabLayout>
            </ProtectedRoute>
          }
        />

        {/* ── Legacy route redirects (old paths without /lab prefix) ───── */}
        <Route path="/lex" element={<Navigate to="/lab/lex" replace />} />
        <Route path="/syntax" element={<Navigate to="/lab/syntax" replace />} />
        <Route path="/semantic" element={<Navigate to="/lab/semantic" replace />} />
        <Route path="/ir" element={<Navigate to="/lab/ir" replace />} />
        <Route path="/opt" element={<Navigate to="/lab/opt" replace />} />
        <Route path="/codegen" element={<Navigate to="/lab/codegen" replace />} />

        {/* ── 404 fallback ─────────────────────────────────────────────── */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

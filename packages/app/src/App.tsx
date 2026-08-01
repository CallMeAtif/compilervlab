import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { TopBar } from './components/TopBar';
import { TooltipProvider } from './components/ui/Tooltip';
import OverviewRoute from './routes/overview';

// Phase routes are code-split: they will grow heavy (React Flow, elkjs,
// virtualized tables) once the phase teams land their views.
const LexRoute = lazy(() => import('./routes/lex'));
const SyntaxRoute = lazy(() => import('./routes/syntax'));
const SemanticRoute = lazy(() => import('./routes/semantic'));
const IrRoute = lazy(() => import('./routes/ir'));
const OptRoute = lazy(() => import('./routes/opt'));
const CodegenRoute = lazy(() => import('./routes/codegen'));

function RouteFallback() {
  return (
    <div className="flex flex-1 items-center justify-center gap-2 py-24 text-sm text-ink-faint">
      <Loader2 aria-hidden className="size-4 animate-spin" />
      Loading phase…
    </div>
  );
}

export default function App() {
  return (
    <TooltipProvider>
      <div className="flex min-h-dvh flex-col">
        <TopBar />
        {/*
          `id` + `tabIndex={-1}` make the TopBar skip link a plain fragment
          link: `href="#main"` lands focus here without any JavaScript.
        */}
        <main id="main" tabIndex={-1} className="flex flex-1 flex-col outline-none">
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<OverviewRoute />} />
              <Route path="/lex" element={<LexRoute />} />
              <Route path="/syntax" element={<SyntaxRoute />} />
              <Route path="/semantic" element={<SemanticRoute />} />
              <Route path="/ir" element={<IrRoute />} />
              <Route path="/opt" element={<OptRoute />} />
              <Route path="/codegen" element={<CodegenRoute />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </TooltipProvider>
  );
}

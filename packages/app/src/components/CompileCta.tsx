/**
 * The "nothing compiled yet" call to action, shared by every phase route.
 *
 * All six cold states used to say "press Compile" and then point somewhere
 * different — the overview, "the top bar" (which has no Compile button at all),
 * or nowhere. Compiling is a store action, so a phase route can simply run it;
 * this component is the one button that does, plus the link out to the editor
 * for readers who want a different program first.
 */
import { Link } from 'react-router-dom';
import { PlayCircle } from 'lucide-react';
import { useCompilationStore } from '../store/compilation';

export function CompileCta({ className }: { className?: string }) {
  const compiling = useCompilationStore((s) => s.compiling);
  const compile = useCompilationStore((s) => s.compile);
  return (
    <div className={className ?? 'flex flex-col items-center gap-2'}>
      <button
        type="button"
        onClick={() => void compile()}
        disabled={compiling}
        className="flex h-11 cursor-pointer items-center gap-2 rounded-sm bg-accent px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
      >
        <PlayCircle aria-hidden className="size-4.5" />
        {compiling ? 'Compiling…' : 'Compile'}
      </button>
      <p className="text-sm text-ink-faint">
        Or pick another example on the{' '}
        <Link to="/" className="underline underline-offset-2">
          overview
        </Link>
        .
      </p>
    </div>
  );
}

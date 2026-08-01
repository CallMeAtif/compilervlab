/**
 * The educational empty states shared by the three parse views: nothing to parse
 * yet, an upstream phase that failed, and the grammar that simply cannot be
 * parsed top-down.
 */
import { Link } from 'react-router-dom';
import { useCompilationStore, phaseDiagnostics } from '../../../store/compilation';
import { EmptyState, Note, TextButton, Diagnostics } from '../components/ui';
import { grammarMeta } from '../lib/grammars';
import type { ViewContext } from '../lib/view';

export function isTopDownBlocked(ctx: ViewContext): boolean {
  return ctx.leftRecursive.length > 0;
}

/**
 * A left-recursive grammar makes both top-down parsers diverge — the procedure
 * for A calls itself without consuming input (§4.3.3). Running it would hang the
 * worker, so the view refuses and points at Algorithm 4.19 instead.
 */
export function TopDownBlocked({
  ctx,
  algorithm,
  onGoToTransforms,
}: {
  ctx: ViewContext;
  algorithm: string;
  onGoToTransforms: () => void;
}) {
  const lr = ctx.leftRecursive;
  return (
    <EmptyState
      title={`${grammarMeta(ctx.grammarId).label} is left recursive — no ${algorithm} can run on it`}
      actions={
        <>
          <TextButton emphasis onClick={onGoToTransforms}>
            Eliminate the left recursion (Algorithm 4.19)
          </TextButton>
        </>
      }
    >
      <p>
        {lr.length} nonterminal{lr.length === 1 ? '' : 's'} derive themselves as their own leftmost
        symbol ({lr.slice(0, 8).join(', ')}
        {lr.length > 8 ? `, … +${lr.length - 8}` : ''}). A predictive parser would expand{' '}
        <span className="font-mono">{lr[0]}</span> to a string beginning with{' '}
        <span className="font-mono">{lr[0]}</span> forever without ever consuming a token — §4.3.3.
      </p>
      <p className="mt-2">
        That is precisely the problem Algorithm 4.19 solves. Run the transform, then parse the
        transformed grammar (<span className="font-mono">c-subset-ll</span> and{' '}
        <span className="font-mono">dragon-4.28</span> are already in that form). Bottom-up parsers
        have no such restriction — try LR parse instead.
      </p>
    </EmptyState>
  );
}

/** No compiled program (C grammars) or no sentence (study grammars). */
export function NoParseInput({ ctx }: { ctx: ViewContext }) {
  const meta = grammarMeta(ctx.grammarId);
  const compilation = useCompilationStore((s) => s.compilation);
  const compiling = useCompilationStore((s) => s.compiling);
  const compile = useCompilationStore((s) => s.compile);

  if (meta.input === 'terminals') {
    return (
      <EmptyState title="Nothing to parse yet">
        Type a sentence in the input box above — a whitespace-separated list of this grammar’s
        terminals, e.g. <span className="font-mono">{meta.sample}</span>.
      </EmptyState>
    );
  }

  return (
    <EmptyState
      title="Compile a program to begin"
      actions={
        <>
          <TextButton emphasis disabled={compiling} onClick={() => void compile()}>
            {compiling ? 'Compiling…' : 'Compile the current source'}
          </TextButton>
          <Link
            to="/"
            className="flex h-11 items-center rounded-md border border-line px-3 text-xs font-semibold text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
          >
            Open the editor
          </Link>
        </>
      }
    >
      This view parses a real token stream, so it needs a compiled program: the scanner has to turn
      the source into terminals before any parser can look at them.
      {compilation === null ? '' : ' The last compile produced no tokens.'}
    </EmptyState>
  );
}

/** Diagnostics from the phases upstream of this one (lexical analysis). */
export function UpstreamFailure() {
  const compilation = useCompilationStore((s) => s.compilation);
  const lex = phaseDiagnostics(compilation, 'lex').filter((d) => d.severity === 'error');
  const syn = phaseDiagnostics(compilation, 'syntax').filter((d) => d.severity === 'error');
  if (lex.length === 0 && syn.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {lex.length > 0 && (
        <Diagnostics
          title="Lexical analysis failed — the parser never received a token stream"
          diagnostics={lex}
        />
      )}
      {syn.length > 0 && (
        <Note tone="warn" title="The pipeline parser reported syntax errors on this program">
          The views below still run — a failed parse is a trace worth watching — but the AST the
          rest of the compiler uses was not produced.
        </Note>
      )}
    </div>
  );
}

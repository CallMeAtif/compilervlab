/**
 * The educational empty states shared by the three parse views: nothing to parse
 * yet, an upstream phase that failed, and the grammar that simply cannot be
 * parsed top-down.
 */
import { Link } from 'react-router-dom';
import { useCompilationStore, phaseDiagnostics } from '../../../store/compilation';
import { EmptyState, Note, TextButton, Diagnostics } from '../components/ui';
import { grammarMeta } from '../lib/grammars';
import type { AlgoId } from '../lib/algorithms';
import type { ViewContext } from '../lib/view';

export function isTopDownBlocked(ctx: ViewContext): boolean {
  return ctx.leftRecursive.length > 0;
}

/**
 * A left-recursive grammar makes both top-down parsers diverge — the procedure
 * for A calls itself without consuming input (§4.3.3). Running it would hang the
 * worker, so the view refuses and points at Algorithm 4.19 instead.
 *
 * The button goes to the TRANSFORM VIEW, so it is labelled as what it does —
 * watch the algorithm run. It carries `?from=` so that view can send the reader
 * back here on a grammar the parser accepts once the rewrite is done; the label
 * and the destination have to agree, and a reader who lands on a step-by-step
 * rewrite after being promised a parse has been lied to.
 */
export function TopDownBlocked({
  ctx,
  algorithm,
  origin,
}: {
  ctx: ViewContext;
  algorithm: string;
  /** The refusing algorithm — the one the transform view returns to. */
  origin: AlgoId;
}) {
  const lr = ctx.leftRecursive;
  return (
    <EmptyState
      title={`Left recursive. No ${algorithm} can run on it.`}
      actions={
        <>
          <TextButton
            emphasis
            ariaLabel="Watch Algorithm 4.19 eliminate the left recursion"
            onClick={() => ctx.selectAlgo('transforms', { from: origin })}
          >
            Watch Algorithm 4.19
          </TextButton>
        </>
      }
    >
      <p>
        {lr.length} nonterminal{lr.length === 1 ? '' : 's'} derive themselves leftmost (
        {lr.slice(0, 8).join(', ')}
        {lr.length > 8 ? `, +${lr.length - 8}` : ''}). Expanding{' '}
        <span className="font-mono">{lr[0]}</span> never consumes a token (§4.3.3).
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
        Type terminals above, e.g. <span className="font-mono">{meta.sample}</span>.
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
      This view parses a real token stream, so it needs a compiled program.
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
          The views below still run. No AST was produced.
        </Note>
      )}
    </div>
  );
}

/**
 * /lex — Lexical Analysis.
 *
 * Six views over the four `lex.*` trace kinds, on ONE nav row:
 *   thompson / subset / minimize  regex → NFA → DFA → minimum-state DFA, per
 *                                 token class (works before anything compiles)
 *   scan                          the combined DFA simulated over the program
 *   tokens                        the token stream and the lexer symbol table
 *   errors                        lexical diagnostics as teaching cards
 *
 * Every view is a `[visualization | TracePanel]` split (stacked below `lg`), and
 * the whole selection (tab, construction stage, token class, step) round trips
 * through the URL.
 */
import type { ReactNode } from 'react';
import { Binary } from 'lucide-react';
import { PhasePage } from '../../components/PhasePage';
import { PhaseNav, type PhaseNavItem } from '../../components/PhaseNav';
import { CompileCta } from '../../components/CompileCta';
import { phaseDiagnostics, useCompilationStore } from '../../store/compilation';
import { LEX_STAGES, useLexUrlState, type LexStage, type LexTab } from './lexUrl';
import { tokenClassById } from './tokenClasses';
import { ConstructionsTab, TokenClassPicker } from './parts/ConstructionsTab';
import { ScanTab } from './parts/ScanTab';
import { TokensTab } from './parts/TokensTab';
import { ErrorsTab } from './parts/ErrorsTab';
import { EmptyState, LoadingPanel, Note } from './parts/ui';
import './lex.css';

/**
 * ONE nav row for the phase: the three chained constructions, then the scanner
 * running over the real program, then what it produced. The stage chain used to
 * be a second tab row above this one saying the same thing.
 */
type LexNavId = LexStage | 'scan' | 'tokens' | 'errors';

const LEX_NAV: ReadonlyArray<PhaseNavItem<LexNavId>> = [
  { id: 'thompson', label: 'Thompson NFA', hint: 'Algorithm 3.23 — regex to NFA' },
  { id: 'subset', label: 'Subset construction', hint: 'Algorithm 3.20 — NFA to DFA' },
  { id: 'minimize', label: 'DFA minimization', hint: 'Algorithm 3.39 — merge equivalent states' },
  { id: 'scan', label: 'Tokenize', hint: 'the DFA run over the compiled source' },
  { id: 'tokens', label: 'Tokens & symbols', hint: 'the token stream and the symbol table' },
  { id: 'errors', label: 'Errors', hint: 'lexical diagnostics' },
];

function navId(tab: LexTab, stage: LexStage): LexNavId {
  return tab === 'constructions' ? stage : tab;
}

/** Tabs (b)–(d) read the compiled program; (a) is source-independent. */
function SourceGate({
  children,
}: {
  children: (args: { source: string; compilationId: string }) => ReactNode;
}) {
  const compilation = useCompilationStore((s) => s.compilation);
  const compiling = useCompilationStore((s) => s.compiling);
  const compileError = useCompilationStore((s) => s.compileError);
  const stale = useCompilationStore((s) => s.stale);

  if (compiling && compilation === null) {
    return <LoadingPanel label="Compiling…" />;
  }
  if (compileError !== null && compilation === null) {
    return (
      <Note tone="error" title="The compile worker failed">
        {compileError}
      </Note>
    );
  }
  if (compilation === null) {
    return (
      <EmptyState title="Compile a program to begin" icon={Binary}>
        <CompileCta className="flex flex-col items-start gap-2" />
        <p className="mt-3">Constructions runs without a compiled program.</p>
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {stale && <Note tone="warn" title="Showing the previous compilation" />}
      {children({ source: compilation.source, compilationId: compilation.id })}
    </div>
  );
}

export function LexPhaseView() {
  const { tab, stage, tokenClass, step, select } = useLexUrlState();
  const compilation = useCompilationStore((s) => s.compilation);
  const cls = tokenClassById(tokenClass);
  const lexDiagnostics = phaseDiagnostics(compilation, 'lex');
  const errorCount = lexDiagnostics.filter((d) => d.severity === 'error').length;

  const items = LEX_NAV.map((item) =>
    item.id === 'errors' && errorCount > 0
      ? {
          ...item,
          badge: (
            <span className="font-mono text-3xs text-err tabular-nums">{errorCount}</span>
          ),
        }
      : item,
  );

  const nav = (
    <PhaseNav
      label="Lexical analysis views"
      items={items}
      value={navId(tab, stage)}
      onSelect={(id) =>
        LEX_STAGES.includes(id as LexStage)
          ? select({ tab: 'constructions', stage: id as LexStage })
          : select({ tab: id as LexTab })
      }
      // The token class filters the same three constructions, so it rides the
      // nav rule instead of costing a band of its own.
      aside={
        tab === 'constructions' ? (
          <TokenClassPicker value={cls} onChange={(id) => select({ tokenClass: id })} />
        ) : null
      }
    />
  );

  return (
    <PhasePage phase="lex" nav={nav}>
      <div role="tabpanel" aria-label="Lexical analysis visualization" className="min-w-0">
        {tab === 'constructions' && (
          <ConstructionsTab
            cls={cls}
            stage={stage}
            initialStep={step}
            onSelectClass={(id) => select({ tokenClass: id })}
            onGoToScan={() => select({ tab: 'scan' })}
          />
        )}

        {tab === 'scan' && (
          <SourceGate>
            {({ source, compilationId }) => (
              <ScanTab source={source} compilationId={compilationId} initialStep={step} />
            )}
          </SourceGate>
        )}

        {tab === 'tokens' && (
          <SourceGate>
            {({ source, compilationId }) => (
              <TokensTab source={source} compilationId={compilationId} initialStep={step} />
            )}
          </SourceGate>
        )}

        {tab === 'errors' && (
          <SourceGate>
            {({ source, compilationId }) => (
              <ErrorsTab
                source={source}
                compilationId={compilationId}
                initialStep={step}
                diagnostics={lexDiagnostics}
              />
            )}
          </SourceGate>
        )}
      </div>
    </PhasePage>
  );
}

export default function LexPhaseRoute() {
  return <LexPhaseView />;
}

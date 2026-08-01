/**
 * /lex — Lexical Analysis.
 *
 * Four tabs over the four `lex.*` trace kinds:
 *   (a) Constructions  regex → NFA → DFA → minimum-state DFA, per token class
 *                      (source-independent: it works before anything is compiled)
 *   (b) Scan           the combined DFA simulated over the real program
 *   (c) Tokens         the token stream and the lexer symbol table
 *   (d) Errors         lexical diagnostics as teaching cards
 *
 * Every tab is a `[visualization | TracePanel]` split (stacked below `lg`), and
 * the whole selection — tab, construction stage, token class and step — round
 * trips through the URL.
 */
import type { ReactNode } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { clsx } from 'clsx';
import { Binary, CircleAlert, ScanText, Table2, Workflow } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { PhasePage } from '../../components/PhasePage';
import { CompileCta } from '../../components/CompileCta';
import { phaseDiagnostics, useCompilationStore } from '../../store/compilation';
import { LEX_TABS, useLexUrlState, type LexTab } from './lexUrl';
import { tokenClassById } from './tokenClasses';
import { ConstructionsTab } from './parts/ConstructionsTab';
import { ScanTab } from './parts/ScanTab';
import { TokensTab } from './parts/TokensTab';
import { ErrorsTab } from './parts/ErrorsTab';
import { EmptyState, LoadingPanel, Note } from './parts/ui';
import './lex.css';

const TAB_META: Record<LexTab, { label: string; hint: string; icon: LucideIcon }> = {
  constructions: {
    label: 'Constructions',
    hint: 'regex → NFA → DFA → min-DFA',
    icon: Workflow,
  },
  scan: { label: 'Scan', hint: 'the DFA running on your source', icon: ScanText },
  tokens: { label: 'Tokens & symbols', hint: 'the artifacts handed to the parser', icon: Table2 },
  errors: { label: 'Errors', hint: 'lexical diagnostics', icon: CircleAlert },
};

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
        <p>
          The scanner needs a program to run on — compile the current source, or open the
          overview to pick an example or write your own C-subset program.
        </p>
        <CompileCta className="mt-3 flex flex-col items-center gap-2" />
        <p className="mt-2">
          The <span className="font-medium">Constructions</span> tab needs nothing compiled — the
          regex → NFA → DFA pipeline depends only on the token specifications, so you can step
          through it right now.
        </p>
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {stale && (
        <Note tone="warn" title="This view is showing the previous compilation">
          The source has been edited since it was compiled. Press{' '}
          <span className="font-medium">Compile</span> on the overview to re-scan — nothing
          recompiles behind your back.
        </Note>
      )}
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

  return (
    <Tabs.Root
      value={tab}
      onValueChange={(v) => select({ tab: v as LexTab })}
      className="flex flex-col gap-4"
    >
      <Tabs.List
        aria-label="Lexical analysis views"
        className="flex flex-wrap gap-1.5 border-b border-line pb-2"
      >
        {LEX_TABS.map((id) => {
          const meta = TAB_META[id];
          const Icon = meta.icon;
          return (
            <Tabs.Trigger
              key={id}
              value={id}
              className={clsx(
                'flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-left transition-colors',
                'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink',
                'data-[state=active]:border-accent data-[state=active]:bg-accent-soft data-[state=active]:text-ink',
              )}
            >
              <Icon aria-hidden className="size-4 shrink-0" />
              <span className="flex flex-col leading-tight">
                <span className="text-sm font-medium">{meta.label}</span>
                <span className="text-[10px] text-ink-faint">{meta.hint}</span>
              </span>
              {id === 'errors' && errorCount > 0 && (
                <span className="ml-1 flex h-5 min-w-5 items-center justify-center rounded-full border border-err/50 bg-err-soft px-1 font-mono text-[10px] font-semibold text-err">
                  {errorCount}
                </span>
              )}
            </Tabs.Trigger>
          );
        })}
      </Tabs.List>

      <Tabs.Content value="constructions" className="focus-visible:outline-none">
        <ConstructionsTab
          cls={cls}
          stage={stage}
          initialStep={step}
          onSelectClass={(id) => select({ tokenClass: id })}
          onSelectStage={(s) => select({ stage: s })}
        />
      </Tabs.Content>

      <Tabs.Content value="scan" className="focus-visible:outline-none">
        <SourceGate>
          {({ source, compilationId }) => (
            <ScanTab source={source} compilationId={compilationId} initialStep={step} />
          )}
        </SourceGate>
      </Tabs.Content>

      <Tabs.Content value="tokens" className="focus-visible:outline-none">
        <SourceGate>
          {({ source, compilationId }) => (
            <TokensTab source={source} compilationId={compilationId} initialStep={step} />
          )}
        </SourceGate>
      </Tabs.Content>

      <Tabs.Content value="errors" className="focus-visible:outline-none">
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
      </Tabs.Content>
    </Tabs.Root>
  );
}

export default function LexPhaseRoute() {
  return (
    <PhasePage phase="lex">
      <LexPhaseView />
    </PhasePage>
  );
}

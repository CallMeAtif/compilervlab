/**
 * Tab (c) — the two artifacts the phase actually hands downstream: the token
 * stream and the lexer's symbol table (tokens and their attributes §3.1.3,
 * symbol tables §2.7).
 *
 * Both tables stay synchronized with the scan trace: rows emitted so far are
 * highlighted, the token at the cursor is the current row, and selecting any
 * row seeks the stepper to the step that emitted it while highlighting its span
 * in the source.
 */
import { useMemo, useState } from 'react';
import type { SourceSpan } from '@lab/trace';
import { scanReducer, type ScanEvent, type ScanState } from '@lab/core/lex/reducers.js';
import type { VTableColumn, VTableRow } from '../../../components/viz/VirtualTable';
import { CodeStrip } from '../../../components/viz/CodeStrip';
import type { Stepper } from '../../../lib/useStepper';
import { useLexTrace } from '../useLexTrace';
import { LoadingPanel, Note, Panel, TraceSplit, UnavailablePanel } from './ui';
import { StatChips } from './bits';
import { VirtualTable } from '../../../components/viz/VirtualTable';

const TOKEN_COLUMNS: VTableColumn[] = [
  { key: 'type', header: 'type', width: 96 },
  { key: 'lexeme', header: 'lexeme', width: 150 },
  { key: 'at', header: 'line:col', width: 84 },
  { key: 'symbolId', header: 'symbolId', width: 80 },
  { key: 'value', header: 'value', width: 80 },
];

const SYMBOL_COLUMNS: VTableColumn[] = [
  { key: 'lexeme', header: 'lexeme', width: 170 },
  { key: 'first', header: 'first seen', width: 100 },
  { key: 'occ', header: 'occurrences', width: 110 },
];

function TokensBody({
  source,
  stepper,
}: {
  source: string;
  stepper: Stepper<ScanState, ScanEvent>;
}) {
  const { trace, state } = stepper;
  const final = useMemo(() => trace.final(), [trace]);
  const [selected, setSelected] = useState<{ kind: 'token' | 'symbol'; index: number } | null>(null);

  const emitStepOf = useMemo(() => {
    const m = new Map<number, number>();
    trace.steps.forEach((s) => {
      if (s.event.kind === 'tokenEmitted') m.set(s.event.token.index, s.index);
    });
    return m;
  }, [trace]);

  const emittedCount = state.tokens.length;
  const currentTokenIndex = emittedCount - 1;

  const selectedSymbolId =
    selected?.kind === 'symbol' ? (final.symbols[selected.index]?.id ?? null) : null;

  const tokenRows = useMemo<VTableRow[]>(
    () =>
      final.tokens.map((t, i) => ({
        id: `t${t.index}`,
        header: String(t.index),
        cells: {
          type: {
            text: i === currentTokenIndex ? `▸ ${t.type}` : t.type,
            highlight: i < emittedCount,
            title: i === currentTokenIndex ? 'the token emitted at the current step' : undefined,
          },
          lexeme: {
            text: t.lexeme === '\n' ? '\\n' : t.lexeme,
            current: selected?.kind === 'token' && selected.index === i,
          },
          at: { text: `${t.span.line}:${t.span.col}`, title: `offsets ${t.span.start}–${t.span.end}` },
          symbolId: {
            text: t.symbolId === undefined ? '' : String(t.symbolId),
            highlight: t.symbolId !== undefined && t.symbolId === selectedSymbolId,
          },
          value: { text: t.value === undefined ? '' : String(t.value) },
        },
      })),
    [final.tokens, emittedCount, selected, selectedSymbolId, currentTokenIndex],
  );

  const symbolRows = useMemo<VTableRow[]>(
    () =>
      final.symbols.map((s, i) => ({
        id: `s${s.id}`,
        header: String(s.id),
        cells: {
          lexeme: { text: s.lexeme, current: selected?.kind === 'symbol' && selected.index === i },
          first: { text: `${s.firstSeen.line}:${s.firstSeen.col}` },
          occ: { text: String(s.occurrences), highlight: s.occurrences > 1 },
        },
      })),
    [final.symbols, selected],
  );

  const spans = useMemo<SourceSpan[]>(() => {
    if (selected?.kind === 'token') {
      const t = final.tokens[selected.index];
      return t ? [t.span] : [];
    }
    if (selected?.kind === 'symbol') {
      const sym = final.symbols[selected.index];
      if (!sym) return [];
      // Every occurrence of the identifier, not just where it was interned.
      return final.tokens.filter((t) => t.symbolId === sym.id).map((t) => t.span);
    }
    const at = final.tokens[currentTokenIndex];
    return at ? [at.span] : [];
  }, [selected, final, currentTokenIndex]);

  return (
    <>
      <Panel
        title="Source"
        subtitle={
          selected === null
            ? 'follows the stepper; select a row below to pin a span'
            : 'showing the selected row'
        }
        bodyClassName="p-0"
      >
        <CodeStrip source={source} spans={spans} maxHeight="13rem" className="rounded-none border-0" />
      </Panel>

      <Panel
        title="Token stream"
        subtitle="what the parser consumes"
        actions={
          <StatChips
            items={[
              ['tokens', String(final.tokens.length)],
              ['emitted', `${emittedCount}`],
            ]}
          />
        }
        bodyClassName="p-0"
      >
        <VirtualTable
          columns={TOKEN_COLUMNS}
          rows={tokenRows}
          cornerLabel="#"
          height={320}
          aria-label="Token stream"
          className="rounded-none border-0"
          selectedRowId={selected?.kind === 'token' ? (tokenRows[selected.index]?.id ?? null) : null}
          scrollToRowId={tokenRows[currentTokenIndex]?.id ?? null}
          onRowSelect={(_id, i) => {
            setSelected({ kind: 'token', index: i });
            const t = final.tokens[i];
            const at = t ? emitStepOf.get(t.index) : undefined;
            if (at !== undefined) stepper.jumpTo(at + 1);
          }}
        />
        <p className="border-t border-line px-3 py-2 text-xs text-ink-muted">
          Rows shaded in the <span className="font-mono">type</span> column have already been
          emitted at the current step. Selecting a row seeks the trace to the moment Fig 3.54 wrote
          it and highlights its span above. <span className="font-mono">symbolId</span> is filled in
          only for identifiers — that is the scanner interning the lexeme.
        </p>
      </Panel>

      <Panel
        title="Symbol table"
        subtitle="one entry per distinct identifier lexeme (§2.7)"
        actions={<StatChips items={[['identifiers', String(final.symbols.length)]]} />}
        bodyClassName="p-0"
      >
        {final.symbols.length === 0 ? (
          <p className="p-3 text-sm text-ink-muted">
            This program declares no identifiers, so the lexer interned nothing.
          </p>
        ) : (
          <VirtualTable
            columns={SYMBOL_COLUMNS}
            rows={symbolRows}
            cornerLabel="id"
            height={Math.min(280, 32 * (symbolRows.length + 1) + 8)}
            aria-label="Symbol table"
            className="rounded-none border-0"
            selectedRowId={
              selected?.kind === 'symbol' ? (symbolRows[selected.index]?.id ?? null) : null
            }
            onRowSelect={(_id, i) => setSelected({ kind: 'symbol', index: i })}
          />
        )}
        <p className="border-t border-line px-3 py-2 text-xs text-ink-muted">
          Selecting an identifier highlights every occurrence of it in the source and marks its
          <span className="font-mono"> symbolId</span> in the token table above.
        </p>
      </Panel>
    </>
  );
}

export function TokensTab({
  source,
  compilationId,
  initialStep,
}: {
  source: string;
  compilationId: string;
  initialStep: number | null;
}) {
  const traceState = useLexTrace<ScanState, ScanEvent>(
    { kind: 'lex.scan', params: { source } },
    scanReducer,
  );

  if (traceState.status === 'loading' || traceState.status === 'idle') {
    return <LoadingPanel label="Collecting the token stream…" />;
  }
  if (traceState.status === 'failed') {
    return (
      <Note tone="error" title="The worker could not record the scan">
        {traceState.message}
      </Note>
    );
  }
  if (traceState.status === 'unavailable') {
    return (
      <UnavailablePanel title="No token stream" diagnostics={traceState.diagnostics}>
        The scanner trace could not be built, so there is no token stream to tabulate.
      </UnavailablePanel>
    );
  }

  return (
    <TraceSplit
      key={`tokens:${compilationId}`}
      trace={traceState.trace}
      title="Tokenization"
      initialStep={initialStep}
      jumpTargets={[
        { label: 'token', predicate: (s) => s.event.kind === 'tokenEmitted' },
        { label: 'keyword', predicate: (s) => s.event.kind === 'keywordLookup' },
        { label: 'error', predicate: (s) => s.event.kind === 'lexError' },
      ]}
    >
      {(stepper) => <TokensBody source={source} stepper={stepper} />}
    </TraceSplit>
  );
}

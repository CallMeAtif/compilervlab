/**
 * Read-only CodeMirror mini view that highlights the given SourceSpans via
 * decorations — used for step-synchronized "where in the source are we"
 * strips inside phase views.
 *
 * Zero-width spans are CARETS, not nothing: a scanner sitting between two
 * characters (`forward` = `lexemeBegin`, an insertion point, an empty lexeme)
 * has a real position and no extent. A span with `start === end`, or any offset
 * passed in `carets`, is drawn as a cursor rule rather than dropped.
 */
import { useEffect, useMemo, useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { cpp } from '@codemirror/lang-cpp';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import type { Range } from '@codemirror/state';
import type { SourceSpan } from '@lab/trace';
import { clsx } from 'clsx';
import { useTheme } from '../../lib/theme';

export interface CodeStripProps {
  source: string;
  /** Highlighted ranges. Entries with `start === end` render as carets. */
  spans?: readonly SourceSpan[];
  /** Additional zero-width caret positions (character offsets). */
  carets?: readonly number[];
  className?: string;
  maxHeight?: string;
  /** Accessible name for the strip. */
  label?: string;
}

const mark = Decoration.mark({ class: 'cm-src-highlight' });

/** Zero-width cursor rule. All instances are equal, so CM can reuse the DOM. */
class CaretWidget extends WidgetType {
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'cm-src-caret';
    el.setAttribute('aria-hidden', 'true');
    return el;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

const caret = Decoration.widget({ widget: new CaretWidget(), side: 1 });

export function CodeStrip({
  source,
  spans,
  carets,
  className,
  maxHeight = '16rem',
  label = 'Source, with the current step highlighted',
}: CodeStripProps) {
  const { theme } = useTheme();
  const viewRef = useRef<EditorView | null>(null);

  const extensions = useMemo(() => {
    const ranges: Range<Decoration>[] = [];

    const inRange = (n: number) => n >= 0 && n <= source.length;
    const caretAt = new Set<number>();

    const sorted = [...(spans ?? [])]
      .filter((s) => s.start <= s.end && s.end <= source.length && s.start >= 0)
      .sort((a, b) => a.start - b.start);
    let lastEnd = -1;
    for (const s of sorted) {
      if (s.start === s.end) {
        caretAt.add(s.start); // zero-width: a position, not an extent
        continue;
      }
      if (s.start < lastEnd) continue; // skip overlaps: marks must be disjoint
      ranges.push(mark.range(s.start, s.end));
      lastEnd = s.end;
    }
    for (const c of carets ?? []) if (inRange(c)) caretAt.add(c);
    for (const at of caretAt) ranges.push(caret.range(at));

    // `Decoration.set(_, true)` sorts, so marks and widgets may interleave.
    return [
      cpp(),
      EditorView.decorations.of(Decoration.set(ranges, true)),
      EditorView.lineWrapping,
    ];
  }, [spans, carets, source]);

  // Keep the first highlighted span (or caret) in view as steps advance.
  const offsets = useMemo(() => {
    const all = [...(spans ?? []).map((s) => s.start), ...(carets ?? [])];
    return all.length > 0 ? Math.min(...all) : null;
  }, [spans, carets]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || offsets === null || offsets > view.state.doc.length) return;
    view.dispatch({ effects: EditorView.scrollIntoView(offsets, { y: 'center' }) });
  }, [offsets, source]);

  return (
    <div
      role="group"
      aria-label={label}
      className={clsx(
        'overflow-hidden rounded-lg border border-line bg-code text-sm',
        className,
      )}
      style={{ maxHeight }}
    >
      <CodeMirror
        value={source}
        theme={theme}
        editable={false}
        readOnly
        extensions={extensions}
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          highlightSelectionMatches: false,
          searchKeymap: false,
        }}
        onCreateEditor={(view) => {
          viewRef.current = view;
        }}
        style={{ maxHeight }}
        maxHeight={maxHeight}
      />
    </div>
  );
}

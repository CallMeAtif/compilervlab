/** Shared helpers for the syntax-LR golden tests. */
import { augment, type Grammar } from '../../src/grammar/grammar.js';
import {
  actionToString,
  formatDotted,
  type LrAction,
} from '../../src/grammar/lr-events.js';
import type { Lr0StateJson } from '../../src/grammar/lr0-items.js';
import type { Lr1StateJson } from '../../src/grammar/lr1-items.js';
import type { Token, TokenStream, TokenType } from '../../src/csubset/tokens.js';

/** "K E' → · E" for kernel items, "  E → · T" for closure items. */
export function fmtLr0State(ag: Grammar, st: Lr0StateJson): string[] {
  return st.items.map(
    (it) => `${it.kernel ? 'K ' : '  '}${formatDotted(ag, it.prod, it.dot)}`,
  );
}

/** Book-style merged-lookahead display: "K C → c · C, c/d" (order of first
 *  appearance of each core; lookaheads in stored order). */
export function fmtLr1StateMerged(ag: Grammar, st: Lr1StateJson): string[] {
  const order: string[] = [];
  const las = new Map<string, string[]>();
  const kernel = new Map<string, boolean>();
  for (const it of st.items) {
    const key = `${it.prod}.${it.dot}`;
    if (!las.has(key)) {
      order.push(key);
      las.set(key, []);
      kernel.set(key, it.kernel);
    }
    las.get(key)!.push(it.la);
  }
  return order.map((key) => {
    const [prod, dot] = key.split('.').map(Number) as [number, number];
    return `${kernel.get(key) ? 'K ' : '  '}${formatDotted(ag, prod, dot)}, ${las.get(key)!.join('/')}`;
  });
}

/** ACTION row → compact s5/r4/acc cells. */
export function fmtActionRow(row: Record<string, LrAction>): Record<string, string> {
  return Object.fromEntries(Object.entries(row).map(([k, a]) => [k, actionToString(a)]));
}

export function fmtActionTable(
  action: Array<Record<string, LrAction>>,
): Array<Record<string, string>> {
  return action.map(fmtActionRow);
}

export { augment };

// ── Hand tokenizer (the syntax tests must not depend on the lex agent) ──────

export type TokSpec = TokenType | [TokenType, string];

/** Build a TokenStream from [type, lexeme] specs; single-token specs use the
 *  type as its own lexeme. Spans are laid out on line 1 with single spaces. */
export function toks(specs: TokSpec[]): TokenStream {
  const tokens: Token[] = [];
  const symbolIds = new Map<string, number>();
  const symbols: TokenStream['symbols'] = [];
  let offset = 0;
  specs.forEach((spec, index) => {
    const [type, lexeme] = typeof spec === 'string' ? [spec, spec] : spec;
    const span = {
      start: offset,
      end: offset + lexeme.length,
      line: 1,
      col: offset + 1,
    };
    const tok: Token = { index, type, lexeme, span };
    if (type === 'id') {
      let sid = symbolIds.get(lexeme);
      if (sid === undefined) {
        sid = symbols.length;
        symbolIds.set(lexeme, sid);
        symbols.push({ id: sid, lexeme, firstSeen: span, occurrences: 0 });
      }
      symbols[sid]!.occurrences += 1;
      tok.symbolId = sid;
    } else if (type === 'intconst') {
      tok.value = parseInt(lexeme, 10);
    } else if (type === 'floatconst') {
      tok.value = parseFloat(lexeme);
    } else if (type === 'charconst') {
      tok.value = lexeme.length >= 3 ? lexeme.charCodeAt(1) : 0;
    }
    tokens.push(tok);
    offset += lexeme.length + 1;
  });
  return { tokens, symbols };
}

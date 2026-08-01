/**
 * The C-subset scanner (§3.8, "Design of a Lexical-Analyzer Generator").
 *
 * One combined machine is built ONCE from all token patterns — the token
 * classes id / intconst / floatconst plus literal patterns for operators and
 * punctuation — through this module's own Thompson → subset-construction →
 * minimization pipeline (§3.8.2: a new start state with ε-edges to each
 * pattern's NFA). Keywords are NOT patterns: they are reserved words, scanned
 * as identifiers and looked up in the keyword table (§3.4.2). Character
 * constants use a small dedicated hand-rolled automaton (§3.4.4: transition
 * diagrams run in sequence); comments and whitespace are stripped by the
 * driver. The driver simulates the DFA with longest-match semantics: it
 * remembers the last accepting state passed and rolls the input back to it
 * when the DFA dies or the input runs out (§3.8.3, Fig 3.54).
 */

import type { Citation, Recorded, SourceSpan, StepMeta, Steps } from '@lab/trace';
import { record } from '@lab/trace';
import type { Diagnostic } from '../common/types.js';
import { lit, buildTokenClasses, type RegexAst } from '../csubset/regex.js';
import { KEYWORDS, type LexSymbolEntry, type Token, type TokenType } from '../csubset/tokens.js';
import type { ScanEvent } from './events.js';
import { minimize } from './minimize.js';
import {
  initialScanState,
  lexDiagnostic,
  scanReducer,
  type ScanState,
} from './reducers.js';
import { subsetConstruction } from './subset-construction.js';
import { thompson } from './thompson.js';
import type { MinDfa, MultiNfa, NfaAccept, NfaEdge } from './types.js';

// ---------------------------------------------------------------------------
// Combined-machine construction (untraced; built once and cached)
// ---------------------------------------------------------------------------

/** Operators & punctuation, in declaration order (= priority order). */
export const OPERATORS: readonly string[] = [
  '+', '-', '*', '/', '%',
  '=', '==', '!=', '<', '>', '<=', '>=',
  '&&', '||', '!', '&',
  '(', ')', '{', '}', '[', ']',
  ';', ',',
];

export interface ScanPattern {
  name: string;
  priority: number;
  regex: RegexAst;
}

/** All patterns of the combined machine: token classes (priorities from
 *  csubset/regex.ts), then operator/punctuation literals at priority 10+. */
export function scannerPatterns(): ScanPattern[] {
  const classes = buildTokenClasses(); // resets regex ids — deterministic
  const pats: ScanPattern[] = classes.map((c) => ({ name: c.name, priority: c.priority, regex: c.regex }));
  OPERATORS.forEach((op, i) => pats.push({ name: op, priority: 10 + i, regex: lit(op) }));
  return pats;
}

/** Run a Steps generator to completion, discarding events. */
function drain<E extends { kind: string }, R>(gen: Steps<E, R>): R {
  let it = gen.next();
  while (!it.done) it = gen.next();
  return it.value;
}

/**
 * §3.8.2: combine the patterns' Thompson NFAs under a new start state 0 with
 * an ε-edge to each pattern's start; each pattern keeps its own accepting
 * state, annotated with the token and its priority.
 */
export function buildCombinedNfa(patterns: ScanPattern[]): MultiNfa {
  const states: number[] = [0];
  const edges: NfaEdge[] = [];
  const accepts: NfaAccept[] = [];
  let offset = 1;
  for (const p of patterns) {
    const nfa = drain(thompson(p.regex));
    for (const s of nfa.states) states.push(s + offset);
    edges.push({ from: 0, to: nfa.start + offset, label: null });
    for (const e of nfa.edges) edges.push({ from: e.from + offset, to: e.to + offset, label: e.label });
    accepts.push({ state: nfa.accept + offset, token: p.name, priority: p.priority });
    offset += nfa.states.length;
  }
  return { states, edges, start: 0, accepts };
}

export interface ScannerDfa {
  minDfa: MinDfa;
  /** trans[state][char] = next state. */
  trans: Record<string, Record<string, string>>;
  /** accept[state] = token/class name (highest-priority accepting pattern). */
  accept: Record<string, string>;
  start: string;
}

let cachedDfa: ScannerDfa | null = null;

/** Build (once) the scanner's minimized DFA via the module's own
 *  Thompson → subset construction → minimization pipeline. */
export function getScannerDfa(): ScannerDfa {
  if (cachedDfa) return cachedDfa;
  const nfa = buildCombinedNfa(scannerPatterns());
  const dfa = drain(subsetConstruction(nfa, false));
  const min = drain(minimize(dfa, false));
  const trans: Record<string, Record<string, string>> = {};
  for (const t of min.trans) {
    (trans[t.from] ??= {})[t.symbol] = t.to;
  }
  const accept: Record<string, string> = {};
  for (const s of min.states) if (s.accept) accept[s.id] = s.accept.token;
  cachedDfa = { minDfa: min, trans, accept, start: min.start };
  return cachedDfa;
}

// ---------------------------------------------------------------------------
// The scanner driver
// ---------------------------------------------------------------------------

/** Raw scanner result: a TokenStream (tokens + symbol table) plus the lexical
 *  errors encountered and the source length (for replay projection). */
export interface ScanResult {
  tokens: Token[];
  symbols: LexSymbolEntry[];
  errors: Diagnostic[];
  sourceLength: number;
}

const ESCAPES: Record<string, number> = { n: 10, t: 9, '0': 0, '\\': 92, "'": 39 };

/** One hint for every "unterminated character constant" path, so the three
 *  places that can raise it stay in step (and it states where scanning
 *  resumes — recovery deletes only the malformed prefix, §3.1.4). */
const UNTERMINATED_CHAR_HINT =
  "a character constant must be closed with ' before the end of the line; scanning resumes at the next character";

const SIM: Citation = {
  section: '3.8.3',
  figureOrAlgo: 'Fig 3.54',
  rule: 'simulate the DFA, remembering the last accepting state passed; when the DFA dies, retract the input pointer to that state and emit its token (longest match)',
};
/** Moving the forward pointer along an edge of a hand-written transition
 *  diagram — the charconst automaton (§3.4.1). */
const DIAGRAM: Citation = {
  section: '3.4.1',
  rule: 'each edge of a transition diagram is labelled with the characters that cause the move; the forward pointer advances over every character consumed',
};
/** Reaching an accepting (double-circled) state of that diagram. */
const DIAGRAM_ACCEPT: Citation = {
  section: '3.4.1',
  rule: 'a double-circled state accepts: the pattern has been matched and the lexeme is the input between lexemeBegin and forward',
};
/** Computing / returning a token's attribute value (§3.1.3). */
const ATTR: Citation = {
  section: '3.1.3',
  rule: "a token carries an attribute value computed from its lexeme — for a character constant, the character code the lexeme denotes",
};
const m = (
  cite: Citation,
  prose: string,
  level: 'macro' | 'micro',
  extra?: Partial<StepMeta>,
): StepMeta => ({ cite, prose, level, section: 'Scan', ...extra });

export function* scan(source: string): Steps<ScanEvent, ScanResult> {
  const dfa = getScannerDfa();
  const len = source.length;
  let pos = 0;
  let line = 1;
  let col = 1;
  const tokens: Token[] = [];
  const symbols: LexSymbolEntry[] = [];
  const errors: Diagnostic[] = [];
  const symIdx = new Map<string, number>();
  let attempt = 0;

  const at = (i: number): string => source.charAt(i);
  const bump = (n: number): void => {
    for (let i = 0; i < n; i++) {
      if (at(pos) === '\n') {
        line++;
        col = 1;
      } else col++;
      pos++;
    }
  };
  const mkSpan = (start: number, end: number, l: number, c: number): SourceSpan => ({
    start,
    end,
    line: l,
    col: c,
  });
  const isWs = (c: string): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r';

  const pushError = (message: string, hint: string | null, span: SourceSpan): void => {
    errors.push(lexDiagnostic(message, hint, span));
  };

  const internSymbol = (lexeme: string, sp: SourceSpan): { id: number; isNew: boolean } => {
    const existing = symIdx.get(lexeme);
    if (existing !== undefined) {
      const entry = symbols[existing]!;
      symbols[existing] = { ...entry, occurrences: entry.occurrences + 1 };
      return { id: existing, isNew: false };
    }
    const id = symbols.length;
    symIdx.set(lexeme, id);
    symbols.push({ id, lexeme, firstSeen: sp, occurrences: 1 });
    return { id, isNew: true };
  };

  while (pos < len) {
    const ch = at(pos);

    // ---- whitespace ------------------------------------------------------
    if (isWs(ch)) {
      const sPos = pos;
      const sLine = line;
      const sCol = col;
      while (pos < len && isWs(at(pos))) bump(1);
      const span = mkSpan(sPos, pos, sLine, sCol);
      yield [
        { kind: 'wsSkipped', span, pos },
        m(
          { section: '3.5.2', rule: 'the whitespace pattern has no action and no return: the lexer proceeds to the token following the whitespace' },
          `Skip whitespace (${pos - sPos} character${pos - sPos === 1 ? '' : 's'}): whitespace produces no token.`,
          'macro',
          { srcSpans: [span] },
        ),
      ];
      continue;
    }

    // ---- comments --------------------------------------------------------
    if (ch === '/' && at(pos + 1) === '/') {
      const sPos = pos;
      const sLine = line;
      const sCol = col;
      while (pos < len && at(pos) !== '\n') bump(1);
      const span = mkSpan(sPos, pos, sLine, sCol);
      yield [
        { kind: 'commentSkipped', style: 'line', span, pos },
        m(
          { section: '3.5.2', rule: 'comments, like whitespace, are stripped by the lexical analyzer and produce no token' },
          `Skip line comment '//…' through the end of line ${sLine}.`,
          'macro',
          { srcSpans: [span] },
        ),
      ];
      continue;
    }
    if (ch === '/' && at(pos + 1) === '*') {
      const sPos = pos;
      const sLine = line;
      const sCol = col;
      const close = source.indexOf('*/', pos + 2);
      if (close === -1) {
        bump(len - pos); // consume the rest of the input
        const span = mkSpan(sPos, len, sLine, sCol);
        pushError('unterminated comment', "a comment opened with '/*' must be closed with '*/'", span);
        yield [
          { kind: 'lexError', message: 'unterminated comment', hint: "a comment opened with '/*' must be closed with '*/'", span, pos },
          m(
            { section: '3.1.4', rule: 'few errors are discernible at the lexical level alone; report the error with its position and recover' },
            `Lexical error at line ${sLine}: the block comment opened here is never closed — the rest of the input is swallowed by it.`,
            'macro',
            { srcSpans: [span] },
          ),
        ];
      } else {
        bump(close + 2 - pos);
        const span = mkSpan(sPos, pos, sLine, sCol);
        yield [
          { kind: 'commentSkipped', style: 'block', span, pos },
          m(
            { section: '3.5.2', rule: 'comments, like whitespace, are stripped by the lexical analyzer and produce no token' },
            `Skip block comment '/* … */' (${pos - sPos} characters).`,
            'macro',
            { srcSpans: [span] },
          ),
        ];
      }
      continue;
    }

    // ---- character constants (dedicated hand-rolled automaton, §3.4.4) ---
    if (ch === "'") {
      const gid = `tok${attempt++}`;
      const sPos = pos;
      const sLine = line;
      const sCol = col;
      yield [
        { kind: 'tokenStart', startPos: sPos, dfaState: 'charconst', pos },
        m(
          {
            section: '3.4.4',
            rule: 'a lexical analyzer may be built from a collection of transition diagrams run in sequence, instead of one combined automaton',
          },
          `A quote at line ${sLine} starts a character constant: switch to the dedicated charconst transition diagram.`,
          'micro',
          { groupId: gid },
        ),
      ];
      bump(1);
      yield [
        { kind: 'charStep', stage: 'open', ch: "'", code: null, pos },
        m(DIAGRAM, `Consume the opening quote.`, 'micro', { groupId: gid }),
      ];

      let code: number | null = null;
      let ok = true;
      let msg = '';
      let hint: string | null = null;

      if (pos >= len || at(pos) === '\n') {
        ok = false;
        msg = 'unterminated character constant';
        hint = UNTERMINATED_CHAR_HINT;
      } else if (at(pos) === "'") {
        bump(1); // consume the closing quote of ''
        ok = false;
        msg = 'empty character constant';
        hint = "a character constant must contain exactly one character, e.g. 'a'";
      } else if (at(pos) === '\\') {
        bump(1);
        if (pos >= len || at(pos) === '\n') {
          ok = false;
          msg = 'unterminated character constant';
          hint = UNTERMINATED_CHAR_HINT;
        } else {
          const e = at(pos);
          const mapped = ESCAPES[e];
          bump(1);
          if (mapped === undefined) {
            ok = false;
            msg = `invalid escape sequence '\\${e}'`;
            hint = "valid escapes are \\n \\t \\0 \\\\ and \\'";
            if (pos < len && at(pos) === "'") bump(1); // resync past the closing quote
          } else {
            code = mapped;
            yield [
              { kind: 'charStep', stage: 'escape', ch: e, code: mapped, pos },
              m(
                ATTR,
                `Escape sequence \\${e} denotes character code ${mapped}. (The lab's C subset allows \\n \\t \\0 \\\\ and \\'.)`,
                'micro',
                { groupId: gid },
              ),
            ];
          }
        }
      } else {
        const c0 = at(pos);
        code = c0.charCodeAt(0);
        bump(1);
        yield [
          { kind: 'charStep', stage: 'char', ch: c0, code, pos },
          m(ATTR, `Character '${c0}' has code ${code}.`, 'micro', { groupId: gid }),
        ];
      }

      if (ok) {
        if (pos < len && at(pos) === "'") {
          bump(1);
          yield [
            { kind: 'charStep', stage: 'close', ch: "'", code: null, pos },
            m(DIAGRAM_ACCEPT, `Closing quote found: the character constant is complete.`, 'micro', { groupId: gid }),
          ];
          const span = mkSpan(sPos, pos, sLine, sCol);
          const token: Token = {
            index: tokens.length,
            type: 'charconst',
            lexeme: source.slice(sPos, pos),
            span,
            ...(code !== null ? { value: code } : {}),
          };
          tokens.push(token);
          yield [
            { kind: 'tokenEmitted', token, symbol: null, pos },
            m(
              ATTR,
              `Emit charconst ${token.lexeme} with value ${code}.`,
              'macro',
              { groupId: gid, srcSpans: [span], irRefs: [{ kind: 'token', id: token.index }] },
            ),
          ];
          continue;
        }
        // Look ahead (without consuming) for a closing quote on this line.
        let j = pos;
        while (j < len && at(j) !== '\n' && at(j) !== "'") j++;
        ok = false;
        if (j < len && at(j) === "'") {
          // There IS a closing quote: the constant is a real, over-long one —
          // consume through it so the malformed lexeme is reported once.
          bump(j + 1 - pos);
          msg = 'character constant must contain exactly one character';
          hint = "use a string only where the subset allows it — a charconst holds a single character like 'a' or '\\n'";
        } else {
          // No closing quote on the line. Panic mode (§3.1.4) deletes only as
          // much as it must: keep the malformed prefix consumed so far and
          // rescan from the next character, which may well start a good token.
          // Swallowing to the end of the line would discard well-formed tokens.
          msg = 'unterminated character constant';
          hint = UNTERMINATED_CHAR_HINT;
        }
      }
      const span = mkSpan(sPos, pos, sLine, sCol);
      pushError(msg, hint, span);
      yield [
        { kind: 'lexError', message: msg, hint, span, pos },
        m(
          { section: '3.1.4', rule: 'report the lexical error with its position; recovery: skip the malformed characters and continue' },
          `Lexical error at line ${sLine}, column ${sCol}: ${msg}. Scanning resumes after the malformed constant.`,
          'macro',
          { groupId: gid, srcSpans: [span] },
        ),
      ];
      continue;
    }

    // ---- combined DFA simulation (§3.8.3, Fig 3.54, longest match) -------
    const gid = `tok${attempt++}`;
    const sPos = pos;
    const sLine = line;
    const sCol = col;
    let state = dfa.start;
    let lastAccept: { pos: number; line: number; col: number; token: string; state: string } | null =
      null;
    yield [
      { kind: 'tokenStart', startPos: sPos, dfaState: state, pos },
      m(SIM, `Begin a token at line ${sLine}, column ${sCol}: the combined DFA starts in state ${state}.`, 'micro', {
        groupId: gid,
      }),
    ];
    while (pos < len) {
      const c = at(pos);
      const to = dfa.trans[state]?.[c];
      if (to === undefined) break;
      bump(1);
      const acc = dfa.accept[to] ?? null;
      if (acc !== null) lastAccept = { pos, line, col, token: acc, state: to };
      yield [
        { kind: 'advance', from: state, ch: c, to, accepting: acc, pos },
        m(
          SIM,
          `Advance on '${c}': state ${state} → ${to}.` +
            (acc !== null ? ` ${to} accepts ${acc} — remember this as the last accepting position.` : ''),
          'micro',
          { groupId: gid },
        ),
      ];
      state = to;
    }

    if (lastAccept === null) {
      // No prefix of the remaining input forms a token.
      const scanned = source.slice(sPos, Math.max(pos, sPos + 1));
      pos = sPos + 1;
      line = sLine;
      col = sCol + 1;
      const span = mkSpan(sPos, sPos + 1, sLine, sCol);
      const c0 = at(sPos);
      let msg: string;
      let hint: string | null = null;
      if (scanned.length > 1 || dfa.trans[dfa.start]?.[c0] !== undefined) {
        msg = `'${scanned}' does not form a token`;
        if (c0 === '|') hint = "logical OR is spelled '||' — there is no single '|' operator in the C subset";
      } else {
        msg = `character '${c0}' does not begin any token`;
        if (c0 === '.') hint = "there is no lone '.' token — floating constants need digits on both sides, e.g. 12.5";
      }
      pushError(msg, hint, span);
      yield [
        { kind: 'lexError', message: msg, hint, span, pos },
        m(
          { section: '3.1.4', rule: 'the simplest recovery strategy is panic mode: delete one character from the remaining input and continue' },
          `Lexical error at line ${sLine}, column ${sCol}: ${msg}. Recovery deletes one character and rescans.`,
          'macro',
          { groupId: gid, srcSpans: [span] },
        ),
      ];
      continue;
    }

    if (lastAccept.pos < pos) {
      const from = pos;
      // The loop ends either because no edge is labelled with the character AT
      // `from`, or because the input ran out. Both retract, but they are
      // different events in Fig 3.54 and the student should see which happened.
      const ranOut = from >= len;
      const deadState = state;
      pos = lastAccept.pos;
      line = lastAccept.line;
      col = lastAccept.col;
      yield [
        {
          kind: 'rollback',
          fromPos: from,
          toPos: pos,
          token: lastAccept.token,
          toState: lastAccept.state,
          reason: ranOut ? 'endOfInput' : 'noTransition',
          pos,
        },
        m(
          SIM,
          (ranOut
            ? `The input ends at position ${from} with the DFA in state ${deadState}, which does not accept:`
            : `State ${deadState} has no transition on '${at(from)}' (position ${from}) and does not accept:`) +
            ` retract the forward pointer to ${pos}, back to state ${lastAccept.state} — the last accepting state passed (${lastAccept.token}).`,
          'micro',
          { groupId: gid },
        ),
      ];
    }

    const lexeme = source.slice(sPos, pos);
    const span = mkSpan(sPos, pos, sLine, sCol);
    let type = lastAccept.token as TokenType;
    let symbol: { id: number; lexeme: string; isNew: boolean } | null = null;
    if (lastAccept.token === 'id') {
      const isKeyword = KEYWORDS.has(lexeme);
      yield [
        { kind: 'keywordLookup', lexeme, isKeyword, pos },
        m(
          {
            section: '3.4.2',
            rule: 'keywords are reserved words: recognize them as identifiers, then consult the keyword table to decide whether an identifier or a keyword token is returned',
          },
          isKeyword
            ? `'${lexeme}' is in the keyword table: it is the reserved word ${lexeme}, not an identifier.`
            : `'${lexeme}' is not in the keyword table: it is an ordinary identifier.`,
          'micro',
          { groupId: gid, srcSpans: [span] },
        ),
      ];
      if (isKeyword) type = lexeme as TokenType;
      else {
        const s = internSymbol(lexeme, span);
        symbol = { id: s.id, lexeme, isNew: s.isNew };
      }
    }
    const token: Token = {
      index: tokens.length,
      type,
      lexeme,
      span,
      ...(symbol !== null ? { symbolId: symbol.id } : {}),
      ...(lastAccept.token === 'intconst' ? { value: parseInt(lexeme, 10) } : {}),
      ...(lastAccept.token === 'floatconst' ? { value: parseFloat(lexeme) } : {}),
    };
    tokens.push(token);
    yield [
      { kind: 'tokenEmitted', token, symbol, pos },
      m(
        SIM,
        `Emit ${String(token.type)} '${lexeme}' (longest match, ${lexeme.length} character${lexeme.length === 1 ? '' : 's'})` +
          (symbol !== null
            ? symbol.isNew
              ? `; new symbol-table entry #${symbol.id}.`
              : `; symbol-table entry #${symbol.id} sees another occurrence.`
            : '.'),
        'macro',
        { groupId: gid, srcSpans: [span], irRefs: [{ kind: 'token', id: token.index }] },
      ),
    ];
  }

  yield [
    { kind: 'done', pos: len },
    m(
      {
        section: '3.1.1',
        figureOrAlgo: 'Fig 3.1',
        rule: 'the lexical analyzer returns a token to the parser on each getNextToken call, until the input is exhausted',
      },
      `End of input: ${tokens.length} tokens, ${symbols.length} symbol-table entries, ${errors.length} lexical error${errors.length === 1 ? '' : 's'}.`,
      'macro',
      { section: 'End' },
    ),
  ];

  return { tokens, symbols, errors, sourceLength: len };
}

/** Convenience: record a scan trace. */
export function runScan(source: string, id = 'lex.scan'): Recorded<ScanState, ScanEvent, ScanResult> {
  return record(() => scan(source), initialScanState(), scanReducer, { id });
}

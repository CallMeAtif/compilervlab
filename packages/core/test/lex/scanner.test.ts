/**
 * Scanner tests: keywords vs identifiers (§3.4.2 reserved words), longest
 * match (§3.8.3, Fig 3.54), char constants with escapes, comments, symbol
 * table, and lexical errors with positions.
 */
import { describe, expect, it } from 'vitest';
import { initialScanState, scanReducer, type ScanState } from '../../src/lex/reducers.js';
import { getScannerDfa, runScan } from '../../src/lex/scanner.js';

const scan = (src: string) => runScan(src).result;
const types = (src: string) => scan(src).tokens.map((t) => t.type);

describe('scanner: keywords vs identifiers (§3.4.2)', () => {
  it('scans keywords as identifiers, then reclassifies via the keyword table', () => {
    const r = scan('int x; float y2; return;');
    expect(r.tokens.map((t) => t.type)).toEqual(['int', 'id', ';', 'float', 'id', ';', 'return', ';']);
    expect(r.errors).toEqual([]);
    // keywords get no symbol-table entry
    expect(r.symbols.map((s) => s.lexeme)).toEqual(['x', 'y2']);
    expect(r.tokens[0]!.symbolId).toBeUndefined();
    expect(r.tokens[1]!.symbolId).toBe(0);
  });

  it('does not treat a keyword prefix as a keyword (longest match first)', () => {
    const r = scan('if ifx iffy else elsewhere');
    expect(r.tokens.map((t) => [t.type, t.lexeme])).toEqual([
      ['if', 'if'],
      ['id', 'ifx'],
      ['id', 'iffy'],
      ['else', 'else'],
      ['id', 'elsewhere'],
    ]);
  });

  it('treats underscore as a letter', () => {
    const r = scan('_tmp1 int_');
    expect(r.tokens.map((t) => [t.type, t.lexeme])).toEqual([
      ['id', '_tmp1'],
      ['id', 'int_'],
    ]);
  });
});

describe('scanner: longest match and numeric constants (§3.8.3)', () => {
  it('scans 12.5 as ONE floatconst', () => {
    const r = scan('12.5');
    expect(r.tokens).toHaveLength(1);
    expect(r.tokens[0]).toMatchObject({ type: 'floatconst', lexeme: '12.5', value: 12.5 });
    expect(r.errors).toEqual([]);
  });

  it("rejects a lone '.' — '12 . 5' is intconst, error, intconst", () => {
    const r = scan('12 . 5');
    expect(r.tokens.map((t) => [t.type, t.value])).toEqual([
      ['intconst', 12],
      ['intconst', 5],
    ]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.span).toEqual({ start: 3, end: 4, line: 1, col: 4 });
    expect(r.errors[0]!.message).toContain("'.'");
  });

  it('rolls back to the last accepting state: 12. followed by non-digit', () => {
    const { trace, result } = runScan('12.x');
    expect(result.tokens.map((t) => [t.type, t.lexeme])).toEqual([
      ['intconst', '12'],
      ['id', 'x'],
    ]);
    expect(result.errors).toHaveLength(1); // the stranded '.'
    const rb = trace.steps.find((s) => s.event.kind === 'rollback')!.event;
    expect(rb).toMatchObject({ kind: 'rollback', fromPos: 3, toPos: 2, token: 'intconst' });
  });

  it('scans multi-char operators by longest match', () => {
    expect(types('a<=b!=c&&d||e==f>=g')).toEqual(['id', '<=', 'id', '!=', 'id', '&&', 'id', '||', 'id', '==', 'id', '>=', 'id']);
    expect(types('a<b>c=d&e!f')).toEqual(['id', '<', 'id', '>', 'id', '=', 'id', '&', 'id', '!', 'id']);
  });

  it('splits 12abc into intconst then id (maximal munch per class)', () => {
    expect(scan('12abc').tokens.map((t) => [t.type, t.lexeme])).toEqual([
      ['intconst', '12'],
      ['id', 'abc'],
    ]);
  });
});

describe('scanner: character constants (§3.4.4 dedicated diagram)', () => {
  it('scans plain and escaped character constants with values', () => {
    const r = scan("'a' '\\n' '\\t' '\\0' '\\\\' '\\''");
    expect(r.tokens.map((t) => t.type)).toEqual(Array(6).fill('charconst'));
    expect(r.tokens.map((t) => t.value)).toEqual([97, 10, 9, 0, 92, 39]);
    expect(r.errors).toEqual([]);
  });

  it('reports an unterminated character constant at end of line', () => {
    const r = scan("'a\nx");
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.message).toBe('unterminated character constant');
    expect(r.errors[0]!.span.line).toBe(1);
    expect(r.tokens.map((t) => t.type)).toEqual(['id']); // scanning resumed with x
  });

  it('reports an empty character constant', () => {
    const r = scan("''");
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.message).toBe('empty character constant');
  });

  it('reports an invalid escape sequence', () => {
    const r = scan("'\\q' x");
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.message).toContain('invalid escape');
    expect(r.tokens.map((t) => t.lexeme)).toEqual(['x']);
  });

  it('reports a multi-character constant once and resyncs past it', () => {
    const r = scan("'ab' x");
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.message).toBe('character constant must contain exactly one character');
    expect(r.tokens.map((t) => t.lexeme)).toEqual(['x']);
  });
});

describe('scanner: comments and whitespace', () => {
  it('skips line comments', () => {
    const r = scan('a // rest is comment ;;;\nb');
    expect(r.tokens.map((t) => t.lexeme)).toEqual(['a', 'b']);
    expect(r.errors).toEqual([]);
  });

  it('skips block comments, including multi-line ones', () => {
    const r = scan('a /* one\ntwo */ b');
    expect(r.tokens.map((t) => t.lexeme)).toEqual(['a', 'b']);
    expect(r.tokens[1]!.span).toEqual({ start: 16, end: 17, line: 2, col: 8 });
  });

  it('reports an unterminated block comment with the opening position', () => {
    const r = scan('a /* never closed');
    expect(r.tokens.map((t) => t.lexeme)).toEqual(['a']);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.message).toBe('unterminated comment');
    expect(r.errors[0]!.span).toEqual({ start: 2, end: 17, line: 1, col: 3 });
  });

  it('comments do not nest and // inside /* */ is inert', () => {
    expect(types('/* // still block */ x')).toEqual(['id']);
  });
});

describe('scanner: symbol table', () => {
  it('counts occurrences and reuses entries per distinct lexeme', () => {
    const r = scan('x = x + y; y = x;');
    expect(r.symbols).toEqual([
      { id: 0, lexeme: 'x', firstSeen: { start: 0, end: 1, line: 1, col: 1 }, occurrences: 3 },
      { id: 1, lexeme: 'y', firstSeen: { start: 8, end: 9, line: 1, col: 9 }, occurrences: 2 },
    ]);
    const xTokens = r.tokens.filter((t) => t.lexeme === 'x');
    expect(xTokens.map((t) => t.symbolId)).toEqual([0, 0, 0]);
  });
});

describe('scanner: lexical errors and recovery (§3.1.4)', () => {
  it('reports an illegal character with line/column and skips it', () => {
    const r = scan('int\n@x');
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.span).toEqual({ start: 4, end: 5, line: 2, col: 1 });
    expect(r.errors[0]!.message).toContain("'@'");
    expect(r.tokens.map((t) => t.type)).toEqual(['int', 'id']); // recovery: skip @, rescan
  });

  it("flags a single '|' with an educational hint about '||'", () => {
    const r = scan('a | b');
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.hint).toContain("'||'");
    expect(r.tokens.map((t) => t.type)).toEqual(['id', 'id']);
  });

  it('records exact token spans', () => {
    const r = scan('x=12;');
    expect(r.tokens.map((t) => t.span)).toEqual([
      { start: 0, end: 1, line: 1, col: 1 },
      { start: 1, end: 2, line: 1, col: 2 },
      { start: 2, end: 4, line: 1, col: 3 },
      { start: 4, end: 5, line: 1, col: 5 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Regressions
// ---------------------------------------------------------------------------

const stepsOf = (src: string) => runScan(src).trace.steps;

describe('scanner: every step is anchored to the section that states its rule', () => {
  it('the DFA-simulation steps cite §3.8.3 / Fig 3.54 (not the §3.8.1 architecture picture)', () => {
    const sim = stepsOf('12.5 + x').filter((s) =>
      ['tokenStart', 'advance', 'rollback', 'tokenEmitted'].includes(s.event.kind),
    );
    expect(sim.length).toBeGreaterThan(3);
    for (const s of sim) {
      expect(s.meta.cite.section, `${s.event.kind} @${s.index}`).toBe('3.8.3');
      expect(s.meta.cite.figureOrAlgo, `${s.event.kind} @${s.index}`).toBe('Fig 3.54');
    }
  });

  it('the keyword-table lookup cites §3.4.2 (recognition of reserved words)', () => {
    const kw = stepsOf('int x').find((s) => s.event.kind === 'keywordLookup')!;
    expect(kw.meta.cite.section).toBe('3.4.2');
    expect(kw.meta.cite.rule).toContain('keyword table');
  });

  it('the end-of-input step cites the lexer/parser interaction of §3.1.1 (Fig 3.1)', () => {
    const done = stepsOf('x').at(-1)!;
    expect(done.event.kind).toBe('done');
    expect(done.meta.cite).toMatchObject({ section: '3.1.1', figureOrAlgo: 'Fig 3.1' });
  });

  it('no character-constant step attributes its content to §3.8, and each carries a rule', () => {
    const steps = stepsOf("'\\n' 'a'");
    expect(steps.length).toBeGreaterThan(4);
    for (const s of steps) {
      expect(s.meta.cite.section, `${s.event.kind}: ${s.meta.prose}`).not.toBe('3.8');
    }
    // "return the token with its attribute value" is §3.1.3.
    const emit = steps.find((s) => s.event.kind === 'tokenEmitted')!;
    expect(emit.meta.cite.section).toBe('3.1.3');
  });

  it('every scan step carries a rule the student can check, not a bare section number', () => {
    for (const s of stepsOf("int x = 12.5; // c\n'a' @ 'ab' 12.x")) {
      expect(s.meta.cite.rule?.trim(), `${s.event.kind} @${s.index} cites only a section`).toBeTruthy();
    }
  });
});

describe('scanner: retraction leaves the DFA in the state it backed up to (§3.8.3)', () => {
  const replay = (src: string) => {
    const steps = stepsOf(src);
    let st: ScanState = initialScanState();
    return steps.map((s) => {
      st = scanReducer(st, s.event);
      return { event: s.event, state: st };
    });
  };

  it('the replayed state after a rollback is the last accepting state, not the dead end', () => {
    const dfa = getScannerDfa();
    for (const src of ['12.x', '12.', '1..2']) {
      const trace = replay(src);
      const i = trace.findIndex((r) => r.event.kind === 'rollback');
      expect(i, src).toBeGreaterThan(0);
      const rb = trace[i]!.event;
      const prev = trace[i - 1]!.event;
      if (rb.kind !== 'rollback' || prev.kind !== 'advance') throw new Error(`unexpected shape: ${src}`);
      const cur = trace[i]!.state.current!;
      // The machine is in a state that really accepts the token being emitted…
      expect(cur.dfaState, src).toBe(rb.toState);
      expect(dfa.accept[cur.dfaState], src).toBe(rb.token);
      // …and NOT in the state the simulation stopped in.
      expect(cur.dfaState, src).not.toBe(prev.to);
      // The forward pointer and the lexeme agree with it.
      expect(trace[i]!.state.pos, src).toBe(rb.toPos);
      expect(cur.lexeme.length, src).toBe(rb.toPos - cur.startPos);
    }
  });

  it('distinguishes a missing transition from the end of the input', () => {
    const dead = stepsOf('12.x').find((s) => s.event.kind === 'rollback')!;
    const eof = stepsOf('12.').find((s) => s.event.kind === 'rollback')!;
    expect(dead.event).toMatchObject({ kind: 'rollback', reason: 'noTransition' });
    expect(eof.event).toMatchObject({ kind: 'rollback', reason: 'endOfInput' });
    expect(dead.meta.prose).toContain("no transition on 'x'");
    expect(eof.meta.prose).toContain('input ends');
    expect(eof.meta.prose).not.toContain('no transition');
  });
});

describe('scanner: recovery deletes only the malformed prefix (§3.1.4 panic mode)', () => {
  it('an unterminated character constant does not swallow the following tokens', () => {
    const r = scan("x = 'a b; y = 1;");
    expect(r.tokens.map((t) => t.lexeme)).toEqual(['x', '=', 'b', ';', 'y', '=', '1', ';']);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.message).toBe('unterminated character constant');
    expect(r.errors[0]!.span).toEqual({ start: 4, end: 6, line: 1, col: 5 });
  });

  it('keeps the identifier that follows a stray quote', () => {
    const r = scan("x ' y");
    expect(r.tokens.map((t) => t.lexeme)).toEqual(['x', 'y']);
    expect(r.errors.map((e) => e.message)).toEqual(['unterminated character constant']);
  });

  it('still consumes through the closing quote of a genuinely over-long constant', () => {
    const r = scan("'ab' x");
    expect(r.errors.map((e) => e.message)).toEqual([
      'character constant must contain exactly one character',
    ]);
    expect(r.tokens.map((t) => t.lexeme)).toEqual(['x']);
  });
});

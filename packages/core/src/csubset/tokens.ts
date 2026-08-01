import type { SourceSpan } from '../common/types.js';

/** Token types of the C subset. Names double as terminal names in the grammar. */
export type TokenType =
  // keywords
  | 'int' | 'float' | 'char' | 'void'
  | 'if' | 'else' | 'while' | 'for' | 'return'
  // identifiers & constants
  | 'id' | 'intconst' | 'floatconst' | 'charconst'
  // operators & punctuation
  | '+' | '-' | '*' | '/' | '%'
  | '=' | '==' | '!=' | '<' | '>' | '<=' | '>='
  | '&&' | '||' | '!' | '&'
  | '(' | ')' | '{' | '}' | '[' | ']'
  | ';' | ','
  // end of input (synthesized, not produced by the scanner)
  | '$';

export interface Token {
  index: number; // position in the token stream
  type: TokenType;
  lexeme: string;
  span: SourceSpan;
  /** For id tokens: index into LexSymbolTable.entries. */
  symbolId?: number;
  /** Constant value for intconst/floatconst/charconst. */
  value?: number;
}

/** The lexer's symbol table: one entry per distinct identifier lexeme. */
export interface LexSymbolEntry {
  id: number;
  lexeme: string;
  firstSeen: SourceSpan;
  occurrences: number;
}

export interface TokenStream {
  tokens: Token[];
  symbols: LexSymbolEntry[];
}

export const KEYWORDS: ReadonlySet<string> = new Set([
  'int', 'float', 'char', 'void', 'if', 'else', 'while', 'for', 'return',
]);

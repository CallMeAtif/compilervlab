/**
 * The C-subset grammar (crafted to be LALR(1) apart from the intentional
 * dangling-else shift/reduce conflict, resolved by shift per §4.8.2) plus the
 * Dragon Book study grammars used to reproduce published tables exactly.
 */
import { grammarFromRules, type Grammar } from '../grammar/grammar.js';

const C_TERMINALS = [
  'int', 'float', 'char', 'void', 'if', 'else', 'while', 'for', 'return',
  'id', 'intconst', 'floatconst', 'charconst',
  '+', '-', '*', '/', '%', '=', '==', '!=', '<', '>', '<=', '>=',
  '&&', '||', '!', '&', '(', ')', '{', '}', '[', ']', ';', ',',
];

/** Production rules of the pipeline grammar. Expression precedence is encoded
 *  by stratification (§4.3.1); assignment mirrors ANSI C's
 *  unary-expression '=' assignment-expression shape. */
export const C_GRAMMAR_RULES: string[] = [
  "Program -> DeclList",
  "DeclList -> DeclList ExternalDecl | ExternalDecl",
  "ExternalDecl -> FuncDef | VarDecl",
  "TypeSpec -> int | float | char | void",
  "FuncDef -> TypeSpec id ( ParamListOpt ) CompoundStmt",
  "ParamListOpt -> ParamList | ε",
  "ParamList -> ParamList , Param | Param",
  "Param -> TypeSpec Declarator",
  "VarDecl -> TypeSpec InitDeclList ;",
  "InitDeclList -> InitDeclList , InitDecl | InitDecl",
  "InitDecl -> Declarator | Declarator = AssignExpr",
  "Declarator -> * Declarator | DirectDecl",
  "DirectDecl -> id | id [ intconst ] | id [ ]",
  "CompoundStmt -> { BlockItemList } | { }",
  "BlockItemList -> BlockItemList BlockItem | BlockItem",
  "BlockItem -> VarDecl | Stmt",
  "Stmt -> ExprStmt | CompoundStmt | IfStmt | WhileStmt | ForStmt | ReturnStmt",
  "ExprStmt -> Expr ; | ;",
  "IfStmt -> if ( Expr ) Stmt | if ( Expr ) Stmt else Stmt",
  "WhileStmt -> while ( Expr ) Stmt",
  "ForStmt -> for ( ExprOpt ; ExprOpt ; ExprOpt ) Stmt",
  "ExprOpt -> Expr | ε",
  "ReturnStmt -> return Expr ; | return ;",
  "Expr -> AssignExpr",
  "AssignExpr -> UnaryExpr = AssignExpr | OrExpr",
  // NOTE: grammarFromRules splits alternatives on '|', so the two-character
  // terminal '||' cannot appear literally in a rule string (it would parse as
  // two empty alternatives). OROR is a placeholder that cGrammar() rewrites
  // to the real '||' terminal; the language is unchanged.
  "OrExpr -> OrExpr OROR AndExpr | AndExpr",
  "AndExpr -> AndExpr && EqExpr | EqExpr",
  "EqExpr -> EqExpr == RelExpr | EqExpr != RelExpr | RelExpr",
  "RelExpr -> RelExpr < AddExpr | RelExpr > AddExpr | RelExpr <= AddExpr | RelExpr >= AddExpr | AddExpr",
  "AddExpr -> AddExpr + MulExpr | AddExpr - MulExpr | MulExpr",
  "MulExpr -> MulExpr * UnaryExpr | MulExpr / UnaryExpr | MulExpr % UnaryExpr | UnaryExpr",
  "UnaryExpr -> PostfixExpr | - UnaryExpr | ! UnaryExpr | * UnaryExpr | & UnaryExpr",
  "PostfixExpr -> PrimaryExpr | PostfixExpr [ Expr ]",
  "PrimaryExpr -> id | intconst | floatconst | charconst | ( Expr ) | id ( ArgListOpt )",
  "ArgListOpt -> ArgList | ε",
  "ArgList -> ArgList , AssignExpr | AssignExpr",
];

export function cGrammar(): Grammar {
  const g = grammarFromRules('C subset', C_GRAMMAR_RULES, C_TERMINALS);
  // Restore the '||' terminal hidden behind the OROR placeholder (see note in
  // C_GRAMMAR_RULES: '|' is the alternative separator of the rule syntax).
  for (const p of g.productions) {
    p.rhs = p.rhs.map((s) => (s === 'OROR' ? '||' : s));
  }
  return g;
}

// ── Dragon Book study grammars ───────────────────────────────────────────────

/** Grammar 4.1 / 4.34 — the expression grammar used for the SLR running example
 *  (canonical LR(0) collection Fig 4.31, SLR table Fig 4.37). */
export function grammar41(): Grammar {
  return grammarFromRules('Dragon 4.1 (expressions)', [
    'E -> E + T | T',
    'T -> T * F | F',
    'F -> ( E ) | id',
  ], ['+', '*', '(', ')', 'id']);
}

/** Grammar 4.28 — the non-left-recursive expression grammar used for the LL(1)
 *  running example (FIRST/FOLLOW of Example 4.30, LL(1) table Fig 4.17). */
export function grammar428(): Grammar {
  return grammarFromRules("Dragon 4.28 (LL(1) expressions)", [
    "E -> T E'",
    "E' -> + T E' | ε",
    "T -> F T'",
    "T' -> * F T' | ε",
    'F -> ( E ) | id',
  ], ['+', '*', '(', ')', 'id']);
}

/** Grammar 4.55 — used for the canonical LR(1) and LALR examples
 *  (item sets Fig 4.41, tables Fig 4.42/4.43). */
export function grammar455(): Grammar {
  return grammarFromRules('Dragon 4.55 (LR(1)/LALR)', [
    'S -> C C',
    'C -> c C | d',
  ], ['c', 'd']);
}

export const STUDY_GRAMMARS: Record<string, () => Grammar> = {
  'c-subset': cGrammar,
  'dragon-4.1': grammar41,
  'dragon-4.28': grammar428,
  'dragon-4.55': grammar455,
};

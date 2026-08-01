# The Lab's C Subset — Language Rules (mini-spec)

This is the normative reference for the semantic-analysis and IR phases. Constructs outside this
subset produce the pedagogical diagnostic "not in the lab's C subset", never a crash.

## Lexical
- Tokens per `core/src/csubset/tokens.ts`. Keywords are reserved words: scanned as identifiers,
  then looked up in the keyword table (Dragon Book §3.4.2 approach).
- `intconst`: `digit+`. `floatconst`: `digit+ . digit+`. `charconst`: `'x'` and escapes
  `'\n' '\t' '\0' '\\' '\''`. Identifiers: `letter (letter|digit)*` with `_` as a letter.
- Comments `//…` and `/*…*/` and whitespace are skipped (no tokens). Unterminated block comment,
  unterminated char constant, and any character not starting a token are lexical errors with position.
- Longest match wins; ties broken by rule priority (keyword table beats nothing else — classes
  are disjoint otherwise).

## Grammar
`core/src/csubset/grammar-def.ts` is normative. Notes:
- Dangling else: genuine shift/reduce conflict, resolved by **shift** (else binds to nearest if),
  shown educationally (§4.8.2).
- Assignment target is grammatically a `UnaryExpr`; semantic analysis enforces l-valueness.
- No typedefs, casts, structs, unions, `++/--`, comma operator, function pointers, multi-dim arrays.

## Types and typing rules
Types: `int`, `float`, `char`, `void` (function returns only), `T*`, `T[n]`.

1. **Arithmetic `+ - * / %`**: operands must be arithmetic (`int`, `float`, `char`).
   `char` promotes to `int`. If either operand is `float`, the other is converted via an explicit
   `inttofloat` conversion node (§6.5.2 widening); result `float`, else `int`.
   `%` requires integer operands.
2. **Relational / equality**: arithmetic operands (same promotion rules), or two pointers of
   identical type (`==`/`!=` only). Result `int` (0/1).
3. **Logical `&& || !`**: operands are scalars (arithmetic or pointer); result `int` (0/1);
   short-circuit evaluation (jumping code, §6.6).
4. **Assignment**: target must be an l-value (identifier, `*e`, `a[i]`); types must match after
   promotions; `int↔float` converts (float→int is an error in the subset — no narrowing);
   pointer assignment requires identical pointer types. Arrays are not assignable.
5. **Pointers**: `&e` requires l-value `e`, yields `T*`; `*e` requires `T*`, yields l-value `T`.
   No pointer arithmetic in the subset (error with hint).
6. **Arrays**: `a[i]` requires `a : T[n]` or `T*`, `i : int/char`; yields l-value `T`.
   In expressions (except `&a` and declarations), `T[n]` decays to `T*` for parameter passing.
7. **Calls**: callee must be a declared function; arity must match; each argument must be
   assignable to the parameter type (same rules as assignment). `void` functions cannot be used
   as values.
8. **Return**: expression must be assignable to the function's return type; `return;` only in
   `void` functions; non-void functions must return a value on the paths we check (missing return
   is a warning, not an error).
9. **Conditions** (`if/while/for`): any scalar; compared ≠ 0.

## Scoping
- One global scope; each function creates a scope (params live there); each `{}` block nests.
- Declaration before use, everywhere. Redeclaration in the same scope is an error;
  shadowing in inner scopes is legal (lookup walks the chain, §2.7).
- Functions are declarable only at top level; no nested functions, no forward prototypes
  (call-before-definition is an error).

## Storage and initializers
- A global is allocated statically: its cell exists for the whole run and already holds its
  initial value before `main` starts (§7.1), so no instruction is generated for it. Its
  initializer must therefore be a *constant expression* — literals and the subset's operators
  applied to them; anything else (a name, a call, `a[i]`) is an error.
- A global without an initializer starts at 0. Local initializers are ordinary assignments and
  may be any expression.

## Evaluation semantics (for the TAC/asm interpreters — the test oracles)
- `int`/`char` are 64-bit in the interpreters (no overflow modeling); `float` is IEEE double.
- Division by zero: runtime error surfaced in the "run" panel.
- Uninitialized variables read 0 (deterministic for testing).
- The entry point is `main` (no arguments); its return value is the program result.

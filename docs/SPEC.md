# Compiler Virtual Lab — Product & Engineering Specification

An interactive web application that accepts **C source code** (a well-defined subset) and walks
the user through **every phase of compilation**, with step-by-step navigation inside each phase.
Everything runs **fully client-side in TypeScript** — a real working compiler pipeline, not a mock.

## Supported C subset (minimum)
- Declarations; `int`, `float`, `char` types (plus `void` for functions)
- Arithmetic / relational / logical expressions, assignment, unary ops
- `if` / `else`, `while`, `for`, `return`, blocks/scopes
- Functions (definition + calls), arrays (declaration + indexing), pointers (`*`, `&`, deref)

## The six phases (each a navigable page/tab with next / prev / play / reset / jump-to-step)

1. **Lexical Analysis**
   - Tokenization with visible DFA simulation over the source.
   - Regex → NFA (Thompson's construction) → DFA (subset construction) → minimized DFA
     (Hopcroft / partition refinement), each construction step-through.
   - Token stream, symbol table entries, lexical errors with line/col positions.

2. **Syntax Analysis** — user-selectable algorithms, each fully animated:
   - FIRST/FOLLOW computation (step by step, fixpoint iterations visible)
   - LL(1): parsing table construction + stack-based parse trace
   - Recursive descent (call-tree visualization)
   - LR(0) and SLR(1): canonical collection of item sets, GOTO graph, ACTION/GOTO tables
   - Canonical LR(1) and LALR(1): item sets with lookaheads, state merging
   - Live parse tree / derivation construction; conflict detection with explanations.

3. **Semantic Analysis**
   - Scoped symbol table construction visualized as nested scopes.
   - Type checking with error highlighting; annotated AST / attribute evaluation.

4. **Intermediate Code Generation**
   - Three-address code: quadruples, triples, indirect triples views.
   - AST → TAC translation step by step (show which AST node emits which instruction).

5. **Code Optimization**
   - Basic block partitioning (leader identification), CFG rendering.
   - Step-through of: constant folding, constant propagation, copy propagation,
     common subexpression elimination, dead code elimination, loop-invariant code motion.
   - Before/after IR diffs per optimization step.

6. **Code Generation**
   - Instruction selection to x86-64 (or MIPS) subset.
   - Register allocation via graph coloring: show interference graph construction
     (liveness analysis) and coloring steps; spilling if needed.
   - Final assembly output.

## Cross-cutting requirements
- Pipeline overview screen: output of each phase feeds the next; click any stage to deep-link.
  The same source program's artifacts must be consistent across all phases (single compilation
  drives all views).
- Preloaded example C programs + free-form editor (CodeMirror or Monaco) with C highlighting.
- Errors shown educationally: what rule failed, where, why.
- Algorithms must match the Dragon Book (Aho/Lam/Sethi/Ullman) definitions exactly.
  No approximated behavior, no hallucinated states/tables/transitions.
- Dark/light themes; responsive layout; graphs laid out via a proper graph layout library.

## Acceptance criteria
- All six phases implemented with working step-through navigation and all listed algorithms
  selectable where multiple exist.
- A sample program (function with a loop and if/else) flows through all phases with consistent,
  correct artifacts at each stage.
- Textbook verification examples pass (Dragon Book grammars 4.28 for LL(1), 4.1 expression
  grammar for SLR, grammar 4.55 for LR(1)/LALR, published FIRST/FOLLOW sets and tables).
- All unit + integration tests green; app builds and runs with a single documented command.
- README documents architecture, C subset, and textbook mapping of each visualization.

## Tooling constraints
- UI styling: Tailwind CSS + shadcn/ui-style components (21st.dev MCP unavailable).
- Design guidance: UI/UX Pro Max skill installed at `.claude/skills/ui-ux-pro-max`.

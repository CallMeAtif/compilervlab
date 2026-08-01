# Textbook Map — the lab ↔ the Dragon Book

<!-- GENERATED FILE — do not edit by hand. Regenerate with:
     pnpm exec jiti scripts/gen-textbook-map.ts
-->

Every step of every visualization in this lab carries a **mandatory citation** into
*Compilers: Principles, Techniques, & Tools* (Aho, Lam, Sethi & Ullman, 2nd ed.) — the
`cite: Citation` field of `StepMeta` in `packages/trace/src/trace.ts`. An unciteable step is
treated as a design smell, so the citations are a complete index of what the lab teaches.

**This file is generated from those citations, not written by hand.**
`scripts/gen-textbook-map.ts` builds every trace the compile worker can produce (through the
same `packages/app/src/worker/registry.ts` the app uses), reads the `cite` of every recorded
step, and prints what it found. Documentation generated this way cannot drift away from the
code: change an algorithm’s citation and the next run of the script changes this file.

Regenerate:

```bash
pnpm exec jiti scripts/gen-textbook-map.ts          # rewrite docs/TEXTBOOK-MAP.md
pnpm exec jiti scripts/gen-textbook-map.ts --check  # CI: fail if the committed file is stale
```

Snapshot of this run: **52 traces** built from **26 trace kinds**, **261,309 recorded steps**, **59 distinct Dragon Book sections** cited, **0 steps without a citation**.

---

## Lexical Analysis — `/lex`

Regular expressions → NFA → DFA → minimized DFA, then the DFA-driven scanner on your source.

| Trace kind | What the visualization shows | Dragon Book anchors (from the code) |
| --- | --- | --- |
| `lex.thompson` | Thompson construction: one token-class regex → an NFA, one fragment per step. | §3.7.4 · Algorithm 3.23 |
| `lex.subset` | Subset construction: the token class’s Thompson NFA → a DFA, one Dstate per step. | §3.7.1 · Fig 3.33<br>§3.7.1 · Algorithm 3.20 |
| `lex.minimize` | Partition refinement of the token class’s DFA into the minimum-state DFA. | §3.9.6 · Algorithm 3.39<br>§3.9.7 · Algorithm 3.39 |
| `lex.scan` | The scanner driver on the real source: longest match with retraction, keyword lookup, symbol-table interning, lexical errors. | §3.8.3 · Fig 3.54<br>§3.5.2<br>§3.4.2<br>§3.1.1 · Fig 3.1<br>§3.1.4 |

### `lex.thompson`

Thompson construction: one token-class regex → an NFA, one fragment per step.

*Manifest anchor* (`trace-kinds.ts`): §3.7.4, Algorithm 3.23 (Fig 3.34)

**Traced as** classIndex=1 (intconst) → `lex.thompson.intconst`, 41 steps 

Step sections: `Thompson construction`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §3.7.4 · Algorithm 3.23 | 41 | “basis: for subexpression a build N(a) with a single a-transition from a new start to a new accepting state”<br>“induction: for s\|t, add a new start with ε-transitions to the starts of N(s) and N(t) and a new accepting state with ε-transitions from their accepting states”<br>“induction: for s*, add a new start and accepting state with ε-transitions allowing zero or more passes through N(s)”<br>…and 2 more rule text(s) |

### `lex.subset`

Subset construction: the token class’s Thompson NFA → a DFA, one Dstate per step.

*Manifest anchor* (`trace-kinds.ts`): §3.7.1, Algorithm 3.20 (Fig 3.36/3.37)

**Traced as** classIndex=1 (intconst) → `lex.subset.intconst`, 11,380 steps 

Step sections: `Start state` · `Process A` · `Process B` · `Process C` · `Process D` · `Process E` · `Process F` · `Process G` · `Process H` · `Process I` · …and 13 more

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §3.7.1 · Fig 3.33 | 11,126 | “push all states of T onto stack; while stack not empty: pop t; for each u with an ε-edge from t not yet in ε-closure(T), add u and push it” |
| §3.7.1 · Algorithm 3.20 | 254 | “while there is an unmarked state T in Dstates: mark T; for each input symbol a, U := ε-closure(move(T, a)); add U to Dstates if new; Dtran[T, a] := U” |

**Traced as** classIndex=0 (identifier — 53-way `letter`, blows the 200k event cap) → `lex.subset.id`, 200,000 steps **(event cap hit — trace truncated)** 

Step sections: `Start state` · `Process A` · `Process B` · `Process C` · `Process D` · `Process E` · `Process F` · `Process G` · `Process H` · `Process I` · …and 3 more

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §3.7.1 · Fig 3.33 | 199,158 | “push all states of T onto stack; while stack not empty: pop t; for each u with an ε-edge from t not yet in ε-closure(T), add u and push it” |
| §3.7.1 · Algorithm 3.20 | 842 | “while there is an unmarked state T in Dstates: mark T; for each input symbol a, U := ε-closure(move(T, a)); add U to Dstates if new; Dtran[T, a] := U” |

### `lex.minimize`

Partition refinement of the token class’s DFA into the minimum-state DFA.

*Manifest anchor* (`trace-kinds.ts`): §3.9.6, Algorithm 3.39 (Fig 3.65)

**Traced as** classIndex=1 (intconst) → `lex.minimize.intconst`, 26 steps 

Step sections: `Initial partition` · `Refinement` · `Representatives` · `Final table`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §3.9.6 · Algorithm 3.39 | 25 | “partition each group G of Π into subgroups such that two states s and t stay together iff for all input symbols a they have transitions on a to states in the same group of Π”<br>“repeat the splitting procedure until Πnew = Π; the final partition Πfinal groups exactly the equivalent states”<br>“choose one state in each group of Πfinal as the representative for that group”<br>…and 1 more rule text(s) |
| §3.9.7 · Algorithm 3.39 | 1 | “step 1 starts with an initial partition Π of two groups, F and S − F; for a lexical analyzer the accepting states are subdivided further, one group per token, so states that announce different patterns are never merged” |

### `lex.scan`

The scanner driver on the real source: longest match with retraction, keyword lookup, symbol-table interning, lexical errors.

*Manifest anchor* (`trace-kinds.ts`): §3.8.1–3.8.3 (Fig 3.54)
*Note*: Always available — a lexical error is a step in the trace, not a reason to return null.

**Traced as** the acceptance sample → `lex.scan`, 453 steps 

Step sections: `Scan` · `End`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §3.8.3 · Fig 3.54 | 335 | “simulate the DFA, remembering the last accepting state passed; when the DFA dies, retract the input pointer to that state and emit its token (longest match)” |
| §3.5.2 | 74 | “comments, like whitespace, are stripped by the lexical analyzer and produce no token”<br>“the whitespace pattern has no action and no return: the lexer proceeds to the token following the whitespace” |
| §3.4.2 | 43 | “keywords are reserved words: recognize them as identifiers, then consult the keyword table to decide whether an identifier or a keyword token is returned” |
| §3.1.1 · Fig 3.1 | 1 | “the lexical analyzer returns a token to the parser on each getNextToken call, until the input is exhausted” |

**Traced as** a program with a lexical error (stray `@`, unterminated comment) → `lex.scan`, 74 steps 

Step sections: `Scan` · `End`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §3.8.3 · Fig 3.54 | 53 | “simulate the DFA, remembering the last accepting state passed; when the DFA dies, retract the input pointer to that state and emit its token (longest match)” |
| §3.5.2 | 12 | “the whitespace pattern has no action and no return: the lexer proceeds to the token following the whitespace” |
| §3.4.2 | 6 | “keywords are reserved words: recognize them as identifiers, then consult the keyword table to decide whether an identifier or a keyword token is returned” |
| §3.1.4 | 2 | “the simplest recovery strategy is panic mode: delete one character from the remaining input and continue”<br>“few errors are discernible at the lexical level alone; report the error with its position and recover” |
| §3.1.1 · Fig 3.1 | 1 | “the lexical analyzer returns a token to the parser on each getNextToken call, until the input is exhausted” |

---

## Syntax Analysis — `/syntax`

FIRST/FOLLOW, grammar transforms, LL(1), recursive descent, LR(0)/SLR, canonical LR(1), LALR(1), and the parse itself.

| Trace kind | What the visualization shows | Dragon Book anchors (from the code) |
| --- | --- | --- |
| `syntax.first-follow` | Fixed-point computation of the FIRST and FOLLOW sets. | §4.4.2 |
| `syntax.ll1-table` | Predictive-parsing table construction, including the conflict cells that prove a grammar is not LL(1). | §4.4.3 · Algorithm 4.31<br>§4.4.3 |
| `syntax.ll1-parse` | Table-driven predictive parse: stack, input, and the productions applied. | §4.4.4 · Algorithm 4.34, Fig 4.19 |
| `syntax.rd` | Recursive-descent parse: the procedure call tree with backtracking-free FIRST tests. | §4.4.1 · Fig 4.13<br>§4.4.3<br>§4.4.1 |
| `syntax.transforms` | Grammar transformations: left-recursion elimination, or left factoring of its result. | §4.3.3 · Algorithm 4.19<br>§4.3.4 · Algorithm 4.21 |
| `syntax.lr0` | The canonical collection of sets of LR(0) items (CLOSURE/GOTO, state numbering). | §4.6.2 · Fig 4.33 (items)<br>§4.6.2 · Fig 4.32 (CLOSURE)<br>§4.6.2 |
| `syntax.slr` | SLR(1) ACTION/GOTO construction from the LR(0) collection plus FOLLOW sets. | §4.6.4 · Algorithm 4.46<br>§4.4.2<br>§4.8.2 |
| `syntax.lr1` | The canonical collection of sets of LR(1) items. | §4.7.2 · Fig 4.40 (CLOSURE)<br>§4.7.2 · Fig 4.40 (GOTO)<br>§4.7.2 · Algorithm 4.53<br>§4.7.4 |
| `syntax.lr1-table` | Canonical LR(1) ACTION/GOTO construction (reduce only on the item’s own lookahead). | §4.7.3 · Algorithm 4.56 |
| `syntax.lalr` | LALR(1): merge LR(1) states with equal cores, then build ACTION/GOTO; mergeable states and any resulting reduce/reduce conflicts are events. | §4.7.4 · Algorithm 4.59<br>§4.7.4<br>§4.8.2 |
| `syntax.lr-parse` | The LR driver: shift/reduce/accept over the configuration stack. With grammarId 'c-subset' + table 'lalr' this is literally the parse the rest of the compiler consumes. | §4.6.3 · Algorithm 4.44 (Fig 4.36) |

### `syntax.first-follow`

Fixed-point computation of the FIRST and FOLLOW sets.

*Manifest anchor* (`trace-kinds.ts`): §4.4.2 (Example 4.30)

**Traced as** grammarId=dragon-4.28 → `syntax.first-follow`, 33 steps 

Step sections: `FIRST` · `FOLLOW`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §4.4.2 | 33 | “FIRST rules 1–2: in E' → + T E', Y1 = + is a terminal, so + ∈ FIRST(E')”<br>“FIRST rule 3: E' → ε is a production, so ε ∈ FIRST(E')”<br>“FIRST rules 1–2: in T' → * F T', Y1 = * is a terminal, so * ∈ FIRST(T')”<br>…and 21 more rule text(s) |

**Traced as** grammarId=c-subset-ll → `syntax.first-follow`, 1,017 steps 

Step sections: `FIRST` · `FOLLOW`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §4.4.2 | 1,017 | “FIRST rule 3: DeclList' → ε is a production, so ε ∈ FIRST(DeclList')”<br>“FIRST rules 1–2: in TypeSpec → int, Y1 = int is a terminal, so int ∈ FIRST(TypeSpec)”<br>“FIRST rules 1–2: in TypeSpec → float, Y1 = float is a terminal, so float ∈ FIRST(TypeSpec)”<br>…and 998 more rule text(s) |

### `syntax.ll1-table`

Predictive-parsing table construction, including the conflict cells that prove a grammar is not LL(1).

*Manifest anchor* (`trace-kinds.ts`): §4.4.3, Algorithm 4.31 (Fig 4.17)
*Note*: 'c-subset-ll' genuinely retains conflicts (dangling else; FuncDef vs VarDecl). They are reported as conflict events, not suppressed.

**Traced as** grammarId=dragon-4.28 → `syntax.ll1-table`, 21 steps 

Step sections: `Predictive parsing table`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §4.4.3 · Algorithm 4.31 | 21 | “For each terminal a in FIRST(α), add A → α to M[A, a]”<br>“If ε ∈ FIRST(α), add A → α to M[A, b] for each b in FOLLOW(A)” |

**Traced as** grammarId=c-subset-ll → `syntax.ll1-table`, 801 steps 

Step sections: `Predictive parsing table`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §4.4.3 · Algorithm 4.31 | 787 | “For each terminal a in FIRST(α), add A → α to M[A, a]”<br>“If ε ∈ FIRST(α), add A → α to M[A, b] for each b in FOLLOW(A)” |
| §4.4.3 | 14 | “LL(1) condition: FIRST/FOLLOW prediction sets of alternatives must be disjoint” |

### `syntax.ll1-parse`

Table-driven predictive parse: stack, input, and the productions applied.

*Manifest anchor* (`trace-kinds.ts`): §4.4.4, Algorithm 4.34 (Fig 4.19/4.21)

**Traced as** grammarId=dragon-4.28, source='id + id * id' → `syntax.ll1-parse`, 17 steps 

Step sections: `Predictive parse`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §4.4.4 · Algorithm 4.34, Fig 4.19 | 17 | — |

### `syntax.rd`

Recursive-descent parse: the procedure call tree with backtracking-free FIRST tests.

*Manifest anchor* (`trace-kinds.ts`): §4.4.1 (Fig 4.13/4.14)

**Traced as** grammarId=dragon-4.28, source='id + id * id' → `syntax.recursive-descent`, 39 steps 

Step sections: `Recursive descent`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §4.4.1 · Fig 4.13 | 27 | “if Xi is a terminal and Xi = current input symbol then advance the input” |
| §4.4.3 | 11 | “Select A → α on lookahead a when a ∈ FIRST(α), or α ⇒* ε and a ∈ FOLLOW(A)” |
| §4.4.1 | 1 | — |

### `syntax.transforms`

Grammar transformations: left-recursion elimination, or left factoring of its result.

*Manifest anchor* (`trace-kinds.ts`): §4.3.3 Algorithm 4.19; §4.3.4 Algorithm 4.21

**Traced as** grammarId=c-subset, stage=eliminate-left-recursion → `syntax.eliminate-left-recursion`, 66 steps 

Step sections: `Eliminate left recursion`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §4.3.3 · Algorithm 4.19 | 66 | — |

**Traced as** grammarId=c-subset, stage=left-factor → `syntax.left-factor`, 31 steps 

Step sections: `Left factoring`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §4.3.4 · Algorithm 4.21 | 31 | — |

### `syntax.lr0`

The canonical collection of sets of LR(0) items (CLOSURE/GOTO, state numbering).

*Manifest anchor* (`trace-kinds.ts`): §4.6.2, Algorithm 4.32 (Fig 4.31)

**Traced as** grammarId=dragon-4.1 → `syntax.lr0-items`, 53 steps 

Step sections: `Augment` · `I0` · `I1` · `I2` · `I4` · `I6` · `I7` · `I8` · `I9`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §4.6.2 · Fig 4.33 (items) | 34 | “GOTO(I, X) = CLOSURE of { [A → αX·β] : [A → α·Xβ] ∈ I }” |
| §4.6.2 · Fig 4.32 (CLOSURE) | 18 | — |
| §4.6.2 | 1 | “augmented grammar G': add S' → S so acceptance is exactly the reduction by S' → S” |

### `syntax.slr`

SLR(1) ACTION/GOTO construction from the LR(0) collection plus FOLLOW sets.

*Manifest anchor* (`trace-kinds.ts`): §4.6.4, Algorithm 4.46 (Fig 4.37)
*Note*: 'c-subset' surfaces genuine conflicts here — that is the teaching point.

**Traced as** grammarId=dragon-4.1 → `syntax.slr-table`, 61 steps 

Step sections: `FOLLOW` · `ACTION/GOTO`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §4.6.4 · Algorithm 4.46 | 58 | — |
| §4.4.2 | 3 | “FOLLOW(A) = set of terminals that can appear immediately to the right of A in some sentential form” |

**Traced as** grammarId=c-subset → `syntax.slr-table`, 2,010 steps 

Step sections: `FOLLOW` · `ACTION/GOTO`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §4.6.4 · Algorithm 4.46 | 1,973 | — |
| §4.4.2 | 36 | “FOLLOW(A) = set of terminals that can appear immediately to the right of A in some sentential form” |
| §4.8.2 | 1 | “resolve the if-else shift/reduce conflict in favor of shifting” |

### `syntax.lr1`

The canonical collection of sets of LR(1) items.

*Manifest anchor* (`trace-kinds.ts`): §4.7.2, Algorithm 4.53 (Fig 4.41)
*Note*: Check `trace.final().truncated` (and `trace.truncated` for the event cap) before claiming the collection is complete.

**Traced as** grammarId=dragon-4.55 → `syntax.lr1-items`, 37 steps 

Step sections: `Augment` · `I0` · `I2` · `I3` · `I6`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §4.7.2 · Fig 4.40 (CLOSURE) | 13 | “add [B → ·γ, b] for each b ∈ FIRST(βa)” |
| §4.7.2 · Fig 4.40 (GOTO) | 13 | “GOTO(I, X) = CLOSURE of { [A → αX·β, a] : [A → α·Xβ, a] ∈ I } — lookaheads ride along unchanged” |
| §4.7.2 · Algorithm 4.53 | 11 | — |

**Traced as** grammarId=c-subset (hits the state cap) → `syntax.lr1-items`, 40,280 steps 

Step sections: `Augment` · `I0` · `I2` · `I4` · `I12` · `I14` · `I16` · `I17` · `I19` · `I20` · …and 191 more

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §4.7.2 · Fig 4.40 (CLOSURE) | 38,126 | “add [B → ·γ, b] for each b ∈ FIRST(βa)” |
| §4.7.2 · Fig 4.40 (GOTO) | 1,752 | “GOTO(I, X) = CLOSURE of { [A → αX·β, a] : [A → α·Xβ, a] ∈ I } — lookaheads ride along unchanged” |
| §4.7.2 · Algorithm 4.53 | 401 | — |
| §4.7.4 | 1 | “canonical LR tables can have many more states than SLR/LALR tables for the same language” |

### `syntax.lr1-table`

Canonical LR(1) ACTION/GOTO construction (reduce only on the item’s own lookahead).

*Manifest anchor* (`trace-kinds.ts`): §4.7.3, Algorithm 4.56 (Fig 4.42)
*Note*: Returns null when the state cap is exceeded (the table cannot be built from a truncated collection) — use getTraceOrError to show why.

**Traced as** grammarId=dragon-4.55 → `syntax.lr1-table`, 32 steps 

Step sections: `ACTION/GOTO`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §4.7.3 · Algorithm 4.56 | 32 | — |

**Traced as** grammarId=c-subset (hits the state cap) → **no trace**: cannot build the canonical LR(1) table for C subset: the canonical LR(1) collection is larger than the lab's 400-state cap (construction stopped after 400 states), and a table built from a truncated collection would be missing rows

### `syntax.lalr`

LALR(1): merge LR(1) states with equal cores, then build ACTION/GOTO; mergeable states and any resulting reduce/reduce conflicts are events.

*Manifest anchor* (`trace-kinds.ts`): §4.7.4, Algorithm 4.59 (Fig 4.43)

**Traced as** grammarId=dragon-4.55 → `syntax.lalr`, 44 steps 

Step sections: `Merge` · `Table`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §4.7.4 · Algorithm 4.59 | 34 | “find all sets having the same core and replace them by their union” |
| §4.7.4 | 10 | “GOTO(J, X) of a union J is the union of the (same-core) GOTOs of its members” |

**Traced as** grammarId=c-subset, resolveDanglingElseByShift=true (the pipeline parser) → `syntax.lalr`, 2,930 steps 

Step sections: `Merge` · `Table`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §4.7.4 · Algorithm 4.59 | 2,117 | “find all sets having the same core and replace them by their union” |
| §4.7.4 | 812 | “GOTO(J, X) of a union J is the union of the (same-core) GOTOs of its members” |
| §4.8.2 | 1 | “resolve the if-else shift/reduce conflict in favor of shifting” |

### `syntax.lr-parse`

The LR driver: shift/reduce/accept over the configuration stack. With grammarId 'c-subset' + table 'lalr' this is literally the parse the rest of the compiler consumes.

*Manifest anchor* (`trace-kinds.ts`): §4.6.3, Algorithm 4.44 (Fig 4.36/4.38)
*Note*: table defaults to 'lalr'. For the C grammars the input symbols carry lexeme/tokenIndex/span, so parse steps highlight the editor.

**Traced as** grammarId=dragon-4.1, table=slr, source='id * id + id' → `syntax.lr-parse.slr`, 15 steps 

Step sections: `Parse`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §4.6.3 · Algorithm 4.44 (Fig 4.36) | 15 | — |

**Traced as** grammarId=c-subset, table=lalr, the acceptance sample → `syntax.lr-parse.lalr`, 416 steps 

Step sections: `Parse`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §4.6.3 · Algorithm 4.44 (Fig 4.36) | 416 | — |

---

## Semantic Analysis — `/semantic`

Scope stack, symbol table, type synthesis and the implicit conversions it inserts.

| Trace kind | What the visualization shows | Dragon Book anchors (from the code) |
| --- | --- | --- |
| `sem.analyze` | Scope entry/exit, symbol declaration and lookup, type synthesis, implicit conversions, and each semantic error with its cited rule. | §2.7<br>§2.7 · Fig. 2.36<br>§6.5.1<br>§6.3.3<br>§6.4.3<br>§6.5.2 · widen(a, t, w) / max(t1, t2)<br>§6.5.2 · max(t1, t2)<br>§6.3.1<br>§2.8.3<br>§7.1 |

### `sem.analyze`

Scope entry/exit, symbol declaration and lookup, type synthesis, implicit conversions, and each semantic error with its cited rule.

*Manifest anchor* (`trace-kinds.ts`): §2.7, §6.3, §6.5
*Note*: Requires a successful parse. Array decay appears only as a trace event — it is not in SemanticInfo.conversions.

**Traced as** the acceptance sample → `sem.analyze`, 119 steps 

Step sections: `Global scope` · `Function gcd` · `Function main`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §2.7 | 55 | “lookup consults the chained tables from the innermost scope outward” |
| §2.7 · Fig. 2.36 | 42 | — |
| §6.5.1 | 16 | — |
| §6.3.3 | 6 | — |

**Traced as** float-average (widening conversions) → `sem.analyze`, 115 steps 

Step sections: `Global scope` · `Function average` · `Function main`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §2.7 | 38 | “lookup consults the chained tables from the innermost scope outward” |
| §2.7 · Fig. 2.36 | 36 | — |
| §6.5.1 | 26 | — |
| §6.3.3 | 5 | — |
| §6.4.3 | 5 | — |
| §6.5.2 · widen(a, t, w) / max(t1, t2) | 2 | “Rule 1: if either operand is float, the other is converted via an explicit inttofloat conversion (§6.5.2 widening); result float” |
| §6.5.2 · max(t1, t2) | 2 | — |
| §6.3.1 | 1 | “Rule 6: in expressions (except '&a' and declarations), T[n] decays to T*” |

**Traced as** type-error (the error rules) → `sem.analyze`, 39 steps 

Step sections: `Global scope` · `Function main`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §2.7 · Fig. 2.36 | 15 | — |
| §2.7 | 15 | “lookup consults the chained tables from the innermost scope outward” |
| §6.5.1 | 5 | — |
| §6.3.3 | 3 | — |
| §2.8.3 | 1 | — |

**Traced as** a non-constant global initializer (§7.1 storage rule) → `sem.analyze`, 19 steps 

Step sections: `Global scope` · `Function main`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §2.7 · Fig. 2.36 | 9 | — |
| §2.7 | 5 | “lookup consults the chained tables from the innermost scope outward” |
| §6.3.3 | 2 | — |
| §6.5.1 | 2 | — |
| §7.1 | 1 | — |

---

## Intermediate Code — `/ir`

Syntax-directed translation to three-address code, jumping code for booleans, backpatching.

| Trace kind | What the visualization shows | Dragon Book anchors (from the code) |
| --- | --- | --- |
| `ir.gen` | Syntax-directed translation to three-address code: temporaries, jumping code for booleans, and §6.7 backpatching (makelist/merge/backpatch). | §6.4.1 · Fig 6.19<br>§6.9<br>§6.7.1<br>§6.7.2<br>§6.7.2 · Fig 6.43<br>§6.7.3 · Fig 6.46<br>§6.2.1<br>§6.4.4 · Fig 6.22<br>§6.7.3<br>§6.4.3<br>§6.6.6<br>§6.6.4 |

### `ir.gen`

Syntax-directed translation to three-address code: temporaries, jumping code for booleans, and §6.7 backpatching (makelist/merge/backpatch).

*Manifest anchor* (`trace-kinds.ts`): §6.2, §6.4, §6.6, §6.7
*Note*: Requires clean semantic analysis. Global initializers are not translated.

**Traced as** the acceptance sample → `ir.gen`, 63 steps 

Step sections: `globals` · `gcd()` · `main()`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §6.4.1 · Fig 6.19 | 22 | “S → id = E { gen(top.get(id.lexeme) = E.addr) }”<br>“E → E1 + E2 { E.addr = new Temp(); gen(E.addr = E1.addr + E2.addr) }” |
| §6.9 | 12 | “a procedure definition yields its own sequence of three-address instructions”<br>“return x: return the value x from the procedure”<br>“return x”<br>…and 4 more rule text(s) |
| §6.7.1 | 12 | “makelist(i) creates a new list containing only i, an index into the array of instructions”<br>“backpatch(p, i) inserts i as the target label for each of the instructions on the list pointed to by p”<br>“merge(p1, p2) concatenates the lists pointed to by p1 and p2, and returns a pointer to the concatenated list” |
| §6.7.2 | 6 | “M → ε { M.instr = nextinstr }” |
| §6.7.2 · Fig 6.43 | 6 | “B → E1 rel E2 { B.truelist = makelist(nextinstr); B.falselist = makelist(nextinstr + 1); gen(if E1 rel E2 goto _); gen(goto _) }”<br>“gen(if E1.addr rel.op E2.addr goto _)”<br>“gen(goto _)” |
| §6.7.3 · Fig 6.46 | 4 | “S → while M1 ( B ) M2 S1 { backpatch(S1.nextlist, M1.instr); backpatch(B.truelist, M2.instr); S.nextlist = B.falselist; gen(goto M1.instr) }”<br>“gen(goto M1.instr)”<br>“S → if ( B ) M1 S1 N else M2 S2 { backpatch(B.truelist, M1.instr); backpatch(B.falselist, M2.instr); S.nextlist = merge(S1.nextlist, merge(N.nextlist, S2.nextlist)) }”<br>…and 1 more rule text(s) |
| §6.2.1 | 1 | “three-address instructions operate on names with addresses; globals live at fixed addresses” |

**Traced as** array-sum (addressing) → `ir.gen`, 66 steps 

Step sections: `globals` · `sum()` · `main()`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §6.4.1 · Fig 6.19 | 20 | “S → id = E { gen(top.get(id.lexeme) = E.addr) }”<br>“E → E1 + E2 { E.addr = new Temp(); gen(E.addr = E1.addr + E2.addr) }” |
| §6.9 | 12 | “a procedure definition yields its own sequence of three-address instructions”<br>“return x: return the value x from the procedure”<br>“return x”<br>…and 4 more rule text(s) |
| §6.7.1 | 8 | “makelist(i) creates a new list containing only i, an index into the array of instructions”<br>“backpatch(p, i) inserts i as the target label for each of the instructions on the list pointed to by p” |
| §6.7.2 | 6 | “M → ε { M.instr = nextinstr }” |
| §6.7.2 · Fig 6.43 | 6 | “B → E1 rel E2 { B.truelist = makelist(nextinstr); B.falselist = makelist(nextinstr + 1); gen(if E1 rel E2 goto _); gen(goto _) }”<br>“gen(if E1.addr rel.op E2.addr goto _)”<br>“gen(goto _)” |
| §6.4.4 · Fig 6.22 | 5 | “E → L { E.addr = new Temp(); gen(E.addr = L.array.base [ L.addr ]) }”<br>“L → id [ E ] { gen(L.addr = E.addr * width) }”<br>“S → L = E { gen(L.array.base [ L.addr ] = E.addr) }” |
| §6.7.3 | 4 | “for (E1; B; E3) S1 ≡ E1; while-style loop: test B, run S1 then E3, jump back to the test (scheme derived from S → while M1 (B) M2 S1, Fig 6.46)”<br>“gen(goto M1.instr): loop back to the test” |
| §6.2.1 | 3 | “three-address instructions operate on names with addresses; globals live at fixed addresses”<br>“x = *y: set x to the value at location y”<br>“x = &y sets x to the location of y” |
| §6.4.3 | 2 | “element address = base + i × w”<br>“array name in an expression denotes the base address” |

**Traced as** &&, \|\|, ! (jumping code) → `ir.gen`, 76 steps 

Step sections: `globals` · `classify()` · `main()`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §6.7.1 | 24 | “makelist(i) creates a new list containing only i, an index into the array of instructions”<br>“backpatch(p, i) inserts i as the target label for each of the instructions on the list pointed to by p”<br>“merge(p1, p2) concatenates the lists pointed to by p1 and p2, and returns a pointer to the concatenated list” |
| §6.9 | 16 | “a procedure definition yields its own sequence of three-address instructions”<br>“return x: return the value x from the procedure”<br>“return x”<br>…and 4 more rule text(s) |
| §6.7.2 · Fig 6.43 | 15 | “B → B1 && M B2 { backpatch(B1.truelist, M.instr); B.truelist = B2.truelist; B.falselist = merge(B1.falselist, B2.falselist) }”<br>“B → E1 rel E2 { B.truelist = makelist(nextinstr); B.falselist = makelist(nextinstr + 1); gen(if E1 rel E2 goto _); gen(goto _) }”<br>“gen(if E1.addr rel.op E2.addr goto _)”<br>…and 3 more rule text(s) |
| §6.7.2 | 9 | “M → ε { M.instr = nextinstr }” |
| §6.4.1 · Fig 6.19 | 4 | “S → id = E { gen(top.get(id.lexeme) = E.addr) }”<br>“E → - E1 { gen(E.addr = minus E1.addr) }” |
| §6.6.6 | 3 | “boolean value: true exit assigns 1”<br>“jump over the false-branch assignment”<br>“boolean value: false exit assigns 0” |
| §6.7.3 · Fig 6.46 | 2 | “S → if ( B ) M S1 { backpatch(B.truelist, M.instr); S.nextlist = merge(B.falselist, S1.nextlist) }” |
| §6.6.4 | 2 | “scalar condition tested ≠ 0 (C-subset rule 9): if x goto _”<br>“fall-through jump for the false case” |
| §6.2.1 | 1 | “three-address instructions operate on names with addresses; globals live at fixed addresses” |

---

## Optimization — `/opt`

Basic blocks and the CFG, the dataflow framework, dominators and loops, and six rewriting passes.

| Trace kind | What the visualization shows | Dragon Book anchors (from the code) |
| --- | --- | --- |
| `opt.pass` | One optimization pass, run on exactly the program state it sees inside the default pipeline (so the trace matches the per-pass diff on the overview). | §8.5.4<br>§9.2.4 · Algorithm 9.11<br>§9.3 · Iterative framework (Algorithm 9.11 style)<br>§9.1.3<br>§9.2.6<br>§9.1.2<br>§9.6.1<br>§9.2.5<br>§9.6.6 · Algorithm 9.46<br>§9.1.5<br>§9.6.4<br>§9.1.4 |
| `opt.pipeline` | The whole default sequence — const-fold, const-prop, copy-prop, cse, licm, dce. | §9.2.5<br>§9.2.4 · Algorithm 9.11<br>§9.3 · Iterative framework (Algorithm 9.11 style)<br>§9.2.6<br>§9.6.1<br>§8.4.1 · Algorithm 8.5<br>§8.4.3<br>§9.1.4<br>§9.1.3<br>§9.6.6 · Algorithm 9.46<br>§8.5.4<br>§9.1.2<br>§9.1.5<br>§9.6.4 |
| `opt.analysis` | A single analysis in isolation on one TAC function of the unoptimized program. The reducer depends on the `analysis` parameter — see `variants`. | §8.4.1 · Algorithm 8.5<br>§8.4.3<br>§9.2.4 · Algorithm 9.11<br>§9.2.5<br>§9.2.6<br>§9.6.1<br>§9.6.6 · Algorithm 9.46<br>§9.6.4 |

### `opt.pass`

One optimization pass, run on exactly the program state it sees inside the default pipeline (so the trace matches the per-pass diff on the overview).

*Manifest anchor* (`trace-kinds.ts`): §8.5 (local), §9.1–9.5 (global)
*Note*: The trace interleaves the pass’s own analysis events (blocks/CFG/dataflow/dominators/loops); passReducer ignores those, so replay them with the analysis reducers below if you want the tables alongside the diff.

**Traced as** pass=const-fold → `opt.pass.const-fold`, 2 steps 

Step sections: `Pass: const-fold`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §8.5.4 | 2 | “Constant folding: evaluate constant expressions at compile time and replace them by their values” |

**Traced as** pass=const-prop → `opt.pass.const-prop`, 40 steps 

Step sections: `Pass: const-prop` · `Setup` · `Iteration 1` · `Iteration 2` · `Iteration 3` · `Converged` · `Rewrites (main)`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §9.2.4 · Algorithm 9.11 | 40 | “A use of x may be replaced by constant c if every definition of x reaching that use assigns c” |

**Traced as** pass=copy-prop → `opt.pass.copy-prop`, 31 steps 

Step sections: `Pass: copy-prop` · `Setup` · `Iteration 1` · `Iteration 2` · `Converged` · `Rewrites (gcd)`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §9.3 · Iterative framework (Algorithm 9.11 style) | 28 | — |
| §9.1.3 | 3 | “After the copy x = y, uses of x may be replaced by y while neither x nor y is reassigned” |

**Traced as** pass=cse → `opt.pass.cse`, 30 steps 

Step sections: `Pass: cse` · `Setup` · `Iteration 1` · `Iteration 2` · `Converged`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §9.2.6 | 28 | — |
| §9.1.2 | 2 | “An expression available at a point (§9.2.6) need not be recomputed; reuse the previously computed value” |

**Traced as** pass=licm → `opt.pass.licm`, 59 steps 

Step sections: `Pass: licm` · `Dominators setup` · `Dominators iteration 1` · `Dominators iteration 2` · `Dominators converged` · `Back edges` · `Natural loop of B2 → B0` · `Setup` · `Iteration 1` · `Iteration 2` · …and 2 more

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §9.6.1 | 22 | “D(n0) = {n0}; D(n) = N (the set of all nodes) for every n ≠ n0”<br>“D(n) = {n} ∪ ( ∩ over predecessors p of n of D(p) )” |
| §9.2.4 · Algorithm 9.11 | 18 | — |
| §9.2.5 | 13 | — |
| §9.6.6 · Algorithm 9.46 | 3 | “loop = {b}; the header is always in the natural loop”<br>“insert(a): the tail of the back edge is in the loop” |
| §9.1.5 | 2 | “Code motion: an expression that yields the same result independent of the number of loop iterations may be evaluated once, before the loop” |
| §9.6.4 | 1 | “An edge a → b is a back edge if its head b dominates its tail a” |

**Traced as** pass=dce → `opt.pass.dce`, 60 steps 

Step sections: `Pass: dce` · `Setup` · `Iteration 1` · `Iteration 2` · `Converged` · `DCE round 1 (gcd)` · `DCE round 1 (main)`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §9.2.5 | 56 | — |
| §9.1.4 | 4 | “An assignment to x is dead if x is not live (will not be used) after it and the statement has no side effects” |

### `opt.pipeline`

The whole default sequence — const-fold, const-prop, copy-prop, cse, licm, dce.

*Manifest anchor* (`trace-kinds.ts`): §8.5, §9
*Note*: State is one PassState per pass, in applied order.

**Traced as** the acceptance sample → `opt.pipeline`, 253 steps 

Step sections: `Leaders (gcd)` · `Blocks (gcd)` · `CFG (gcd)` · `Leaders (main)` · `Blocks (main)` · `CFG (main)` · `Pass: const-fold` · `Pass: const-prop` · `Setup` · `Iteration 1` · …and 17 more

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §9.2.5 | 69 | — |
| §9.2.4 · Algorithm 9.11 | 58 | “A use of x may be replaced by constant c if every definition of x reaching that use assigns c” |
| §9.3 · Iterative framework (Algorithm 9.11 style) | 28 | — |
| §9.2.6 | 28 | — |
| §9.6.1 | 22 | “D(n0) = {n0}; D(n) = N (the set of all nodes) for every n ≠ n0”<br>“D(n) = {n} ∪ ( ∩ over predecessors p of n of D(p) )” |
| §8.4.1 · Algorithm 8.5 | 18 | “Rule 1: the first three-address instruction is a leader”<br>“Rule 2: any instruction that is the target of a jump is a leader”<br>“Rule 3: any instruction that immediately follows a jump (or a return, which also transfers control away) is a leader”<br>…and 1 more rule text(s) |
| §8.4.3 | 13 | “There is an edge from ENTRY to the block containing the first instruction of the program”<br>“There is an edge from B to C if there is a conditional or unconditional jump from the end of B to the beginning of C”<br>“There is an edge from B to C if C immediately follows B in the original order and B does not end in an unconditional jump”<br>…and 1 more rule text(s) |
| §9.1.4 | 4 | “An assignment to x is dead if x is not live (will not be used) after it and the statement has no side effects” |
| §9.1.3 | 3 | “After the copy x = y, uses of x may be replaced by y while neither x nor y is reassigned” |
| §9.6.6 · Algorithm 9.46 | 3 | “loop = {b}; the header is always in the natural loop”<br>“insert(a): the tail of the back edge is in the loop” |
| §8.5.4 | 2 | “Constant folding: evaluate constant expressions at compile time and replace them by their values” |
| §9.1.2 | 2 | “An expression available at a point (§9.2.6) need not be recomputed; reuse the previously computed value” |
| §9.1.5 | 2 | “Code motion: an expression that yields the same result independent of the number of loop iterations may be evaluated once, before the loop” |
| §9.6.4 | 1 | “An edge a → b is a back edge if its head b dominates its tail a” |

### `opt.analysis`

A single analysis in isolation on one TAC function of the unoptimized program. The reducer depends on the `analysis` parameter — see `variants`.

*Manifest anchor* (`trace-kinds.ts`): §8.4 (blocks/CFG), §9.2 (dataflow), §9.6 (dominators/loops)
*Note*: Runs on `optimized.input` (the renumbered TAC that enters the pipeline), so block ids line up with what opt.pass shows. The three dataflow instantiations share one reducer and one state shape; tell them apart by the trace id / your own route state.

**Traced as** analysis=basic-blocks, functionName=gcd → `opt.basic-blocks.gcd`, 8 steps 

Step sections: `Leaders (gcd)` · `Blocks (gcd)`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §8.4.1 · Algorithm 8.5 | 8 | “Rule 1: the first three-address instruction is a leader”<br>“Rule 2: any instruction that is the target of a jump is a leader”<br>“Rule 3: any instruction that immediately follows a jump (or a return, which also transfers control away) is a leader”<br>…and 1 more rule text(s) |

**Traced as** analysis=cfg, functionName=gcd → `opt.cfg.gcd`, 6 steps 

Step sections: `CFG (gcd)`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §8.4.3 | 6 | “There is an edge from ENTRY to the block containing the first instruction of the program”<br>“There is an edge from B to C if there is a conditional or unconditional jump from the end of B to the beginning of C”<br>“There is an edge from B to C if C immediately follows B in the original order and B does not end in an unconditional jump”<br>…and 1 more rule text(s) |

**Traced as** analysis=reaching-defs, functionName=gcd → `opt.reaching-definitions.gcd`, 18 steps 

Step sections: `Setup` · `Iteration 1` · `Iteration 2` · `Iteration 3` · `Converged`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §9.2.4 · Algorithm 9.11 | 18 | — |

**Traced as** analysis=live-vars, functionName=gcd → `opt.live-variables.gcd`, 13 steps 

Step sections: `Setup` · `Iteration 1` · `Iteration 2` · `Converged`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §9.2.5 | 13 | — |

**Traced as** analysis=avail-exprs, functionName=gcd → `opt.available-expressions.gcd`, 13 steps 

Step sections: `Setup` · `Iteration 1` · `Iteration 2` · `Converged`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §9.2.6 | 13 | — |

**Traced as** analysis=dominators, functionName=gcd → `opt.dominators.gcd`, 10 steps 

Step sections: `Dominators setup` · `Dominators iteration 1` · `Dominators iteration 2` · `Dominators converged`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §9.6.1 | 10 | “D(n0) = {n0}; D(n) = N (the set of all nodes) for every n ≠ n0”<br>“D(n) = {n} ∪ ( ∩ over predecessors p of n of D(p) )” |

**Traced as** analysis=loops, functionName=gcd → `opt.loops.gcd`, 4 steps 

Step sections: `Back edges` · `Natural loop of B2 → B0`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §9.6.6 · Algorithm 9.46 | 3 | “loop = {b}; the header is always in the natural loop”<br>“insert(a): the tail of the back edge is in the loop” |
| §9.6.4 | 1 | “An edge a → b is a back edge if its head b dominates its tail a” |

---

## Code Generation — `/codegen`

Instruction selection to x86-64, liveness, interference-graph coloring with spilling, emission, execution.

| Trace kind | What the visualization shows | Dragon Book anchors (from the code) |
| --- | --- | --- |
| `codegen.isel` | Instruction selection: each TAC quad → x86-64 AT&T instructions over virtual registers, with the frame layout decisions (arrays, address-taken locals). | §8.6<br>§8.9.2 · quad-at-a-time tiling<br>§8.9.2<br>§8.3.2 |
| `codegen.liveness` | Backward liveness over the selected code — the input to the interference graph. | §8.4.2<br>§9.2.5<br>§9.2.5 · live-variable equations |
| `codegen.interference` | Interference-graph construction: an edge per pair simultaneously live at a def. | §8.8.4 |
| `codegen.color` | Chaitin-style simplify/select coloring with spilling: the stack of removed nodes, the spill choices, and the rewritten code each spill round. | §8.8.4 |
| `codegen.emit` | Final emission: prologue/epilogue, register substitution, one line per step. | §8.3.2<br>§8.6<br>§8.2.1 |
| `codegen.exec` | The x86-64 subset interpreter executing the emitted program — the oracle that must agree with the TAC interpreter. | §8.2.1 |

### `codegen.isel`

Instruction selection: each TAC quad → x86-64 AT&T instructions over virtual registers, with the frame layout decisions (arrays, address-taken locals).

*Manifest anchor* (`trace-kinds.ts`): §8.2, §8.6
*Note*: Runs on the OPTIMIZED program (`optimized.output`), like the real pipeline.

**Traced as** the acceptance sample → `codegen.isel`, 69 steps 

Step sections: `gcd: selection` · `main: selection` · `Done`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §8.6 | 34 | “a simple code generator emits a load, an operation, and a store for each three-address instruction” |
| §8.9.2 · quad-at-a-time tiling | 28 | “tile the input with rules covering machine instructions”<br>“one tile per IR operator: the quad's opcode selects the rule that covers it” |
| §8.9.2 | 5 | “machine idioms are single tiles: x86-64 division needs the dividend sign-extended into %rdx:%rax”<br>“the tiling covers the whole function body”<br>“code generation by tiling is complete when every IR operation is covered” |
| §8.3.2 | 2 | “on entry, the callee moves incoming parameters from their convention locations” |

### `codegen.liveness`

Backward liveness over the selected code — the input to the interference graph.

*Manifest anchor* (`trace-kinds.ts`): §8.8.2 (Algorithm 9.14 applied to machine code)

**Traced as** the acceptance sample → `codegen.liveness`, 103 steps 

Step sections: `gcd: liveness` · `gcd: liveness pass 1` · `gcd: liveness pass 2` · `gcd: liveness pass 3` · `main: liveness` · `main: liveness pass 1` · `main: liveness pass 2` · `Done`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §8.4.2 | 93 | “use/def per instruction; in[i] = use[i] ∪ (out[i] − def[i]), out[i] = ∪ in[succ] (equations per §9.2.5)” |
| §9.2.5 | 8 | “iterate the transfer equations until the live sets stabilize”<br>“the iteration converges because the sets only grow”<br>“live-variable analysis complete” |
| §9.2.5 · live-variable equations | 2 | “live-variable analysis is a backward dataflow problem” |

### `codegen.interference`

Interference-graph construction: an edge per pair simultaneously live at a def.

*Manifest anchor* (`trace-kinds.ts`): §8.8.3

**Traced as** the acceptance sample → `codegen.interference`, 18 steps 

Step sections: `gcd: interference` · `main: interference` · `Done`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §8.8.4 | 18 | “construct a register-interference graph: nodes are symbolic registers”<br>“machine registers participate as precolored nodes: a symbolic register interfering with one cannot receive its color”<br>“an edge connects two nodes if one is live at a point where the other is defined”<br>…and 4 more rule text(s) |

### `codegen.color`

Chaitin-style simplify/select coloring with spilling: the stack of removed nodes, the spill choices, and the rewritten code each spill round.

*Manifest anchor* (`trace-kinds.ts`): §8.8.4

**Traced as** the acceptance sample (k = 8, the default) → `codegen.color`, 25 steps 

Step sections: `gcd: coloring` · `gcd: coloring round 1` · `main: coloring` · `main: coloring round 1` · `Done`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §8.8.4 | 25 | “register allocation by graph coloring with k physical registers”<br>“color the interference graph of the function”<br>“a node with fewer than k neighbors can always be colored: remove it and color the rest first”<br>…and 3 more rule text(s) |

**Traced as** k=3 — forces real spills → `codegen.color`, 42 steps 

Step sections: `gcd: coloring` · `gcd: coloring round 1` · `gcd: coloring round 2` · `main: coloring` · `main: coloring round 1` · `Done`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §8.8.4 | 42 | “register allocation by graph coloring with k physical registers”<br>“color the interference graph of the function”<br>“a node with fewer than k neighbors can always be colored: remove it and color the rest first”<br>…and 6 more rule text(s) |

### `codegen.emit`

Final emission: prologue/epilogue, register substitution, one line per step.

*Manifest anchor* (`trace-kinds.ts`): §8.6, §7.2 (activation records)

**Traced as** the acceptance sample → `codegen.emit`, 68 steps 

Step sections: `Header` · `gcd: emit` · `main: emit` · `Done`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §8.3.2 | 29 | “each procedure has a label marking its entry point”<br>“the calling sequence saves the old frame pointer and allocates the activation record”<br>“a single return point simplifies the return sequence”<br>…and 1 more rule text(s) |
| §8.6 | 29 | “emit the target instruction with all names replaced by their assigned locations” |
| §8.2.1 | 10 | “assembly programs are sequences of labels, directives and instructions”<br>“labels name instruction addresses”<br>“the emitted program is complete” |

### `codegen.exec`

The x86-64 subset interpreter executing the emitted program — the oracle that must agree with the TAC interpreter.

*Manifest anchor* (`trace-kinds.ts`): lab oracle (see docs/PLAN.md testing layer 3)

**Traced as** the acceptance sample → `interp.asm`, 63 steps 

Step sections: `Execution` · `Halt`

| Dragon Book | Steps | Rule text quoted in the step card |
| --- | ---: | --- |
| §8.2.1 | 63 | “the target machine executes one instruction at a time, updating registers and memory”<br>“one instruction executes at a time; ret pops the return address”<br>“execution ends when control returns from the entry procedure” |

---

## Reverse index — Dragon Book section → where it appears

Sorted by section number. “Steps” totals every run listed above.

| Dragon Book | Steps | Trace kinds |
| --- | ---: | --- |
| §2.7 | 113 | `sem.analyze` |
| §2.7 · Fig. 2.36 | 102 | `sem.analyze` |
| §2.8.3 | 1 | `sem.analyze` |
| §3.1.1 · Fig 3.1 | 2 | `lex.scan` |
| §3.1.4 | 2 | `lex.scan` |
| §3.4.2 | 49 | `lex.scan` |
| §3.5.2 | 86 | `lex.scan` |
| §3.7.1 · Algorithm 3.20 | 1,096 | `lex.subset` |
| §3.7.1 · Fig 3.33 | 210,284 | `lex.subset` |
| §3.7.4 · Algorithm 3.23 | 41 | `lex.thompson` |
| §3.8.3 · Fig 3.54 | 388 | `lex.scan` |
| §3.9.6 · Algorithm 3.39 | 25 | `lex.minimize` |
| §3.9.7 · Algorithm 3.39 | 1 | `lex.minimize` |
| §4.3.3 · Algorithm 4.19 | 66 | `syntax.transforms` |
| §4.3.4 · Algorithm 4.21 | 31 | `syntax.transforms` |
| §4.4.1 | 1 | `syntax.rd` |
| §4.4.1 · Fig 4.13 | 27 | `syntax.rd` |
| §4.4.2 | 1,089 | `syntax.first-follow`, `syntax.slr` |
| §4.4.3 | 25 | `syntax.ll1-table`, `syntax.rd` |
| §4.4.3 · Algorithm 4.31 | 808 | `syntax.ll1-table` |
| §4.4.4 · Algorithm 4.34, Fig 4.19 | 17 | `syntax.ll1-parse` |
| §4.6.2 | 1 | `syntax.lr0` |
| §4.6.2 · Fig 4.32 (CLOSURE) | 18 | `syntax.lr0` |
| §4.6.2 · Fig 4.33 (items) | 34 | `syntax.lr0` |
| §4.6.3 · Algorithm 4.44 (Fig 4.36) | 431 | `syntax.lr-parse` |
| §4.6.4 · Algorithm 4.46 | 2,031 | `syntax.slr` |
| §4.7.2 · Algorithm 4.53 | 412 | `syntax.lr1` |
| §4.7.2 · Fig 4.40 (CLOSURE) | 38,139 | `syntax.lr1` |
| §4.7.2 · Fig 4.40 (GOTO) | 1,765 | `syntax.lr1` |
| §4.7.3 · Algorithm 4.56 | 32 | `syntax.lr1-table` |
| §4.7.4 | 823 | `syntax.lr1`, `syntax.lalr` |
| §4.7.4 · Algorithm 4.59 | 2,151 | `syntax.lalr` |
| §4.8.2 | 2 | `syntax.slr`, `syntax.lalr` |
| §6.2.1 | 5 | `ir.gen` |
| §6.3.1 | 1 | `sem.analyze` |
| §6.3.3 | 16 | `sem.analyze` |
| §6.4.1 · Fig 6.19 | 46 | `ir.gen` |
| §6.4.3 | 7 | `sem.analyze`, `ir.gen` |
| §6.4.4 · Fig 6.22 | 5 | `ir.gen` |
| §6.5.1 | 49 | `sem.analyze` |
| §6.5.2 · max(t1, t2) | 2 | `sem.analyze` |
| §6.5.2 · widen(a, t, w) / max(t1, t2) | 2 | `sem.analyze` |
| §6.6.4 | 2 | `ir.gen` |
| §6.6.6 | 3 | `ir.gen` |
| §6.7.1 | 44 | `ir.gen` |
| §6.7.2 | 21 | `ir.gen` |
| §6.7.2 · Fig 6.43 | 27 | `ir.gen` |
| §6.7.3 | 4 | `ir.gen` |
| §6.7.3 · Fig 6.46 | 6 | `ir.gen` |
| §6.9 | 40 | `ir.gen` |
| §7.1 | 1 | `sem.analyze` |
| §8.2.1 | 73 | `codegen.emit`, `codegen.exec` |
| §8.3.2 | 31 | `codegen.isel`, `codegen.emit` |
| §8.4.1 · Algorithm 8.5 | 26 | `opt.pipeline`, `opt.analysis` |
| §8.4.2 | 93 | `codegen.liveness` |
| §8.4.3 | 19 | `opt.pipeline`, `opt.analysis` |
| §8.5.4 | 4 | `opt.pass`, `opt.pipeline` |
| §8.6 | 63 | `codegen.isel`, `codegen.emit` |
| §8.8.4 | 85 | `codegen.interference`, `codegen.color` |
| §8.9.2 | 5 | `codegen.isel` |
| §8.9.2 · quad-at-a-time tiling | 28 | `codegen.isel` |
| §9.1.2 | 4 | `opt.pass`, `opt.pipeline` |
| §9.1.3 | 6 | `opt.pass`, `opt.pipeline` |
| §9.1.4 | 8 | `opt.pass`, `opt.pipeline` |
| §9.1.5 | 4 | `opt.pass`, `opt.pipeline` |
| §9.2.4 · Algorithm 9.11 | 134 | `opt.pass`, `opt.pipeline`, `opt.analysis` |
| §9.2.5 | 159 | `opt.pass`, `opt.pipeline`, `opt.analysis`, `codegen.liveness` |
| §9.2.5 · live-variable equations | 2 | `codegen.liveness` |
| §9.2.6 | 69 | `opt.pass`, `opt.pipeline`, `opt.analysis` |
| §9.3 · Iterative framework (Algorithm 9.11 style) | 56 | `opt.pass`, `opt.pipeline` |
| §9.6.1 | 54 | `opt.pass`, `opt.pipeline`, `opt.analysis` |
| §9.6.4 | 3 | `opt.pass`, `opt.pipeline`, `opt.analysis` |
| §9.6.6 · Algorithm 9.46 | 9 | `opt.pass`, `opt.pipeline`, `opt.analysis` |

## Configurations that deliberately produce no trace

| Trace kind | Configuration | Why |
| --- | --- | --- |
| `syntax.lr1-table` | grammarId=c-subset (hits the state cap) | cannot build the canonical LR(1) table for C subset: the canonical LR(1) collection is larger than the lab's 400-state cap (construction stopped after 400 states), and a table built from a truncated collection would be missing rows |

These are teaching outcomes, not bugs: the canonical LR(1) collection for the C subset blows
through the educational 400-state cap, which is precisely the argument for LALR(1) (§4.7.4).

## Cited in the code but not reached by these runs

The runs above only take the paths the sample programs take, so a rule cited on an error
path (or on a construct none of the samples uses) can be in the code and absent from every
trace here. This list comes from a static scan of `packages/core/src` for citation section
literals — it is a coverage note, not a defect list.

| Dragon Book | Declared in |
| --- | --- |
| §3.1.3 | `packages/core/src/lex/scanner.ts` |
| §3.4.1 | `packages/core/src/lex/scanner.ts` |
| §3.4.4 | `packages/core/src/lex/scanner.ts` |
| §6.6.1 | `packages/core/src/ir/gen.ts`, `packages/core/src/sem/typecheck.ts` |
| §8.3.1 | `packages/core/src/codegen/emit.ts`, `packages/core/src/codegen/isel.ts` |
| §9.5.1 | `packages/core/src/opt/passes/licm.ts` |

---

Grammar ids used above: `dragon-4.1` (the expression grammar of Fig 4.1), `dragon-4.28`
(the LL(1) expression grammar of Example 4.28), `dragon-4.55` (the LR(1) grammar of Example
4.55), `c-subset` (the lab’s C grammar — what the pipeline actually parses), and `c-subset-ll`
(the same grammar after left-recursion elimination and left factoring). See
`packages/app/src/worker/trace-kinds.ts` for the full parameter contract.


# Compiler Virtual Lab

An interactive lab that takes a C program and walks you through **all six phases of compiling it**,
one algorithm step at a time. Everything runs client-side in TypeScript: there is a real compiler in
here — a hand-written scanner, an LALR(1) parser built from our own table constructor, a type
checker, a three-address-code generator, a classic optimizer and an x86-64 back end — and every
algorithm records its own execution as a stream of events you can step, scrub, replay and deep-link.

No parser generators, no automata libraries. Every algorithm is implemented directly from
*Compilers: Principles, Techniques, & Tools* (Aho, Lam, Sethi & Ullman, 2nd ed. — the Dragon Book),
and **every recorded step carries a mandatory citation** into it. That citation index is generated
straight from the code: see [`docs/TEXTBOOK-MAP.md`](docs/TEXTBOOK-MAP.md).

## What you can actually do

Type (or pick) a C program, press **Compile**, and then:

- **Watch the scanner get built and then run.** Turn the `id`, `intconst` and `floatconst` regexes
  into NFAs by Thompson's construction, subset-construct them into DFAs, minimize them by partition
  refinement — then watch the DFA-driven scanner chew through *your* source with longest-match
  retraction, keyword lookup and symbol-table interning, one lexeme at a time.
- **Compare every parser in the book on the same grammar.** FIRST/FOLLOW fixed points; left-recursion
  elimination and left factoring shown as their own traced transformations; the LL(1) table with its
  conflict cells; recursive descent as a call tree; the LR(0) collection with its GOTO graph; SLR(1),
  canonical LR(1) and LALR(1) ACTION/GOTO tables — and the shift/reduce and reduce/reduce conflicts
  each one genuinely has. Switch to the book's study grammars (Fig 4.1, Example 4.28, Example 4.55)
  and the tables reproduce the published ones.
- **See the parse that actually happened.** The pipeline's parser is the LALR(1) machine our own
  constructor builds from the C-subset grammar: **147 states, merged from 553 canonical LR(1)
  states, with exactly one conflict** — the dangling `else`, resolved by shift with the §4.8.2
  explanation attached. Stepping the LR driver highlights each token in the editor as it is shifted.
- **Watch scopes open and close**, symbols get declared and looked up along the scope chain, types
  get synthesized bottom-up, and `int → float` widenings get inserted exactly where the rules demand.
- **See each AST node emit its quadruples**, including jumping code for `&&` / `||` / `!` and §6.7
  backpatching (`makelist` / `merge` / `backpatch`) as explicit steps. The same TAC is also shown as
  triples and indirect triples.
- **Run the optimizer with its analyses visible**: leaders and basic blocks, the CFG, the iterative
  dataflow framework converging (reaching definitions, live variables, available expressions),
  dominators and natural loops — then constant folding, constant propagation, copy propagation, CSE,
  loop-invariant code motion and dead-code elimination, each with a before/after diff of what it
  rewrote.
- **Allocate registers by graph coloring.** Instruction selection to x86-64 (AT&T syntax), backward
  liveness, interference-graph construction, Chaitin-style simplify/select with spilling. Drop *K*
  to 3 and watch real spills appear.
- **Run the result.** An x86-64 subset interpreter executes the emitted assembly step by step; it is
  also the test oracle that has to agree with the TAC interpreter.

Every phase has the same transport: prev / next / play / pause / reset, a speed control, a
macro-vs-micro step filter, a scrubber with named section ticks, and a per-algorithm **"Jump to…"**
menu whose entries are whatever that algorithm found interesting — next retraction, next keyword,
next lexical error, next new state, next GOTO, next conflict, next dataflow iteration, next
`makelist` / `backpatch` — each showing how many are left in the trace. Keyboard: ←/→ step,
Shift+←/→ jump a section, Space plays/pauses, Home/End go to the ends. Every step shows a prose
explanation and its Dragon Book citation badge. Selection lives in the URL
(`/syntax?algo=lalr&step=42`), so any step of any algorithm is a link. Errors are stopping points,
not dead ends: playback runs to the failing step and explains the rule that was violated, with the
source span highlighted.

## Quick start

Requires **Node ≥ 20** (developed on 24.4) and **pnpm** (developed on 11.5).

```bash
pnpm install          # once
pnpm dev              # → http://localhost:5173
```

That is the whole thing — no server, no database, no API keys. The compiler runs in a Web Worker;
the UI thread only ever sees JSON.

Everything else:

```bash
pnpm test        # the whole golden / invariant / property / integration suite (vitest, node env)
pnpm typecheck   # tsc --noEmit for packages/trace, packages/core, packages/app
pnpm build       # production build of the app into packages/app/dist
pnpm preview     # serve that build

pnpm exec jiti scripts/gen-textbook-map.ts           # regenerate docs/TEXTBOOK-MAP.md from the code
pnpm exec jiti scripts/gen-textbook-map.ts --check   # CI guard: fail if it is stale
```

## The supported C subset

Real C is not the point; a subset small enough to teach and big enough to be honest is. The
normative rules — typing, conversions, scoping, storage, evaluation — are in
[`docs/c-subset.md`](docs/c-subset.md), and `packages/core/src/csubset/` is the single source of
truth in code (token regexes, the grammar, the AST node types). In summary:

| | In the subset | Not in the subset |
| --- | --- | --- |
| Types | `int`, `float`, `char`, `void` (function returns), `T*`, `T[n]` | `struct`, `union`, `typedef`, casts, multi-dimensional arrays, function pointers |
| Expressions | arithmetic `+ - * / %`, relational, equality, logical `&&` `\|\|` `!` (short-circuit), assignment, `&x`, `*p`, `a[i]`, calls | `++` / `--`, comma operator, pointer arithmetic, `float → int` narrowing |
| Statements | `if` / `else`, `while`, `for`, `return`, blocks | `switch`, `do`-`while`, `break`, `continue`, `goto` |
| Declarations | globals with **constant** initializers, locals with any initializer, functions at top level | forward prototypes (call-before-definition is an error), nested functions |

Conversions are explicit: `char` promotes to `int`, and mixing `int` with `float` inserts a visible
`inttofloat` widening (§6.5.2). Arrays decay to pointers when passed. Declaration before use is
required everywhere; shadowing in inner scopes is legal. Anything outside the subset produces the
pedagogical diagnostic *"not in the lab's C subset"* — never a crash.

## The six phases

Each phase is a route; each algorithm is a recorded trace you can step through.

| Phase | Route | Algorithms you can step through | Dragon Book |
| --- | --- | --- | --- |
| Lexical analysis | `/lex` | Thompson construction · subset construction · DFA minimization (partition refinement) · the scanner driver (longest match with retraction, keyword table, symbol table, lexical errors) | §3.4, §3.7–3.9 |
| Syntax analysis | `/syntax` | FIRST/FOLLOW · left-recursion elimination · left factoring · LL(1) table + predictive parse · recursive descent · LR(0) items · SLR(1) table · canonical LR(1) items + table · LALR(1) merging + table · the LR driver | §4.3–4.8 |
| Semantic analysis | `/semantic` | scope construction, symbol declaration and lookup, type synthesis, implicit conversions, the error rules | §2.7, §6.3, §6.5 |
| Intermediate code | `/ir` | syntax-directed translation to three-address code · jumping code for booleans · backpatching · quadruple / triple / indirect-triple views | §6.2, §6.4, §6.6, §6.7 |
| Optimization | `/opt` | basic blocks · CFG · reaching definitions · live variables · available expressions · dominators · natural loops · const-fold · const-prop · copy-prop · CSE · LICM · DCE | §8.4–8.5, §9.1–9.6 |
| Code generation | `/codegen` | instruction selection (x86-64 AT&T) · liveness · interference graph · graph coloring with spilling · emission · execution | §8.2–8.9 |

The exact per-algorithm citation index — section, figure/algorithm, and the rule text quoted in each
step card — is generated from the code into [`docs/TEXTBOOK-MAP.md`](docs/TEXTBOOK-MAP.md).

## Architecture

```
packages/trace   the record/replay abstraction. Zero dependencies, no DOM.
packages/core    the compiler. Pure TypeScript, ES2022 lib only (no DOM), tested under node.
packages/app     the React app: routes, visualizations, editor, store, the compile worker.
```

Dependencies point one way: `app → core → trace`. Nothing in `core` knows a UI exists.

### The trace/replay contract

The whole design rests on one idea: **an algorithm is a generator that yields typed events, and a
view is a pure reducer that folds them into state.** From `packages/trace/src/trace.ts`:

```ts
type Steps<E, R> = Generator<[E, StepMeta], R, void>;   // the algorithm
type Reducer<S, E> = (state: S, event: E) => S;         // the view's state: pure, immutable

interface StepMeta {
  cite: Citation;                     // MANDATORY: { section, figureOrAlgo?, rule? }
  prose: string;                      // what THIS step did, in words
  level: 'macro' | 'micro';           // play() at macro level skips the micro detail
  groupId?: string; section?: string; // scrubber ticks and Shift+arrow section jumps
  srcSpans?: SourceSpan[];            // → highlight the editor
  irRefs?: IrRef[];                   // → highlight the upstream artifact
}
```

An algorithm module is therefore three exports plus a one-line recorder wrapper — here is the whole
of the dominator computation's plumbing (`packages/core/src/opt/dominators.ts`):

```ts
export function* computeDominators(cfg: Cfg): Steps<DominatorsEvent, DominatorsResult> { … }
export const initialDominatorsState: DominatorsState = { … };
export const dominatorsReducer: Reducer<DominatorsState, DominatorsEvent> = (state, event) => { … };

export function runComputeDominators(cfg: Cfg) {
  return record(() => computeDominators(cfg), initialDominatorsState, dominatorsReducer, {
    id: `opt.dominators.${cfg.functionName}`,
  });
}
```

`record()` runs the generator to completion, keeps every `[event, meta]` pair, and snapshots the
reduced state every 50 events. Those keyframes are what make `trace.stateAt(i)` cheap: jumping to
step 30 000 replays at most 50 events from the nearest keyframe, so scrubbing a 40 000-step LR(1)
construction is instant and `?step=` deep links resolve immediately. Traces cross the worker
boundary as plain JSON (`SerializedTrace`) and the route rebuilds a replayable trace locally with
the same reducer:

```ts
const payload = await getCompilerClient().getTrace({
  kind: 'syntax.lr0',
  params: { grammarId: 'dragon-4.1' },
});
const trace = traceFromSerialized<Lr0UiState, Lr0Event>(payload, lr0Reducer);
trace.stateAt(step);   // nearest keyframe + ≤50 events — no snapshots shipped over the wire
```

**The invariant that keeps this honest** (`checkTraceInvariants`, exercised in the tests for every
algorithm): folding *all* the events through the reducer must deep-equal the artifact the algorithm
returned. An algorithm that mutates state without emitting an event cannot pass. The checker also
verifies keyframe `stateAt(i)` ≡ full replay, and that every step has a non-empty citation section
and prose — an unciteable step fails the suite.

### One compilation drives all six phases

`compile(source)` in `packages/core/src/compile.ts` runs the real pipeline once, eagerly and
untraced:

```
scan → LALR(1) parse → semantic analysis → TAC generation → optimization → code generation
```

It returns a single immutable `Compilation` (`id = 'c-' + fnv1a(source)`) holding every artifact:
`tokens`, `ast`, `semantic`, `tac`, `optimized`, `asm`, `registers`, and all diagnostics ordered by
phase then span. A stage runs only if every earlier stage produced an artifact *and* emitted no
error; the failing stage still publishes what it produced (so you can inspect the tokens that led to
a syntax error) and everything downstream stays `null`. It never throws: an internal exception
becomes an "internal compiler error" diagnostic attached to that phase.

That single object is what every phase page renders, so the views cannot disagree with each other —
the AST on `/semantic` is the AST the parser on `/syntax` built, and the assembly on `/codegen` came
from the quads on `/ir`. The traces are the same story told slowly: the worker re-runs exactly the
stages a requested trace needs (memoized per source) and hands back the recording.

Everything is deterministic — no clocks, no randomness, no ambient state, worklists in grammar
order — which is precisely why `/syntax?algo=lalr&step=42` means the same thing tomorrow.

### Why generators + reducers

- **You cannot fake a step.** The replay invariant derives the artifact from the events, so the
  visualization *is* the algorithm rather than a re-implementation of it that drifts.
- **Memory.** An LR(1) construction on the C grammar emits ~40 000 events; snapshotting state per
  step would be hopeless. Events plus periodic keyframes are cheap, and `stateAt` is still fast.
- **The worker boundary is free.** Events and states are plain JSON by contract, so a trace
  structured-clones to the UI thread and the reducer rebuilds it there.
- **Textbook fidelity is checkable.** Golden tests assert that a trace's own numbering matches the
  book's published figures (Fig 3.34's NFA, Fig 4.31's LR(0) collection, Fig 4.37's SLR table,
  Fig 4.38's parse of `id * id + id`, the §9.2 reaching-definitions example…).
- **The prose and the citation live with the algorithm**, not in a UI file nobody updates.

### Testing strategy

`pnpm test` runs four layers in one vitest suite:

1. **Textbook goldens** — reproduce the book's published automata, sets, tables and traces exactly,
   in the book's own numbering: Fig 3.34's NFA, Fig 3.36/3.37's subset construction, Fig 3.65's
   minimized DFA, Fig 4.17's LL(1) table, Fig 4.31's LR(0) collection, Fig 4.37's SLR table,
   Fig 4.41/4.42's LR(1) sets and table, Fig 4.43's LALR merge, the §9.2 reaching-definitions example.
2. **Replay invariants** — per algorithm, via `checkTraceInvariants`: reduce(events) ≡ artifact,
   keyframe `stateAt(i)` ≡ full replay, and a non-empty citation and prose on every step.
3. **Cross-checking oracles** — the emitted x86-64, executed by our interpreter, must compute what
   the TAC interpreter computes over a spread of programs; every optimizer pass must leave the return
   value and the runtime-error behaviour unchanged; an allocator validity checker re-derives liveness
   over the final code and asserts that no two simultaneously-live pseudos share a register, that
   nothing collides with a pinned physical register, and that every spilled value round-trips
   through its own slot.
4. **Integration guards** — the acceptance sample end to end, error-path fixtures asserting message,
   span and cited rule, and an app-side test that every declared trace kind actually builds
   (`packages/app/test/trace-registry.test.ts`).

The oracles are fixture-driven, not randomized: `fast-check` is a declared dev dependency but no
test uses it yet, so `docs/PLAN.md`'s "property-based oracles" layer is still an intention rather
than a fact.

## Adding a new algorithm

The architecture claims to be extensible; here is the entire cost of adding, say, Hopcroft's
*O(n log n)* minimization next to the partition-refinement one.

1. **Write the algorithm as a generator** in `packages/core/src/<phase>/`: yield `[event, meta]`
   pairs, return the finished artifact. Cite every step —
   `{ section: '3.9.6', figureOrAlgo: 'Algorithm 3.39', rule: '…' }` — and write `prose` for someone
   reading it once. Mark detail steps `level: 'micro'` so playback can skip them, and set `section`
   for scrubber ticks.
2. **Define its event union, state and reducer** in the same module (or the phase's `*-events.ts`):
   `type XEvent = …`, `initialXState`, `xReducer`. The reducer must be pure and return new objects.
3. **Export a `runX()` wrapper** that calls `record(() => x(args), initialXState, xReducer, { id })`,
   and re-export it from `packages/core/src/index.ts` if the worker will use the barrel.
4. **Test it**: a golden against the book's published result, plus
   `checkTraceInvariants(runX(...), xReducer, project)`. If the reducer and the algorithm ever
   disagree, that is what tells you.
5. **Declare a trace kind** in `packages/app/src/worker/trace-kinds.ts` (description, `cite`, params,
   and the module / reducer / state / event names the UI needs) and add its builder to
   `TRACE_REGISTRY` in `packages/app/src/worker/registry.ts`. The registry test in
   `packages/app/test/trace-registry.test.ts` fails until the new kind builds a non-empty trace.
6. **Render it**: in the phase route, fetch with `getTraceOrError`, rebuild with
   `traceFromSerialized`, drive it with `useStepper`, and drop in the shared `<StepControls/>`,
   `<TracePanel/>`, `<ExplainCard/>` and `<CitationBadge/>`. Add an `?algo=` value so it deep-links.
7. **Regenerate the textbook map** (`pnpm exec jiti scripts/gen-textbook-map.ts`). Your algorithm's
   citations appear in `docs/TEXTBOOK-MAP.md` because they are in your code — not because you wrote
   them there.

Steps 1–4 are pure `core` work with no UI in sight; steps 5–6 are the only places the app learns the
algorithm exists. Nothing else in the system has to change.

## Known limitations

These are real, and we would rather say so than let you discover them.

**Educational caps**

- **Canonical LR(1) on the C grammar is capped at 400 states.** The collection genuinely blows past
  it, so `syntax.lr1` returns a *truncated* collection and `syntax.lr1-table` returns no table at
  all, with the §4.7.4 explanation attached instead of a frozen tab. That is the teaching point — it
  is exactly the argument for LALR(1), which merges those 553 LR(1) states into 147 — but it does
  mean there is no canonical LR(1) table for C in the app.
- **Recording stops at 200 000 events** (`maxEvents`), setting `truncated` and showing a banner; the
  algorithm still runs to completion, so the *artifact* is always exact. The subset construction for
  the `id` token class hits this (its `letter` alternation is 53-way), which is why the `id` automata
  sit behind an explicit "render anyway" gate in the lex view.
- **LR(1)/LALR table construction for the full C grammar exceeds the default event cap**, so the
  pipeline builds its tables untraced; the traced views use the study grammars or capped runs.

**Compiler subset**

- **No forward prototypes.** A function must be defined before it is called; call-before-definition
  is an error (so, no mutual recursion).
- **No pointer arithmetic**, no `struct` / `union` / `typedef` / casts, no multi-dimensional arrays,
  no `switch` / `do`-`while` / `break` / `continue` / `goto`, no `++` / `--`. See the table above and
  `docs/c-subset.md`.
- **Global initializers must be constant expressions**, and they are *not* translated into TAC: the
  §7.1 story is that a global's cell already holds its value before `main` starts. The interpreters
  do not execute them, so a program whose result depends on a non-zero global initializer will run
  differently here than under a real C implementation.
- **A missing `return` is a warning, not an error**, on the paths we check.

**Interpreters (the test oracles)**

- **The TAC interpreter gives every variable a fixed 4096-byte slot**, so an array of more than 1024
  `int`s overflows into the next variable's slot. Lab-sized programs are far below that; it is still
  a hard wall rather than a graceful one.
- `int` and `char` are 64-bit with **no overflow modeling**; `float` is an IEEE double. Uninitialized
  reads yield 0 — deliberately, so tests are deterministic. Division by zero is a runtime error
  surfaced in the run panel.

**Code generation**

- **Floats are not register-allocated, by design.** Every float value owns a frame slot and float
  instructions compute through the reserved SSE scratch `%xmm8` (§8.6 simple code generator);
  `%xmm0…%xmm7` are argument/return registers only. That is safe for a float live across a call and
  for more than eight simultaneously-live floats — at the cost of memory traffic. Only the eight
  general-purpose registers take part in the interference graph and the coloring.
- **K = 1 does not converge.** Three-address instructions need more simultaneously-live scratch
  values than one register can hold; the allocator reports that instead of looping forever. K ≥ 2
  converges on every fixture.
- The x86-64 output is an **educational subset** in AT&T syntax, executed by our own interpreter. It
  is not assembled or linked, and there is no instruction scheduling or peephole pass.

**Optimizer**

- **Each pass runs exactly once, in the fixed order** `const-fold → const-prop → copy-prop → cse →
  licm → dce` — there is no fixpoint loop over the pipeline. That is deliberate (the phase teaches
  one pass at a time, with a before/after diff per pass), but it means an opportunity a *later* pass
  creates for an *earlier* one is left on the table. In the gcd sample, `t1 = x + 0` is not foldable
  when const-folding runs; const-propagation then turns it into `t1 = 48 + 0`, and no second folding
  pass comes round to finish it. A real compiler would iterate; this one shows you why it has to.

**Front end / UI**

- **A page reload loses the compiled program.** The store is in memory only — nothing is written to
  `localStorage` and the source is not encoded in the URL. A deep link (`/codegen?tab=color&step=40`)
  therefore restores the *view* — phase, algorithm, tab, step — but not the *program*: the page opens
  on its "Compile a program to begin" card, whose Compile button re-runs the pipeline on the default
  example and then honours the `?step=` you arrived with. Sharing a link to your own edited source is
  not possible. This follows from the explicit-compile rule (edits never recompile behind your back),
  but it is a real limit of the deep links, not a feature.
- **One editor token misses WCAG AA in the light theme.** CodeMirror's bundled light theme paints C
  type keywords (`int`, `float`, `char`, `void`) at `#008855`, which measures 4.11:1 on the `--code-bg`
  surface — under the 4.5:1 required for body text. Every other token in both themes passes (light
  worst case otherwise 5.4:1, dark 4.8:1). The fix is to stop using the bundled themes and ship a
  HighlightStyle derived from our own tokens, which needs `@codemirror/language` and `@lezer/highlight`
  declared in `packages/app/package.json`.
- The **transformed C grammar is not fully LL(1)** — the dangling `else` and the `FuncDef` vs
  `VarDecl` prefix survive left factoring. The LL(1) views show those conflict cells rather than
  hiding them, and the top-down parsers use the documented disambiguation.

- Keyboard shortcuts are **focus-scoped** to the step controls (deliberate: the editor needs the
  arrow keys). The scrubber's section ticks ignore the slider thumb's width — cosmetic.
- `elkjs` is a **1.4 MB** chunk (438 kB gzipped) and CodeMirror another 526 kB. Both are split out
  and fetched only by the routes that need them (elk is imported dynamically by the graph view), but
  the graph-heavy phases are not featherweight.

## Documentation

| | |
| --- | --- |
| [`docs/SPEC.md`](docs/SPEC.md) | what the product must do — the original specification |
| [`docs/PLAN.md`](docs/PLAN.md) | the architecture decision and why (Gate A synthesis) |
| [`docs/c-subset.md`](docs/c-subset.md) | the normative language rules for the C subset |
| [`docs/TEXTBOOK-MAP.md`](docs/TEXTBOOK-MAP.md) | phase → algorithm → Dragon Book, **generated from the code** |
| [`docs/HANDOFF.md`](docs/HANDOFF.md) | the project record: what was built, what was fixed, what is left |
| `packages/app/src/worker/trace-kinds.ts` | the trace manifest — the contract between the worker and the phase UIs |

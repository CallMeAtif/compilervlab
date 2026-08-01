# Project record — Compiler Virtual Lab

Status as of **2026-08-01**. This file is the engineering record: what was built, in what order, what
was found wrong and fixed, and what is knowingly left. For the product tour, the architecture and the
honest limitation list, read [`../README.md`](../README.md) first.

## Verified state

Commands run in this tree, at the time of writing:

| Command | Result |
| --- | --- |
| `npx vitest run` | **45 files, 611 tests, all passing** |
| `pnpm typecheck` (`tsc --noEmit` × trace, core, app) | clean |
| `pnpm build` (`pnpm --filter app build`) | green; chunk-size warning only (elkjs 1.44 MB / 438 kB gzip, CodeMirror 526 kB) |
| `pnpm dev` | serves on http://localhost:5173 (HTTP 200, app shell renders) |
| `pnpm exec jiti scripts/gen-textbook-map.ts` | 52 of 53 configured traces build, 261 k recorded steps, 0 steps without a citation |

The one deliberate non-build is `syntax.lr1-table` on `c-subset` — see *Known limitations*.

## Gate A — architecture (done)

Three competing proposals were scored by a 3-judge panel; the algorithm-fidelity proposal won, with
ideas grafted from the other two. Outputs: [`PLAN.md`](PLAN.md) (the synthesized architecture and the
reasons), [`SPEC.md`](SPEC.md) (the product specification) and [`c-subset.md`](c-subset.md) (the
normative language rules, written *before* any phase work so the phases could not disagree).

Key decisions that everything else depends on:

- Algorithms are **pure generators yielding `[event, StepMeta]`**; views are **pure reducers**.
  Keyframes every 50 events give fast `stateAt(i)`. Every step carries a **mandatory** Dragon Book
  citation.
- **Pipeline honesty**: the compiler's real parse is the traced LALR(1) machine built by our own
  table constructor from the C-subset grammar. LL(1)/recursive descent run on the *algorithmically
  transformed* grammar (Algo 4.19 then 4.21, themselves traced). LR(0)/SLR surface their genuine
  conflicts as teaching material. Only the LALR parse feeds downstream.
- Strict module boundaries: `packages/trace` (no deps, no DOM) ← `packages/core` (no DOM) ←
  `packages/app`.

## Gate B — build (done)

**Wave 1 — platform + core algorithms.** `packages/trace` (record/replay, keyframes, invariants,
worker serialization); the phase artifact contracts in `packages/core/src`; then the algorithms:

- `core/src/lex/` — Thompson (Fig 3.34 exact), subset construction (Fig 3.36/3.37), minimization
  (Fig 3.65 + the §3.9.7 lexical refinement), the C scanner (longest match §3.8.3/Fig 3.54, reserved
  words §3.4.2, lexical errors).
- `core/src/grammar/` LL family — FIRST/FOLLOW (Ex 4.30), LL(1) table (Fig 4.17), LL(1) parse
  (Fig 4.21), recursive descent, transforms (Algo 4.19/4.21, with the 4.1 → 4.28 golden),
  `llReadyCGrammar()`.
- `core/src/grammar/` LR family + `core/src/ast/parser.ts` — LR(0) (Fig 4.31 exact numbering), SLR
  (Fig 4.37), the LR driver (Fig 4.38), canonical LR(1) (Fig 4.41/4.42), LALR merging (Fig 4.43),
  and the pipeline LALR parser that builds the AST. Dangling else is a real shift/reduce conflict
  resolved by shift (§4.8.2), emitted as an event.
- `core/src/sem/` — scopes, symbol table, type checking per `docs/c-subset.md`.
- `core/src/ir/` + `core/src/interp/tac.ts` — AST → TAC with §6.7 backpatching, triple/indirect
  views, and the TAC interpreter oracle.
- `core/src/opt/` — blocks/CFG (Algo 8.5), the iterative dataflow framework (reaching definitions
  golden, liveness, available expressions), dominators/loops, and the six passes.
- `core/src/codegen/` + `core/src/interp/asm.ts` — instruction selection (x86-64 AT&T), liveness,
  interference, Chaitin coloring with spilling, emission, the asm interpreter, and an allocator
  validity checker.

**Integration.** `core/src/compile.ts` runs the real pipeline eagerly; a stage runs only if every
earlier stage produced an artifact and emitted no error, the erroring stage still publishes what it
produced, and `compile` never throws (an exception becomes an "internal compiler error" diagnostic).
`Compilation.id = 'c-' + fnv1a(source)`. `packages/app/src/worker/` gained
`registry.ts` (Worker-free, therefore testable), the Comlink shell `compile.worker.ts`, and
`api.ts` (`getTraceOrError`, `getPipelineInfo`). **`trace-kinds.ts` is the manifest** — 26 trace
kinds, each with its params, the `@lab/core` subpath of its reducer, and its state/event type names.

**Wave 2 — the six phase UIs.** Every route under `packages/app/src/routes/` is real: `/lex` (four
tabs across the four lex trace kinds), `/syntax` (5 grammars × 10 algorithms, all 11 syntax trace
kinds), `/semantic` (nested scope boxes, animated scope-chain lookups, type-annotated AST),
`/ir` (AST ↔ TAC provenance both ways, backpatch panel, quad/triple/indirect views), `/opt`
(passes, analyses and pipeline views with per-line-justified diffs and a dedicated LICM panel),
`/codegen` (six tabs in pipeline order, ending in the asm interpreter's Run tab). Each view renders
`stepper.state` only — no algorithm state is re-derived in the UI — and every view is deep-linkable.

## Gate C — adversarial verification (done)

Eight independent verifier agents re-derived each phase from the book *by hand first*, then compared
against the code; all eight returned **defects-found**. A second wave of fix agents reproduced each
finding before fixing it and added a regression test per fix. Test count over the gate:
**455 → 515 → 526 → 567 → 569 → 587 → 611**.

**Lexical automata** — subset construction now emits the empty move `U = ε-closure(move(T,a)) = ∅`
as a traced step (Fig 3.32) instead of skipping it silently. Four further findings (Π mutated
mid-round, missing-accepting-states crash, §3.9.6-vs-§3.9.7 citation, unreachable state elected as
representative) were **not reproducible** — already correct — and one (Thompson intermediate
fragments vs Example 3.24) was rejected as not-a-defect.

**Scanner** — the most-repeated citation in the phase was wrong: the DFA-simulation rule cited
§3.8.2/Fig 3.49 (the Lex architecture diagram) instead of **§3.8.3/Fig 3.54**. Also fixed: keyword
lookup now cites §3.4.2; after a retraction the replayed DFA state was the dead-end state rather than
the accepting state backed up to; character-constant steps cited §3.8 for material not in §3.8 (two
with no rule at all); the end-of-input step's citation; rollback prose claimed "the DFA died" even
when the input simply ran out; and unterminated-character-constant recovery swallowed every
remaining token on the line.

**FIRST/FOLLOW and LL(1)** — the conflict note hard-coded the dangling-else story and cited §4.8.2
(an *LR* section) for every multiply-defined cell; it now branches on the resolution actually used
and cites §4.4.3 / Example 4.33. A k-way ambiguous cell is now **one** conflict record carrying the
cell's final contents. A divergence guard makes `ll1ParseSteps` always terminate. The moves-table
stack column header now matches the top-first rendering.

**LR(0)/SLR** — unresolved ACTION conflicts were being decided silently by item-discovery order, and
dangling else was not resolved per §4.8.2; the SLR conflict note was kind-agnostic and mis-cited
Example 4.48. Four other findings (including the `augment()` fresh-start-symbol claim) were rejected
as already-correct in the current code.

**LR(1)/LALR** — a merge-introduced reduce/reduce conflict could be masked by a shift that claimed
the cell first; conflicts are now one record per conflicted ACTION cell instead of one per
lookahead-split copy; accept-vs-reduce is classified as such instead of asserting a shift; the LALR
trace numbers table rows by the book's merged-state names; merged names stay unambiguous past
one-digit collections; and the educational LR(1) state cap now surfaces as truncation carrying the
§4.7.4 lesson rather than an internal fault.

**Semantics and IR** — one *critical*: **global variable initializers were dropped** between IR
generation and every consumer, silently producing a wrong answer with no diagnostic. Also: the
derived triple view for a multiply-defined temporary (boolean materialization, §6.6.6); pointer /
address instruction forms cited §6.2.2 instead of §6.2.1; Fig 6.22 cited §6.4.3 instead of §6.4.4;
a `void` call in a `for`-init/update was given a result temporary; float constants rendered
identically to ints.

**Optimization** — nine genuine defects, all soundness-relevant: const-prop propagated a constant
assigned on only one path (missing ENTRY dummy definitions); CSE reused an expression across a store
through a pointer; LICM hoisted a trapping instruction into the preheader of a possibly-zero-trip
loop; DCE deleted a dead division by zero, erasing a runtime error; the CFG omitted the block→EXIT
edge when a `return` was not the last instruction of its block; LICM's "preheader" was spliced in
front of the header label without checking whether the preceding block was inside the loop; the
`df-init` step never recorded the initialisation its own prose described; a conditional jump whose
target is also its fall-through emitted the CFG edge twice; and LICM attributed a 1st-edition rule
set to §9.1.5 while dominators cited an invented figure name.

**Code generation** — five, three of them wrong-code bugs:

1. **Array element addressing multiplied the already-scaled byte offset by 8 again.** `ir/gen.ts`
   emits `t = i * width` and `interp/tac.ts` reads `base + off` (§6.4.4 Fig 6.22), but codegen
   re-scaled it, so element *i* of an `int` array landed at `base + 32i` — past its frame slot and
   over the saved `%rbp` / return address. The shipped `array-sum.c` example returned 0 instead of 30.
2. **Float pseudos were handed `%xmm` registers by blind round-robin**, with no liveness: a float
   live across a call was destroyed by the `%xmm0` argument move, and a ninth live float aliased the
   first — silently. Floats are now memory-resident (`FrameReason 'float'`) and compute through the
   reserved scratch `%xmm8`.
3. **Callee-save `pushq`s were emitted after an already-16-aligned `subq`**, so an odd number of
   saved registers left `%rsp ≡ 8 (mod 16)` at every `call` while the step prose claimed a
   16-aligned frame. Frame allocation now includes the callee-save area in its alignment.
4. `LiveRange.liveAt` was documented as "quad indices" but holds selected-instruction indices
   (contract now pinned by a test).
5. The isel tile step claimed "maximal munch: choose the largest tile" although `tileQuad` has
   exactly one tile per opcode.

Also fixed earlier, during Gate B integration: `codegen/color.ts` SELECT coloured from all eight
`GP_REGISTERS` regardless of K, so a low K never actually spilled (SELECT now uses
`GP_REGISTERS.slice(0, K)`, `MAX_ROUNDS` 3 → 10); `lex/reducers.ts` re-exports its event unions so
each lex reducer module presents a full surface; `app/src/lib/hash.ts` re-exports `fnv1a` from
`@lab/core` so ids cannot drift.

## Gate D — testing, polish, docs

Four workstreams, run concurrently in this tree:

- **Docs (this workstream, complete and verified).** `README.md` rewritten as the front door
  (product tour, quick start, C subset, architecture with the trace/replay contract, the six-phase
  table, the extension story, and an honest limitations section). `docs/TEXTBOOK-MAP.md` is now
  **generated** by `scripts/gen-textbook-map.ts`: it builds every trace kind through the same worker
  registry the app uses and reports the `cite` of every recorded step — phase → algorithm → sections
  and figures → the rule text quoted in the step card — plus a reverse index, the configurations that
  deliberately produce no trace, and a static-scan list of citations that exist in the source but are
  not reached by the sampled runs. `--check` fails when the committed file is stale, which is the
  hook to put in CI. This file rewritten as the project record.
- **Browser end-to-end tests** (`packages/app/e2e/**`, `playwright.config.ts`, root `test:e2e`
  script) — owned by a sibling agent, landing in this tree; the config targets a production build
  served by `vite preview`. See that agent's report for its verification.
- **Bundle / code-splitting** (`packages/app/vite.config.ts`, route-level `React.lazy`) — vendor
  chunking into `react-vendor` / `codemirror` / `reactflow` / `elkjs` with the compiler confined to
  the worker chunk; elk is imported dynamically by the graph view.
- **UI/UX polish** (shared components, styles, overview) — typography/color/elevation system, both
  themes, responsive stacking, reduced-motion, accessibility sweep.

Because those three ran concurrently with this one, the chunk sizes and test counts above are what
*this* workstream measured; re-run `pnpm test` and `pnpm build` for the final numbers.

## Known limitations (kept deliberately)

The full, reader-facing list is in the README's *Known limitations*. The engineering-facing summary:

- **`syntax.lr1-table` on `c-subset` returns null**: the canonical LR(1) collection exceeds the
  educational 400-state cap, so the table cannot be built from a truncated collection. `syntax.lr1`
  returns the truncated collection instead — that *is* the teaching point (147 LALR states vs 553
  LR(1) states). The failure is reported as a §4.7.4 syntax diagnostic, never as an internal fault
  (guarded by a test in `packages/app/test/trace-registry.test.ts`).
- **Event cap 200 000** (`maxEvents`): the algorithm still runs to completion, so artifacts stay
  exact, but the *trace* is truncated and the UI must show the banner. `lex.subset` on the `id` token
  class hits this (53-way `letter` alternation), which is why the `id` automata are behind an
  explicit cost gate in the lex view. LR(1)/LALR table construction on the full C grammar also
  exceeds it, so the pipeline builds its tables untraced.
- **TAC interpreter**: fixed 4096-byte slot per variable (an array of > 1024 `int`s overflows into
  the next slot). Global initializers are constant-folded at compile time and are not executed
  before `main`.
- **Floats are not register-allocated by design** (frame slot + `%xmm8` scratch, §8.6); only the
  eight GP registers are coloured. **K = 1 cannot converge** and reports that instead of looping.
- **No forward prototypes** (call-before-definition is an error), no pointer arithmetic, no
  structs/unions/typedefs/casts, no multi-dimensional arrays, no `switch`/`do`-`while`/`break`/
  `continue`/`goto`, no `++`/`--`.
- The **transformed C grammar is genuinely not fully LL(1)** (dangling else; `FuncDef` vs `VarDecl`).
  The LL(1) views show the conflict cells; the top-down parsers use documented disambiguation.
- StepControls' scrubber ticks ignore the slider thumb width (cosmetic); keyboard shortcuts are
  focus-scoped by design.
- **`docs/PLAN.md`'s testing layer 3 ("property-based oracles", fast-check) was never implemented.**
  `fast-check` is a declared dev dependency with zero usages; the oracles that do exist (asm ≡ TAC,
  optimizer semantics preservation, allocator validity) are fixture-driven over curated program
  lists. The code wins, so the README describes what exists — but this is the obvious next test
  investment, and it is where the plan's "NFA ≡ DFA ≡ minimized DFA" and "all parsers agree on
  membership" checks would live (neither exists today).
- Three source files contain a literal `\0` inside a template-literal map key
  (`lex/minimize.ts`, `lex/reducers.ts`, `grammar/slr-table.ts`). Compilers and tests are fine with
  it, but `grep`/`file` classify those files as binary, so plain-text tooling silently skips them.

## Working on this repo

- `packages/app/src/worker/trace-kinds.ts` is the contract to read first: it names every trace kind,
  its parameters, and the reducer/module/state/event names a route needs.
- Adding an algorithm is seven mechanical steps — see *Adding a new algorithm* in the README. Steps
  1–4 are pure `core`; the app only learns about it in steps 5–6.
- After changing any citation, prose or algorithm, regenerate the textbook map:
  `pnpm exec jiti scripts/gen-textbook-map.ts` (and wire `--check` into CI so it cannot rot).
- The trace registry test (`packages/app/test/trace-registry.test.ts`) is the cheapest end-to-end
  guard in the repo: it fails the moment a declared trace kind stops building.

## Orchestration artifacts

Workflow scripts and per-agent journals live under
`~/.claude/projects/-Users-callmeatif-Documents-compiler-virtual-lab/4246f9da-453e-4935-bb68-d1d4a668add7/`
(`workflows/scripts/` and `subagents/workflows/<run-id>/journal.jsonl`):

| Gate | Run id |
| --- | --- |
| A — plan judge panel | `wf_bc6b0ab5-57e` |
| B wave 1 — core | `wf_89d06b5a-2c5` |
| B wave 2 — phase UIs | `wf_a607435e-d7e` |
| C — adversarial verification | `wf_230a80f2-e4b` |
| D — testing and polish | `wf_5f042fe2-9b4` |

21st.dev MCP was never connectable (API key required); the fallback per the spec — Tailwind v4 plus
shadcn-style components checked into the repo — is what is in use. The UI/UX Pro Max skill is
installed at `.claude/skills/ui-ux-pro-max`.

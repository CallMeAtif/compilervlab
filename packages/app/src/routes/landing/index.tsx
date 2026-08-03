/**
 * `/` — the public front door.
 *
 * The thesis: this product's world is compilers, so the hero IS the compiler.
 * `max.c` writes itself, and then SCROLL IS THE COMPILER — the page pins a
 * WebGL stage and drives one real C function through all seven states of the
 * pipeline: text, token cubes, a parse tree standing in space, types, quadruple
 * slabs, a control-flow graph, x86-64. See components/site/pipeline/.
 *
 * Below that spectacle the same six phases are set out statically, on one spine
 * rule, each paired with the Dragon Book section the lab cites and a link into
 * the run that produced it. That half is the reference: it needs no JavaScript,
 * no GPU and no scrolling to be complete, which is what makes it safe for the
 * pinned section above to be as elaborate as it is.
 *
 * Every listing on this page came out of this repository's compiler — see
 * components/site/max-program.ts. Nothing is illustrative.
 */
import { SiteHeader } from '../../components/site/SiteHeader';
import { SiteFooter } from '../../components/site/SiteFooter';
import { Artifact, PhaseSection } from '../../components/site/primitives';
import { Reveal } from '../../components/site/Reveal';
import { Pipeline } from '../../components/site/pipeline/Pipeline';
import { AST_PREFIXES } from '../../components/site/pipeline/program-geometry';
import {
  AST_NODES,
  BLOCKS,
  GRAMMAR_FACTS,
  OPT_PASSES,
  QUADS,
  REGISTER_ASSIGNMENT,
  SCOPES,
  SYMBOL_TABLE,
} from '../../components/site/max-program';

export default function LandingRoute() {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas font-inter">
      <SiteHeader />

      <main id="main" tabIndex={-1} className="flex-1 outline-none">
        <Pipeline />

        {/* ── The pipeline, at rest ────────────────────────────────────── */}
        <div className="mx-auto max-w-[84rem] px-4 pt-16 sm:px-6 sm:pt-24">
          <Reveal className="border-t border-line pt-10 sm:pt-14">
            <h2 className="site-heading max-w-[22ch]">
              The same four lines, all the way down to registers.
            </h2>
            <p className="site-body mt-3 max-w-[58ch]">
              Six phases, six artifacts, one program. Every listing below is what the lab produced
              for <code>max.c</code>. Open any phase to step through the run that made it.
            </p>
          </Reveal>

          <div className="site-spine mt-12 flex flex-col gap-16 sm:mt-16 sm:gap-24">
            {/* 01 ── Lexical ───────────────────────────────────────────── */}
            <PhaseSection
              ordinal="01"
              name="Lexical"
              cite="§3.8.3 · Fig 3.54"
              href="/lab/lex"
              title="Characters become tokens"
              artifact={
                <Artifact caption="symbol table · 23 tokens · 3 entries">
                  <table className="w-full text-left tabular-nums">
                    <thead className="text-2xs text-ink-faint">
                      <tr>
                        <th className="pr-4 pb-2 font-normal">id</th>
                        <th className="pr-4 pb-2 font-normal">lexeme</th>
                        <th className="pr-4 pb-2 font-normal">first seen</th>
                        <th className="pb-2 font-normal">uses</th>
                      </tr>
                    </thead>
                    <tbody>
                      {SYMBOL_TABLE.map((s) => (
                        <tr key={s.id} className="border-t border-line">
                          <td className="py-1.5 pr-4 text-ink-faint">{s.id}</td>
                          <td className="py-1.5 pr-4 text-ink">{s.lexeme}</td>
                          <td className="py-1.5 pr-4 text-ink-muted">
                            {s.line}:{s.col}
                          </td>
                          <td className="py-1.5 text-ink-muted">{s.occurrences}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Artifact>
              }
            >
              The scanner takes the longest match at each position and retracts when a match fails.
              Identifiers are interned as it goes, so the <code>a</code> in the parameter list and
              the <code>a</code> in <code>return a</code> are one symbol seen three times — the
              entry every later phase looks up.
            </PhaseSection>

            {/* 02 ── Syntax ────────────────────────────────────────────── */}
            <PhaseSection
              ordinal="02"
              name="Syntax"
              cite="§4.7.4 · Fig 4.43"
              href="/lab/syntax"
              title="Tokens become a tree"
              artifact={
                <Artifact caption="abstract syntax tree · 13 nodes">
                  <div className="whitespace-pre">
                    {AST_NODES.map((n, i) => (
                      <div key={`${n.kind}-${i}`}>
                        <span className="text-ink-faint">{AST_PREFIXES[i]}</span>
                        <span className="text-ink">{n.kind}</span>
                        {n.detail ? <span className="text-ink-muted"> {n.detail}</span> : null}
                      </div>
                    ))}
                  </div>
                </Artifact>
              }
            >
              The parser is a real LALR(1) machine built by this repo's own table constructor:{' '}
              {GRAMMAR_FACTS.canonicalLr1States} canonical LR(1) states merged by core down to{' '}
              {GRAMMAR_FACTS.lalrStates}. Shifting and reducing over {GRAMMAR_FACTS.productions}{' '}
              productions leaves this tree behind.
            </PhaseSection>

            {/* 03 ── Semantic ──────────────────────────────────────────── */}
            <PhaseSection
              ordinal="03"
              name="Semantic"
              cite="§2.7 · §6.5"
              href="/lab/semantic"
              title="Names get scopes and types"
              artifact={
                <Artifact caption="scope tree · 2 scopes · 3 symbols · 0 conversions">
                  {SCOPES.map((scope) => (
                    <div key={scope.id} style={{ paddingLeft: `${scope.id * 1.25}rem` }}>
                      <div className="text-ink-faint">
                        scope {scope.id} · {scope.kind}
                        {scope.label ? ` ${scope.label}` : ''}
                      </div>
                      {scope.entries.map((e) => (
                        <div key={e.name} className="pt-1 pl-5">
                          <span className="text-ink">{e.name}</span>
                          <span className="text-ink-faint"> : </span>
                          <span className="text-ink-muted">{e.type}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </Artifact>
              }
            >
              Each identifier is resolved to a declaration in an enclosing scope and given a type.
              Comparing two <code>int</code>s needs no conversion here; a mixed comparison would get
              an <code>int → float</code> widening inserted before the operator, and the lab marks
              the node it was inserted at.
            </PhaseSection>

            {/* 04 ── Intermediate ──────────────────────────────────────── */}
            <PhaseSection
              ordinal="04"
              name="Intermediate"
              cite="§6.4 · §6.6"
              href="/lab/ir"
              title="The tree flattens into quadruples"
              artifact={
                <Artifact caption="three-address code · 6 quadruples · 0 temporaries">
                  <div className="whitespace-pre">
                    {QUADS.map((q) => (
                      <div key={q.index} className="flex gap-3">
                        <span className="w-4 shrink-0 text-right text-ink-faint tabular-nums">
                          {q.index}
                        </span>
                        <span className={q.text.endsWith(':') ? 'text-ink' : 'text-ink-muted'}>
                          {q.text}
                        </span>
                      </div>
                    ))}
                  </div>
                </Artifact>
              }
            >
              Statements become three-address instructions. The <code>if</code> emits a jump to a
              label that does not exist yet: the quad is left with a hole, kept on a list, and
              filled in once the target's address is known — backpatching.
            </PhaseSection>

            {/* 05 ── Optimization ──────────────────────────────────────── */}
            <PhaseSection
              ordinal="05"
              name="Optimization"
              cite="§8.4 · §9"
              href="/lab/opt"
              title="Quads become blocks, blocks become a graph"
              artifact={
                <Artifact caption="control-flow graph · 4 blocks · 6 edges · 6 passes, 0 changes">
                  <div className="space-y-2">
                    {BLOCKS.map((b) => (
                      <div key={b.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="text-ink">{b.id}</span>
                        <span className="text-2xs text-ink-faint">quads {b.quads}</span>
                        <span className="text-ink-muted">{b.body}</span>
                        <span className="text-2xs text-ink-faint">→ {b.to.join(', ')}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-1.5 border-t border-line pt-3">
                    {OPT_PASSES.map((p) => (
                      <span
                        key={p}
                        className="rounded-xs border border-line px-1.5 py-0.5 text-2xs text-ink-faint"
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                </Artifact>
              }
            >
              A leader starts a block, and the blocks are wired into a control-flow graph. Six
              passes then run in order — constant folding, constant and copy propagation, common
              subexpression elimination, loop-invariant code motion, dead-code elimination. On{' '}
              <code>max</code> none of them finds anything to change, which is a result worth
              reading too.
            </PhaseSection>

            {/* 06 ── Code generation ───────────────────────────────────── */}
            <PhaseSection
              ordinal="06"
              name="Codegen"
              cite="§8.8 · §7.2"
              href="/lab/codegen"
              title="Live ranges get coloured, quads get instructions"
              artifact={
                <Artifact caption="register allocation · 2 live variables · 1 edge · 0 spills">
                  <div className="whitespace-pre">
                    <div className="text-ink-faint">interference graph</div>
                    <div className="mt-1 text-ink">a ── b</div>
                    <div className="mt-4 text-ink-faint">assignment</div>
                    {REGISTER_ASSIGNMENT.map((r) => (
                      <div key={r.name} className="mt-1">
                        <span className="text-ink">{r.name}</span>
                        <span className="text-ink-faint"> → </span>
                        <span className="text-ink">{r.reg}</span>
                      </div>
                    ))}
                    <div className="mt-4 text-ink-faint">spilled: none</div>
                  </div>
                </Artifact>
              }
            >
              Every quad selects an instruction, and overlapping live ranges become edges in an
              interference graph. <code>a</code> and <code>b</code> are live at the same moment, so
              they interfere and take different registers. Two colours are enough, so nothing spills
              to the stack.
            </PhaseSection>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

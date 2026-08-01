/**
 * Generator for docs/TEXTBOOK-MAP.md.
 *
 * The map is NOT hand-written. This script runs every trace the lab can produce
 * (through the same registry the compile worker uses) and reads the `cite`
 * field of every recorded `StepMeta` — the mandatory Dragon Book citation that
 * `packages/trace/src/trace.ts` requires of every step. The document is
 * therefore a report of what the code actually emits: if an algorithm's
 * citation changes, the map changes on the next run, and if a citation is
 * missing the map says so out loud.
 *
 * Run it with:
 *
 *     pnpm exec jiti scripts/gen-textbook-map.ts
 *
 * (`jiti` is the TypeScript loader that ships in the workspace; it resolves the
 * `@lab/core` workspace package and the app's extensionless imports the same
 * way Vite does. Add `--check` to fail instead of writing when the committed
 * file is out of date — useful in CI.)
 */
import { writeFileSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { buildTrace } from '../packages/app/src/worker/registry';
import {
  TRACE_KINDS,
  TRACE_KIND_NAMES,
  type TraceKind,
  type TraceKindSpec,
} from '../packages/app/src/worker/trace-kinds';
import { gcdAcceptanceSource } from '../packages/app/src/examples/gcd-acceptance.c';
import { arraySumSource } from '../packages/app/src/examples/array-sum.c';
import { floatAverageSource } from '../packages/app/src/examples/float-average.c';
import { typeErrorSource } from '../packages/app/src/examples/type-error.c';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '..', 'docs', 'TEXTBOOK-MAP.md');
const CORE_SRC = resolve(HERE, '..', 'packages', 'core', 'src');

/** Short-circuit `&&`/`||`/`!`, whose jumping code (§6.6) no shipped example uses. */
const BOOLEAN_SOURCE = `int limit = 2 + 3;   // constant-expression global initializer (§7.1)

int classify(int a, int b) {
    int flag;
    flag = a > 0 && b > 0;   // boolean in VALUE context: jumping code + 0/1 (§6.6.6)
    if (a < 0 || b < 0) { return -1; }
    if (!flag) { return 0; }
    return limit;
}

int main() { return classify(3, 4); }
`;

/** A program with a lexical error, so the scanner's error rules are exercised. */
const LEX_ERROR_SOURCE = `int main() {
    int x = 1;
    x = x @ 2;   /* '@' starts no token in the subset
    return x;
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// What to run
// ─────────────────────────────────────────────────────────────────────────────

interface Run {
  kind: TraceKind;
  params: Record<string, unknown>;
  /** How the parameters read in the document. */
  label: string;
}

const source = gcdAcceptanceSource;

/**
 * One run per interesting configuration of every declared trace kind. Kinds
 * that dispatch on a parameter (opt.analysis, opt.pass, syntax.transforms) get
 * one run per value, because each value is a different textbook algorithm.
 * Grammar-parameterised kinds are run on the book's study grammar *and* on the
 * lab's C grammar where both are meaningful — that difference is the point of
 * several of the visualizations.
 */
const RUNS: Run[] = [
  // Lexical analysis
  { kind: 'lex.thompson', params: { classIndex: 1 }, label: 'classIndex=1 (intconst)' },
  { kind: 'lex.subset', params: { classIndex: 1 }, label: 'classIndex=1 (intconst)' },
  {
    kind: 'lex.subset',
    params: { classIndex: 0 },
    label: 'classIndex=0 (identifier — 53-way `letter`, blows the 200k event cap)',
  },
  { kind: 'lex.minimize', params: { classIndex: 1 }, label: 'classIndex=1 (intconst)' },
  { kind: 'lex.scan', params: { source }, label: 'the acceptance sample' },
  {
    kind: 'lex.scan',
    params: { source: LEX_ERROR_SOURCE },
    label: 'a program with a lexical error (stray `@`, unterminated comment)',
  },

  // Syntax — LL family
  { kind: 'syntax.first-follow', params: { grammarId: 'dragon-4.28' }, label: 'grammarId=dragon-4.28' },
  { kind: 'syntax.first-follow', params: { grammarId: 'c-subset-ll' }, label: 'grammarId=c-subset-ll' },
  { kind: 'syntax.ll1-table', params: { grammarId: 'dragon-4.28' }, label: 'grammarId=dragon-4.28' },
  { kind: 'syntax.ll1-table', params: { grammarId: 'c-subset-ll' }, label: 'grammarId=c-subset-ll' },
  {
    kind: 'syntax.ll1-parse',
    params: { grammarId: 'dragon-4.28', source: 'id + id * id' },
    label: "grammarId=dragon-4.28, source='id + id * id'",
  },
  {
    kind: 'syntax.rd',
    params: { grammarId: 'dragon-4.28', source: 'id + id * id' },
    label: "grammarId=dragon-4.28, source='id + id * id'",
  },
  {
    kind: 'syntax.transforms',
    params: { grammarId: 'c-subset', stage: 'eliminate-left-recursion' },
    label: 'grammarId=c-subset, stage=eliminate-left-recursion',
  },
  {
    kind: 'syntax.transforms',
    params: { grammarId: 'c-subset', stage: 'left-factor' },
    label: 'grammarId=c-subset, stage=left-factor',
  },

  // Syntax — LR family
  { kind: 'syntax.lr0', params: { grammarId: 'dragon-4.1' }, label: 'grammarId=dragon-4.1' },
  { kind: 'syntax.slr', params: { grammarId: 'dragon-4.1' }, label: 'grammarId=dragon-4.1' },
  { kind: 'syntax.slr', params: { grammarId: 'c-subset' }, label: 'grammarId=c-subset' },
  { kind: 'syntax.lr1', params: { grammarId: 'dragon-4.55' }, label: 'grammarId=dragon-4.55' },
  { kind: 'syntax.lr1', params: { grammarId: 'c-subset' }, label: 'grammarId=c-subset (hits the state cap)' },
  { kind: 'syntax.lr1-table', params: { grammarId: 'dragon-4.55' }, label: 'grammarId=dragon-4.55' },
  { kind: 'syntax.lr1-table', params: { grammarId: 'c-subset' }, label: 'grammarId=c-subset (hits the state cap)' },
  { kind: 'syntax.lalr', params: { grammarId: 'dragon-4.55' }, label: 'grammarId=dragon-4.55' },
  {
    kind: 'syntax.lalr',
    params: { grammarId: 'c-subset', resolveDanglingElseByShift: true },
    label: 'grammarId=c-subset, resolveDanglingElseByShift=true (the pipeline parser)',
  },
  {
    kind: 'syntax.lr-parse',
    params: { grammarId: 'dragon-4.1', table: 'slr', source: 'id * id + id' },
    label: "grammarId=dragon-4.1, table=slr, source='id * id + id'",
  },
  {
    kind: 'syntax.lr-parse',
    params: { grammarId: 'c-subset', table: 'lalr', source },
    label: 'grammarId=c-subset, table=lalr, the acceptance sample',
  },

  // Semantic analysis / IR
  { kind: 'sem.analyze', params: { source }, label: 'the acceptance sample' },
  { kind: 'sem.analyze', params: { source: floatAverageSource }, label: 'float-average (widening conversions)' },
  { kind: 'sem.analyze', params: { source: typeErrorSource }, label: 'type-error (the error rules)' },
  {
    kind: 'sem.analyze',
    params: { source: 'int n;\nint g = n + 1;\nint main() { return g; }\n' },
    label: 'a non-constant global initializer (§7.1 storage rule)',
  },
  { kind: 'ir.gen', params: { source }, label: 'the acceptance sample' },
  { kind: 'ir.gen', params: { source: arraySumSource }, label: 'array-sum (addressing)' },
  { kind: 'ir.gen', params: { source: BOOLEAN_SOURCE }, label: '&&, ||, ! (jumping code)' },

  // Optimization
  ...(['const-fold', 'const-prop', 'copy-prop', 'cse', 'licm', 'dce'] as const).map(
    (pass): Run => ({ kind: 'opt.pass', params: { source, pass }, label: `pass=${pass}` }),
  ),
  { kind: 'opt.pipeline', params: { source }, label: 'the acceptance sample' },
  ...(
    ['basic-blocks', 'cfg', 'reaching-defs', 'live-vars', 'avail-exprs', 'dominators', 'loops'] as const
  ).map((analysis): Run => ({
    kind: 'opt.analysis',
    params: { source, analysis, functionName: 'gcd' },
    label: `analysis=${analysis}, functionName=gcd`,
  })),

  // Code generation
  { kind: 'codegen.isel', params: { source }, label: 'the acceptance sample' },
  { kind: 'codegen.liveness', params: { source }, label: 'the acceptance sample' },
  { kind: 'codegen.interference', params: { source }, label: 'the acceptance sample' },
  { kind: 'codegen.color', params: { source }, label: 'the acceptance sample (k = 8, the default)' },
  { kind: 'codegen.color', params: { source, k: 3 }, label: 'k=3 — forces real spills' },
  { kind: 'codegen.emit', params: { source }, label: 'the acceptance sample' },
  { kind: 'codegen.exec', params: { source }, label: 'the acceptance sample' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Collect
// ─────────────────────────────────────────────────────────────────────────────

interface Citation {
  section: string;
  figureOrAlgo?: string;
  rule?: string;
}
interface StepMetaLike {
  cite: Citation;
  prose: string;
  level: string;
  section?: string;
}

interface CiteGroup {
  section: string;
  figureOrAlgo: string;
  steps: number;
  rules: string[]; // distinct, in order of first appearance
}

interface RunResult extends Run {
  ok: boolean;
  traceId: string;
  steps: number;
  truncated: boolean;
  /** Scrubber sections (StepMeta.section) in order of first appearance. */
  sections: string[];
  cites: CiteGroup[];
  /** Steps whose citation carries no section — a contract violation. */
  uncited: number;
  diagnostics: string[];
}

function citeKey(c: Citation): string {
  return `${c.section} :: ${c.figureOrAlgo ?? ''}`;
}

function runOne(run: Run): RunResult {
  const res = buildTrace({ kind: run.kind, params: run.params });
  if (!res.trace) {
    return {
      ...run,
      ok: false,
      traceId: '',
      steps: 0,
      truncated: false,
      sections: [],
      cites: [],
      uncited: 0,
      diagnostics: res.diagnostics.map((d) => d.message),
    };
  }
  const groups = new Map<string, CiteGroup>();
  const sections: string[] = [];
  let uncited = 0;
  for (const step of res.trace.steps as ReadonlyArray<{ meta: StepMetaLike }>) {
    const cite = step.meta.cite;
    if (!cite || !cite.section) {
      uncited++;
      continue;
    }
    const key = citeKey(cite);
    let g = groups.get(key);
    if (!g) {
      g = { section: cite.section, figureOrAlgo: cite.figureOrAlgo ?? '', steps: 0, rules: [] };
      groups.set(key, g);
    }
    g.steps++;
    if (cite.rule && !g.rules.includes(cite.rule)) g.rules.push(cite.rule);

    const s = step.meta.section;
    if (s && sections[sections.length - 1] !== s && !sections.includes(s)) sections.push(s);
  }
  return {
    ...run,
    ok: true,
    traceId: res.trace.id,
    steps: res.trace.steps.length,
    truncated: res.trace.truncated,
    sections,
    cites: [...groups.values()].sort((a, b) => b.steps - a.steps),
    uncited,
    diagnostics: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Static cross-check: which citations exist in the source but were not emitted?
//
// The runs above only exercise the paths the sample programs take, so a rule
// cited on (say) an error path can be in the code and absent from every trace.
// This best-effort scan finds section-number literals on lines that build a
// citation, so the document can be honest about its own coverage.
// ─────────────────────────────────────────────────────────────────────────────

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = resolve(dir, entry);
    if (statSync(p).isDirectory()) out.push(...tsFilesUnder(p));
    else if (entry.endsWith('.ts')) out.push(p);
  }
  return out.sort();
}

function scanDeclaredSections(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>(); // section → files
  const sectionLiteral = /'(\d+(?:\.\d+){1,3})'/gu;
  for (const file of tsFilesUnder(CORE_SRC)) {
    const rel = file.slice(file.indexOf('packages/'));
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!/\bcite\b|section:/u.test(line)) continue;
      for (const m of line.matchAll(sectionLiteral)) {
        const sec = m[1]!;
        let set = found.get(sec);
        if (!set) found.set(sec, (set = new Set()));
        set.add(rel);
      }
    }
  }
  return found;
}

// ─────────────────────────────────────────────────────────────────────────────
// Render
// ─────────────────────────────────────────────────────────────────────────────

const PHASES: Array<{ prefix: string; title: string; route: string; blurb: string }> = [
  {
    prefix: 'lex',
    title: 'Lexical Analysis',
    route: '/lex',
    blurb: 'Regular expressions → NFA → DFA → minimized DFA, then the DFA-driven scanner on your source.',
  },
  {
    prefix: 'syntax',
    title: 'Syntax Analysis',
    route: '/syntax',
    blurb: 'FIRST/FOLLOW, grammar transforms, LL(1), recursive descent, LR(0)/SLR, canonical LR(1), LALR(1), and the parse itself.',
  },
  {
    prefix: 'sem',
    title: 'Semantic Analysis',
    route: '/semantic',
    blurb: 'Scope stack, symbol table, type synthesis and the implicit conversions it inserts.',
  },
  {
    prefix: 'ir',
    title: 'Intermediate Code',
    route: '/ir',
    blurb: 'Syntax-directed translation to three-address code, jumping code for booleans, backpatching.',
  },
  {
    prefix: 'opt',
    title: 'Optimization',
    route: '/opt',
    blurb: 'Basic blocks and the CFG, the dataflow framework, dominators and loops, and six rewriting passes.',
  },
  {
    prefix: 'codegen',
    title: 'Code Generation',
    route: '/codegen',
    blurb: 'Instruction selection to x86-64, liveness, interference-graph coloring with spilling, emission, execution.',
  },
];

const esc = (s: string): string => s.replace(/\|/gu, '\\|').replace(/\n/gu, ' ');
const num = (n: number): string => n.toLocaleString('en-US');

function anchorOf(g: CiteGroup): string {
  return g.figureOrAlgo ? `§${g.section} · ${g.figureOrAlgo}` : `§${g.section}`;
}

/** Scrubber tick-mark names, capped: some collections have one per state. */
function sectionList(sections: string[]): string {
  const MAX = 10;
  const shown = sections.slice(0, MAX).map((s) => `\`${s}\``);
  const rest = sections.length - shown.length;
  return shown.join(' · ') + (rest > 0 ? ` · …and ${rest} more` : '');
}

function rulesCell(g: CiteGroup): string {
  if (g.rules.length === 0) return '—';
  const shown = g.rules.slice(0, 3).map((r) => `“${esc(r)}”`);
  const rest = g.rules.length - shown.length;
  return shown.join('<br>') + (rest > 0 ? `<br>…and ${rest} more rule text(s)` : '');
}

function render(results: RunResult[]): string {
  const out: string[] = [];
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const totalSteps = ok.reduce((n, r) => n + r.steps, 0);
  const allSections = new Set<string>();
  for (const r of ok) for (const g of r.cites) allSections.add(g.section);

  out.push('# Textbook Map — the lab ↔ the Dragon Book');
  out.push('');
  out.push(
    '<!-- GENERATED FILE — do not edit by hand. Regenerate with:',
    '     pnpm exec jiti scripts/gen-textbook-map.ts',
    '-->',
  );
  out.push('');
  out.push(
    'Every step of every visualization in this lab carries a **mandatory citation** into',
    '*Compilers: Principles, Techniques, & Tools* (Aho, Lam, Sethi & Ullman, 2nd ed.) — the',
    '`cite: Citation` field of `StepMeta` in `packages/trace/src/trace.ts`. An unciteable step is',
    'treated as a design smell, so the citations are a complete index of what the lab teaches.',
    '',
    '**This file is generated from those citations, not written by hand.**',
    '`scripts/gen-textbook-map.ts` builds every trace the compile worker can produce (through the',
    'same `packages/app/src/worker/registry.ts` the app uses), reads the `cite` of every recorded',
    'step, and prints what it found. Documentation generated this way cannot drift away from the',
    'code: change an algorithm’s citation and the next run of the script changes this file.',
    '',
    'Regenerate:',
    '',
    '```bash',
    'pnpm exec jiti scripts/gen-textbook-map.ts          # rewrite docs/TEXTBOOK-MAP.md',
    'pnpm exec jiti scripts/gen-textbook-map.ts --check  # CI: fail if the committed file is stale',
    '```',
    '',
  );
  out.push(
    `Snapshot of this run: **${ok.length} traces** built from **${TRACE_KIND_NAMES.length} trace kinds**, ` +
      `**${num(totalSteps)} recorded steps**, **${allSections.size} distinct Dragon Book sections** cited, ` +
      `**${ok.reduce((n, r) => n + r.uncited, 0)} steps without a citation**.`,
  );
  out.push('');
  out.push('---');
  out.push('');

  // ── Per phase ──────────────────────────────────────────────────────────────
  for (const phase of PHASES) {
    const kinds = TRACE_KIND_NAMES.filter((k) => k.startsWith(`${phase.prefix}.`));
    out.push(`## ${phase.title} — \`${phase.route}\``);
    out.push('');
    out.push(phase.blurb);
    out.push('');

    // Phase summary table.
    out.push('| Trace kind | What the visualization shows | Dragon Book anchors (from the code) |');
    out.push('| --- | --- | --- |');
    for (const kind of kinds) {
      const runs = results.filter((r) => r.kind === kind && r.ok);
      const anchors = new Set<string>();
      for (const r of runs) for (const g of r.cites) anchors.add(anchorOf(g));
      const spec = TRACE_KINDS[kind] as TraceKindSpec;
      out.push(
        `| \`${kind}\` | ${esc(spec.description)} | ${
          anchors.size > 0 ? [...anchors].map((a) => esc(a)).join('<br>') : '— (no trace built)'
        } |`,
      );
    }
    out.push('');

    // Detail per kind.
    for (const kind of kinds) {
      const runs = results.filter((r) => r.kind === kind);
      const spec = TRACE_KINDS[kind] as TraceKindSpec;
      out.push(`### \`${kind}\``);
      out.push('');
      out.push(`${spec.description}`);
      out.push('');
      out.push(`*Manifest anchor* (\`trace-kinds.ts\`): ${esc(spec.cite)}`);
      if (spec.notes) out.push(`*Note*: ${esc(spec.notes)}`);
      out.push('');
      for (const r of runs) {
        if (!r.ok) {
          out.push(
            `**Traced as** ${esc(r.label)} → **no trace**: ${r.diagnostics.map(esc).join(' · ') || 'unknown reason'}`,
            '',
          );
          continue;
        }
        const parts = [
          `**Traced as** ${esc(r.label)} → \`${r.traceId}\`, ${num(r.steps)} steps`,
          r.truncated ? '**(event cap hit — trace truncated)**' : '',
          r.sections.length > 0 ? `\n\nStep sections: ${sectionList(r.sections)}` : '',
        ];
        out.push(parts.filter(Boolean).join(' '));
        out.push('');
        out.push('| Dragon Book | Steps | Rule text quoted in the step card |');
        out.push('| --- | ---: | --- |');
        for (const g of r.cites) {
          out.push(`| ${esc(anchorOf(g))} | ${num(g.steps)} | ${rulesCell(g)} |`);
        }
        if (r.uncited > 0) {
          out.push(`| **(missing citation)** | ${num(r.uncited)} | ⚠️ steps with no \`cite.section\` |`);
        }
        out.push('');
      }
    }
    out.push('---');
    out.push('');
  }

  // ── Reverse index ──────────────────────────────────────────────────────────
  out.push('## Reverse index — Dragon Book section → where it appears');
  out.push('');
  out.push('Sorted by section number. “Steps” totals every run listed above.');
  out.push('');
  const byAnchor = new Map<string, { anchor: string; steps: number; kinds: Set<string> }>();
  for (const r of ok) {
    for (const g of r.cites) {
      const anchor = anchorOf(g);
      let e = byAnchor.get(anchor);
      if (!e) byAnchor.set(anchor, (e = { anchor, steps: 0, kinds: new Set() }));
      e.steps += g.steps;
      e.kinds.add(r.kind);
    }
  }
  const sectionSort = (a: string, b: string): number => {
    const pa = a.replace(/^§/u, '').split(/[ .·]/u);
    const pb = b.replace(/^§/u, '').split(/[ .·]/u);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const na = Number(pa[i] ?? ''), nb = Number(pb[i] ?? '');
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
      if (!Number.isFinite(na) || !Number.isFinite(nb)) return a.localeCompare(b);
    }
    return a.localeCompare(b);
  };
  out.push('| Dragon Book | Steps | Trace kinds |');
  out.push('| --- | ---: | --- |');
  for (const e of [...byAnchor.values()].sort((x, y) => sectionSort(x.anchor, y.anchor))) {
    out.push(`| ${esc(e.anchor)} | ${num(e.steps)} | ${[...e.kinds].map((k) => `\`${k}\``).join(', ')} |`);
  }
  out.push('');

  // ── Failures ───────────────────────────────────────────────────────────────
  out.push('## Configurations that deliberately produce no trace');
  out.push('');
  if (failed.length === 0) {
    out.push('None in this run.');
  } else {
    out.push('| Trace kind | Configuration | Why |');
    out.push('| --- | --- | --- |');
    for (const r of failed) {
      out.push(`| \`${r.kind}\` | ${esc(r.label)} | ${r.diagnostics.map(esc).join(' · ')} |`);
    }
  }
  out.push('');
  out.push(
    'These are teaching outcomes, not bugs: the canonical LR(1) collection for the C subset blows',
    'through the educational 400-state cap, which is precisely the argument for LALR(1) (§4.7.4).',
    '',
  );

  // ── Coverage honesty ───────────────────────────────────────────────────────
  const emitted = new Set<string>();
  for (const r of ok) for (const g of r.cites) emitted.add(g.section);
  const declared = scanDeclaredSections();
  const unexercised = [...declared.entries()]
    .filter(([sec]) => !emitted.has(sec))
    .sort((a, b) => sectionSort(a[0], b[0]));

  out.push('## Cited in the code but not reached by these runs');
  out.push('');
  out.push(
    'The runs above only take the paths the sample programs take, so a rule cited on an error',
    'path (or on a construct none of the samples uses) can be in the code and absent from every',
    'trace here. This list comes from a static scan of `packages/core/src` for citation section',
    'literals — it is a coverage note, not a defect list.',
    '',
  );
  if (unexercised.length === 0) {
    out.push('None: every section cited in the compiler source appears in a trace above.');
  } else {
    out.push('| Dragon Book | Declared in |');
    out.push('| --- | --- |');
    for (const [sec, files] of unexercised) {
      out.push(`| §${sec} | ${[...files].map((f) => `\`${f}\``).join(', ')} |`);
    }
  }
  out.push('');

  out.push('---');
  out.push('');
  out.push(
    'Grammar ids used above: `dragon-4.1` (the expression grammar of Fig 4.1), `dragon-4.28`',
    '(the LL(1) expression grammar of Example 4.28), `dragon-4.55` (the LR(1) grammar of Example',
    '4.55), `c-subset` (the lab’s C grammar — what the pipeline actually parses), and `c-subset-ll`',
    '(the same grammar after left-recursion elimination and left factoring). See',
    '`packages/app/src/worker/trace-kinds.ts` for the full parameter contract.',
    '',
  );

  return out.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

function main(): void {
  const check = process.argv.includes('--check');

  const declared = new Set(TRACE_KIND_NAMES as readonly string[]);
  const covered = new Set(RUNS.map((r) => r.kind as string));
  const missing = [...declared].filter((k) => !covered.has(k));
  if (missing.length > 0) {
    console.error(
      `gen-textbook-map: ${missing.length} declared trace kind(s) have no run configured: ${missing.join(', ')}`,
    );
    process.exitCode = 1;
    return;
  }

  const started = Date.now();
  const results = RUNS.map(runOne);
  const text = render(results) + '\n';

  const uncited = results.reduce((n, r) => n + r.uncited, 0);
  if (uncited > 0) {
    console.warn(`gen-textbook-map: WARNING — ${uncited} recorded step(s) carry no cite.section`);
  }

  if (check) {
    const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
    if (current !== text) {
      console.error(
        'gen-textbook-map: docs/TEXTBOOK-MAP.md is out of date — run `pnpm exec jiti scripts/gen-textbook-map.ts`',
      );
      process.exitCode = 1;
      return;
    }
    console.log('gen-textbook-map: docs/TEXTBOOK-MAP.md is up to date.');
    return;
  }

  writeFileSync(OUT, text, 'utf8');
  const ok = results.filter((r) => r.ok).length;
  console.log(
    `gen-textbook-map: wrote ${OUT} — ${ok}/${results.length} traces, ` +
      `${results.reduce((n, r) => n + r.steps, 0).toLocaleString('en-US')} steps, ${Date.now() - started} ms`,
  );
}

main();

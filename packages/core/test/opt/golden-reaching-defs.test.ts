/**
 * Textbook golden: reaching definitions on the §9.2 running example
 * (Fig 9.13 flow graph; gen/kill from Example 9.9/Fig 9.14; converged IN/OUT
 * bit-vectors from the Algorithm 9.11 worked example in §9.2.4).
 * Book blocks B1..B4 are our B0..B3.
 */
import { describe, expect, it } from 'vitest';
import { runFindBasicBlocks } from '../../src/opt/basic-blocks.js';
import { computeCfg, ENTRY, EXIT, runBuildCfg } from '../../src/opt/cfg.js';
import { runReachingDefinitions } from '../../src/opt/dataflow.js';
import { fig913 } from './helpers.js';

describe('Algorithm 8.5 leaders and blocks on the Fig 9.13 program', () => {
  it('identifies leaders with the correct rules and forms four blocks', () => {
    const f = fig913();
    const { result, trace } = runFindBasicBlocks(f);
    // Discovery order: 0 (rule 1); scanning jumps in program order, the
    // "ifFalse e1 goto L4" at 6 contributes 8 (rule 2: its target) then 7
    // (rule 3: follows the jump); "if e2 goto L2" at 10 contributes 3 (rule 2).
    expect(result.leaders).toEqual([
      { quadIndex: 0, rule: 1 },
      { quadIndex: 8, rule: 2 },
      { quadIndex: 7, rule: 3 },
      { quadIndex: 3, rule: 2 },
    ]);
    expect(result.blocks.map((b) => b.quadIndices)).toEqual([
      [0, 1, 2],
      [3, 4, 5, 6],
      [7],
      [8, 9, 10],
    ]);
    // Every leader event cites Algorithm 8.5.
    for (const s of trace.steps) {
      expect(s.meta.cite.figureOrAlgo).toBe('Algorithm 8.5');
    }
  });

  it('builds the Fig 9.13 CFG edges with §8.4.3 justifications', () => {
    const f = fig913();
    const { result: bb } = runFindBasicBlocks(f);
    const { result: cfg, trace } = runBuildCfg(f, bb.blocks);
    expect(cfg.edges).toEqual([
      { from: ENTRY, to: 0 },
      { from: 0, to: 1 }, // fallthrough           (B1→B2 in the book)
      { from: 1, to: 3 }, // ifFalse target L4     (B2→B4)
      { from: 1, to: 2 }, // fallthrough           (B2→B3)
      { from: 2, to: 3 }, // fallthrough           (B3→B4)
      { from: 3, to: 1 }, // if e2 goto L2         (B4→B2, the loop)
      { from: 3, to: EXIT },
    ]);
    for (const s of trace.steps) expect(s.meta.cite.section).toBe('8.4.3');
  });
});

describe('§9.2.4 reaching definitions golden (Algorithm 9.11)', () => {
  const f = fig913();
  const cfg = computeCfg(f, runFindBasicBlocks(f).result.blocks);
  const { result, trace } = runReachingDefinitions(f, cfg);

  it('numbers the seven definitions d1..d7 in program order', () => {
    expect(result.defs).toEqual([
      { id: 'd1', quadIndex: 0, var: 'i' },
      { id: 'd2', quadIndex: 1, var: 'j' },
      { id: 'd3', quadIndex: 2, var: 'a' },
      { id: 'd4', quadIndex: 4, var: 'i' },
      { id: 'd5', quadIndex: 5, var: 'j' },
      { id: 'd6', quadIndex: 7, var: 'a' },
      { id: 'd7', quadIndex: 9, var: 'i' },
    ]);
  });

  it('computes the book gen/kill sets (Fig 9.14; book B1..B4 = our B0..B3)', () => {
    expect(result.gen['0']).toEqual(['d1', 'd2', 'd3']);
    expect(result.kill['0']).toEqual(['d4', 'd5', 'd6', 'd7']);
    expect(result.gen['1']).toEqual(['d4', 'd5']);
    expect(result.kill['1']).toEqual(['d1', 'd2', 'd7']);
    expect(result.gen['2']).toEqual(['d6']);
    expect(result.kill['2']).toEqual(['d3']);
    expect(result.gen['3']).toEqual(['d7']);
    expect(result.kill['3']).toEqual(['d1', 'd4']);
  });

  it('converges to the book IN/OUT bit-vectors', () => {
    // Book (2nd ed. §9.2.4 example), bit-vectors over d1..d7:
    // OUT[B1] = 111 0000, IN[B2] = 111 0111, OUT[B2] = 001 1110,
    // IN[B3] = OUT[B2],   OUT[B3] = 000 1110,
    // IN[B4] = 001 1110,  OUT[B4] = 001 0111.
    expect(result.in['0']).toEqual([]);
    expect(result.out['0']).toEqual(['d1', 'd2', 'd3']);
    expect(result.in['1']).toEqual(['d1', 'd2', 'd3', 'd5', 'd6', 'd7']);
    expect(result.out['1']).toEqual(['d3', 'd4', 'd5', 'd6']);
    expect(result.in['2']).toEqual(['d3', 'd4', 'd5', 'd6']);
    expect(result.out['2']).toEqual(['d4', 'd5', 'd6']);
    expect(result.in['3']).toEqual(['d3', 'd4', 'd5', 'd6']);
    expect(result.out['3']).toEqual(['d3', 'd5', 'd6', 'd7']);
    // OUT[ENTRY] = ∅ boundary.
    expect(result.out[String(ENTRY)]).toEqual([]);
  });

  it('takes three round-robin iterations (values stabilize after two)', () => {
    expect(result.iterations).toBe(3);
    // Iteration sections appear as scrubber sections.
    const sections = trace.sections().map((s) => s.name);
    expect(sections).toContain('Iteration 1');
    expect(sections).toContain('Iteration 2');
    expect(sections).toContain('Iteration 3');
    expect(sections).toContain('Converged');
  });
});

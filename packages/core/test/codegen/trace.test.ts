/**
 * Trace invariants (replay ≡ artifact, keyframes, citations), determinism
 * (two recordings event-identical), and interference-graph domain invariants
 * (symmetry normalization a<b, sorted nodes, no self/duplicate edges).
 */
import { describe, expect, it } from 'vitest';
import { checkTraceInvariants } from '@lab/trace';
import type { Recorded } from '@lab/trace';
import {
  iselReducer,
  projectIsel,
  runIsel,
} from '../../src/codegen/isel.js';
import {
  livenessReducer,
  projectLiveness,
  runLiveness,
} from '../../src/codegen/liveness.js';
import {
  interferenceReducer,
  projectInterference,
  runInterference,
} from '../../src/codegen/interference.js';
import { colorReducer, projectColor, runColor } from '../../src/codegen/color.js';
import { emitReducer, projectEmit, runEmit } from '../../src/codegen/emit.js';
import { asmExecReducer, projectAsmRun, runAsmTraced } from '../../src/interp/asm.js';
import type { TacProgram } from '../../src/ir/types.js';
import type { SymbolEntry } from '../../src/sem/types.js';
import {
  arrayProgram,
  floatAcrossCallProgram,
  floatProgram,
  frameArrayProgram,
  gcdProgram,
  spillProgram,
} from './fixtures.js';

interface Pipeline {
  isel: ReturnType<typeof runIsel>;
  liveness: ReturnType<typeof runLiveness>;
  interference: ReturnType<typeof runInterference>;
  color: ReturnType<typeof runColor>;
  emit: ReturnType<typeof runEmit>;
  exec: ReturnType<typeof runAsmTraced>;
}

function pipeline(program: TacProgram, symbols?: SymbolEntry[]): Pipeline {
  const isel = runIsel(program, symbols);
  const liveness = runLiveness(isel.result);
  const interference = runInterference(isel.result, liveness.result);
  const color = runColor(isel.result);
  const emit = runEmit(isel.result, color.result);
  const exec = runAsmTraced(emit.result);
  return { isel, liveness, interference, color, emit, exec };
}

const fixtures: Array<[string, () => { program: TacProgram; symbols?: SymbolEntry[] }]> = [
  ['gcd', () => ({ program: gcdProgram() })],
  ['spill', () => ({ program: spillProgram() })],
  ['float', () => ({ program: floatProgram() })],
  ['float across a call', () => floatAcrossCallProgram()],
  ['array', () => arrayProgram()],
  ['frame array', () => frameArrayProgram()],
];

describe('trace invariants for every recorded codegen trace', () => {
  for (const [name, mk] of fixtures) {
    it(`${name}: all six traces satisfy checkTraceInvariants`, () => {
      const { program, symbols } = mk();
      const p = pipeline(program, symbols);
      expect(checkTraceInvariants(p.isel, iselReducer, projectIsel)).toEqual([]);
      expect(checkTraceInvariants(p.liveness, livenessReducer, projectLiveness)).toEqual([]);
      expect(checkTraceInvariants(p.interference, interferenceReducer, projectInterference)).toEqual([]);
      expect(checkTraceInvariants(p.color, colorReducer, projectColor)).toEqual([]);
      expect(checkTraceInvariants(p.emit, emitReducer, projectEmit)).toEqual([]);
      expect(checkTraceInvariants(p.exec, asmExecReducer, projectAsmRun)).toEqual([]);
    });
  }
});

describe('determinism: two runs produce identical event sequences', () => {
  for (const [name, mk] of fixtures) {
    it(`${name}: event-identical recordings`, () => {
      const a = pipeline(mk().program, mk().symbols);
      const b = pipeline(mk().program, mk().symbols);
      const events = (r: Recorded<unknown, { kind: string }, unknown>) =>
        r.trace.steps.map((s) => s.event);
      for (const phase of ['isel', 'liveness', 'interference', 'color', 'emit', 'exec'] as const) {
        expect(JSON.stringify(events(a[phase]))).toBe(JSON.stringify(events(b[phase])));
      }
    });
  }
});

describe('interference graph domain invariants', () => {
  for (const [name, mk] of fixtures) {
    it(`${name}: edges normalized a<b, nodes sorted, no self/dup edges`, () => {
      const { program, symbols } = mk();
      const p = pipeline(program, symbols);
      for (const r of p.interference.result) {
        const g = r.graph;
        const ids = g.nodes.map((n) => n.id);
        expect([...ids].sort()).toEqual(ids); // nodes sorted
        expect(new Set(ids).size).toBe(ids.length);
        const seen = new Set<string>();
        for (const e of g.edges) {
          expect(e.a < e.b).toBe(true); // stored once with a < b
          expect(ids).toContain(e.a);
          expect(ids).toContain(e.b);
          const k = `${e.a}|${e.b}`;
          expect(seen.has(k)).toBe(false);
          seen.add(k);
        }
        // forbidden colors are real GP registers on real nodes
        for (const [node, regs] of Object.entries(r.forbidden)) {
          expect(ids).toContain(node);
          for (const reg of regs) expect(reg.startsWith('%')).toBe(true);
        }
      }
    });
  }
});

describe('liveness artifact sanity', () => {
  it('gcd: LiveRange liveAt indices are sorted, in-bounds, pseudo-only', () => {
    const { program } = { program: gcdProgram() };
    const isel = runIsel(program);
    const live = runLiveness(isel.result);
    for (let f = 0; f < live.result.length; f++) {
      const fn = live.result[f]!;
      const n = isel.result.functions[f]!.code.length;
      expect(fn.liveIn.length).toBe(n);
      expect(fn.liveOut.length).toBe(n);
      expect(fn.iterations).toBeGreaterThanOrEqual(2); // fixpoint needs a confirming pass
      for (const r of fn.ranges) {
        expect(r.nodeId.startsWith('%')).toBe(false);
        expect([...r.liveAt].sort((x, y) => x - y)).toEqual(r.liveAt);
        for (const i of r.liveAt) {
          expect(i).toBeGreaterThanOrEqual(0);
          expect(i).toBeLessThan(n);
          expect(fn.liveIn[i]).toContain(r.nodeId);
        }
      }
    }
  });

  it('LiveRange.liveAt indexes the SELECTED code, not the TAC quads', () => {
    // The contract type must describe what liveness actually produces: liveness
    // runs at machine-instruction granularity, so gcd's indices run past the
    // function's quad count and would name the wrong instruction if a consumer
    // used them on fn.quads.
    const program = gcdProgram();
    const isel = runIsel(program);
    const live = runLiveness(isel.result);
    const code = isel.result.functions[0]!.code;
    const quads = program.functions[0]!.quads;
    expect(code.length).toBeGreaterThan(quads.length);
    const indices = live.result[0]!.ranges.flatMap((r) => r.liveAt);
    expect(Math.max(...indices)).toBeGreaterThanOrEqual(quads.length);
    expect(Math.max(...indices)).toBeLessThan(code.length);
  });

  it('gcd: params a and b interfere (both live through the loop)', () => {
    const isel = runIsel(gcdProgram());
    const live = runLiveness(isel.result);
    const interf = runInterference(isel.result, live.result);
    const g = interf.result[0]!.graph;
    expect(g.functionName).toBe('gcd');
    expect(g.edges).toContainEqual({ a: 'a', b: 'b' });
  });

  it('sections give per-function scrubber tick-marks', () => {
    const p = pipeline(gcdProgram());
    const sections = p.isel.trace.sections().map((s) => s.name);
    expect(sections).toContain('gcd: selection');
    expect(sections).toContain('main: selection');
    expect(p.color.trace.sections().some((s) => s.name.includes('coloring'))).toBe(true);
  });
});

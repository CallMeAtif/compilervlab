/**
 * Derived triple / indirect-triple views (§6.2.3, Fig 6.11/6.12).
 * The classic book example a = b * -c + b * -c is reproduced row for row.
 */
import { describe, expect, it } from 'vitest';
import { runIrGen } from '../../src/ir/gen.js';
import { toIndirectTriples, toTriples } from '../../src/ir/views.js';
import { buildProgram } from './fixtures.js';
import { arrayProgram } from './programs.js';

function rowsOf(rows: ReturnType<typeof toTriples>): Array<[string, string, string]> {
  return rows.map((r) => [r.op, r.arg1, r.arg2]);
}

describe('triples view (§6.2.3)', () => {
  it('a = b * -c + b * -c matches Fig 6.11(b)', () => {
    const { ast, sem } = buildProgram((b) =>
      b.program(
        b.func(
          'int',
          'f',
          [b.param('int', 'b'), b.param('int', 'c')],
          b.compound(
            b.varDecl('int', 'a'),
            b.exprStmt(
              b.assign(
                b.id('a'),
                b.bin(
                  '+',
                  b.bin('*', b.id('b'), b.un('-', b.id('c'))),
                  b.bin('*', b.id('b'), b.un('-', b.id('c'))),
                ),
              ),
            ),
            b.ret(b.id('a')),
          ),
        ),
      ),
    );
    const tac = runIrGen(ast, sem).result;
    const fn = tac.functions[0]!;
    const rows = toTriples(fn);
    expect(rowsOf(rows)).toEqual([
      ['minus', 'c', ''], // (0)
      ['*', 'b', '(0)'], // (1)
      ['minus', 'c', ''], // (2)
      ['*', 'b', '(2)'], // (3)
      ['+', '(1)', '(3)'], // (4)
      ['=', 'a', '(4)'], // (5)
      ['return', 'a', ''], // (6)
    ]);
    // positions are the row indices themselves
    expect(rows.map((r) => r.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('array stores expand to the two-row []= form (Fig 6.11 discussion)', () => {
    const { ast, sem } = arrayProgram.build();
    const tac = runIrGen(ast, sem).result;
    const f = tac.functions.find((x) => x.name === 'f')!;
    const rows = toTriples(f);
    expect(rowsOf(rows)).toEqual([
      ['*', 'i', '4'], // (0) offset for the store
      ['*', 'i', '4'], // (1) offset for the load
      ['=[]', 'a', '(1)'], // (2) a[i] load
      ['+', '(2)', '1'], // (3)
      ['[]=', 'a', '(0)'], // (4) store access
      ['=', '(4)', '(3)'], // (5) store value
      ['*', '0', '4'], // (6)
      ['=[]', 'a', '(6)'], // (7)
      ['return', '(7)', ''], // (8)
    ]);
    // provenance: rows point back at their quads
    expect(rows[4]!.quadIndex).toBe(4);
    expect(rows[5]!.quadIndex).toBe(4);
  });

  it('jumps keep symbolic label targets', () => {
    const { ast, sem } = buildProgram((b) =>
      b.program(
        b.func(
          'int',
          'f',
          [b.param('int', 'a'), b.param('int', 'b')],
          b.compound(
            b.whileS(
              b.bin('<', b.id('a'), b.id('b')),
              b.exprStmt(b.assign(b.id('a'), b.bin('+', b.id('a'), b.int(1)))),
            ),
            b.ret(b.id('a')),
          ),
        ),
      ),
    );
    const fn = runIrGen(ast, sem).result.functions[0]!;
    const rows = toTriples(fn);
    expect(rows[1]).toMatchObject({ op: 'if<', arg1: 'a', arg2: 'b', target: 'L2' });
    expect(rows[2]).toMatchObject({ op: 'goto', target: 'L3' });
  });
});

describe('indirect triples view (§6.2.3, Fig 6.12)', () => {
  it('adds an identity instruction listing over the same triples', () => {
    const { ast, sem } = arrayProgram.build();
    const fn = runIrGen(ast, sem).result.functions.find((x) => x.name === 'f')!;
    const direct = toTriples(fn);
    const indirect = toIndirectTriples(fn);
    expect(indirect.triples).toEqual(direct);
    expect(indirect.order).toEqual(direct.map((r) => r.index));
  });

  it('views are pure: deriving twice gives identical rows', () => {
    const { ast, sem } = arrayProgram.build();
    const fn = runIrGen(ast, sem).result.functions[0]!;
    expect(toTriples(fn)).toEqual(toTriples(fn));
  });
});

/**
 * Backpatching primitives — makelist / merge / backpatch exactly as defined in
 * Dragon Book (2nd ed.) §6.7.1. Lists are lists of instruction indices whose
 * jump targets are still unfilled; backpatch(p, i) fills them all with the
 * label bound to instruction i. Each primitive is a generator that yields its
 * own trace event so the UI can show lists being created, merged, and patched.
 */
import type { StepMeta, Steps } from '@lab/trace';
import type { Quad } from './types.js';
import type { IrEvent, ListRole } from './ir-events.js';

/** A backpatch list. `id` identifies it in trace events; `instrs` are the
 *  indices of quads whose jump target is unfilled. */
export interface BpList {
  id: number;
  role: ListRole;
  astNodeId: number;
  instrs: number[];
}

/** Mutable per-function context the primitives operate on. Internal to the
 *  generator (never emitted); all visible effects go through events. */
export interface BackpatchCtx {
  func: string;
  quads: Quad[];
  nextListId: () => number;
}

function meta(
  prose: string,
  rule: string,
  groupId: string | undefined,
  section: string,
): StepMeta {
  return {
    cite: { section: '6.7.1', rule },
    prose,
    level: 'micro',
    ...(groupId !== undefined ? { groupId } : {}),
    section,
  };
}

/** An empty list (the book's null pointer). Creating one is not an event —
 *  nothing observable exists until an instruction is put on a list. */
export function emptyList(ctx: BackpatchCtx, role: ListRole, astNodeId: number): BpList {
  return { id: ctx.nextListId(), role, astNodeId, instrs: [] };
}

/** makelist(i): a new list containing only instruction index i (§6.7.1). */
export function* makelist(
  ctx: BackpatchCtx,
  instr: number,
  role: ListRole,
  astNodeId: number,
  groupId: string | undefined,
  section: string,
): Steps<IrEvent, BpList> {
  const list: BpList = { id: ctx.nextListId(), role, astNodeId, instrs: [instr] };
  yield [
    {
      kind: 'makelist',
      func: ctx.func,
      listId: list.id,
      role,
      astNodeId,
      instr,
    },
    meta(
      `makelist(${instr}): new ${role} containing only instruction ${instr}, whose jump target is not yet known.`,
      'makelist(i) creates a new list containing only i, an index into the array of instructions',
      groupId,
      section,
    ),
  ];
  return list;
}

/** merge(p1, p2): the concatenation of the two lists (§6.7.1). Merging two
 *  empty lists is a silent no-op (the book's null pointers). */
export function* mergeLists(
  ctx: BackpatchCtx,
  a: BpList,
  b: BpList,
  role: ListRole,
  astNodeId: number,
  groupId: string | undefined,
  section: string,
): Steps<IrEvent, BpList> {
  const instrs = [...a.instrs, ...b.instrs];
  if (instrs.length === 0) return emptyList(ctx, role, astNodeId);
  const list: BpList = { id: ctx.nextListId(), role, astNodeId, instrs };
  const sources: number[] = [];
  if (a.instrs.length > 0) sources.push(a.id);
  if (b.instrs.length > 0) sources.push(b.id);
  yield [
    {
      kind: 'merge',
      func: ctx.func,
      listId: list.id,
      role,
      astNodeId,
      sources,
      instrs,
    },
    meta(
      `merge: concatenate lists {${a.instrs.join(', ')}} and {${b.instrs.join(', ')}} into the ${role} {${instrs.join(', ')}}.`,
      'merge(p1, p2) concatenates the lists pointed to by p1 and p2, and returns a pointer to the concatenated list',
      groupId,
      section,
    ),
  ];
  return list;
}

/** backpatch(p, i): insert the label bound at instruction index `targetInstr`
 *  as the target of each instruction on list p (§6.7.1). Patches the quads in
 *  place and emits one event carrying the full patch. */
export function* backpatch(
  ctx: BackpatchCtx,
  list: BpList,
  targetInstr: number,
  targetLabel: string,
  groupId: string | undefined,
  section: string,
): Steps<IrEvent, null> {
  if (list.instrs.length === 0) return null;
  for (const i of list.instrs) {
    const q = ctx.quads[i];
    if (q) q.result = { kind: 'label', name: targetLabel };
  }
  yield [
    {
      kind: 'backpatch',
      func: ctx.func,
      listId: list.id,
      instrs: [...list.instrs],
      targetLabel,
      targetInstr,
    },
    meta(
      `backpatch({${list.instrs.join(', ')}}, ${targetInstr}): fill ${targetLabel} (instruction ${targetInstr}) in as the target of each instruction on the list.`,
      'backpatch(p, i) inserts i as the target label for each of the instructions on the list pointed to by p',
      groupId,
      section,
    ),
  ];
  return null;
}

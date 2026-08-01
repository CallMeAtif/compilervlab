/**
 * Turning a pass trace into DiffView rows.
 *
 * A `rewrite` event carries the change record AND the full instruction list of
 * the function after that change, so the honest way to attribute a line to a
 * justification is to diff consecutive snapshots and carry the annotations
 * forward. (Change.beforeIndex cannot be trusted as a key: DCE renumbers
 * between rounds and LICM reports pre-motion indices.)
 *
 * The rows finally shown compare the program ENTERING the pass with the
 * program as of the current step, so the diff grows as you step.
 */
import type { DiffRow } from '../../../components/DiffView';

export type DiffOp =
  | { type: 'same'; i: number; j: number }
  | { type: 'del'; i: number }
  | { type: 'add'; j: number };

/** Longest-common-subsequence diff over instruction text, with prefix/suffix
 *  trimming so the DP stays tiny for teaching-sized functions. */
export function lcsDiff(a: readonly string[], b: readonly string[]): DiffOp[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const ops: DiffOp[] = [];
  for (let k = 0; k < start; k++) ops.push({ type: 'same', i: k, j: k });

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const n = midA.length;
  const m = midB.length;

  if (n === 0 || m === 0 || n * m > 400_000) {
    for (let k = 0; k < n; k++) ops.push({ type: 'del', i: start + k });
    for (let k = 0; k < m; k++) ops.push({ type: 'add', j: start + k });
  } else {
    // dp[i][j] = LCS length of midA[i..] and midB[j..]
    const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      const rowI = dp[i]!;
      const rowNext = dp[i + 1]!;
      for (let j = m - 1; j >= 0; j--) {
        rowI[j] =
          midA[i] === midB[j] ? rowNext[j + 1]! + 1 : Math.max(rowNext[j]!, rowI[j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        ops.push({ type: 'same', i: start + i, j: start + j });
        i++;
        j++;
      } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
        ops.push({ type: 'del', i: start + i });
        i++;
      } else {
        ops.push({ type: 'add', j: start + j });
        j++;
      }
    }
    while (i < n) ops.push({ type: 'del', i: start + i++ });
    while (j < m) ops.push({ type: 'add', j: start + j++ });
  }

  for (let k = 0; k < a.length - endA; k++) {
    ops.push({ type: 'same', i: endA + k, j: endB + k });
  }
  return ops;
}

export interface RewriteSnapshot {
  /** Instruction texts of the function after this rewrite. */
  snapshot: readonly string[];
  justification: string;
}

export interface PassDiff {
  rows: DiffRow[];
  added: number;
  removed: number;
  changed: number;
}

/**
 * Carry per-line justifications through every intermediate snapshot, then emit
 * DiffView rows for (entering program → current program).
 */
export function buildPassDiff(
  before: readonly string[],
  rewrites: readonly RewriteSnapshot[],
): PassDiff {
  let current: readonly string[] = before;
  let justification: Array<string | null> = before.map(() => null);
  /** Justifications of lines that were deleted along the way, by line text. */
  const deleted = new Map<string, string[]>();

  for (const step of rewrites) {
    const next = step.snapshot;
    const ops = lcsDiff(current, next);
    const nextJust: Array<string | null> = next.map(() => null);
    for (const op of ops) {
      if (op.type === 'same') nextJust[op.j] = justification[op.i] ?? null;
      else if (op.type === 'add') nextJust[op.j] = step.justification;
      else {
        const text = current[op.i];
        if (text !== undefined) {
          const list = deleted.get(text) ?? [];
          list.push(justification[op.i] ?? step.justification);
          deleted.set(text, list);
        }
      }
    }
    current = next;
    justification = nextJust;
  }

  const takeDeleted = (text: string): string | undefined => {
    const list = deleted.get(text);
    if (!list || list.length === 0) return undefined;
    return list.shift();
  };

  const ops = lcsDiff(before, current);
  const rows: DiffRow[] = [];
  let added = 0;
  let removed = 0;
  let changed = 0;

  for (let k = 0; k < ops.length; ) {
    const op = ops[k]!;
    if (op.type === 'same') {
      rows.push({ kind: 'unchanged', before: before[op.i] ?? '', after: current[op.j] ?? '' });
      k++;
      continue;
    }
    // Collect a maximal run of deletions followed by a run of additions and
    // pair them up: a paired del+add is a rewritten line, not a delete + insert.
    const dels: number[] = [];
    while (k < ops.length && ops[k]!.type === 'del') {
      dels.push((ops[k] as { type: 'del'; i: number }).i);
      k++;
    }
    const adds: number[] = [];
    while (k < ops.length && ops[k]!.type === 'add') {
      adds.push((ops[k] as { type: 'add'; j: number }).j);
      k++;
    }
    const paired = Math.min(dels.length, adds.length);
    for (let p = 0; p < paired; p++) {
      const i = dels[p]!;
      const j = adds[p]!;
      const just = justification[j] ?? takeDeleted(before[i] ?? '');
      rows.push({
        kind: 'changed',
        before: before[i] ?? '',
        after: current[j] ?? '',
        ...(just ? { justification: just } : {}),
      });
      changed++;
    }
    for (let p = paired; p < dels.length; p++) {
      const i = dels[p]!;
      const text = before[i] ?? '';
      const just = takeDeleted(text);
      rows.push({ kind: 'removed', before: text, after: null, ...(just ? { justification: just } : {}) });
      removed++;
    }
    for (let p = paired; p < adds.length; p++) {
      const j = adds[p]!;
      const just = justification[j];
      rows.push({
        kind: 'added',
        before: null,
        after: current[j] ?? '',
        ...(just ? { justification: just } : {}),
      });
      added++;
    }
  }

  return { rows, added, removed, changed };
}

/** Same-index rows only (no diff) — used before any rewrite has happened. */
export function unchangedRows(lines: readonly string[]): DiffRow[] {
  return lines.map((text) => ({ kind: 'unchanged' as const, before: text, after: text }));
}

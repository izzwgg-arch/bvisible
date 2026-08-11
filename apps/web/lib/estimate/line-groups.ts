// Bundle grouping for estimate lines.
//
// A bundle is not a special row type — it is a set of ordinary lines
// sharing a `lineGroupId`, held in one contiguous run. Each component
// keeps its own kind, catalog link, vendor and markup rule, so purchase
// orders, the cost breakdown and R-EST-05 exemption all keep working
// unchanged; the grouping only changes how the lines are presented.
//
// Everything here is pure so the grid, the editor reducer and the tests
// share one definition of where a bundle starts and stops.

export type LineGroupMember = {
  id: string;
  lineGroupId: string | null;
  lineGroupLabel: string | null;
};

/** One contiguous run of lines sharing a lineGroupId — a single bundle. */
export type BundleRun = {
  groupId: string;
  label: string;
  /** Position among top-level rows: bundles count as one. */
  blockNumber: number;
  startIdx: number;
  endIdx: number;
  memberIds: string[];
};

export type LineLayout = {
  /** Keyed by the index of the line that opens the run. */
  runByStartIdx: Map<number, BundleRun>;
  runByLineId: Map<string, BundleRun>;
  /** "3" for a standalone line, "3.2" for the second item of bundle 3. */
  displayNumber: Map<string, string>;
};

export const DEFAULT_BUNDLE_LABEL = 'Bundle';

/**
 * Walks the flat line list once and marks off the bundle runs, giving
 * the grid where each run starts and ends, its label, and the numbering
 * for its members.
 *
 * Runs are contiguous by definition: if the same lineGroupId somehow
 * appears in two separate stretches, each stretch becomes its own
 * bundle rather than silently swallowing the lines in between.
 */
export function buildLineLayout(lines: ReadonlyArray<LineGroupMember>): LineLayout {
  const runByStartIdx = new Map<number, BundleRun>();
  const runByLineId = new Map<string, BundleRun>();
  const displayNumber = new Map<string, string>();
  let blockNumber = 0;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line) break;
    blockNumber += 1;
    const groupId = line.lineGroupId;

    if (!groupId) {
      displayNumber.set(line.id, String(blockNumber));
      index += 1;
      continue;
    }

    let end = index;
    while (end + 1 < lines.length && lines[end + 1]?.lineGroupId === groupId) end += 1;
    const members = lines.slice(index, end + 1);
    const run: BundleRun = {
      groupId,
      label:
        members.find((m) => m.lineGroupLabel?.trim())?.lineGroupLabel?.trim() ||
        DEFAULT_BUNDLE_LABEL,
      blockNumber,
      startIdx: index,
      endIdx: end,
      memberIds: members.map((m) => m.id),
    };
    runByStartIdx.set(index, run);
    members.forEach((member, position) => {
      runByLineId.set(member.id, run);
      displayNumber.set(member.id, `${blockNumber}.${position + 1}`);
    });
    index = end + 1;
  }

  return { runByStartIdx, runByLineId, displayNumber };
}

/** First contiguous run of the given group, as [start, end] indices. */
export function groupBounds(
  lines: ReadonlyArray<LineGroupMember>,
  groupId: string
): [number, number] | null {
  const start = lines.findIndex((l) => l.lineGroupId === groupId);
  if (start < 0) return null;
  let end = start;
  while (end + 1 < lines.length && lines[end + 1]?.lineGroupId === groupId) end += 1;
  return [start, end];
}

/** The block a line sits in: its whole bundle run, or just itself. */
export function blockBounds(
  lines: ReadonlyArray<LineGroupMember>,
  idx: number
): [number, number] {
  const groupId = lines[idx]?.lineGroupId ?? null;
  if (!groupId) return [idx, idx];
  let start = idx;
  let end = idx;
  while (start - 1 >= 0 && lines[start - 1]?.lineGroupId === groupId) start -= 1;
  while (end + 1 < lines.length && lines[end + 1]?.lineGroupId === groupId) end += 1;
  return [start, end];
}

/**
 * Moves one line up or down, keeping bundles intact: a component only
 * reorders inside its own bundle, and a standalone line hops the whole
 * adjacent bundle rather than landing in the middle of it.
 *
 * Returns the original array when the move isn't allowed.
 */
export function moveLinePreservingGroups<T extends LineGroupMember>(
  lines: ReadonlyArray<T>,
  id: string,
  dir: -1 | 1
): T[] {
  const idx = lines.findIndex((l) => l.id === id);
  if (idx < 0) return lines.slice();
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= lines.length) return lines.slice();

  const groupId = lines[idx]?.lineGroupId ?? null;
  if (groupId && (lines[newIdx]?.lineGroupId ?? null) !== groupId) return lines.slice();

  const [blockStart, blockEnd] = groupId ? [newIdx, newIdx] : blockBounds(lines, newIdx);
  const target = dir === -1 ? blockStart : blockEnd;
  const next = lines.slice();
  const [item] = next.splice(idx, 1);
  if (!item) return lines.slice();
  next.splice(target, 0, item);
  return next;
}

/**
 * Turns the guided builder's client-side card keys into real group ids.
 *
 * A card that produced several lines is a bundle and gets an id every
 * one of its lines shares. A key with a single line behind it is just
 * an ordinary item, so it stays ungrouped.
 */
export function assignBundleGroupIds(
  groupKeys: ReadonlyArray<string | null | undefined>,
  mintId: () => string
): Map<string, string> {
  const counts = new Map<string, number>();
  for (const key of groupKeys) {
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const idByKey = new Map<string, string>();
  for (const [key, count] of counts) {
    if (count > 1) idByKey.set(key, mintId());
  }
  return idByKey;
}

/** Moves a whole bundle past the block above or below it. */
export function moveGroup<T extends LineGroupMember>(
  lines: ReadonlyArray<T>,
  groupId: string,
  dir: -1 | 1
): T[] {
  const bounds = groupBounds(lines, groupId);
  if (!bounds) return lines.slice();
  const [start, end] = bounds;
  const neighbor = dir === -1 ? start - 1 : end + 1;
  if (neighbor < 0 || neighbor >= lines.length) return lines.slice();

  const [neighborStart, neighborEnd] = blockBounds(lines, neighbor);
  const run = lines.slice(start, end + 1);
  const rest = [...lines.slice(0, start), ...lines.slice(end + 1)];
  const insertAt = dir === -1 ? neighborStart : neighborEnd + 1 - run.length;
  rest.splice(insertAt, 0, ...run);
  return rest;
}

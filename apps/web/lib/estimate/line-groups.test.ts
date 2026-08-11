import { describe, expect, it } from 'vitest';
import {
  blockBounds,
  buildLineLayout,
  groupBounds,
  assignBundleGroupIds,
  moveGroup,
  moveLinePreservingGroups,
  type LineGroupMember,
} from '@/lib/estimate/line-groups';

function line(id: string, lineGroupId: string | null = null, lineGroupLabel: string | null = null): LineGroupMember {
  return { id, lineGroupId, lineGroupLabel };
}

// The guided builder saves a custom build as several lines sharing one
// lineGroupId. This is the regression these tests guard: those lines
// must read back as ONE bundle, not as loose items.
const GRAY_BUNDLE = [
  line('m1', 'g1', 'Gray 1/8'),
  line('m2', 'g1', 'Gray 1/8'),
  line('mach1', 'g1', 'Gray 1/8'),
  line('labor1', 'g1', 'Gray 1/8'),
];

describe('buildLineLayout', () => {
  it('folds a run of same-group lines into one bundle', () => {
    const layout = buildLineLayout(GRAY_BUNDLE);

    const run = layout.runByStartIdx.get(0);
    expect(run).toBeDefined();
    expect(run?.groupId).toBe('g1');
    expect(run?.label).toBe('Gray 1/8');
    expect(run?.startIdx).toBe(0);
    expect(run?.endIdx).toBe(3);
    expect(run?.memberIds).toEqual(['m1', 'm2', 'mach1', 'labor1']);
    // Only the opening line carries a header.
    expect(layout.runByStartIdx.size).toBe(1);
  });

  it('numbers bundles as one block and members beneath it', () => {
    const layout = buildLineLayout([
      line('solo'),
      ...GRAY_BUNDLE,
      line('after'),
    ]);

    expect(layout.displayNumber.get('solo')).toBe('1');
    expect(layout.displayNumber.get('m1')).toBe('2.1');
    expect(layout.displayNumber.get('m2')).toBe('2.2');
    expect(layout.displayNumber.get('labor1')).toBe('2.4');
    // The whole bundle counts as a single row, so the next line is 3.
    expect(layout.displayNumber.get('after')).toBe('3');
  });

  it('keeps consecutive bundles separate instead of merging them', () => {
    const layout = buildLineLayout([
      line('a1', 'g1', 'Gray 1/8'),
      line('a2', 'g1', 'Gray 1/8'),
      line('b1', 'g2', 'Wallpaper - Dark gray'),
      line('b2', 'g2', 'Wallpaper - Dark gray'),
    ]);

    expect(layout.runByStartIdx.get(0)?.groupId).toBe('g1');
    expect(layout.runByStartIdx.get(2)?.groupId).toBe('g2');
    expect(layout.runByStartIdx.get(2)?.label).toBe('Wallpaper - Dark gray');
    expect(layout.displayNumber.get('b1')).toBe('2.1');
  });

  it('falls back to a generic label when no member carries one', () => {
    const layout = buildLineLayout([line('x', 'g9', null), line('y', 'g9', '  ')]);
    expect(layout.runByStartIdx.get(0)?.label).toBe('Bundle');
  });

  it('treats a split group as two runs rather than swallowing what is between', () => {
    const layout = buildLineLayout([
      line('a', 'g1', 'Bundle A'),
      line('loose'),
      line('b', 'g1', 'Bundle A'),
    ]);

    expect(layout.runByStartIdx.get(0)?.memberIds).toEqual(['a']);
    expect(layout.runByStartIdx.get(2)?.memberIds).toEqual(['b']);
    expect(layout.displayNumber.get('loose')).toBe('2');
  });

  it('leaves an ungrouped estimate untouched', () => {
    const layout = buildLineLayout([line('a'), line('b')]);
    expect(layout.runByStartIdx.size).toBe(0);
    expect(layout.displayNumber.get('b')).toBe('2');
  });
});

describe('groupBounds', () => {
  it('returns the run for a group', () => {
    expect(groupBounds([line('x'), ...GRAY_BUNDLE], 'g1')).toEqual([1, 4]);
  });

  it('returns null for a group that is not present', () => {
    expect(groupBounds(GRAY_BUNDLE, 'nope')).toBeNull();
  });
});

describe('blockBounds', () => {
  it('spans the whole bundle from any member', () => {
    const lines = [line('x'), ...GRAY_BUNDLE, line('y')];
    expect(blockBounds(lines, 1)).toEqual([1, 4]);
    expect(blockBounds(lines, 3)).toEqual([1, 4]);
    expect(blockBounds(lines, 4)).toEqual([1, 4]);
  });

  it('is just the line itself when ungrouped', () => {
    expect(blockBounds([line('x'), ...GRAY_BUNDLE], 0)).toEqual([0, 0]);
  });
});

describe('assignBundleGroupIds', () => {
  function mint() {
    let n = 0;
    return () => `gid-${(n += 1)}`;
  }

  it('gives every line of a multi-line card the same group id', () => {
    // This is the reported bug: a custom build must not scatter into
    // separate items when the estimate is created.
    const ids = assignBundleGroupIds(['card-1', 'card-1', 'card-1', 'card-1'], mint());
    expect(ids.get('card-1')).toBe('gid-1');
    expect(ids.size).toBe(1);
  });

  it('keeps separate cards in separate bundles', () => {
    const ids = assignBundleGroupIds(['card-1', 'card-1', 'card-2', 'card-2'], mint());
    expect(ids.get('card-1')).toBe('gid-1');
    expect(ids.get('card-2')).toBe('gid-2');
  });

  it('leaves a single-line card ungrouped', () => {
    const ids = assignBundleGroupIds(['card-1', 'card-2', 'card-2'], mint());
    expect(ids.has('card-1')).toBe(false);
    expect(ids.has('card-2')).toBe(true);
  });

  it('ignores lines with no card key', () => {
    expect(assignBundleGroupIds([null, undefined, null], mint()).size).toBe(0);
  });
});

const ids = (lines: ReadonlyArray<LineGroupMember>) => lines.map((l) => l.id);

describe('moveLinePreservingGroups', () => {
  it('reorders a component inside its bundle', () => {
    expect(ids(moveLinePreservingGroups(GRAY_BUNDLE, 'mach1', -1))).toEqual([
      'm1',
      'mach1',
      'm2',
      'labor1',
    ]);
  });

  it('refuses to move a component out of its bundle', () => {
    const lines = [line('before'), ...GRAY_BUNDLE, line('after')];
    // First member moving up would escape the bundle; last member down.
    expect(ids(moveLinePreservingGroups(lines, 'm1', -1))).toEqual(ids(lines));
    expect(ids(moveLinePreservingGroups(lines, 'labor1', 1))).toEqual(ids(lines));
  });

  it('hops a standalone line over a whole bundle instead of into it', () => {
    const lines = [line('before'), ...GRAY_BUNDLE, line('after')];
    expect(ids(moveLinePreservingGroups(lines, 'before', 1))).toEqual([
      'm1',
      'm2',
      'mach1',
      'labor1',
      'before',
      'after',
    ]);
    expect(ids(moveLinePreservingGroups(lines, 'after', -1))).toEqual([
      'before',
      'after',
      'm1',
      'm2',
      'mach1',
      'labor1',
    ]);
  });

  it('leaves the list alone at the edges', () => {
    const lines = [line('a'), line('b')];
    expect(ids(moveLinePreservingGroups(lines, 'a', -1))).toEqual(['a', 'b']);
    expect(ids(moveLinePreservingGroups(lines, 'b', 1))).toEqual(['a', 'b']);
  });
});

describe('moveGroup', () => {
  it('moves the whole bundle up past a standalone line', () => {
    const lines = [line('before'), ...GRAY_BUNDLE, line('after')];
    expect(ids(moveGroup(lines, 'g1', -1))).toEqual([
      'm1',
      'm2',
      'mach1',
      'labor1',
      'before',
      'after',
    ]);
  });

  it('moves the whole bundle down past a standalone line', () => {
    const lines = [line('before'), ...GRAY_BUNDLE, line('after')];
    expect(ids(moveGroup(lines, 'g1', 1))).toEqual([
      'before',
      'after',
      'm1',
      'm2',
      'mach1',
      'labor1',
    ]);
  });

  it('swaps two adjacent bundles without interleaving them', () => {
    const lines = [
      line('a1', 'g1', 'A'),
      line('a2', 'g1', 'A'),
      line('b1', 'g2', 'B'),
      line('b2', 'g2', 'B'),
      line('b3', 'g2', 'B'),
    ];
    expect(ids(moveGroup(lines, 'g1', 1))).toEqual(['b1', 'b2', 'b3', 'a1', 'a2']);
    expect(ids(moveGroup(lines, 'g2', -1))).toEqual(['b1', 'b2', 'b3', 'a1', 'a2']);
  });

  it('leaves the list alone at the edges', () => {
    const lines = [...GRAY_BUNDLE];
    expect(ids(moveGroup(lines, 'g1', -1))).toEqual(ids(lines));
    expect(ids(moveGroup(lines, 'g1', 1))).toEqual(ids(lines));
  });
});

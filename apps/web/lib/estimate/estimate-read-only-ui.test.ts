import { describe, expect, it } from 'vitest';
import { EstimateStatus } from '@bvisible/db';
import {
  FINALIZED_READ_ONLY_CHIP_LABEL,
  isEstimateEditorReadOnly,
} from './estimate-read-only-ui';

describe('isEstimateEditorReadOnly', () => {
  it('is true only for FINALIZED', () => {
    expect(isEstimateEditorReadOnly(EstimateStatus.FINALIZED)).toBe(true);
    expect(isEstimateEditorReadOnly(EstimateStatus.DRAFT)).toBe(false);
    expect(isEstimateEditorReadOnly(EstimateStatus.SENT)).toBe(false);
    expect(isEstimateEditorReadOnly(EstimateStatus.APPROVED)).toBe(false);
    expect(isEstimateEditorReadOnly(EstimateStatus.REJECTED)).toBe(false);
  });
});

describe('FINALIZED_READ_ONLY_CHIP_LABEL', () => {
  it('matches operator-facing copy', () => {
    expect(FINALIZED_READ_ONLY_CHIP_LABEL).toBe('Finalized — read-only');
  });
});

describe('estimate editor read-only UI (static)', () => {
  async function readEstimateUi(relativePath: string): Promise<string> {
    return import('node:fs/promises').then((fs) =>
      fs.readFile(new URL(relativePath, import.meta.url), 'utf8'),
    );
  }

  it('editor guards dispatch and save when read-only', async () => {
    const src = await readEstimateUi('../../app/(app)/estimates/[id]/editor.tsx');
    expect(src).toMatch(/isEstimateEditorReadOnly/);
    expect(src).toMatch(/function guardedDispatch/);
    expect(src).toMatch(/if \(readOnly \|\| saving\) return/);
    expect(src).toMatch(/if \(readOnly\) return/);
  });

  it('line grid renders read-only cells and hides row actions', async () => {
    const src = await readEstimateUi('../../app/(app)/estimates/[id]/line-grid.tsx');
    expect(src).toMatch(/readOnly\?: boolean/);
    expect(src).toMatch(/FinalizedReadOnlyChip/);
    expect(src).toMatch(/!readOnly \?/);
  });

  it('catalog and pricing helper collapse Apply when read-only', async () => {
    const catalog = await readEstimateUi('../../app/(app)/estimates/[id]/catalog-item-picker.tsx');
    const pricing = await readEstimateUi('../../app/(app)/estimates/[id]/pricing-helper-panel.tsx');
    expect(catalog).toMatch(/if \(readOnly\)/);
    expect(pricing).toMatch(/if \(readOnly\)/);
    expect(catalog).toMatch(/Catalog Apply is disabled/);
    expect(pricing).toMatch(/Pricing helper Apply is disabled/);
  });
});

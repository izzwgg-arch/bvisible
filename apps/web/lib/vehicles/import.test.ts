import { describe, expect, it } from 'vitest';
import { VehicleDimensionConfidenceLevel } from '@bvisible/db';
import { importVehicleRows, parseVehicleImportText } from './import';

describe('vehicle import', () => {
  it('parses normalized CSV rows with optional dimensions', () => {
    const parsed = parseVehicleImportText(
      [
        'year,make,model,trim,bodyStyle,totalApproxWrapSqFt,confidenceLevel',
        '2024,Ford,Transit,250 Medium Roof,Cargo van,298,estimated',
      ].join('\n'),
      'csv'
    );

    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({
      year: 2024,
      make: 'Ford',
      model: 'Transit',
      trim: '250 Medium Roof',
      bodyStyle: 'Cargo van',
      totalApproxWrapSqFt: 298,
      confidenceLevel: VehicleDimensionConfidenceLevel.ESTIMATED,
    });
  });

  it('reports invalid rows without throwing', () => {
    const parsed = parseVehicleImportText('year,make,model\nnot-a-year,Ford,Transit\n2024,,Transit', 'csv');

    expect(parsed.rows).toHaveLength(0);
    expect(parsed.errors).toHaveLength(2);
  });

  it('supports dry-run recent year and make filters', async () => {
    const rows = parseVehicleImportText(
      JSON.stringify([
        { year: new Date().getFullYear(), make: 'Ford', model: 'Transit' },
        { year: 2008, make: 'Ford', model: 'E-Series' },
        { year: new Date().getFullYear(), make: 'Ram', model: 'ProMaster' },
      ]),
      'json'
    ).rows;

    const result = await importVehicleRows(rows, {
      tenantId: 'tenant-1',
      dryRun: true,
      recentYears: 10,
      make: 'Ford',
    });

    expect(result.dryRun).toBe(true);
    expect(result.totalRows).toBe(1);
    expect(result.preview[0]?.model).toBe('Transit');
  });
});

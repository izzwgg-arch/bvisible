export function slugifyVehiclePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180) || 'unknown';
}

export function normalizeVehicleText(value: unknown, max = 180): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text.length > 0 ? text.slice(0, max) : null;
}

export function parseOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).replace(/[,"]/g, '').trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

export function parseOptionalInt(value: unknown): number | null {
  const n = parseOptionalNumber(value);
  if (n === null) return null;
  return Number.isInteger(n) ? n : Math.trunc(n);
}

export function vehicleDisplayName(vehicle: {
  year?: number | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
}): string {
  return [vehicle.year, vehicle.make, vehicle.model, vehicle.trim]
    .filter((v) => v !== null && v !== undefined && String(v).trim().length > 0)
    .join(' ');
}

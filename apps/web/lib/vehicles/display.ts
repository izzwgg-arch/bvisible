import { VehicleDimensionConfidenceLevel } from '@bvisible/db';

export const VEHICLE_PLACEHOLDER_SVG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 420">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#eff6ff"/>
      <stop offset="1" stop-color="#f8fafc"/>
    </linearGradient>
  </defs>
  <rect width="720" height="420" rx="34" fill="url(#bg)"/>
  <path d="M122 260h64l54-82h238l64 82h58v58H122v-58Z" fill="#dbeafe" stroke="#93c5fd" stroke-width="6"/>
  <path d="M267 188h190l42 72H222l45-72Z" fill="#fff" stroke="#bfdbfe" stroke-width="6"/>
  <circle cx="232" cy="319" r="38" fill="#1e293b"/>
  <circle cx="494" cy="319" r="38" fill="#1e293b"/>
  <circle cx="232" cy="319" r="16" fill="#e2e8f0"/>
  <circle cx="494" cy="319" r="16" fill="#e2e8f0"/>
  <text x="360" y="112" text-anchor="middle" font-family="Inter, Arial" font-size="30" font-weight="700" fill="#64748b">Vehicle photo</text>
</svg>`);

export function formatInches(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(value % 1 ? 1 : 0)} in` : 'Missing';
}

export function formatSqFt(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(value % 1 ? 1 : 0)} sq ft` : 'Missing';
}

export function confidenceLabel(value: VehicleDimensionConfidenceLevel | null | undefined): string {
  switch (value) {
    case VehicleDimensionConfidenceLevel.MANUAL:
      return 'Manual';
    case VehicleDimensionConfidenceLevel.ESTIMATED:
      return 'Estimated';
    case VehicleDimensionConfidenceLevel.VERIFIED:
      return 'Verified';
    case VehicleDimensionConfidenceLevel.IMPORTED:
    default:
      return 'Imported';
  }
}

export function coverageSqFt(profile: {
  totalApproxWrapSqFt?: number | null;
  sideApproxSqFt?: number | null;
  hoodApproxSqFt?: number | null;
  roofApproxSqFt?: number | null;
  rearApproxSqFt?: number | null;
  frontApproxSqFt?: number | null;
}, coverage: string, customSqFt?: number | null): number {
  if (coverage === 'custom') return Math.max(0, customSqFt ?? 0);
  if (coverage === 'sides') return Math.max(0, profile.sideApproxSqFt ?? 0);
  if (coverage === 'hood') return Math.max(0, profile.hoodApproxSqFt ?? 0);
  if (coverage === 'roof') return Math.max(0, profile.roofApproxSqFt ?? 0);
  if (coverage === 'rear') return Math.max(0, profile.rearApproxSqFt ?? 0);
  if (coverage === 'front') return Math.max(0, profile.frontApproxSqFt ?? 0);
  if (coverage === 'partial') {
    return Math.max(0, (profile.sideApproxSqFt ?? 0) + (profile.rearApproxSqFt ?? 0));
  }
  return Math.max(0, profile.totalApproxWrapSqFt ?? 0);
}

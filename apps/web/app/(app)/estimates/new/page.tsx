import Link from 'next/link';
import { prisma } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { getSheetSnapshot } from '@/lib/sheet-sync/sync';
import { activeMaterialPrice, loadOverrides } from '@/lib/sheet-sync/active-price';
import {
  GuidedEstimateBuilder,
  type BuilderBundle,
  type BuilderMaterial,
} from './guided-builder';

export const metadata = { title: 'New estimate' };
export const dynamic = 'force-dynamic';

export default async function NewEstimatePage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string }>;
}) {
  const me = await requireTenantId();
  const sp = await searchParams;

  const [clients, snapshot, overrides, rates, machines] = await Promise.all([
    prisma.client.findMany({
      where: { tenantId: me.tenantId, deletedAt: null },
      orderBy: [{ companyName: 'asc' }],
      select: { id: true, companyName: true },
    }),
    getSheetSnapshot(me.tenantId),
    loadOverrides(me.tenantId),
    prisma.tenantOperatingRates.findUnique({ where: { tenantId: me.tenantId } }),
    prisma.machine.findMany({
      where: { tenantId: me.tenantId, isActive: true },
      select: { name: true, ratePerHourCents: true },
    }),
  ]);

  const data = snapshot.data;

  const materials: BuilderMaterial[] = data.materials.map((m) => {
    const active = activeMaterialPrice(overrides, m.key, m.priceCents);
    return {
      key: m.key,
      name: m.name,
      category: m.category,
      priceCents: active.priceCents,
      vendor: m.vendor,
      source: active.source,
    };
  });

  const bundles: BuilderBundle[] = data.bundles.map((b) => ({
    id: b.id,
    name: b.name,
    signType: b.signType,
    shopHours: b.shopHours,
    designUnits: b.designUnits,
    installHours: b.installHours,
    travelHours: b.travelHours,
    installers: b.installers,
    notes: b.notes,
    components: data.bundleComponents
      .filter((c) => c.packageId === b.id)
      .map((c) => ({
        componentType: c.componentType,
        itemName: c.itemName,
        quantity: c.quantity,
        optional: c.optional,
      })),
  }));

  const defaultMarkupPercent = rates ? Math.round(rates.defaultMarkupPercentMilli / 1000) : 200;
  const sheetOk = snapshot.status === 'OK' && data.materials.length > 0;

  return (
    <>
      <PageHeader
        title="New estimate"
        subtitle="Enter the job once, then build it one line at a time — materials, bundles, vehicle wraps, square footage, or a full custom build."
        actions={
          <Link
            href="/estimates"
            className="inline-flex items-center justify-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3.5 py-2 text-[13.5px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
          >
            Cancel
          </Link>
        }
      />

      <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-4 py-1.5 text-[12px] text-[var(--color-bv-muted)] shadow-[var(--shadow-bv-card)]">
        <span className={`h-2 w-2 rounded-full ${sheetOk ? 'bg-emerald-500' : 'bg-amber-500'}`} />
        {sheetOk ? (
          <span>
            Live Sheet · {data.materials.length} materials · {bundles.length} bundles ·{' '}
            {data.vehicleWraps.length} vehicle wraps · {data.sqftRates.length} sq-ft rates
          </span>
        ) : (
          <span>
            Pricing Sheet unavailable{snapshot.lastError ? ` — ${snapshot.lastError}` : ''}. Check
            the Pricing backend.
          </span>
        )}
      </div>

      <GuidedEstimateBuilder
        clients={clients}
        defaultClientId={sp.clientId ?? null}
        defaultMarkupPercent={defaultMarkupPercent}
        rates={{
          shopLaborCentsPerHour: rates?.shopLaborCentsPerHour ?? 5000,
          designFlatCents: rates?.designFlatCents ?? 15000,
          installPerPersonHourCents: rates?.installPerPersonHourCents ?? 15000,
        }}
        materials={materials}
        machines={machines}
        sqftRates={data.sqftRates.map((r) => ({
          id: r.id,
          name: r.name,
          pricePerSqFtCents: r.pricePerSqFtCents,
          wastePercent: r.wastePercent,
          unit: r.unit,
        }))}
        vehicleWraps={data.vehicleWraps.map((w) => ({
          id: w.id,
          name: w.name,
          coverage: w.coverage,
          billableAreaSqFt: w.billableAreaSqFt,
          priceCents: w.priceCents,
        }))}
        bundles={bundles}
        aliases={data.aliases}
        recommendations={data.recommendations}
      />
    </>
  );
}

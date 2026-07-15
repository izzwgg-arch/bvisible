import Link from 'next/link';
import { prisma, Role } from '@bvisible/db';
import { requireRoleWithEffectiveCompany } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { formatMoney } from '@bvisible/pricing';
import { getSheetSnapshot } from '@/lib/sheet-sync/sync';
import { pricingSheetUrl } from '@/lib/sheet-sync/gviz';
import { activeMachineRate, activeMaterialPrice, loadOverrides } from '@/lib/sheet-sync/active-price';
import {
  deactivateLegacyMaterialsAction,
  refreshSheetAction,
  resetOverrideAction,
  saveOperatingRatesAction,
  setOverrideAction,
} from './actions';

export const metadata = { title: 'Pricing backend' };
export const dynamic = 'force-dynamic';

const TABS = [
  { key: 'materials', label: 'Materials' },
  { key: 'machines', label: 'Machines' },
  { key: 'sqft', label: 'Sq-ft rates' },
  { key: 'wraps', label: 'Vehicle wraps' },
  { key: 'bundles', label: 'Bundles' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const cardCls =
  'rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] shadow-[var(--shadow-bv-card)]';
const inputCls =
  'rounded-[10px] border border-[var(--color-bv-border)] bg-white px-3 py-2 text-[13px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)]';
const thCls =
  'px-4 py-2.5 text-left text-[9.5px] font-bold uppercase tracking-[0.13em] text-[var(--color-bv-muted)]';
const tdCls = 'px-4 py-2.5 text-[12.5px] text-[var(--color-bv-text)]';

function SourceBadge({ source }: { source: 'SHEET' | 'OVERRIDE' }) {
  return source === 'SHEET' ? (
    <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[9.5px] font-bold text-emerald-700">
      Google Sheet
    </span>
  ) : (
    <span className="rounded-full bg-[#fdeee1] px-2.5 py-1 text-[9.5px] font-bold text-[#b05c1e]">
      App override
    </span>
  );
}

function OverrideCell({
  itemType,
  itemKey,
  source,
  activeCents,
}: {
  itemType: 'MATERIAL' | 'MACHINE';
  itemKey: string;
  source: 'SHEET' | 'OVERRIDE';
  activeCents: number;
}) {
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded-[8px] border border-[var(--color-bv-border)] bg-white px-3 py-1 text-center text-[11px] font-bold text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]">
        {source === 'OVERRIDE' ? 'Edit / Reset' : 'Edit'}
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-64 rounded-[12px] border border-[var(--color-bv-border)] bg-white p-3 shadow-[var(--shadow-bv-elevated)]">
        <form action={setOverrideAction} className="flex items-end gap-2">
          <input type="hidden" name="itemType" value={itemType} />
          <input type="hidden" name="itemKey" value={itemKey} />
          <label className="block flex-1">
            <span className="mb-1 block text-[9.5px] font-bold uppercase tracking-[0.1em] text-[var(--color-bv-muted)]">
              New active price $
            </span>
            <input
              className={`${inputCls} w-full`}
              name="price"
              type="number"
              min={0}
              step="0.01"
              defaultValue={(activeCents / 100).toFixed(2)}
            />
          </label>
          <button className="rounded-[9px] bg-[var(--color-bv-accent)] px-3 py-2 text-[11.5px] font-bold text-white">
            Save
          </button>
        </form>
        {source === 'OVERRIDE' ? (
          <form action={resetOverrideAction} className="mt-2">
            <input type="hidden" name="itemType" value={itemType} />
            <input type="hidden" name="itemKey" value={itemKey} />
            <button className="w-full rounded-[9px] border border-[var(--color-bv-border)] px-3 py-1.5 text-[11px] font-bold text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]">
              Reset to follow the Sheet
            </button>
          </form>
        ) : (
          <p className="mt-2 text-[10px] leading-snug text-[var(--color-bv-muted)]">
            This changes the app price only. Reset it anytime to follow the live Google Sheet
            again.
          </p>
        )}
      </div>
    </details>
  );
}

export default async function PricingBackendPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string }>;
}) {
  const me = await requireRoleWithEffectiveCompany(Role.ADMIN, Role.SUPER_ADMIN);
  const sp = await searchParams;
  const tab: TabKey = (TABS.find((t) => t.key === sp.tab)?.key ?? 'materials') as TabKey;
  const q = (sp.q ?? '').trim().toLowerCase();

  if (!me.tenantId) {
    return <PageHeader title="Pricing backend" subtitle="Select a workspace first." />;
  }
  const tenantId = me.tenantId;

  const [snapshot, overrides, rates, legacyCount] = await Promise.all([
    getSheetSnapshot(tenantId),
    loadOverrides(tenantId),
    prisma.tenantOperatingRates.findUnique({ where: { tenantId } }),
    prisma.shopMaterialItem.count({
      where: { tenantId, sheetKey: null, itemType: 'SINGLE', kind: 'MATERIAL', isActive: true },
    }),
  ]);
  const data = snapshot.data;
  const overrideCount = overrides.materials.size + overrides.machines.size;

  const matchesQ = (hay: string) => !q || hay.toLowerCase().includes(q);

  const materials = data.materials
    .filter((m) => matchesQ(`${m.name} ${m.category} ${m.vendor}`))
    .slice(0, 200)
    .map((m) => ({ ...m, active: activeMaterialPrice(overrides, m.key, m.priceCents) }));
  const machines = data.machines
    .filter((m) => matchesQ(m.name))
    .map((m) => ({ ...m, active: activeMachineRate(overrides, m.key, m.ratePerHourCents) }));
  const sqftRates = data.sqftRates.filter((r) => matchesQ(`${r.name} ${r.category}`));
  const wraps = data.vehicleWraps.filter((w) => matchesQ(`${w.name} ${w.coverage}`)).slice(0, 200);
  const bundles = data.bundles.filter((b) => matchesQ(`${b.name} ${b.signType}`));

  const syncedLabel = snapshot.syncedAt
    ? snapshot.syncedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : 'never';

  return (
    <>
      <PageHeader
        title="Pricing backend"
        subtitle="The Google Sheet supplies the catalog — the owner keeps editing prices there. Overrides and operating rates are managed here."
        actions={
          <>
            <a
              href={pricingSheetUrl()}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center rounded-[10px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3.5 py-2 text-[13px] font-semibold text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
            >
              Open Google Sheet ↗
            </a>
            <form action={refreshSheetAction}>
              <button className="inline-flex items-center justify-center rounded-[10px] bg-[var(--color-bv-text)] px-3.5 py-2 text-[13px] font-semibold text-white hover:opacity-95">
                ⟳ Refresh Sheet
              </button>
            </form>
          </>
        }
      />

      {/* status cards */}
      <div className="grid gap-3 md:grid-cols-4">
        <div className={`${cardCls} p-4`}>
          <div className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-[var(--color-bv-muted)]">
            Google Sheet
          </div>
          <div className="mt-1 flex items-center gap-2 text-[18px] font-bold text-[var(--color-bv-text)]">
            <span
              className={`h-2.5 w-2.5 rounded-full ${snapshot.status === 'OK' ? 'bg-emerald-500' : 'bg-red-500'}`}
            />
            {snapshot.status === 'OK' ? 'Connected' : 'Error'}
          </div>
          <div className="mt-0.5 text-[11px] text-[var(--color-bv-muted)]">
            {snapshot.status === 'OK'
              ? `Synced ${syncedLabel} · auto every 5 min`
              : (snapshot.lastError ?? 'Sync failed')}
          </div>
        </div>
        {(
          [
            [String(data.materials.length), 'Materials', 'Meterial price + Vendor Catalog tabs'],
            [String(data.machines.length), 'Machines', 'Machinary Price tab · live hourly rates'],
            [String(overrideCount), 'Overrides', 'App-controlled prices · reset to follow Sheet'],
          ] as const
        ).map(([v, t, s]) => (
          <div key={t} className={`${cardCls} p-4`}>
            <div className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-[var(--color-bv-muted)]">
              {t}
            </div>
            <div className="mt-1 text-[20px] font-bold text-[var(--color-bv-text)]">{v}</div>
            <div className="mt-0.5 text-[11px] text-[var(--color-bv-muted)]">{s}</div>
          </div>
        ))}
      </div>

      {/* operating rates */}
      <div className={`${cardCls} mt-4 p-5`}>
        <div className="text-[15px] font-bold text-[var(--color-bv-text)]">Operating rates</div>
        <div className="text-[11.5px] text-[var(--color-bv-muted)]">
          Used immediately in every new estimate. Stored in B Visible (not the Sheet), audited on
          change.
        </div>
        <form
          action={saveOperatingRatesAction}
          className="mt-3 grid items-end gap-3 md:grid-cols-[repeat(4,1fr)_auto]"
        >
          {(
            [
              ['shopLabor', 'Shop labor', '$ / hour', (rates?.shopLaborCentsPerHour ?? 5000) / 100],
              ['designFlat', 'Design', '$ flat', (rates?.designFlatCents ?? 15000) / 100],
              [
                'installRate',
                'Installation',
                '$ / person / hr',
                (rates?.installPerPersonHourCents ?? 15000) / 100,
              ],
              [
                'defaultMarkup',
                'Default markup',
                '% (200 = ×3.00)',
                (rates?.defaultMarkupPercentMilli ?? 200000) / 1000,
              ],
            ] as const
          ).map(([name, label, hint, value]) => (
            <label key={name} className="block">
              <span className="mb-1 block text-[9.5px] font-bold uppercase tracking-[0.12em] text-[var(--color-bv-text)] opacity-70">
                {label} <span className="font-normal normal-case opacity-70">({hint})</span>
              </span>
              <input
                className={`${inputCls} w-full`}
                name={name}
                type="number"
                min={0}
                step="0.01"
                defaultValue={value}
              />
            </label>
          ))}
          <button className="rounded-[10px] bg-[var(--color-bv-accent)] px-5 py-2.5 text-[13px] font-bold text-white hover:opacity-95">
            Save rates
          </button>
        </form>
      </div>

      {/* legacy cleanup */}
      {legacyCount > 0 ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-bv)] border border-amber-200 bg-amber-50 px-5 py-3.5">
          <div className="text-[12.5px] text-amber-900">
            <b>{legacyCount}</b> catalog material{legacyCount === 1 ? '' : 's'} did not come from
            the Google Sheet. The Sheet is the source of truth — deactivate the legacy items?
            (Soft-deactivate only; bundles and labor items are untouched.)
          </div>
          <form action={deactivateLegacyMaterialsAction}>
            <button className="rounded-[10px] bg-amber-600 px-4 py-2 text-[12px] font-bold text-white hover:opacity-95">
              Deactivate {legacyCount} legacy item{legacyCount === 1 ? '' : 's'}
            </button>
          </form>
        </div>
      ) : null}

      {/* catalog tables */}
      <div className={`${cardCls} mt-4 overflow-visible`}>
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-bv-border)] px-4 py-3">
          {TABS.map((t) => {
            const count =
              t.key === 'materials'
                ? data.materials.length
                : t.key === 'machines'
                  ? data.machines.length
                  : t.key === 'sqft'
                    ? data.sqftRates.length
                    : t.key === 'wraps'
                      ? data.vehicleWraps.length
                      : data.bundles.length;
            return (
              <Link
                key={t.key}
                href={`/pricing-backend?tab=${t.key}${q ? `&q=${encodeURIComponent(sp.q ?? '')}` : ''}`}
                className={`rounded-full px-4 py-1.5 text-[12px] font-bold ${
                  tab === t.key
                    ? 'bg-[var(--color-bv-text)] text-white'
                    : 'bg-[var(--color-bv-bg)] text-[var(--color-bv-muted)]'
                }`}
              >
                {t.label} · {count}
              </Link>
            );
          })}
          <form className="ml-auto" method="GET">
            <input type="hidden" name="tab" value={tab} />
            <input
              className={`${inputCls} w-64`}
              name="q"
              placeholder="Search name, category, or vendor…"
              defaultValue={sp.q ?? ''}
            />
          </form>
        </div>
        <div className="flex justify-between bg-[#fdf6ef] px-4 py-2 text-[10.5px] text-[#b05c1e]">
          <span>Sheet prices update automatically on sync.</span>
          <span>An override stays active until you reset it to the Sheet price.</span>
        </div>

        <table className="w-full border-collapse">
          {tab === 'materials' ? (
            <>
              <thead>
                <tr className="border-b border-[var(--color-bv-border)]">
                  <th className={thCls}>Material</th>
                  <th className={thCls}>Category</th>
                  <th className={thCls}>Sheet price</th>
                  <th className={thCls}>Active price</th>
                  <th className={thCls}>Vendor</th>
                  <th className={thCls}>Source</th>
                  <th className={thCls}></th>
                </tr>
              </thead>
              <tbody>
                {materials.map((m) => (
                  <tr key={m.key} className="border-b border-[var(--color-bv-border)]/50">
                    <td className={`${tdCls} font-semibold`}>{m.name}</td>
                    <td className={tdCls}>{m.category}</td>
                    <td className={tdCls}>{formatMoney(m.priceCents)}</td>
                    <td
                      className={`${tdCls} font-bold ${m.active.source === 'OVERRIDE' ? 'text-[#b05c1e]' : ''}`}
                    >
                      {formatMoney(m.active.priceCents)}
                    </td>
                    <td className={tdCls}>{m.vendor || '—'}</td>
                    <td className={tdCls}>
                      <SourceBadge source={m.active.source} />
                    </td>
                    <td className={`${tdCls} w-28`}>
                      <OverrideCell
                        itemType="MATERIAL"
                        itemKey={m.key}
                        source={m.active.source}
                        activeCents={m.active.priceCents}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </>
          ) : null}

          {tab === 'machines' ? (
            <>
              <thead>
                <tr className="border-b border-[var(--color-bv-border)]">
                  <th className={thCls}>Machine</th>
                  <th className={thCls}>Sheet rate</th>
                  <th className={thCls}>Active rate</th>
                  <th className={thCls}>Source</th>
                  <th className={thCls}></th>
                </tr>
              </thead>
              <tbody>
                {machines.map((m) => (
                  <tr key={m.key} className="border-b border-[var(--color-bv-border)]/50">
                    <td className={`${tdCls} font-semibold`}>{m.name}</td>
                    <td className={tdCls}>{formatMoney(m.ratePerHourCents)}/hr</td>
                    <td
                      className={`${tdCls} font-bold ${m.active.source === 'OVERRIDE' ? 'text-[#b05c1e]' : ''}`}
                    >
                      {formatMoney(m.active.priceCents)}/hr
                    </td>
                    <td className={tdCls}>
                      <SourceBadge source={m.active.source} />
                    </td>
                    <td className={`${tdCls} w-28`}>
                      <OverrideCell
                        itemType="MACHINE"
                        itemKey={m.key}
                        source={m.active.source}
                        activeCents={m.active.priceCents}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </>
          ) : null}

          {tab === 'sqft' ? (
            <>
              <thead>
                <tr className="border-b border-[var(--color-bv-border)]">
                  <th className={thCls}>Item</th>
                  <th className={thCls}>Category</th>
                  <th className={thCls}>$ / sq ft (final)</th>
                  <th className={thCls}>Waste %</th>
                  <th className={thCls}>Default machine</th>
                  <th className={thCls}>Shop min / sq ft</th>
                </tr>
              </thead>
              <tbody>
                {sqftRates.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--color-bv-border)]/50">
                    <td className={`${tdCls} font-semibold`}>{r.name}</td>
                    <td className={tdCls}>{r.category}</td>
                    <td className={`${tdCls} font-bold`}>{formatMoney(r.pricePerSqFtCents)}</td>
                    <td className={tdCls}>{r.wastePercent}%</td>
                    <td className={tdCls}>{r.defaultMachine || '—'}</td>
                    <td className={tdCls}>{r.shopMinutesPerSqFt}</td>
                  </tr>
                ))}
              </tbody>
            </>
          ) : null}

          {tab === 'wraps' ? (
            <>
              <thead>
                <tr className="border-b border-[var(--color-bv-border)]">
                  <th className={thCls}>Vehicle</th>
                  <th className={thCls}>Coverage</th>
                  <th className={thCls}>Billable sq ft</th>
                  <th className={thCls}>Price (final)</th>
                </tr>
              </thead>
              <tbody>
                {wraps.map((w) => (
                  <tr key={w.id} className="border-b border-[var(--color-bv-border)]/50">
                    <td className={`${tdCls} font-semibold`}>{w.name}</td>
                    <td className={tdCls}>{w.coverage || '—'}</td>
                    <td className={tdCls}>{w.billableAreaSqFt || '—'}</td>
                    <td className={`${tdCls} font-bold`}>{formatMoney(w.priceCents)}</td>
                  </tr>
                ))}
              </tbody>
            </>
          ) : null}

          {tab === 'bundles' ? (
            <>
              <thead>
                <tr className="border-b border-[var(--color-bv-border)]">
                  <th className={thCls}>Bundle</th>
                  <th className={thCls}>Sign type</th>
                  <th className={thCls}>Shop hr</th>
                  <th className={thCls}>Design</th>
                  <th className={thCls}>Install hr</th>
                  <th className={thCls}>Installers</th>
                  <th className={thCls}>Components</th>
                </tr>
              </thead>
              <tbody>
                {bundles.map((b) => (
                  <tr key={b.id} className="border-b border-[var(--color-bv-border)]/50">
                    <td className={`${tdCls} font-semibold`}>{b.name}</td>
                    <td className={tdCls}>{b.signType || '—'}</td>
                    <td className={tdCls}>{b.shopHours}</td>
                    <td className={tdCls}>{b.designUnits}</td>
                    <td className={tdCls}>{b.installHours + b.travelHours}</td>
                    <td className={tdCls}>{b.installers}</td>
                    <td className={tdCls}>
                      {data.bundleComponents.filter((c) => c.packageId === b.id).length}
                    </td>
                  </tr>
                ))}
              </tbody>
            </>
          ) : null}
        </table>

        <div className="flex justify-between bg-[var(--color-bv-bg)] px-4 py-2.5 text-[10.5px] text-[var(--color-bv-muted)]">
          <span>
            {tab === 'materials'
              ? `Showing ${materials.length} of ${data.materials.length} live items`
              : ''}
          </span>
          <span>
            Auto-refresh: every 5 minutes wherever Sheet pricing is used · sq-ft and wrap prices
            are final (never marked up twice)
          </span>
        </div>
      </div>
    </>
  );
}

import Link from 'next/link';
import { prisma } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { AutoSubmitInput } from '@/components/app/auto-submit-controls';
import { EmptyState } from '@/components/app/empty-state';
import { VendorCsvButtons } from './csv-buttons';

export const metadata = { title: 'Vendors' };
export const dynamic = 'force-dynamic';

interface SearchParams {
  created?: string;
  q?: string;
  filter?: string;
}

type VendorFilter = 'all' | 'contact-ready' | 'missing-contact' | 'has-pos' | 'no-pos';

type VendorListRow = {
  name: string;
  email: string | null;
  phone: string | null;
  emails: string[];
  phones: string[];
  notes: string | null;
  _count: { purchaseOrders: number };
};

const VENDOR_FILTERS: ReadonlyArray<{ value: VendorFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'contact-ready', label: 'Contact ready' },
  { value: 'missing-contact', label: 'Missing contact' },
  { value: 'has-pos', label: 'Has POs' },
  { value: 'no-pos', label: 'No POs' },
];

export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const me = await requireTenantId();
  const sp = await searchParams;
  const rawQ = sp.q?.trim() ?? '';
  const filter = parseVendorFilter(sp.filter);

  const vendors = await prisma.vendor.findMany({
    where: { tenantId: me.tenantId, deletedAt: null },
    orderBy: [{ name: 'asc' }],
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      emails: true,
      phones: true,
      notes: true,
      _count: { select: { purchaseOrders: true } },
      updatedAt: true,
    },
    take: 500,
  });

  const activeVendors = vendors.filter((v) => v._count.purchaseOrders > 0).length;
  const contactReady = vendors.filter(
    (v) => v.emails.length > 0 || v.email || v.phones.length > 0 || v.phone
  ).length;
  const totalPOs = vendors.reduce((sum, v) => sum + v._count.purchaseOrders, 0);
  const filteredVendors = vendors.filter(
    (vendor) => vendorMatchesSearch(vendor, rawQ) && vendorMatchesFilter(vendor, filter)
  );

  return (
    <>
      <PageHeader
        title="Vendors"
        subtitle={`Supplier directory for ${me.tenant.name}. Track contacts, PO history, and pricing intelligence across all suppliers.`}
        actions={
          <div className="flex items-center gap-2">
            <VendorCsvButtons />
            <Link
              href="/vendors/new"
              className="inline-flex items-center justify-center rounded-[12px] bg-[var(--color-bv-accent)] px-4 py-2.5 text-[13.5px] font-semibold text-[var(--color-bv-accent-foreground)] shadow-[0_16px_34px_rgba(47,90,243,0.24)] transition-all hover:-translate-y-0.5 hover:opacity-95"
            >
              Add vendor
            </Link>
          </div>
        }
      />

      {sp.created ? (
        <div className="mb-5 rounded-[var(--radius-bv)] border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[13px] text-emerald-900">
          Created <span className="font-medium">{sp.created}</span>.
        </div>
      ) : null}

      {vendors.length === 0 ? (
        <EmptyState
          title="No vendors yet"
          description="Vendors are suppliers you issue POs to. Add one before creating purchase orders."
          primaryAction={{ label: 'Add vendor', href: '/vendors/new' }}
        />
      ) : (
        <div className="grid gap-5">
          <section className="grid gap-3 md:grid-cols-3">
            <VendorStat label="Total vendors" value={vendors.length.toString()} detail={`${activeVendors} with PO activity`} tone="blue" />
            <VendorStat label="Total POs issued" value={totalPOs.toString()} detail="Purchase orders across all vendors" tone="emerald" />
            <VendorStat label="Contact ready" value={contactReady.toString()} detail={`${filteredVendors.length} showing now`} tone="violet" />
          </section>

          <section className="rounded-[22px] border border-white/80 bg-white/90 p-4 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-xl">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <form method="get" className="flex min-w-[280px] flex-1 flex-wrap items-center gap-2">
                <input type="hidden" name="filter" value={filter} />
                <AutoSubmitInput
                  name="q"
                  defaultValue={rawQ}
                  placeholder="Search vendors by name, email, phone, or notes..."
                  className="h-11 min-w-[260px] flex-1 rounded-[14px] border border-slate-200 bg-slate-50/80 px-4 text-[13.5px] outline-none transition-all placeholder:text-slate-400 focus:border-blue-300 focus:bg-white focus:shadow-[0_0_0_4px_rgba(47,90,243,0.10)]"
                />
                <button
                  type="submit"
                  className="h-11 rounded-[14px] border border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-700 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-slate-50"
                >
                  Search
                </button>
                {rawQ || filter !== 'all' ? (
                  <Link
                    href="/vendors"
                    className="h-11 rounded-[14px] border border-slate-200 bg-white px-4 py-3 text-[13px] font-semibold text-slate-500 transition-all hover:bg-slate-50 hover:text-slate-900"
                  >
                    Clear
                  </Link>
                ) : null}
              </form>
              <div className="flex flex-wrap gap-2 text-[12px]">
                {VENDOR_FILTERS.map((f) => (
                  <Link
                    key={f.value}
                    href={vendorFilterHref(f.value, rawQ)}
                    className={`rounded-full px-3 py-1.5 font-semibold transition-all ${
                      filter === f.value
                        ? 'bg-[var(--color-bv-accent)] text-white shadow-[0_10px_22px_rgba(47,90,243,0.22)]'
                        : 'border border-slate-200 bg-white text-slate-500 hover:border-blue-100 hover:bg-blue-50 hover:text-blue-700'
                    }`}
                  >
                    {f.label}
                  </Link>
                ))}
              </div>
            </div>
          </section>

          <section className="flex max-h-[calc(100vh-375px)] min-h-[280px] flex-col overflow-hidden rounded-[22px] border border-white/80 bg-white/90 shadow-[0_22px_70px_rgba(15,23,42,0.10)] backdrop-blur-xl">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-[15px] font-semibold text-slate-950">Supplier directory</h2>
                <p className="mt-1 text-[12.5px] text-slate-500">
                  {rawQ || filter !== 'all'
                    ? `Filtered by ${filterLabel(filter)}${rawQ ? ` matching "${rawQ}"` : ''}.`
                    : 'All active vendors with contact details and PO activity.'}
                </p>
              </div>
              <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-700">
                {filteredVendors.length} suppliers
              </span>
            </div>
            <div className="min-h-0 overflow-y-auto p-4">
              <div className="grid gap-3">
              {filteredVendors.length === 0 ? (
                <div className="rounded-[18px] border border-dashed border-slate-200 bg-slate-50/70 px-4 py-10 text-center">
                  <h3 className="text-[14px] font-semibold text-slate-950">No vendors match your search</h3>
                  <p className="mt-1 text-[12.5px] text-slate-500">Try a different keyword or filter.</p>
                  <Link
                    href="/vendors"
                    className="mt-4 inline-flex rounded-[12px] border border-slate-200 bg-white px-4 py-2 text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Clear filters
                  </Link>
                </div>
              ) : filteredVendors.map((v) => (
                <Link
                  key={v.id}
                  href={`/vendors/${v.id}`}
                  className="group grid gap-4 rounded-[18px] border border-slate-100 bg-white px-4 py-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-violet-100 hover:shadow-[0_18px_42px_rgba(15,23,42,0.08)] md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_160px_120px]"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-violet-50 text-[13px] font-semibold text-violet-700 ring-1 ring-violet-100 transition group-hover:bg-violet-100">
                        {initials(v.name)}
                      </div>
                      <div className="min-w-0">
                        <span className="truncate text-[14px] font-semibold text-slate-950 group-hover:text-[var(--color-bv-accent)]">
                          {v.name}
                        </span>
                        <p className="truncate text-[12.5px] text-slate-500">{v.notes ?? 'No notes'}</p>
                      </div>
                    </div>
                  </div>
                  <div className="grid gap-1 text-[12.5px] text-slate-500">
                    <span className="truncate">
                      {v.emails[0] ?? v.email ?? 'Email not set'}
                      {v.emails.length > 1 ? (
                        <span className="ml-1.5 rounded-full bg-violet-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-violet-600 ring-1 ring-violet-100">
                          +{v.emails.length - 1}
                        </span>
                      ) : null}
                    </span>
                    <span className="truncate">
                      {v.phones[0] ?? v.phone ?? 'Phone not set'}
                      {v.phones.length > 1 ? (
                        <span className="ml-1.5 rounded-full bg-violet-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-violet-600 ring-1 ring-violet-100">
                          +{v.phones.length - 1}
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <div>
                    <span className="inline-flex rounded-full border border-violet-100 bg-violet-50 px-2.5 py-1 text-[11.5px] font-semibold text-violet-700">
                      {v._count.purchaseOrders} POs
                    </span>
                  </div>
                  <div className="text-[12px] text-slate-500 tabular-nums group-hover:text-[var(--color-bv-accent)]">
                    Edit contacts →
                  </div>
                </Link>
              ))}
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function VendorStat({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: 'blue' | 'emerald' | 'violet' }) {
  const toneClass = {
    blue: 'from-blue-600/10 to-indigo-500/10 text-blue-700 ring-blue-500/15',
    emerald: 'from-emerald-600/10 to-teal-500/10 text-emerald-700 ring-emerald-500/15',
    violet: 'from-violet-600/10 to-fuchsia-500/10 text-violet-700 ring-violet-500/15',
  }[tone];
  return (
    <div className={`rounded-[18px] border border-white/80 bg-gradient-to-br px-4 py-4 shadow-[0_18px_50px_rgba(15,23,42,0.08)] ring-1 backdrop-blur-xl ${toneClass}`}>
      <div className="text-[10px] font-black uppercase tracking-[0.13em] opacity-70">{label}</div>
      <div className="mt-2 text-[20px] font-black leading-none tracking-[-0.02em]">{value}</div>
      <p className="mt-2 text-[11.5px] font-semibold leading-snug opacity-70">{detail}</p>
    </div>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function parseVendorFilter(raw: string | undefined): VendorFilter {
  return VENDOR_FILTERS.some((filter) => filter.value === raw) ? (raw as VendorFilter) : 'all';
}

function vendorFilterHref(filter: VendorFilter, q: string): string {
  const params = new URLSearchParams();
  if (filter !== 'all') params.set('filter', filter);
  if (q) params.set('q', q);
  const query = params.toString();
  return query ? `/vendors?${query}` : '/vendors';
}

function filterLabel(filter: VendorFilter): string {
  return VENDOR_FILTERS.find((f) => f.value === filter)?.label.toLowerCase() ?? 'all';
}

function hasContact(vendor: VendorListRow): boolean {
  return Boolean(vendor.email || vendor.phone || vendor.emails.length > 0 || vendor.phones.length > 0);
}

function vendorMatchesFilter(vendor: VendorListRow, filter: VendorFilter): boolean {
  switch (filter) {
    case 'contact-ready':
      return hasContact(vendor);
    case 'missing-contact':
      return !hasContact(vendor);
    case 'has-pos':
      return vendor._count.purchaseOrders > 0;
    case 'no-pos':
      return vendor._count.purchaseOrders === 0;
    case 'all':
      return true;
  }
}

function vendorMatchesSearch(vendor: VendorListRow, rawQ: string): boolean {
  const q = rawQ.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    vendor.name,
    vendor.email,
    vendor.phone,
    vendor.notes,
    ...vendor.emails,
    ...vendor.phones,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

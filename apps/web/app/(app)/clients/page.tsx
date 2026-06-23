import Link from 'next/link';
import { Prisma, prisma } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { AutoSubmitInput } from '@/components/app/auto-submit-controls';
import { EmptyState } from '@/components/app/empty-state';
import { BulkDeleteForm } from '@/components/app/bulk-delete-form';
import { DEFAULT_PAGE_SIZE, PaginationControls, pageSkip, parsePageParam } from '@/components/app/pagination-controls';
import { ClientCsvButtons } from './csv-buttons';
import { bulkDeleteClientsAction } from './actions';

export const metadata = { title: 'Customers' };
export const dynamic = 'force-dynamic';

interface SearchParams {
  created?: string;
  q?: string;
  filter?: string;
  page?: string | string[];
}

type CustomerFilter = 'all' | 'contact-ready' | 'missing-contact' | 'has-estimates' | 'no-estimates';

type CustomerListRow = {
  companyName: string;
  contactName: string | null;
  email: string | null;
  secondaryEmail: string | null;
  phone: string | null;
  alternatePhone: string | null;
  address: string | null;
  _count: { estimates: number };
};

const CUSTOMER_FILTERS: ReadonlyArray<{ value: CustomerFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'contact-ready', label: 'Contact ready' },
  { value: 'missing-contact', label: 'Missing contact' },
  { value: 'has-estimates', label: 'Has estimates' },
  { value: 'no-estimates', label: 'No estimates' },
];

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const me = await requireTenantId();
  const sp = await searchParams;
  const rawQ = sp.q?.trim() ?? '';
  const filter = parseCustomerFilter(sp.filter);
  const page = parsePageParam(sp.page);
  const where = customerWhere(me.tenantId, rawQ, filter);

  const [clients, totalClients, filteredTotal, contactsReady, activeClients, estimateTotal] = await Promise.all([
    prisma.client.findMany({
      where,
      orderBy: [{ companyName: 'asc' }],
      skip: pageSkip(page),
      take: DEFAULT_PAGE_SIZE,
      select: {
        id: true,
        companyName: true,
        contactName: true,
        email: true,
        secondaryEmail: true,
        phone: true,
        alternatePhone: true,
        address: true,
        _count: { select: { estimates: true } },
      },
    }),
    prisma.client.count({ where: { tenantId: me.tenantId, deletedAt: null } }),
    prisma.client.count({ where }),
    prisma.client.count({
      where: {
        tenantId: me.tenantId,
        deletedAt: null,
        OR: contactReadyWhere(),
      },
    }),
    prisma.client.count({
      where: { tenantId: me.tenantId, deletedAt: null, estimates: { some: {} } },
    }),
    prisma.estimate.count({
      where: { tenantId: me.tenantId, deletedAt: null, client: { deletedAt: null } },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle={`Customer command center for ${me.tenant.name}. Keep contacts, quote history, and account readiness easy to scan.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ClientCsvButtons />
            <Link
              href="/clients/new"
              className="inline-flex items-center justify-center rounded-[12px] bg-[var(--color-bv-accent)] px-4 py-2.5 text-[13.5px] font-semibold text-[var(--color-bv-accent-foreground)] shadow-[0_16px_34px_rgba(47,90,243,0.24)] transition-all hover:-translate-y-0.5 hover:opacity-95"
            >
              Create customer
            </Link>
          </div>
        }
      />

      {sp.created ? (
        <div className="mb-5 rounded-[var(--radius-bv)] border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[13px] text-emerald-900">
          Created <span className="font-medium">{sp.created}</span>.
        </div>
      ) : null}

      {totalClients === 0 ? (
        <EmptyState
          title="No customers yet"
          description="Clients are the customers you quote. Add one to create estimates and keep jobs organized."
          primaryAction={{ label: 'Create customer', href: '/clients/new' }}
        />
      ) : (
        <div className="grid gap-5">
          <section className="grid gap-3 md:grid-cols-3">
            <CustomerStat label="Total customers" value={totalClients.toString()} detail={`${activeClients} with estimate activity`} tone="blue" />
            <CustomerStat label="Quote history" value={estimateTotal.toString()} detail="Total estimates connected to customers" tone="emerald" />
            <CustomerStat label="Contact ready" value={contactsReady.toString()} detail={`${filteredTotal} matching filters`} tone="violet" />
          </section>

          <section className="rounded-[22px] border border-white/80 bg-white/90 p-4 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-xl">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <form method="get" className="flex min-w-[280px] flex-1 flex-wrap items-center gap-2">
                <input type="hidden" name="filter" value={filter} />
                <AutoSubmitInput
                  name="q"
                  defaultValue={rawQ}
                  placeholder="Search customers by company, contact, email, phone, or address..."
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
                    href="/clients"
                    className="h-11 rounded-[14px] border border-slate-200 bg-white px-4 py-3 text-[13px] font-semibold text-slate-500 transition-all hover:bg-slate-50 hover:text-slate-900"
                  >
                    Clear
                  </Link>
                ) : null}
              </form>
              <div className="flex flex-wrap gap-2 text-[12px]">
                {CUSTOMER_FILTERS.map((f) => (
                  <Link
                    key={f.value}
                    href={customerFilterHref(f.value, rawQ)}
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
                <h2 className="text-[15px] font-semibold text-slate-950">Customer portfolio</h2>
                <p className="mt-1 text-[12.5px] text-slate-500">
                  {rawQ || filter !== 'all'
                      ? `Filtered by ${customerFilterLabel(filter)}${rawQ ? ` matching "${rawQ}"` : ''}.`
                    : 'Account details formatted for quick quoting and follow-up.'}
                </p>
              </div>
              <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-700">
                {filteredTotal} customers
              </span>
            </div>
            <div className="min-h-0 overflow-y-auto p-4">
              {clients.length === 0 ? (
                <div className="rounded-[18px] border border-dashed border-slate-200 bg-slate-50/70 px-4 py-10 text-center">
                  <h3 className="text-[14px] font-semibold text-slate-950">No customers match your search</h3>
                  <p className="mt-1 text-[12.5px] text-slate-500">Try a different keyword or filter.</p>
                  <Link
                    href="/clients"
                    className="mt-4 inline-flex rounded-[12px] border border-slate-200 bg-white px-4 py-2 text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Clear filters
                  </Link>
                </div>
              ) : (
                <BulkDeleteForm action={bulkDeleteClientsAction} itemLabel="customers">
                  <div className="grid gap-3">
                    {clients.map((c) => (
                      <div
                        key={c.id}
                        className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-[18px] border border-slate-100 bg-white px-4 py-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-violet-100 hover:shadow-[0_18px_42px_rgba(15,23,42,0.08)]"
                      >
                        <input
                          type="checkbox"
                          name="ids"
                          value={c.id}
                          aria-label={`Select ${c.companyName}`}
                          className="mt-3 h-4 w-4 rounded border-slate-300 text-[var(--color-bv-accent)] focus:ring-[var(--color-bv-accent)]"
                        />
                        <Link
                          href={`/clients/${c.id}`}
                          className="group grid min-w-0 gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_160px_120px]"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-3">
                              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-violet-50 text-[13px] font-semibold text-violet-700 ring-1 ring-violet-100 transition group-hover:bg-violet-100">
                                {initials(c.companyName)}
                              </div>
                              <div className="min-w-0">
                                <span className="truncate text-[14px] font-semibold text-slate-950 group-hover:text-[var(--color-bv-accent)]">
                                  {c.companyName}
                                </span>
                                <p className="truncate text-[12.5px] text-slate-500">
                                  {c.contactName ?? 'No primary contact yet'}
                                </p>
                              </div>
                            </div>
                          </div>
                          <div className="grid gap-1 text-[12.5px] text-slate-500">
                            <span className="truncate">
                              {c.email ?? 'Email not set'}
                              {c.secondaryEmail ? (
                                <span className="ml-1.5 rounded-full bg-violet-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-violet-600 ring-1 ring-violet-100">
                                  +1
                                </span>
                              ) : null}
                            </span>
                            <span className="truncate">
                              {c.phone ?? 'Phone not set'}
                              {c.alternatePhone ? (
                                <span className="ml-1.5 rounded-full bg-violet-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-violet-600 ring-1 ring-violet-100">
                                  +1
                                </span>
                              ) : null}
                            </span>
                          </div>
                          <div>
                            <span className="inline-flex rounded-full border border-violet-100 bg-violet-50 px-2.5 py-1 text-[11.5px] font-semibold text-violet-700">
                              {c._count.estimates} estimates
                            </span>
                          </div>
                          <div className="text-[12px] text-slate-500 tabular-nums group-hover:text-[var(--color-bv-accent)]">
                            Edit contacts →
                          </div>
                        </Link>
                      </div>
                    ))}
                  </div>
                </BulkDeleteForm>
              )}
            </div>
            <PaginationControls
              basePath="/clients"
              page={page}
              total={filteredTotal}
              params={{ q: rawQ, filter: filter === 'all' ? undefined : filter }}
            />
          </section>
        </div>
      )}
    </>
  );
}

function CustomerStat({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: 'blue' | 'emerald' | 'violet' }) {
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

function parseCustomerFilter(raw: string | undefined): CustomerFilter {
  return CUSTOMER_FILTERS.some((filter) => filter.value === raw) ? (raw as CustomerFilter) : 'all';
}

function customerFilterHref(filter: CustomerFilter, q: string): string {
  const params = new URLSearchParams();
  if (filter !== 'all') params.set('filter', filter);
  if (q) params.set('q', q);
  const query = params.toString();
  return query ? `/clients?${query}` : '/clients';
}

function customerFilterLabel(filter: CustomerFilter): string {
  return CUSTOMER_FILTERS.find((f) => f.value === filter)?.label.toLowerCase() ?? 'all';
}

function customerHasContact(customer: CustomerListRow): boolean {
  return Boolean(customer.email || customer.secondaryEmail || customer.phone || customer.alternatePhone);
}

function customerMatchesFilter(customer: CustomerListRow, filter: CustomerFilter): boolean {
  switch (filter) {
    case 'contact-ready':
      return customerHasContact(customer);
    case 'missing-contact':
      return !customerHasContact(customer);
    case 'has-estimates':
      return customer._count.estimates > 0;
    case 'no-estimates':
      return customer._count.estimates === 0;
    case 'all':
      return true;
  }
}

function customerMatchesSearch(customer: CustomerListRow, rawQ: string): boolean {
  const q = rawQ.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    customer.companyName,
    customer.contactName,
    customer.email,
    customer.secondaryEmail,
    customer.phone,
    customer.alternatePhone,
    customer.address,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

function customerWhere(tenantId: string, rawQ: string, filter: CustomerFilter): Prisma.ClientWhereInput {
  return {
    tenantId,
    deletedAt: null,
    ...customerSearchWhere(rawQ),
    ...customerFilterWhere(filter),
  };
}

function customerSearchWhere(rawQ: string): Prisma.ClientWhereInput {
  const q = rawQ.trim();
  if (!q) return {};
  return {
    OR: [
      { companyName: { contains: q, mode: 'insensitive' } },
      { contactName: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
      { secondaryEmail: { contains: q, mode: 'insensitive' } },
      { phone: { contains: q, mode: 'insensitive' } },
      { alternatePhone: { contains: q, mode: 'insensitive' } },
      { address: { contains: q, mode: 'insensitive' } },
    ],
  };
}

function contactReadyWhere(): Prisma.ClientWhereInput[] {
  return [
    { email: { not: null } },
    { secondaryEmail: { not: null } },
    { phone: { not: null } },
    { alternatePhone: { not: null } },
  ];
}

function customerFilterWhere(filter: CustomerFilter): Prisma.ClientWhereInput {
  switch (filter) {
    case 'contact-ready':
      return { OR: contactReadyWhere() };
    case 'missing-contact':
      return { NOT: { OR: contactReadyWhere() } };
    case 'has-estimates':
      return { estimates: { some: {} } };
    case 'no-estimates':
      return { estimates: { none: {} } };
    case 'all':
      return {};
  }
}

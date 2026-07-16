import Link from 'next/link';
import { requireUserForAppShell } from '@/lib/auth/current-user';
import { getSheetSnapshot } from '@/lib/sheet-sync/sync';

export const metadata = { title: 'Home' };
export const dynamic = 'force-dynamic';

function BigCard({
  href,
  kicker,
  title,
  body,
  cta,
  tone,
}: {
  href: string;
  kicker: string;
  title: string;
  body: string;
  cta: string;
  tone: 'accent' | 'dark';
}) {
  const toneClasses =
    tone === 'accent'
      ? 'bg-[var(--color-bv-accent)] text-white'
      : 'bg-[var(--color-bv-text)] text-white';
  return (
    <Link
      href={href}
      className={`group flex min-h-[200px] flex-col rounded-[var(--radius-bv)] p-7 shadow-[var(--shadow-bv-elevated)] transition-transform hover:-translate-y-0.5 ${toneClasses}`}
    >
      <div className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-80">{kicker}</div>
      <div className="mt-1 text-[26px] font-bold tracking-[-0.01em]">{title}</div>
      <p className="mt-2 max-w-md text-[13.5px] leading-relaxed opacity-90">{body}</p>
      <div className="mt-auto pt-5 text-[13px] font-bold">
        {cta} <span className="transition-transform group-hover:translate-x-0.5">→</span>
      </div>
    </Link>
  );
}

export default async function HomePage() {
  const user = await requireUserForAppShell();

  let sheetLine: { ok: boolean; text: string } = {
    ok: false,
    text: 'Pricing Sheet not synced yet',
  };
  if (user.tenantId) {
    try {
      const snapshot = await getSheetSnapshot(user.tenantId);
      if (snapshot.status === 'OK' && snapshot.syncedAt) {
        const d = snapshot.data;
        sheetLine = {
          ok: true,
          text: `Live pricing Sheet connected · ${d.materials.length} materials · ${d.bundles.length} bundles · ${d.vehicleWraps.length} vehicle wraps`,
        };
      } else if (snapshot.lastError) {
        sheetLine = { ok: false, text: `Pricing Sheet: ${snapshot.lastError}` };
      }
    } catch {
      sheetLine = { ok: false, text: 'Pricing Sheet unreachable — using last saved catalog' };
    }
  }

  return (
    <div className="mx-auto max-w-[1080px]">
      <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-bv-accent)]">
        B Visible workspace
      </div>
      <h1 className="mt-2 text-[clamp(2rem,4vw,2.6rem)] font-bold tracking-[-0.02em] text-[var(--color-bv-text)]">
        What do you need to do?
      </h1>
      <p className="mt-1 text-[14px] text-[var(--color-bv-muted)]">
        Choose one clear path. Your name is attached to every estimate and purchase order
        automatically.
      </p>

      <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-4 py-1.5 text-[12px] text-[var(--color-bv-muted)] shadow-[var(--shadow-bv-card)]">
        <span
          className={`h-2 w-2 rounded-full ${sheetLine.ok ? 'bg-emerald-500' : 'bg-amber-500'}`}
        />
        <span className={sheetLine.ok ? 'font-medium text-[var(--color-bv-text)]' : ''}>
          {sheetLine.text}
        </span>
      </div>

      <div className="mt-7 grid gap-5 md:grid-cols-2">
        <BigCard
          href="/estimates/new"
          kicker="Office"
          title="Create a new estimate"
          body="Build the job one line at a time with materials, ready items, bundles, vehicle wraps, or measured square footage."
          cta="Start estimate"
          tone="accent"
        />
        <BigCard
          href="/purchase-orders/shop-order"
          kicker="Shop"
          title="Order materials"
          body="Add what the shop needs. We split it by the lowest-price vendor and create separate purchase orders."
          cta="Open purchasing"
          tone="dark"
        />
      </div>

    </div>
  );
}

import { Role } from '@bvisible/db';
import { requireRoleWithEffectiveCompany } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { AdminMetric, AdminPanel, AdminPill } from '@/components/app/admin-ui';
import { loadPoCcRecipients } from '@/lib/emails/po-cc';
import { PoCcForm } from './po-cc-form';

export const metadata = { title: 'PO email CC' };
export const dynamic = 'force-dynamic';

export default async function PoEmailCcPage() {
  const me = await requireRoleWithEffectiveCompany(Role.ADMIN, Role.SUPER_ADMIN);
  const emails = await loadPoCcRecipients(me.tenantId);

  return (
    <>
      <PageHeader
        title="PO email CC"
        subtitle="Who is copied on every purchase order emailed to a vendor. Applies to purchase orders only."
      />

      <section className="mb-5 grid gap-3 md:grid-cols-3">
        <AdminMetric
          label="CC recipients"
          value={emails.length.toString()}
          detail={emails.length === 0 ? 'Vendor only — nobody is copied' : 'Copied on every PO email'}
          tone={emails.length === 0 ? 'slate' : 'blue'}
        />
        <AdminMetric
          label="Applies to"
          value="Purchase orders"
          detail="Estimates keep their own separate CC list"
          tone="violet"
        />
        <AdminMetric
          label="Sending"
          value="Manual"
          detail="A PO is emailed only when you click Send PO"
          tone="emerald"
        />
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <AdminPanel
          title="Default CC recipients"
          eyebrow="Purchase order email"
          description="These addresses are copied on every purchase order emailed to a vendor. Leave the list empty to send to the vendor only. You can still adjust the CC list for a single email on the Send PO screen — that never changes this default."
          action={
            <AdminPill tone={emails.length === 0 ? 'slate' : 'emerald'}>
              {emails.length === 0 ? 'no CC' : `${emails.length} recipient${emails.length === 1 ? '' : 's'}`}
            </AdminPill>
          }
        >
          <div className="p-5">
            <PoCcForm initialEmails={emails} />
          </div>
        </AdminPanel>

        <AdminPanel
          title="What this does and does not change"
          eyebrow="Scope"
          description="Kept explicit so a change here never surprises anyone on another document type."
        >
          <div className="grid gap-3 p-5 text-[13px] leading-relaxed text-slate-700">
            <ScopeRow
              tone="yes"
              title="Purchase orders emailed to a vendor"
              detail="Both the Send PO button on a purchase order and the shop-order flow use this list."
            />
            <ScopeRow
              tone="no"
              title="Estimates sent to a customer"
              detail="Estimates have their own CC list and are not affected by anything on this page."
            />
            <ScopeRow
              tone="no"
              title="Internal notifications"
              detail="Draft-PO alerts to admins and office reminders for online-store orders have their own recipients and never used this CC list."
            />
            <ScopeRow
              tone="no"
              title="Automatic sending"
              detail="Changing this list does not send anything. A purchase order goes out only when someone clicks Send PO."
            />
          </div>
        </AdminPanel>
      </div>
    </>
  );
}

function ScopeRow({
  tone,
  title,
  detail,
}: {
  tone: 'yes' | 'no';
  title: string;
  detail: string;
}) {
  const yes = tone === 'yes';
  return (
    <div className="flex gap-3 rounded-[14px] border border-slate-100 bg-slate-50/60 px-4 py-3">
      <span
        aria-hidden
        className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[12px] font-black ${
          yes ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'
        }`}
      >
        {yes ? '✓' : '—'}
      </span>
      <div>
        <p className="text-[13px] font-semibold text-slate-900">{title}</p>
        <p className="mt-0.5 text-[12px] text-slate-500">{detail}</p>
      </div>
    </div>
  );
}

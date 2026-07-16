import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { assistantConfigured } from '@/lib/assistant/agent';
import { AssistantChat } from './assistant-chat';

export const metadata = { title: 'Assistant' };
export const dynamic = 'force-dynamic';

export default async function AssistantPage() {
  await requireTenantId();
  const configured = assistantConfigured();

  return (
    <>
      <PageHeader
        title="Business assistant"
        subtitle="Estimates, lookups, and business answers — grounded in the live pricing Sheet and your data."
      />
      {!configured ? (
        <div className="mb-4 max-w-[1000px] rounded-[var(--radius-bv)] border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-900">
          <b>Setup needed:</b> add <code>OPENAI_API_KEY</code> (and optionally{' '}
          <code>OPENAI_MODEL</code>) to the server environment, then restart the app. The
          assistant stays disabled until then.
        </div>
      ) : (
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#ecc39e] bg-[#fdf6ef] px-4 py-1.5 text-[11.5px] text-[#8a5a33]">
          🔒 Drafts only — the assistant never sends, emails, approves, finalizes, or deletes.
        </div>
      )}
      <AssistantChat configured={configured} />
    </>
  );
}

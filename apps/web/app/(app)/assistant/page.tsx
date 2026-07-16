import { prisma, Role } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { assistantConfigured } from '@/lib/assistant/agent';
import { AssistantChat } from './assistant-chat';
import { AssistantSettingsPanel } from './settings-panel';

export const metadata = { title: 'Assistant' };
export const dynamic = 'force-dynamic';

export default async function AssistantPage() {
  const me = await requireTenantId();
  const [configured, setting] = await Promise.all([
    assistantConfigured(me.tenantId),
    prisma.assistantSetting.findUnique({
      where: { tenantId: me.tenantId },
      select: { apiKeyCipher: true, model: true },
    }),
  ]);
  const isAdmin = me.role === Role.ADMIN || me.role === Role.SUPER_ADMIN;

  return (
    <>
      <PageHeader
        title="Business assistant"
        subtitle="Estimates, lookups, and business answers — grounded in the live pricing Sheet and your data."
      />
      {isAdmin ? (
        <AssistantSettingsPanel
          keyConfigured={Boolean(setting?.apiKeyCipher) || configured}
          model={setting?.model ?? 'gpt-5-mini'}
        />
      ) : null}
      {!configured ? (
        <div className="mb-4 max-w-[1000px] rounded-[var(--radius-bv)] border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-900">
          <b>Setup needed:</b> open <b>Assistant settings</b> above and paste your OpenAI API key.
          The assistant stays disabled until then.
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

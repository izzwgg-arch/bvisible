'use server';

// Assistant settings (ADMIN+): OpenAI API key sealed with AES-256-GCM
// before it touches the database; never echoed back to the browser.

import { revalidatePath } from 'next/cache';
import { prisma, Role } from '@bvisible/db';
import { requireRoleWithEffectiveCompany } from '@/lib/auth/current-user';
import { sealSecret } from '@/lib/email-ingest/crypto';
import { writeAuditLog } from '@/lib/auth/audit';

export interface AssistantSettingsState {
  error: string | null;
  saved?: boolean;
}

export async function saveAssistantSettingsAction(
  _prev: AssistantSettingsState,
  formData: FormData
): Promise<AssistantSettingsState> {
  const me = await requireRoleWithEffectiveCompany(Role.ADMIN, Role.SUPER_ADMIN);
  if (!me.tenantId) return { error: 'No workspace selected.' };

  const apiKey = String(formData.get('apiKey') ?? '').trim();
  const model = String(formData.get('model') ?? '').trim().slice(0, 80) || 'gpt-5.6-sol';
  const clear = formData.get('clear') === '1';

  if (!clear && apiKey && (apiKey.length < 20 || !/^sk-/.test(apiKey))) {
    return { error: 'That does not look like an OpenAI API key (should start with "sk-").' };
  }

  const data: { model: string; apiKeyCipher?: string | null } = { model };
  if (clear) data.apiKeyCipher = null;
  else if (apiKey) data.apiKeyCipher = sealSecret(apiKey).cipherText;

  await prisma.assistantSetting.upsert({
    where: { tenantId: me.tenantId },
    update: data,
    create: { tenantId: me.tenantId, ...data },
  });

  await writeAuditLog({
    action: 'assistant_settings_saved',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'assistant_settings',
    targetId: me.tenantId,
    metadata: { model, keyChanged: clear || Boolean(apiKey), cleared: clear },
  });

  revalidatePath('/assistant');
  return { error: null, saved: true };
}

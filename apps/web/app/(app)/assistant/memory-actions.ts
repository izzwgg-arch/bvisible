'use server';

// Assistant training (ADMIN+): the permanent memory bank the agent reads
// at the start of every conversation. Admins teach it by correcting the
// assistant in chat ("remember: …"); this panel is the manual escape
// hatch — add a lesson by hand, or drop one that turned out wrong.

import { revalidatePath } from 'next/cache';
import { prisma, Role } from '@bvisible/db';
import { requireRoleWithEffectiveCompany } from '@/lib/auth/current-user';
import { saveAssistantLesson } from '@/lib/assistant/agent';
import { writeAuditLog } from '@/lib/auth/audit';

export interface AssistantMemoryState {
  error: string | null;
  saved?: string | null;
  forgot?: string | null;
}

export async function teachAssistantAction(
  _prev: AssistantMemoryState,
  formData: FormData
): Promise<AssistantMemoryState> {
  const me = await requireRoleWithEffectiveCompany(Role.ADMIN, Role.SUPER_ADMIN);

  const lesson = String(formData.get('lesson') ?? '').trim();
  const category = String(formData.get('category') ?? '').trim();
  if (lesson.length < 8) return { error: 'Write a lesson of at least a few words.' };

  const result = await saveAssistantLesson(
    { id: me.id, tenantId: me.tenantId },
    lesson,
    category,
    'panel'
  );
  if ('error' in result) return { error: result.error };

  revalidatePath('/assistant');
  return { error: null, saved: result.saved };
}

export async function forgetAssistantMemoryAction(
  _prev: AssistantMemoryState,
  formData: FormData
): Promise<AssistantMemoryState> {
  const me = await requireRoleWithEffectiveCompany(Role.ADMIN, Role.SUPER_ADMIN);

  const id = String(formData.get('id') ?? '').trim();
  if (!id) return { error: 'Nothing selected.' };

  // Scoped read before the delete: a made-up id matches nothing, and the
  // lookup gives us the wording to audit and echo back.
  const row = await prisma.assistantMemory.findFirst({
    where: { id, tenantId: me.tenantId },
    select: { id: true, content: true },
  });
  if (!row) return { error: 'That lesson is already gone.' };

  await prisma.assistantMemory.delete({ where: { id: row.id } });
  await writeAuditLog({
    action: 'assistant_memory_forgotten',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'assistant_memory',
    targetId: row.id,
    metadata: { lesson: row.content, via: 'panel' },
  });

  revalidatePath('/assistant');
  return { error: null, forgot: row.content };
}

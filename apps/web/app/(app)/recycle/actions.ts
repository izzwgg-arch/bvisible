'use server';

import { revalidatePath } from 'next/cache';
import { requireTenantId } from '@/lib/auth/current-user';
import { restoreRecord } from '@/lib/assistant/recycle';
import type { RecyclableEntity } from '@/lib/assistant/operator-actions';

const ENTITIES: RecyclableEntity[] = ['estimate', 'customer', 'vendor', 'purchase_order', 'catalog_item'];

export async function restoreRecordAction(
  _prev: { error: string | null },
  formData: FormData,
): Promise<{ error: string | null }> {
  const me = await requireTenantId();
  const entity = String(formData.get('entity') ?? '');
  const id = String(formData.get('id') ?? '');
  if (!ENTITIES.includes(entity as RecyclableEntity) || !id) {
    return { error: 'Invalid restore request.' };
  }
  const res = await restoreRecord({ id: me.id, tenantId: me.tenantId }, entity as RecyclableEntity, id);
  if ('error' in res) return { error: res.error };
  revalidatePath('/recycle');
  return { error: null };
}

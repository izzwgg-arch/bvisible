'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@bvisible/db';
import { dismissVendorPriceNotificationSchema } from '@/lib/validators';
import { requireTenantId } from '@/lib/auth/current-user';
import { readRequestContext } from '@/lib/request-context';
import { writeAuditLog } from '@/lib/auth/audit';

/** Called from dashboard `<form action={...}>` — no prev state. */
export async function dismissVendorPriceNotificationAction(
  formData: FormData
): Promise<void> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();

  const parsed = dismissVendorPriceNotificationSchema.safeParse({
    notificationId: formData.get('notificationId'),
  });
  if (!parsed.success) return;
  const { notificationId } = parsed.data;

  const row = await prisma.vendorPriceNotification.findFirst({
    where: {
      id: notificationId,
      tenantId: me.tenantId,
      dismissedAt: null,
    },
    select: { id: true, vendorId: true },
  });
  if (!row) return;

  await prisma.vendorPriceNotification.update({
    where: { id: notificationId },
    data: { dismissedAt: new Date() },
  });

  await writeAuditLog({
    action: 'vendor_price_notification_dismissed',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'vendor_price_notification',
    targetId: notificationId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: {},
  });

  revalidatePath('/dashboard');
  revalidatePath('/vendors');
  revalidatePath(`/vendors/${row.vendorId}`);
}

import { requireTenantId } from '@/lib/auth/current-user';
import { buildOrderableCatalog } from '@/lib/po/orderable-catalog';
import { loadSmtpConfigFromDb, MailerConfigError } from '@/lib/mailer';
import { defaultOfficeReminderEmail } from '@/lib/po/office-reminder';
import { ShopOrderFlow } from './shop-order-flow';

export const metadata = { title: 'Order materials' };
export const dynamic = 'force-dynamic';

export default async function ShopOrderPage() {
  const me = await requireTenantId();

  const [catalog, smtp] = await Promise.all([
    buildOrderableCatalog(me.tenantId),
    loadSmtpConfigFromDb(),
  ]);

  // The flow renders its own per-screen headers (Order materials /
  // Review order) so each screen matches its mockup exactly.
  return (
    <ShopOrderFlow
      catalog={catalog.entries}
      aliases={catalog.aliases}
      vendorEmails={catalog.vendorEmails}
      smtpConfigured={!(smtp instanceof MailerConfigError)}
      // Prefill only. Resolved server-side (AMAZON_OFFICE_REMINDER_EMAIL, or
      // the sales@bvisible.us fallback) so no configuration reaches the client
      // beyond the address itself, and so the server still decides where a
      // reminder actually goes.
      defaultOfficeReminderTo={defaultOfficeReminderEmail()}
      sheetWarning={
        catalog.sheetOk
          ? null
          : `Material list is temporarily unavailable${catalog.sheetError ? ` — ${catalog.sheetError}` : ''}. You can still add custom materials.`
      }
    />
  );
}

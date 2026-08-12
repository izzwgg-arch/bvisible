import { requireTenantId } from '@/lib/auth/current-user';
import { buildOrderableCatalog } from '@/lib/po/orderable-catalog';
import { loadSmtpConfigFromDb, MailerConfigError } from '@/lib/mailer';
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
      sheetWarning={
        catalog.sheetOk
          ? null
          : `Material list is temporarily unavailable${catalog.sheetError ? ` — ${catalog.sheetError}` : ''}. You can still add custom materials.`
      }
    />
  );
}

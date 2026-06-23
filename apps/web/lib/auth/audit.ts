import { prisma } from '@bvisible/db';

// Allowed actions. Keep this list small and append-only — querying by
// action is indexed and changing existing strings would break old rows.
export type AuditAction =
  | 'login_success'
  | 'login_failure'
  | 'logout'
  | 'password_changed'
  | 'password_reset_requested'
  | 'password_reset_completed'
  | 'invite_created'
  | 'invite_accepted'
  | 'user_disabled'
  | 'user_enabled'
  | 'tenant_created'
  | 'tenant_invoice_profile_saved'
  | 'super_admin_bootstrapped'
  | 'client_created'
  | 'client_updated'
  | 'estimate_created'
  | 'estimate_saved'
  | 'estimate_client_changed'
  | 'estimate_client_created_and_attached'
  | 'estimate_status_changed'
  | 'estimate_multiplier_overridden'
  | 'estimate_deleted'
  | 'estimate_finalized'
  | 'estimate_unfinalized'
  | 'estimate_sent_to_client'
  | 'estimate_quote_viewed_public'
  | 'estimate_quote_accepted'
  | 'estimate_quote_declined'
  | 'invoice_created_from_estimate'
  | 'invoice_marked_paid'
  | 'vendor_created'
  | 'vendor_updated'
  | 'po_created'
  | 'po_created_from_estimate'
  | 'po_saved'
  | 'po_status_changed'
  | 'po_qbo_number_set'
  | 'po_vendor_set'
  | 'po_attachment_added'
  | 'po_attachment_deleted'
  | 'po_note_added'
  | 'po_sent'
  | 'po_deleted'
  | 'email_ingest_tick'
  | 'email_ingest_message_ingested'
  | 'email_ingest_message_matched'
  | 'email_ingest_message_failed'
  | 'email_ingest_manual_link'
  | 'email_ingest_dismissed'
  | 'email_ingest_retried'
  | 'tenant_inbox_configured'
  | 'tenant_inbox_saved'
  | 'tenant_inbox_deleted'
  | 'tenant_inbox_test_run'
  | 'vendor_price_lower_detected'
  | 'vendor_price_notification_dismissed'
  | 'shop_material_item_created'
  | 'shop_material_item_saved'
  | 'shop_item_category_saved'
  | 'machine_saved'
  | 'shop_material_manual_price_recorded'
  | 'shop_material_catalog_linked'
  | 'repricing_request_created'
  | 'repricing_request_status_changed'
  | 'po_reconciliation_run'
  | 'spend_alert_dismissed'
  | 'po_reconciliation_line_resolution'
  | 'po_reconciliation_manual_merge'
  | 'po_operator_marked_reconciled'
  | 'po_lifecycle_vendor_acknowledged'
  | 'po_lifecycle_blocked'
  | 'po_lifecycle_blocked_cleared'
  | 'po_lifecycle_received_complete'
  | 'po_reconciliation_manual_refresh'
  | 'mobile_login_success'
  | 'mobile_login_failure'
  | 'mobile_refresh_success'
  | 'mobile_refresh_failure'
  | 'mobile_logout'
  | 'mobile_upload_presign'
  | 'mobile_upload_complete'
  | 'smtp_config_saved'
  | 'client_csv_imported'
  | 'shop_material_csv_imported'
  | 'vendor_csv_imported'
  | 'vehicle_created'
  | 'vehicle_updated'
  | 'vehicle_archived'
  | 'vehicles_imported';

export interface AuditEntry {
  action: AuditAction;
  tenantId?: string | null;
  userId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  // Free-form context. NEVER put plaintext passwords, raw tokens, or full
  // email bodies here. Email addresses for login attempts are fine
  // (they're already user-identifying for the audit purpose).
  metadata?: Record<string, unknown>;
}

export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        tenantId: entry.tenantId ?? null,
        userId: entry.userId ?? null,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
        metadata: entry.metadata ? (entry.metadata as object) : undefined,
      },
    });
  } catch (err) {
    // Audit failure must NEVER break the underlying action (login, etc).
    // We still want to know about it, so log to stderr without secrets.
    // eslint-disable-next-line no-console
    console.error('audit_log_write_failed', {
      action: entry.action,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

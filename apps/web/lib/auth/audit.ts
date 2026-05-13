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
  | 'super_admin_bootstrapped';

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

import { prisma } from '@bvisible/db';

// Per-email failed-login throttle. Counts `login_failure` audit rows for
// a given email within the last LOCKOUT_WINDOW_MS. >= LOCKOUT_THRESHOLD
// returns `locked: true` and the login flow returns "too many attempts"
// without checking the password.
//
// This is intentionally simple — distributed rate limiting belongs in
// Redis (see KNOWN_RULES.md / future work). For one PM2 process on one
// box, audit-row counting is correct and free.

const LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOCKOUT_THRESHOLD = 5;

export async function isLockedForEmail(email: string): Promise<boolean> {
  const since = new Date(Date.now() - LOCKOUT_WINDOW_MS);
  const failures = await prisma.auditLog.count({
    where: {
      action: 'login_failure',
      createdAt: { gte: since },
      // metadata->>email = $email -- Postgres JSON path. Prisma path filter:
      metadata: {
        path: ['email'],
        equals: email,
      },
    },
  });
  return failures >= LOCKOUT_THRESHOLD;
}

#!/usr/bin/env tsx
// Bootstrap the first SUPER_ADMIN. Refuses to run if any SUPER_ADMIN
// already exists. Reads credentials from env vars only — never logs the
// password.
//
// Usage (on the deploy server, from /opt/bvisible/app):
//
//   BOOTSTRAP_ADMIN_EMAIL=you@example.com \
//   BOOTSTRAP_ADMIN_PASSWORD='strong-passphrase-here' \
//   BOOTSTRAP_ADMIN_NAME='Your Name' \
//   ( set -a; . /opt/bvisible/shared/env/.env; set +a; \
//     pnpm --filter @bvisible/web run bootstrap:super-admin )
//
// The set -a / set +a wrapper sources DATABASE_URL from the shared
// env file without committing it to your shell history.

import { prisma, Role } from '@bvisible/db';
import { hashPassword } from '../lib/auth/password';
import { writeAuditLog } from '../lib/auth/audit';
import { emailSchema, passwordSchema } from '../lib/validators';

async function main(): Promise<void> {
  const rawEmail = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const rawPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const rawName = process.env.BOOTSTRAP_ADMIN_NAME ?? null;

  if (!rawEmail || !rawPassword) {
    console.error(
      'bootstrap-super-admin: BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD are required.'
    );
    process.exit(2);
  }

  const emailParse = emailSchema.safeParse(rawEmail);
  if (!emailParse.success) {
    console.error('bootstrap-super-admin: invalid email.');
    process.exit(2);
  }
  const passwordParse = passwordSchema.safeParse(rawPassword);
  if (!passwordParse.success) {
    console.error(
      'bootstrap-super-admin: password must be 12-128 characters.'
    );
    process.exit(2);
  }
  const email = emailParse.data;
  const password = passwordParse.data;
  const name = rawName?.trim() || null;

  const existing = await prisma.user.findFirst({
    where: { role: Role.SUPER_ADMIN },
    select: { id: true, email: true, createdAt: true },
  });
  if (existing) {
    console.error(
      `bootstrap-super-admin: SUPER_ADMIN already exists (id=${existing.id}, email=${existing.email}, createdAt=${existing.createdAt.toISOString()}). Refusing to run.`
    );
    await prisma.$disconnect();
    process.exit(3);
  }

  const passwordHash = await hashPassword(password);

  const created = await prisma.user.create({
    data: {
      email,
      name,
      role: Role.SUPER_ADMIN,
      tenantId: null,
      passwordHash,
      inviteAcceptedAt: new Date(),
    },
    select: { id: true, email: true, createdAt: true },
  });

  await writeAuditLog({
    action: 'super_admin_bootstrapped',
    userId: created.id,
    tenantId: null,
    targetType: 'user',
    targetId: created.id,
    metadata: { email: created.email },
  });

  console.log(
    `bootstrap-super-admin: created SUPER_ADMIN id=${created.id} email=${created.email} at ${created.createdAt.toISOString()}`
  );
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(
    'bootstrap-super-admin: failed.',
    err instanceof Error ? err.message : String(err)
  );
  try {
    await prisma.$disconnect();
  } catch {
    /* swallow */
  }
  process.exit(1);
});

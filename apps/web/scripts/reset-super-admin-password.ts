#!/usr/bin/env tsx
// Rotate password for existing SUPER_ADMIN users only. Never logs plaintext
// passwords. Invalidates browser Session rows for the target user.
//
// Usage (production, deploy user):
//
//   cd /opt/bvisible/app/apps/web
//   ( set -a; . /opt/bvisible/shared/env/.env; set +a; \
//     RESET_SUPER_ADMIN_PASSWORD='your-12+-char-secret' \
//     pnpm exec tsx scripts/reset-super-admin-password.ts )
//
// When multiple SUPER_ADMIN rows exist, disambiguate:
//
//   RESET_SUPER_ADMIN_EMAIL='exact@email' ...
//
// Optional: CLEAR_SUPER_ADMIN_DISABLED=1 sets disabledAt=null when resetting.

import { prisma, Role } from '@bvisible/db';
import { hashPassword, verifyPassword } from '../lib/auth/password';
import { writeAuditLog } from '../lib/auth/audit';
import { emailSchema, passwordSchema } from '../lib/validators';

async function main(): Promise<void> {
  const rawPassword = process.env.RESET_SUPER_ADMIN_PASSWORD;
  const rawEmail = process.env.RESET_SUPER_ADMIN_EMAIL ?? null;
  const clearDisabled =
    process.env.CLEAR_SUPER_ADMIN_DISABLED === '1' ||
    process.env.CLEAR_SUPER_ADMIN_DISABLED === 'true';

  if (!rawPassword) {
    console.error(
      'reset-super-admin-password: RESET_SUPER_ADMIN_PASSWORD is required.',
    );
    process.exit(2);
  }

  const passwordParse = passwordSchema.safeParse(rawPassword);
  if (!passwordParse.success) {
    console.error(
      'reset-super-admin-password: password must be 12-128 characters.',
    );
    process.exit(2);
  }
  const password = passwordParse.data;

  const admins = await prisma.user.findMany({
    where: { role: Role.SUPER_ADMIN },
    select: {
      id: true,
      email: true,
      tenantId: true,
      disabledAt: true,
      passwordHash: true,
    },
    orderBy: { email: 'asc' },
  });

  if (admins.length === 0) {
    console.error(
      'reset-super-admin-password: no SUPER_ADMIN users found. Use bootstrap:super-admin instead.',
    );
    await prisma.$disconnect();
    process.exit(4);
  }

  let target = admins[0]!;
  if (admins.length > 1) {
    if (!rawEmail) {
      console.error(
        `reset-super-admin-password: ${admins.length} SUPER_ADMIN rows exist; set RESET_SUPER_ADMIN_EMAIL.`,
      );
      for (const a of admins) {
        console.error(`  - id=${a.id} email=${a.email} tenantId=${a.tenantId ?? 'null'}`);
      }
      await prisma.$disconnect();
      process.exit(5);
    }
    const ep = emailSchema.safeParse(rawEmail);
    if (!ep.success) {
      console.error('reset-super-admin-password: invalid RESET_SUPER_ADMIN_EMAIL.');
      await prisma.$disconnect();
      process.exit(2);
    }
    const match = admins.find((a) => a.email.toLowerCase() === ep.data.toLowerCase());
    if (!match) {
      console.error(
        'reset-super-admin-password: RESET_SUPER_ADMIN_EMAIL does not match any SUPER_ADMIN.',
      );
      await prisma.$disconnect();
      process.exit(6);
    }
    target = match;
  } else if (rawEmail) {
    const ep = emailSchema.safeParse(rawEmail);
    if (!ep.success) {
      console.error('reset-super-admin-password: invalid RESET_SUPER_ADMIN_EMAIL.');
      await prisma.$disconnect();
      process.exit(2);
    }
    if (target.email.toLowerCase() !== ep.data.toLowerCase()) {
      console.error(
        `reset-super-admin-password: email mismatch (expected ${target.email}).`,
      );
      await prisma.$disconnect();
      process.exit(6);
    }
  }

  if (!target.passwordHash) {
    console.error(
      `reset-super-admin-password: user ${target.email} has no password hash (invite flow?). Fix manually.`,
    );
    await prisma.$disconnect();
    process.exit(7);
  }

  if (target.disabledAt && !clearDisabled) {
    console.error(
      `reset-super-admin-password: user ${target.email} is disabled (disabledAt set). Re-run with CLEAR_SUPER_ADMIN_DISABLED=1 or clear disabledAt via ops.`,
    );
    await prisma.$disconnect();
    process.exit(8);
  }

  const passwordHash = await hashPassword(password);

  await prisma.$transaction([
    prisma.session.deleteMany({ where: { userId: target.id } }),
    prisma.user.update({
      where: { id: target.id },
      data: {
        passwordHash,
        ...(clearDisabled && target.disabledAt ? { disabledAt: null } : {}),
      },
    }),
  ]);

  const verifyOk = await verifyPassword(password, passwordHash);
  if (!verifyOk) {
    console.error('reset-super-admin-password: internal verifyPassword failed.');
    await prisma.$disconnect();
    process.exit(1);
  }

  await writeAuditLog({
    action: 'password_changed',
    userId: target.id,
    tenantId: target.tenantId,
    targetType: 'user',
    targetId: target.id,
    metadata: { channel: 'reset_super_admin_password_script' },
  });

  console.log(
    `reset-super-admin-password: updated SUPER_ADMIN id=${target.id} email=${target.email}; sessions invalidated; argon verify OK.`,
  );
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(
    'reset-super-admin-password: failed.',
    err instanceof Error ? err.message : String(err),
  );
  try {
    await prisma.$disconnect();
  } catch {
    /* swallow */
  }
  process.exit(1);
});

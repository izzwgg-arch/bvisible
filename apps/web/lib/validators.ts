import { z } from 'zod';
import { EstimateLineKind, EstimateStatus, Role } from '@bvisible/db';

// Email rules: lowercase, trimmed, max 254 (RFC 5321), valid shape.
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'Email is too long.')
  .email('Enter a valid email address.');

// Password rules: 12-128 chars, no other constraints. Length beats
// composition complexity for password strength. We do NOT enforce
// "must contain a number" theatre.
export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters.')
  .max(128, 'Password must be at most 128 characters.');

// Tenant slug: lowercase letters, digits, hyphens. 2-40 chars. No
// leading/trailing hyphen. Used in URLs eventually.
export const tenantSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'Slug must be at least 2 characters.')
  .max(40, 'Slug must be at most 40 characters.')
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Lowercase letters, digits, and hyphens only.');

// Login form submission.
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.').max(256),
  next: z.string().max(2048).optional(),
});

// Forgot-password form: just the email. We always say "if the email
// exists, a reset link was sent" regardless, so no verification here.
export const requestResetSchema = z.object({
  email: emailSchema,
});

// Reset form: token comes from the URL, password from the form.
export const completeResetSchema = z.object({
  token: z.string().min(20).max(80),
  password: passwordSchema,
  confirmPassword: passwordSchema,
}).refine((d) => d.password === d.confirmPassword, {
  message: 'Passwords do not match.',
  path: ['confirmPassword'],
});

// Change own password.
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.').max(256),
  newPassword: passwordSchema,
  confirmPassword: passwordSchema,
}).refine((d) => d.newPassword === d.confirmPassword, {
  message: 'New passwords do not match.',
  path: ['confirmPassword'],
});

// Accept invite: set name + password. Email + tenant + role are baked
// into the invite row.
export const acceptInviteSchema = z.object({
  token: z.string().min(20).max(80),
  name: z.string().trim().min(1, 'Enter your name.').max(120),
  password: passwordSchema,
  confirmPassword: passwordSchema,
}).refine((d) => d.password === d.confirmPassword, {
  message: 'Passwords do not match.',
  path: ['confirmPassword'],
});

// Admin: invite a user. Role is restricted to ADMIN | USER from the
// admin UI; SUPER_ADMIN can also invite SUPER_ADMIN but only via the
// CLI bootstrap path.
export const inviteUserSchema = z.object({
  email: emailSchema,
  role: z.enum([Role.ADMIN, Role.USER]),
});

// SUPER_ADMIN: create a tenant.
export const createTenantSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters.').max(120),
  slug: tenantSlugSchema,
});

// SUPER_ADMIN: send a test email to verify SMTP works.
export const testEmailSchema = z.object({
  recipient: emailSchema,
});

// ---------------------------------------------------------------------
// Estimate / client foundation
// ---------------------------------------------------------------------

// Trim, collapse internal whitespace, cap length. Used by client and
// estimate display fields where a stray newline would break the table.
const shortText = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(/\s+/g, ' ').trim())
    .pipe(z.string().min(1, 'Cannot be blank.').max(max, `Too long (max ${max} chars).`));

const longText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Too long (max ${max} chars).`)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null));

const optionalEmail = z
  .union([z.literal(''), emailSchema])
  .optional()
  .transform((v) => (v && v.length > 0 ? v : null));

const optionalShort = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null));

export const createClientSchema = z.object({
  companyName: shortText(160),
  contactName: optionalShort(120),
  email: optionalEmail,
  phone: optionalShort(40),
  notes: longText(2000),
});

export const createEstimateSchema = z.object({
  clientId: z.string().min(1, 'Pick a client.').max(60),
  title: shortText(160),
});

// One row in the editor grid as it leaves the client.
// `qtyMilli` and `unitCostCents` are integers; the client is
// responsible for parsing user input into these forms (see
// apps/web/lib/estimate/format.ts and packages/pricing/src/qty.ts).
export const estimateLineSchema = z.object({
  // Optional id so the server can keep the same row across saves;
  // missing means "newly inserted in this batch — assign one".
  id: z.string().min(1).max(60).optional(),
  kind: z.nativeEnum(EstimateLineKind),
  description: z.string().trim().max(240),
  qtyMilli: z
    .number()
    .int()
    .min(-1_000_000_000, 'Quantity out of range.')
    .max(1_000_000_000, 'Quantity out of range.'),
  unitCostCents: z
    .number()
    .int()
    .min(-100_000_000_00, 'Unit cost out of range.')
    .max(100_000_000_00, 'Unit cost out of range.'),
  machineId: z
    .string()
    .max(60)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  notes: optionalShort(500),
});

// Bulk save — replaces all lines + meta in one transaction.
// `multiplierMilli` is the sell-multiplier × 1000 (default 3000 = 3×).
// 0–10× covers every realistic markup; refuse anything wilder so a
// fat-fingered keystroke can't 100×-multiply a $50k subtotal.
export const saveEstimateSchema = z.object({
  estimateId: z.string().min(1).max(60),
  title: shortText(160),
  notes: longText(4000),
  multiplierMilli: z
    .number()
    .int()
    .min(0, 'Multiplier cannot be negative.')
    .max(10_000, 'Multiplier capped at 10×.'),
  designFlatCents: z
    .number()
    .int()
    .min(0, 'Design fee cannot be negative.')
    .max(1_000_000_00, 'Design fee out of range.'),
  lines: z.array(estimateLineSchema).max(500, 'Too many lines (max 500).'),
});

export const updateEstimateStatusSchema = z.object({
  estimateId: z.string().min(1).max(60),
  status: z.nativeEnum(EstimateStatus),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RequestResetInput = z.infer<typeof requestResetSchema>;
export type CompleteResetInput = z.infer<typeof completeResetSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
export type InviteUserInput = z.infer<typeof inviteUserSchema>;
export type CreateTenantInput = z.infer<typeof createTenantSchema>;
export type TestEmailInput = z.infer<typeof testEmailSchema>;
export type CreateClientInput = z.infer<typeof createClientSchema>;
export type CreateEstimateInput = z.infer<typeof createEstimateSchema>;
export type EstimateLineInput = z.infer<typeof estimateLineSchema>;
export type SaveEstimateInput = z.infer<typeof saveEstimateSchema>;
export type UpdateEstimateStatusInput = z.infer<typeof updateEstimateStatusSchema>;

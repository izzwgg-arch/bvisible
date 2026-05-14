import { z } from 'zod';
import {
  EstimateLineKind,
  EstimateStatus,
  POAttachmentKind,
  POLineKind,
  POStatus,
  Role,
} from '@bvisible/db';

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

// All optional-text helpers accept null OR undefined OR '' and emit
// null. .nullish() means callers don't have to remember which absence
// shape we expect when invoking a server action programmatically.
const longText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Too long (max ${max} chars).`)
    .nullish()
    .transform((v) => (v && v.length > 0 ? v : null));

const optionalEmail = z
  .union([z.literal(''), emailSchema, z.null()])
  .nullish()
  .transform((v) => (v && v.length > 0 ? v : null));

const optionalShort = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
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

// FINALIZED can only be set via finalizeEstimateAction (R-EST-04).
// The runtime gate is enforced in updateEstimateStatusAction so the
// inferred TS type can stay as the full enum (refine doesn't narrow
// types in our zod version, but a literal-union narrow would force
// every UI call site to filter the enum manually).
export const updateEstimateStatusSchema = z.object({
  estimateId: z.string().min(1).max(60),
  status: z.nativeEnum(EstimateStatus),
});

export const finalizeEstimateSchema = z.object({
  estimateId: z.string().min(1).max(60),
});

// ---------------------------------------------------------------------
// Vendor + purchase order foundation
// ---------------------------------------------------------------------

export const createVendorSchema = z.object({
  name: shortText(160),
  email: optionalEmail,
  phone: optionalShort(40),
  notes: longText(2000),
});

// Helper for nullable id refs. Accepts null/undefined/empty-string and
// emits null. Callers pass `null` to clear, undefined to leave alone is
// not modeled here (we always overwrite).
const nullableIdRef = z
  .string()
  .max(60)
  .nullish()
  .transform((v) => (v && v.length > 0 ? v : null));

// "Create blank PO" — the lines/qbo/etc are filled in later in the
// editor. Vendor and estimate are both optional at creation time.
export const createPurchaseOrderSchema = z.object({
  estimateId: nullableIdRef,
  vendorId: nullableIdRef,
  notes: longText(2000),
});

export const createPoFromEstimateSchema = z.object({
  estimateId: z.string().min(1).max(60),
  vendorId: nullableIdRef,
});

// One row in the PO grid. Mirrors estimateLineSchema (same integer
// units, same bounds). PO lines have no machineId — the PO is the
// cost-side and doesn't track which machine produced what.
export const poLineSchema = z.object({
  id: z.string().min(1).max(60).optional(),
  kind: z.nativeEnum(POLineKind),
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
  notes: optionalShort(500),
});

// Bulk save — replaces all PO lines + meta in one transaction.
export const savePurchaseOrderSchema = z.object({
  purchaseOrderId: z.string().min(1).max(60),
  notes: longText(4000),
  lines: z.array(poLineSchema).max(500, 'Too many lines (max 500).'),
});

export const updatePoStatusSchema = z.object({
  purchaseOrderId: z.string().min(1).max(60),
  status: z.nativeEnum(POStatus),
});

// Allow letters, digits, dash and underscore. QuickBooks docs are loose
// on format; this covers every observed value while rejecting whitespace
// and punctuation that could only have come from a copy-paste mistake.
export const setPoQboNumberSchema = z.object({
  purchaseOrderId: z.string().min(1).max(60),
  qboPoNumber: z
    .string()
    .trim()
    .max(40, 'QBO number is too long (max 40 chars).')
    .nullish()
    .transform((v) => (v && v.length > 0 ? v : null))
    .refine((v) => v === null || /^[A-Za-z0-9_-]+$/.test(v), {
      message: 'Use letters, digits, dashes, or underscores only.',
    }),
});

export const setPoVendorSchema = z.object({
  purchaseOrderId: z.string().min(1).max(60),
  vendorId: nullableIdRef,
});

export const addPoNoteSchema = z.object({
  purchaseOrderId: z.string().min(1).max(60),
  note: shortText(500),
});

export const uploadAttachmentMetaSchema = z.object({
  purchaseOrderId: z.string().min(1).max(60),
  kind: z.nativeEnum(POAttachmentKind),
});

export const deleteAttachmentSchema = z.object({
  purchaseOrderId: z.string().min(1).max(60),
  attachmentId: z.string().min(1).max(60),
});

// ---------------------------------------------------------------------
// Vendor email ingestion
// ---------------------------------------------------------------------

// Manual operator link of an unmatched/failed IngestedEmail to a PO.
// Server validates that both ids belong to the caller's tenant before
// creating any rows.
export const manualLinkEmailSchema = z.object({
  ingestedEmailId: z.string().min(1).max(60),
  purchaseOrderId: z.string().min(1).max(60),
});

export const retryEmailSchema = z.object({
  ingestedEmailId: z.string().min(1).max(60),
});

export const dismissEmailSchema = z.object({
  ingestedEmailId: z.string().min(1).max(60),
});

// Hostname: trim, lower-case for comparison purposes, length-bounded.
// We accept anything that looks roughly like a DNS label sequence or a
// raw IPv4 — the IMAP library will reject genuinely invalid hosts at
// connect time. Refuse leading/trailing whitespace and any character
// the resolver treats as a separator.
const imapHostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Host is required.')
  .max(253, 'Host is too long (max 253 chars).')
  .regex(
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/,
    'Enter a valid hostname (letters, digits, dots, hyphens).'
  );

const imapPortSchema = z.coerce
  .number()
  .int('Port must be a whole number.')
  .min(1, 'Port must be 1-65535.')
  .max(65535, 'Port must be 1-65535.');

// 30s..3600s. Matches the clamp in apps/web/lib/email-ingest/config.ts.
const pollIntervalSchema = z.coerce
  .number()
  .int('Poll interval must be a whole number of seconds.')
  .min(30, 'Poll interval must be at least 30 seconds.')
  .max(3600, 'Poll interval must be at most 3600 seconds.');

const imapMailboxSchema = z
  .string()
  .trim()
  .min(1, 'Mailbox is required.')
  .max(120, 'Mailbox name is too long (max 120 chars).')
  // Refuse control chars and the IMAP wildcard chars; non-ASCII is
  // legal in IMAP4rev1 but rare and risky in display, so reject it.
  .regex(/^[\x20-\x7e]+$/u, 'Mailbox must be plain ASCII.')
  .refine((v) => !/[*%]/.test(v), 'Mailbox cannot contain * or %.');

const imapUsernameSchema = z
  .string()
  .trim()
  .min(1, 'Username is required.')
  .max(254, 'Username is too long (max 254 chars).');

// IMAP passwords vary wildly (Gmail app-password = 16 chars no spaces;
// many providers allow long passphrases). Bound it at 1024 to refuse
// nonsense paste-of-a-PEM mistakes.
const imapPasswordSchema = z
  .string()
  .min(1, 'Password is required.')
  .max(1024, 'Password is too long (max 1024 chars).');

// SUPER_ADMIN: save (create or update) a tenant inbox. Password is
// optional on update — empty/omitted means "keep the existing sealed
// password". The action enforces that on create the password is
// required.
export const saveTenantInboxSchema = z.object({
  tenantId: z.string().min(1).max(60),
  host: imapHostnameSchema,
  port: imapPortSchema,
  secure: z.coerce.boolean(),
  mailbox: imapMailboxSchema,
  username: imapUsernameSchema,
  // Optional on edit; the action layer rejects an empty value when
  // creating a new row.
  password: z
    .string()
    .max(1024, 'Password is too long (max 1024 chars).')
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  pollIntervalSeconds: pollIntervalSchema,
  enabled: z.coerce.boolean(),
});

export const deleteTenantInboxSchema = z.object({
  tenantId: z.string().min(1).max(60),
});

// SUPER_ADMIN: in-form "Test connection" payload. Same shape as save
// but the password may be omitted to mean "use the stored sealed
// password for this tenant" (for credential-rotation workflows where
// the operator wants to test a new host/mailbox without re-typing the
// password they just rotated in).
export const testInboxConnectionSchema = z.object({
  tenantId: z.string().min(1).max(60),
  host: imapHostnameSchema,
  port: imapPortSchema,
  secure: z.coerce.boolean(),
  mailbox: imapMailboxSchema,
  username: imapUsernameSchema,
  password: imapPasswordSchema.optional(),
});

// Internal /api/internal/email-ingest/test request body. Same fields,
// but tenantId is also optional (allows a stateless test without
// touching the DB row at all).
export const internalTestInboxSchema = z.object({
  tenantId: z.string().min(1).max(60).optional(),
  host: imapHostnameSchema,
  port: imapPortSchema,
  secure: z.coerce.boolean(),
  mailbox: imapMailboxSchema,
  username: imapUsernameSchema,
  password: imapPasswordSchema.optional(),
});

export type ManualLinkEmailInput = z.infer<typeof manualLinkEmailSchema>;
export type RetryEmailInput = z.infer<typeof retryEmailSchema>;
export type DismissEmailInput = z.infer<typeof dismissEmailSchema>;
export type SaveTenantInboxInput = z.infer<typeof saveTenantInboxSchema>;
export type DeleteTenantInboxInput = z.infer<typeof deleteTenantInboxSchema>;
export type TestInboxConnectionInput = z.infer<typeof testInboxConnectionSchema>;
export type InternalTestInboxInput = z.infer<typeof internalTestInboxSchema>;

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
export type FinalizeEstimateInput = z.infer<typeof finalizeEstimateSchema>;
export type CreateVendorInput = z.infer<typeof createVendorSchema>;
export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;
export type CreatePoFromEstimateInput = z.infer<typeof createPoFromEstimateSchema>;
export type PoLineInput = z.infer<typeof poLineSchema>;
export type SavePurchaseOrderInput = z.infer<typeof savePurchaseOrderSchema>;
export type UpdatePoStatusInput = z.infer<typeof updatePoStatusSchema>;
export type SetPoQboNumberInput = z.infer<typeof setPoQboNumberSchema>;
export type SetPoVendorInput = z.infer<typeof setPoVendorSchema>;
export type AddPoNoteInput = z.infer<typeof addPoNoteSchema>;
export type UploadAttachmentMetaInput = z.infer<typeof uploadAttachmentMetaSchema>;
export type DeleteAttachmentInput = z.infer<typeof deleteAttachmentSchema>;

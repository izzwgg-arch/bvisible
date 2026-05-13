import { z } from 'zod';
import { Role } from '@bvisible/db';

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

export type LoginInput = z.infer<typeof loginSchema>;
export type RequestResetInput = z.infer<typeof requestResetSchema>;
export type CompleteResetInput = z.infer<typeof completeResetSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
export type InviteUserInput = z.infer<typeof inviteUserSchema>;
export type CreateTenantInput = z.infer<typeof createTenantSchema>;
export type TestEmailInput = z.infer<typeof testEmailSchema>;

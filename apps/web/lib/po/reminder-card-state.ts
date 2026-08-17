// Which state the "Office reminder" card on the order-ready page is in.
//
// Deliberately its own module: the card is a client component, and
// `office-reminder.ts` imports Prisma at module scope. Keeping this pure and
// dependency-free means the decision can be unit tested and imported from the
// browser bundle without dragging the database client along.
//
// The three states are distinct on purpose. Order creation and reminder
// delivery are separate concerns, so "no attempt on file" must never be
// rendered as a success — that would tell the office an email went out when
// none ever did.

/// Mirrors POReminderStatus without importing the Prisma enum, so this module
/// stays free of database imports.
export type ReminderStatusLike = 'PENDING' | 'SENT' | 'FAILED';

export type ReminderCardState = 'sent' | 'failed' | 'never_attempted';

export function reminderCardState(input: {
  /// Status of the newest attempt, or null when the PO has none at all — a
  /// draft-mode retail order, a non-retail PO opened by URL, or one created
  /// before reminders existed.
  latestStatus: ReminderStatusLike | null;
  /// Outcome of a resend performed in this session, which supersedes the
  /// stored row because it is newer than the page's data.
  resendOk: boolean;
  resendError: string | null;
}): ReminderCardState {
  if (input.resendOk) return 'sent';
  if (input.resendError) return 'failed';
  if (input.latestStatus === 'FAILED') return 'failed';
  // PENDING means an attempt row exists but never reached a terminal state,
  // so it is treated as "nothing delivered yet" rather than as a success.
  if (input.latestStatus === 'SENT') return 'sent';
  return 'never_attempted';
}

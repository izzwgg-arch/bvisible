import { describe, expect, it } from 'vitest';
import { reminderCardState } from './reminder-card-state';

/**
 * The card must report what actually happened. The case that matters most is
 * an order with no attempt on file: it used to render as "Reminder sent",
 * telling the office an email had gone out when none ever had.
 */
describe('reminderCardState', () => {
  const base = { latestStatus: null, resendOk: false, resendError: null } as const;

  it('never reports success for an order with no attempt on file', () => {
    expect(reminderCardState(base)).toBe('never_attempted');
  });

  it('treats a PENDING row as nothing delivered yet', () => {
    expect(reminderCardState({ ...base, latestStatus: 'PENDING' })).toBe('never_attempted');
  });

  it('reports the stored outcome of the newest attempt', () => {
    expect(reminderCardState({ ...base, latestStatus: 'SENT' })).toBe('sent');
    expect(reminderCardState({ ...base, latestStatus: 'FAILED' })).toBe('failed');
  });

  it('lets a resend in this session supersede the stored row', () => {
    // A retry after a failure must show success without waiting for a refetch.
    expect(reminderCardState({ latestStatus: 'FAILED', resendOk: true, resendError: null })).toBe('sent');
    // ...and a failed resend must not keep showing the earlier success.
    expect(
      reminderCardState({ latestStatus: 'SENT', resendOk: false, resendError: 'Nope.' })
    ).toBe('failed');
  });

  it('surfaces a failed first send from an order that had no prior row', () => {
    expect(reminderCardState({ ...base, resendError: 'Nope.' })).toBe('failed');
  });
});

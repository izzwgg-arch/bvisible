import { describe, expect, it } from 'vitest';
import { POStatus } from '@bvisible/db';
import {
  classifyReceivingChange,
  clampReceivedQty,
  derivePoStatusFromLines,
  lineReceivingState,
} from './receiving';

describe('lineReceivingState', () => {
  it('is waiting at zero, partial in between, received at/over ordered', () => {
    expect(lineReceivingState({ qtyMilli: 5000, receivedQtyMilli: 0 })).toBe('waiting');
    expect(lineReceivingState({ qtyMilli: 20000, receivedQtyMilli: 8000 })).toBe('partial');
    expect(lineReceivingState({ qtyMilli: 5000, receivedQtyMilli: 5000 })).toBe('received');
    expect(lineReceivingState({ qtyMilli: 5000, receivedQtyMilli: 6000 })).toBe('received');
  });
});

describe('derivePoStatusFromLines', () => {
  const sent = POStatus.SENT;
  it('moves to RECEIVED only when every line is complete', () => {
    expect(
      derivePoStatusFromLines(
        [
          { qtyMilli: 5000, receivedQtyMilli: 5000 },
          { qtyMilli: 2000, receivedQtyMilli: 2000 },
        ],
        sent
      )
    ).toBe(POStatus.RECEIVED);
  });

  it('is PARTIALLY_RECEIVED when some but not all is in', () => {
    expect(
      derivePoStatusFromLines(
        [
          { qtyMilli: 5000, receivedQtyMilli: 5000 },
          { qtyMilli: 2000, receivedQtyMilli: 0 },
        ],
        sent
      )
    ).toBe(POStatus.PARTIALLY_RECEIVED);
    // a partial delivery on a single line too
    expect(
      derivePoStatusFromLines([{ qtyMilli: 20000, receivedQtyMilli: 8000 }], sent)
    ).toBe(POStatus.PARTIALLY_RECEIVED);
  });

  it('correcting an item below ordered moves an Arrived PO back', () => {
    expect(
      derivePoStatusFromLines(
        [
          { qtyMilli: 5000, receivedQtyMilli: 4000 },
          { qtyMilli: 2000, receivedQtyMilli: 2000 },
        ],
        POStatus.RECEIVED
      )
    ).toBe(POStatus.PARTIALLY_RECEIVED);
  });

  it('falls back to SENT when everything is reversed, preserving ORDERED', () => {
    expect(
      derivePoStatusFromLines([{ qtyMilli: 5000, receivedQtyMilli: 0 }], POStatus.RECEIVED)
    ).toBe(POStatus.SENT);
    expect(
      derivePoStatusFromLines([{ qtyMilli: 5000, receivedQtyMilli: 0 }], POStatus.ORDERED)
    ).toBe(POStatus.ORDERED);
  });

  it('leaves an empty PO alone', () => {
    expect(derivePoStatusFromLines([], POStatus.SENT)).toBe(POStatus.SENT);
  });
});

describe('classifyReceivingChange', () => {
  it('labels completion, partial, correction, and reversal', () => {
    expect(classifyReceivingChange(0, 5000, 5000)).toBe('received');
    expect(classifyReceivingChange(0, 2000, 5000)).toBe('partial');
    expect(classifyReceivingChange(3000, 4000, 5000)).toBe('partial');
    expect(classifyReceivingChange(4000, 2000, 5000)).toBe('corrected');
    expect(classifyReceivingChange(4000, 0, 5000)).toBe('reversed');
  });

  it('honours explicit bulk/undo sources', () => {
    expect(classifyReceivingChange(0, 5000, 5000, 'mark_all')).toBe('mark_all');
    expect(classifyReceivingChange(5000, 2000, 5000, 'undo')).toBe('undo');
  });
});

describe('clampReceivedQty', () => {
  it('never goes negative or above ordered', () => {
    expect(clampReceivedQty(-100, 5000)).toBe(0);
    expect(clampReceivedQty(99999, 5000)).toBe(5000);
    expect(clampReceivedQty(2500, 5000)).toBe(2500);
    expect(clampReceivedQty(Number.NaN, 5000)).toBe(0);
  });
});

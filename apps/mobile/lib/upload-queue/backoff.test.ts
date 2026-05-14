import { describe, it, expect } from 'vitest';
import { computeBackoffMs } from './backoff';

describe('computeBackoffMs', () => {
  it('increases with retries', () => {
    expect(computeBackoffMs(0, 0)).toBe(2000);
    expect(computeBackoffMs(1, 0)).toBe(4000);
    expect(computeBackoffMs(2, 0)).toBe(8000);
  });

  it('caps growth', () => {
    expect(computeBackoffMs(100, 0)).toBe(120000);
  });
});

type VoidCb = () => void;

let onAuthFailure: VoidCb | null = null;

/** Called when refresh fails after a 401 (revoked session / expired refresh). */
export function setAuthFailureListener(cb: VoidCb | null): void {
  onAuthFailure = cb;
}

export function notifyAuthFailure(): void {
  try {
    onAuthFailure?.();
  } catch {
    /* ignore */
  }
}

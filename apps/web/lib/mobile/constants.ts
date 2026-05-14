/** Mobile Bearer JWT access TTL (seconds). */
export const MOBILE_ACCESS_TOKEN_TTL_SEC = 15 * 60;

/** Refresh token absolute expiry for rotating sessions. */
export const MOBILE_REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Pending upload row TTL before PUT must complete. */
export const MOBILE_PENDING_UPLOAD_TTL_MS = 15 * 60 * 1000;

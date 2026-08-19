// Client-safe upload constants (no Node imports) — used by the Step 2 UI.
// The server-side allowlist / sniffing lives in lib/bid/uploads.ts.

export const BID_ACCEPT_ATTRIBUTE = '.xlsx,.xls,.csv,.pdf,.png,.jpg,.jpeg,.webp,.docx,.txt';
export const BID_MAX_UPLOAD_MB = 25;

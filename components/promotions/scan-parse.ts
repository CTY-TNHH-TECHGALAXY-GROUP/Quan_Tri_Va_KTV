/**
 * Turns raw scanner text into a lookup request. Pure string parsing — whether
 * the voucher is valid is decided by the server lookup.
 *
 * Accepts:
 *   - a URL carrying `t` / `token` (QR token) or `code` (voucher code)
 *   - a voucher code like OCT30-X7K92A (typed or printed)
 *   - anything else → treated as an opaque QR token
 */
export type ScanLookup = { kind: 'token' | 'code'; value: string };

const VOUCHER_CODE_RE = /^[A-Z0-9]{2,10}-[A-Z0-9]{4,12}$/;
const MAX_INPUT_LENGTH = 512;

export const parseScannedText = (raw: string): ScanLookup | null => {
  const text = (raw ?? '').trim();
  if (!text || text.length > MAX_INPUT_LENGTH) return null;

  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      const token = url.searchParams.get('t') ?? url.searchParams.get('token');
      if (token) return { kind: 'token', value: token };
      const code = url.searchParams.get('code');
      if (code) return { kind: 'code', value: code.trim().toUpperCase() };
    } catch {
      /* fall through */
    }
    return null;
  }

  const upper = text.toUpperCase();
  if (VOUCHER_CODE_RE.test(upper)) return { kind: 'code', value: upper };
  return { kind: 'token', value: text };
};

/** Manual box only accepts voucher codes (tokens are not human-typable). */
export const parseManualCode = (raw: string): ScanLookup | null => {
  const upper = (raw ?? '').trim().toUpperCase().replace(/\s+/g, '');
  return VOUCHER_CODE_RE.test(upper) ? { kind: 'code', value: upper } : null;
};

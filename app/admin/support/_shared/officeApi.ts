/** Small JSON helpers for the Office admin screens — every write goes through /api/support/*. */
export const sendJson = async (url: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) => {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) throw new Error(json?.error || json?.message || `HTTP ${res.status}`);
  return json;
};

export const getJson = async (url: string) => {
  const res = await fetch(url, { cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) throw new Error(json?.error || `HTTP ${res.status}`);
  return json;
};

export const hhmmVN = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' }) : '';

export interface StaffOption { id: string; name: string; workType?: string | null; title?: string | null }
export interface CategoryOption { id: string; name: string; type?: string | null }

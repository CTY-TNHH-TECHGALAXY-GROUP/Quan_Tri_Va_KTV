import { useCallback, useEffect, useRef, useState } from 'react';
import { PROMOTION_API_MODE, promotionApi } from '@/lib/services/promotionApi';
import { supabase } from '@/lib/supabase';
import { t } from '@/components/promotions/promotion.i18n';
import type {
  PromotionErrorCode,
  WebClaimConfigInput,
  WebClaimOverview,
  WebClaimStats,
  WebClaimStatus,
} from '@/lib/types/promotion-client';

// 🔧 UI CONFIGURATION
const REFRESH_DEBOUNCE_MS = 400;
const FALLBACK_POLL_MS = 30_000;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,59}$/;

export interface WebClaimForm {
  totalQuantity: string;
  reservationMinutes: string;
  maxOpenPerPhone: string;
  maxTotalPerPhone: string;
  publicSlug: string;
}

export type WebClaimFormErrors = Partial<Record<keyof WebClaimForm, string>>;

const slugFrom = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

export const webClaimFormFrom = (s: WebClaimStats | null, campaignName: string): WebClaimForm => ({
  totalQuantity: s?.total != null ? String(s.total) : '20',
  reservationMinutes: String(s?.reservationMinutes ?? 30),
  maxOpenPerPhone: String(s?.maxOpenPerPhone ?? 1),
  maxTotalPerPhone: s?.maxTotalPerPhone != null ? String(s.maxTotalPerPhone) : '',
  publicSlug: s?.publicSlug ?? slugFrom(campaignName),
});

const intOf = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN);

export const validateWebClaimForm = (f: WebClaimForm): { errors: WebClaimFormErrors; input: WebClaimConfigInput | null } => {
  const errors: WebClaimFormErrors = {};
  const total = intOf(f.totalQuantity);
  const minutes = intOf(f.reservationMinutes);
  const open = intOf(f.maxOpenPerPhone);
  const maxTotal = f.maxTotalPerPhone.trim() === '' ? null : intOf(f.maxTotalPerPhone);
  const slug = f.publicSlug.trim().toLowerCase();
  if (!(total >= 1)) errors.totalQuantity = t.webClaim.errors.totalQuantity;
  if (!(minutes >= 5 && minutes <= 1440)) errors.reservationMinutes = t.webClaim.errors.reservationMinutes;
  if (!(open >= 1)) errors.maxOpenPerPhone = t.webClaim.errors.maxOpenPerPhone;
  if (maxTotal !== null && !(maxTotal >= 1)) errors.maxTotalPerPhone = t.webClaim.errors.maxTotalPerPhone;
  if (!SLUG_PATTERN.test(slug)) errors.publicSlug = t.webClaim.errors.publicSlug;
  if (Object.keys(errors).length) return { errors, input: null };
  return {
    errors,
    input: { totalQuantity: total, reservationMinutes: minutes, maxOpenPerPhone: open, maxTotalPerPhone: maxTotal, publicSlug: slug },
  };
};

type LoadState =
  | { status: 'loading'; data: WebClaimOverview | null }
  | { status: 'ready'; data: WebClaimOverview }
  | { status: 'error'; code: PromotionErrorCode; data: WebClaimOverview | null };

/**
 * Stock + voucher list of one campaign, kept live:
 *  - realtime on PromotionCampaignStock (public table, only changes when counts change);
 *    delivery order is not guaranteed, so an event only triggers a refetch when its
 *    `version` is newer than the last one seen;
 *  - fallback poll + refetch on tab focus (missed events, sleeping tab).
 */
export const useWebClaim = (campaignId: string) => {
  const [state, setState] = useState<LoadState>({ status: 'loading', data: null });
  const [statusFilter, setStatusFilter] = useState<WebClaimStatus | undefined>(undefined);
  const [live, setLive] = useState(false);
  const lastVersion = useRef(0);
  const requestSeq = useRef(0);
  const filterRef = useRef(statusFilter);
  filterRef.current = statusFilter;

  const load = useCallback(async () => {
    // Only the latest request may write: a slow response must not overwrite a newer filter.
    const seq = ++requestSeq.current;
    const res = await promotionApi.getWebClaim(campaignId, filterRef.current);
    if (seq !== requestSeq.current) return;
    setState((prev) =>
      res.success ? { status: 'ready', data: res.data } : { status: 'error', code: res.error.code, data: prev.data },
    );
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load, statusFilter]);

  useEffect(() => {
    lastVersion.current = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load(), REFRESH_DEBOUNCE_MS);
    };
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    const poll = setInterval(() => document.visibilityState === 'visible' && refresh(), FALLBACK_POLL_MS);
    const channel =
      PROMOTION_API_MODE === 'http'
        ? supabase
            .channel(`promo_web_stock_${campaignId}`)
            .on(
              'postgres_changes',
              { event: '*', schema: 'public', table: 'PromotionCampaignStock', filter: `campaign_id=eq.${campaignId}` },
              (payload) => {
                const version = Number((payload.new as { version?: number } | null)?.version ?? 0);
                if (payload.eventType === 'DELETE' || version > lastVersion.current) {
                  lastVersion.current = Math.max(lastVersion.current, version);
                  refresh();
                }
              },
            )
            .subscribe((status) => setLive(status === 'SUBSCRIBED'))
        : null;
    return () => {
      if (timer) clearTimeout(timer);
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      if (channel) supabase.removeChannel(channel);
      setLive(false);
    };
  }, [campaignId, load]);

  /** Mutations return fresh stats; the list is refetched so both stay in step. */
  const applyStats = (stats: WebClaimStats) => {
    setState((prev) => (prev.data ? { status: 'ready', data: { ...prev.data, stats } } : prev));
    void load();
  };

  const configure = async (input: WebClaimConfigInput) => {
    const res = await promotionApi.configureWebClaim(campaignId, input);
    if (res.success) applyStats(res.data);
    return res;
  };

  const setPaused = async (paused: boolean) => {
    const res = await promotionApi.setWebClaimPaused(campaignId, paused);
    if (res.success) applyStats(res.data);
    return res;
  };

  const release = async (reason: string, claimId?: string) => {
    const res = await promotionApi.releaseWebClaims(campaignId, reason, claimId);
    if (res.success) applyStats(res.data);
    return res;
  };

  return { state, reload: load, live, statusFilter, setStatusFilter, configure, setPaused, release };
};

import { useCallback, useEffect, useRef, useState } from 'react';
import { PROMOTION_API_MODE, promotionApi } from '@/lib/services/promotionApi';
import { supabase } from '@/lib/supabase';
import { orderEligibility } from '@/lib/promotion-format';
import type {
  ApplyPromotionResult,
  PromotionErrorCode,
  PromotionOrderCandidate,
  PromotionPassWithQr,
} from '@/lib/types/promotion-client';
import { parseManualCode, parseScannedText, type ScanLookup } from '@/components/promotions/scan-parse';

// 🔧 UI CONFIGURATION
const ORDER_SEARCH_DEBOUNCE_MS = 300;
/** New / changed orders arrive in bursts (one booking = several rows): wait, then reload once. */
const ORDER_REALTIME_DEBOUNCE_MS = 800;
/** Safety net when a realtime event is missed (flaky mobile network). */
const ORDER_POLL_MS = 30_000;
/** Same bounds as the engine (OVERRIDE_REASON_REQUIRED). */
export const OVERRIDE_NOTE_MIN = 3;
export const OVERRIDE_NOTE_MAX = 500;

export const isOverrideNoteValid = (note: string) => {
  const n = note.trim().length;
  return n >= OVERRIDE_NOTE_MIN && n <= OVERRIDE_NOTE_MAX;
};

/** Popup state when the selected order misses the campaign conditions. */
export type OverridePrompt = { reasons: string[]; note: string; error: PromotionErrorCode | null; submitting: boolean };

export type ScanStep =
  | { name: 'scan' }
  | { name: 'lookingUp' }
  | { name: 'lookupError'; code: PromotionErrorCode }
  | { name: 'found'; pass: PromotionPassWithQr }
  | { name: 'success'; pass: PromotionPassWithQr; result: ApplyPromotionResult };

export type OrdersState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; orders: PromotionOrderCandidate[] }
  | { status: 'error'; code: PromotionErrorCode };

/**
 * Keep the staff's choice if still applicable. Otherwise preselect the voucher
 * owner's only applicable order, or the only applicable order overall (shared
 * vouchers list every open order, so "only one in the list" alone is rare).
 * Staff still has to press Apply — never auto-applied.
 */
export const pickDefaultOrderId = (orders: PromotionOrderCandidate[], prev: string | null): string | null => {
  const applicable = orders.filter((o) => o.canApply);
  // A staff pick survives a reload while it can still be applied (normally or as an exception).
  if (prev && orders.some((o) => o.id === prev && (o.canApply || o.canOverride))) return prev;
  const owner = applicable.filter((o) => o.isPassOwnerOrder);
  if (owner.length === 1) return owner[0].id;
  if (owner.length === 0 && applicable.length === 1) return applicable[0].id;
  return null;
};

const offlineCode = (): PromotionErrorCode | null =>
  typeof navigator !== 'undefined' && navigator.onLine === false ? 'NETWORK_ERROR' : null;

/**
 * Staff flow: scan (lookup only) → pick an open order → Apply.
 * Nothing is consumed until `apply()` succeeds on the server.
 */
/**
 * Reading the e-voucher QR with the phone's own camera app opens the scan page
 * with `?t=<token>` (or `?code=`). Start the lookup straight away in that case.
 */
export const lookupFromUrl = (params: URLSearchParams | null): ScanLookup | null => {
  const token = params?.get('t')?.trim();
  if (token) return { kind: 'token', value: token };
  const code = params?.get('code');
  return code ? parseManualCode(code) : null;
};

export const useScanVoucher = (initialLookup: ScanLookup | null = null) => {
  const [step, setStep] = useState<ScanStep>({ name: 'scan' });
  const [mode, setMode] = useState<'camera' | 'manual'>('camera');
  const [manualCode, setManualCode] = useState('');
  const [manualError, setManualError] = useState(false);
  const [orders, setOrders] = useState<OrdersState>({ status: 'idle' });
  const [orderSearch, setOrderSearch] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<PromotionErrorCode | null>(null);
  const [override, setOverride] = useState<OverridePrompt | null>(null);
  const applyingRef = useRef(false);
  const lastLookupRef = useRef<ScanLookup | null>(null);
  const ordersReqRef = useRef(0);
  const [ordersRefreshing, setOrdersRefreshing] = useState(false);

  const pass = step.name === 'found' || step.name === 'success' ? step.pass : null;
  const passId = step.name === 'found' ? step.pass.id : null;
  const passUsable = step.name === 'found' && step.pass.effectiveStatus === 'ACTIVE';

  const lookup = useCallback(async (req: ScanLookup) => {
    lastLookupRef.current = req;
    const offline = offlineCode();
    if (offline) {
      setStep({ name: 'lookupError', code: offline });
      return;
    }
    setStep({ name: 'lookingUp' });
    const res = req.kind === 'token' ? await promotionApi.getPassByToken(req.value) : await promotionApi.getPassByCode(req.value);
    if (!res.success) {
      const code = res.error.code === 'PROMOTION_NOT_FOUND' ? 'INVALID_QR' : res.error.code;
      setStep({ name: 'lookupError', code });
      return;
    }
    setOrderSearch('');
    setSelectedOrderId(null);
    setApplyError(null);
    setOrders({ status: 'idle' });
    setStep({ name: 'found', pass: res.data });
  }, []);

  const onDecode = useCallback(
    (text: string) => {
      const req = parseScannedText(text);
      if (!req) {
        setStep({ name: 'lookupError', code: 'INVALID_QR' });
        return;
      }
      lookup(req);
    },
    [lookup],
  );

  const submitManual = () => {
    const req = parseManualCode(manualCode);
    setManualError(!req);
    if (req) lookup(req);
  };

  const retryLookup = () => {
    if (lastLookupRef.current) lookup(lastLookupRef.current);
    else reset();
  };

  /** `silent` = background refresh: keep the current list on screen (no spinner, no error swap). */
  const loadOrders = useCallback(async (id: string, search: string, silent = false) => {
    const reqId = ++ordersReqRef.current;
    if (silent) setOrdersRefreshing(true);
    else setOrders({ status: 'loading' });
    const res = await promotionApi.getActiveOrders(id, { search: search.trim() || undefined });
    if (reqId !== ordersReqRef.current) return;
    setOrdersRefreshing(false);
    if (!res.success) {
      if (!silent) setOrders({ status: 'error', code: res.error.code });
      return;
    }
    setOrders({ status: 'success', orders: res.data });
    setSelectedOrderId((prev) => pickDefaultOrderId(res.data, prev));
  }, []);

  // Deep link from the QR (phone camera app) → look up once on mount.
  const initialRef = useRef(initialLookup);
  useEffect(() => {
    if (initialRef.current) lookup(initialRef.current);
    initialRef.current = null;
  }, [lookup]);

  useEffect(() => {
    if (!passId || !passUsable) return;
    const timer = setTimeout(() => loadOrders(passId, orderSearch), orderSearch ? ORDER_SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  }, [passId, passUsable, orderSearch, loadOrders]);

  // Keep the open-order list live: a customer may book (web / counter) right after the scan.
  // Realtime on Bookings (same as the dispatch board) + refresh when the tab comes back + slow poll.
  const liveRef = useRef({ passId, orderSearch });
  liveRef.current = { passId, orderSearch };
  useEffect(() => {
    if (!passId || !passUsable) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const { passId: id, orderSearch: q } = liveRef.current;
        if (id) loadOrders(id, q, true);
      }, ORDER_REALTIME_DEBOUNCE_MS);
    };
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    const poll = setInterval(() => document.visibilityState === 'visible' && refresh(), ORDER_POLL_MS);
    const channel =
      PROMOTION_API_MODE === 'http'
        ? supabase.channel(`promo_scan_orders_${passId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'Bookings' }, refresh).subscribe()
        : null;
    return () => {
      if (timer) clearTimeout(timer);
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      if (channel) supabase.removeChannel(channel);
    };
  }, [passId, passUsable, loadOrders]);

  const selectedOrder = orders.status === 'success' ? orders.orders.find((o) => o.id === selectedOrderId) ?? null : null;
  const selectedNeedsOverride = !!selectedOrder && orderEligibility(selectedOrder) === 'NOT_ELIGIBLE';

  const openOverride = (reasons: string[]) => setOverride({ reasons, note: '', error: null, submitting: false });

  /**
   * Apply. A NOT_ELIGIBLE order opens the exception popup first; the server can
   * also answer ORDER_CONDITION_NOT_MET (conditions changed meanwhile) → popup too.
   */
  const apply = async (note?: string) => {
    if (step.name !== 'found' || !selectedOrderId || applyingRef.current) return;
    if (note === undefined && selectedNeedsOverride) {
      openOverride(selectedOrder?.unmetReasons ?? []);
      return;
    }
    const offline = offlineCode();
    if (offline) {
      if (note !== undefined) setOverride((o) => o && { ...o, error: offline });
      else setApplyError(offline);
      return;
    }
    applyingRef.current = true;
    setApplying(true);
    setApplyError(null);
    if (note !== undefined) setOverride((o) => o && { ...o, error: null, submitting: true });
    const res = await promotionApi.applyPass(step.pass.id, selectedOrderId, note !== undefined ? { note } : undefined);
    applyingRef.current = false;
    setApplying(false);
    if (!res.success) {
      const data = res.error.data as { unmetReasons?: string[]; canOverride?: boolean } | undefined;
      if (res.error.code === 'ORDER_CONDITION_NOT_MET' && data?.canOverride && note === undefined) {
        openOverride(data.unmetReasons ?? []);
        return;
      }
      if (res.error.code === 'OVERRIDE_REASON_REQUIRED') {
        setOverride((o) => o && { ...o, error: res.error.code, submitting: false });
        return;
      }
      setOverride(null);
      setApplyError(res.error.code);
      // Server state may have moved (e.g. applied from another device) → refresh verdicts.
      loadOrders(step.pass.id, orderSearch);
      return;
    }
    setOverride(null);
    setStep({ name: 'success', pass: { ...step.pass, ...res.data.pass }, result: res.data });
  };

  const confirmOverride = () => {
    if (!override) return;
    if (!isOverrideNoteValid(override.note)) {
      setOverride({ ...override, error: 'OVERRIDE_REASON_REQUIRED' });
      return;
    }
    apply(override.note.trim());
  };

  const reset = () => {
    lastLookupRef.current = null;
    setManualCode('');
    setManualError(false);
    setOrders({ status: 'idle' });
    setSelectedOrderId(null);
    setApplyError(null);
    setOverride(null);
    setStep({ name: 'scan' });
  };

  return {
    step,
    pass,
    passUsable,
    mode,
    setMode,
    manualCode,
    setManualCode: (v: string) => {
      setManualCode(v);
      setManualError(false);
    },
    manualError,
    submitManual,
    onDecode,
    retryLookup,
    orders,
    reloadOrders: () => passId && loadOrders(passId, orderSearch),
    /** Manual "Làm mới": keeps the list on screen while fetching. */
    refreshOrders: () => passId && loadOrders(passId, orderSearch, true),
    ordersRefreshing,
    orderSearch,
    setOrderSearch,
    selectedOrderId,
    selectOrder: (id: string) => {
      setSelectedOrderId(id);
      setApplyError(null);
    },
    applying,
    applyError,
    apply: () => apply(),
    selectedNeedsOverride,
    override,
    setOverrideNote: (note: string) => setOverride((o) => o && { ...o, note, error: null }),
    closeOverride: () => setOverride(null),
    confirmOverride,
    reset,
  };
};

import { useCallback, useEffect, useRef, useState } from 'react';
import { promotionApi } from '@/lib/services/promotionApi';
import type {
  ApplyPromotionResult,
  PromotionErrorCode,
  PromotionOrderCandidate,
  PromotionPassWithQr,
} from '@/lib/types/promotion-client';
import { parseManualCode, parseScannedText, type ScanLookup } from '@/components/promotions/scan-parse';

// 🔧 UI CONFIGURATION
const ORDER_SEARCH_DEBOUNCE_MS = 300;

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
  if (prev && applicable.some((o) => o.id === prev)) return prev;
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
  const applyingRef = useRef(false);
  const lastLookupRef = useRef<ScanLookup | null>(null);
  const ordersReqRef = useRef(0);

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

  const loadOrders = useCallback(async (id: string, search: string) => {
    const reqId = ++ordersReqRef.current;
    setOrders({ status: 'loading' });
    const res = await promotionApi.getActiveOrders(id, { search: search.trim() || undefined });
    if (reqId !== ordersReqRef.current) return;
    if (!res.success) {
      setOrders({ status: 'error', code: res.error.code });
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

  const apply = async () => {
    if (step.name !== 'found' || !selectedOrderId || applyingRef.current) return;
    const offline = offlineCode();
    if (offline) {
      setApplyError(offline);
      return;
    }
    applyingRef.current = true;
    setApplying(true);
    setApplyError(null);
    const res = await promotionApi.applyPass(step.pass.id, selectedOrderId);
    applyingRef.current = false;
    setApplying(false);
    if (!res.success) {
      setApplyError(res.error.code);
      // Server state may have moved (e.g. applied from another device) → refresh verdicts.
      loadOrders(step.pass.id, orderSearch);
      return;
    }
    setStep({ name: 'success', pass: { ...step.pass, ...res.data.pass }, result: res.data });
  };

  const reset = () => {
    lastLookupRef.current = null;
    setManualCode('');
    setManualError(false);
    setOrders({ status: 'idle' });
    setSelectedOrderId(null);
    setApplyError(null);
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
    orderSearch,
    setOrderSearch,
    selectedOrderId,
    selectOrder: (id: string) => {
      setSelectedOrderId(id);
      setApplyError(null);
    },
    applying,
    applyError,
    apply,
    reset,
  };
};

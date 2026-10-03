import { useCallback, useEffect, useRef, useState } from 'react';
import { BULK_ISSUE_MAX, promotionApi } from '@/lib/services/promotionApi';
import type {
  BulkIssueResult,
  CustomerCandidateFilter,
  CustomerCandidatePage,
  PromotionErrorCode,
} from '@/lib/types/promotion-client';

// 🔧 UI CONFIGURATION
export const CANDIDATE_PAGE_SIZE = BULK_ISSUE_MAX;

export const DEFAULT_CANDIDATE_FILTER: CustomerCandidateFilter = { hasEmail: true };
/** Engine limit for the "qualified order" date range. */
export const MAX_QUALIFIED_RANGE_DAYS = 93;
const DEFAULT_QUALIFIED_RANGE_DAYS = 30;

const vnDay = (offsetDays = 0) => new Date(Date.now() + 7 * 3600_000 + offsetDays * 86400_000).toISOString().slice(0, 10);

/** onlyQualified needs both dates, ≤ 93 days apart (contract v4 §3.1). */
export const qualifiedRangeError = (f: CustomerCandidateFilter): boolean => {
  if (!f.onlyQualified) return false;
  if (!f.qualifiedFrom || !f.qualifiedTo || f.qualifiedTo < f.qualifiedFrom) return true;
  const days = (Date.parse(f.qualifiedTo) - Date.parse(f.qualifiedFrom)) / 86400_000 + 1;
  return days > MAX_QUALIFIED_RANGE_DAYS;
};

/** Customers already holding a pass cannot be issued again (server: ALREADY_EXISTS). */
const selectable = (r: { alreadyHasPass?: boolean }) => !r.alreadyHasPass;

type LoadState =
  | { status: 'idle' | 'loading' }
  | { status: 'success'; page: CustomerCandidatePage }
  | { status: 'error'; code: PromotionErrorCode };

/**
 * Filter customer profiles (server side), pick up to one page, issue in bulk.
 * Criteria are applied on "Lọc" — not on every keystroke — because the server
 * aggregates bookings per customer.
 */
export const useCustomerCandidates = (campaignId: string) => {
  const [draft, setDraft] = useState<CustomerCandidateFilter>(DEFAULT_CANDIDATE_FILTER);
  const [applied, setApplied] = useState<CustomerCandidateFilter>(DEFAULT_CANDIDATE_FILTER);
  const [offset, setOffset] = useState(0);
  const [state, setState] = useState<LoadState>({ status: 'idle' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [issuing, setIssuing] = useState(false);
  const [issueError, setIssueError] = useState<PromotionErrorCode | null>(null);
  const [result, setResult] = useState<BulkIssueResult | null>(null);
  const [rangeError, setRangeError] = useState(false);
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setState({ status: 'loading' });
    const res = await promotionApi.getCustomerCandidates(campaignId, { ...applied, limit: CANDIDATE_PAGE_SIZE, offset });
    if (id !== reqId.current) return;
    setSelected(new Set());
    setState(res.success ? { status: 'success', page: res.data } : { status: 'error', code: res.error.code });
  }, [campaignId, applied, offset]);

  useEffect(() => {
    load();
  }, [load]);

  const setField = <K extends keyof CustomerCandidateFilter>(key: K, value: CustomerCandidateFilter[K]) =>
    setDraft((f) => {
      const next = { ...f, [key]: value === '' ? undefined : value };
      // Ticking "qualified" pre-fills the last 30 VN days (both dates are required).
      if (key === 'onlyQualified' && value && !f.qualifiedFrom && !f.qualifiedTo) {
        next.qualifiedFrom = vnDay(-(DEFAULT_QUALIFIED_RANGE_DAYS - 1));
        next.qualifiedTo = vnDay();
      }
      return next;
    });

  const apply = () => {
    if (qualifiedRangeError(draft)) {
      setRangeError(true);
      return;
    }
    setRangeError(false);
    setOffset(0);
    setApplied({ ...draft, search: draft.search?.trim() || undefined });
  };
  const reset = () => {
    setRangeError(false);
    setDraft(DEFAULT_CANDIDATE_FILTER);
    setOffset(0);
    setApplied(DEFAULT_CANDIDATE_FILTER);
  };

  const rows = state.status === 'success' ? state.page.rows : [];
  const toggle = (id: string) =>
    setSelected((prev) => {
      if (!rows.some((r) => r.id === id && selectable(r))) return prev;
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < BULK_ISSUE_MAX) next.add(id);
      return next;
    });
  const pickable = rows.filter(selectable);
  const allOnPageSelected = pickable.length > 0 && pickable.every((r) => selected.has(r.id));
  const togglePage = () => setSelected(allOnPageSelected ? new Set() : new Set(pickable.slice(0, BULK_ISSUE_MAX).map((r) => r.id)));

  const issue = async () => {
    if (issuing || selected.size === 0) return;
    setIssuing(true);
    setIssueError(null);
    const res = await promotionApi.bulkIssue(campaignId, [...selected]);
    setIssuing(false);
    if (!res.success) {
      setIssueError(res.error.code);
      return;
    }
    setResult(res.data);
    // Issued customers drop out of the list (server excludes existing pass holders).
    load();
  };

  return {
    draft,
    setField,
    rangeError,
    apply,
    reset,
    state,
    rows,
    offset,
    setOffset,
    selected,
    toggle,
    togglePage,
    allOnPageSelected,
    issue,
    issuing,
    issueError,
    result,
    clearResult: () => setResult(null),
    clearSelection: () => setSelected(new Set()),
    reload: load,
  };
};

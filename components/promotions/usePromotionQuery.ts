import { useCallback, useEffect, useRef, useState } from 'react';
import type { PromotionErrorCode, PromotionResult } from '@/lib/types/promotion-client';

export type QueryState<T> =
  | { status: 'loading'; data: T | null }
  | { status: 'success'; data: T }
  | { status: 'error'; data: T | null; code: PromotionErrorCode };

/**
 * Loading / success / error state for one adapter call. Re-runs when `deps`
 * change; stale responses are dropped.
 */
export const usePromotionQuery = <T>(run: () => Promise<PromotionResult<T>>, deps: unknown[]) => {
  const [state, setState] = useState<QueryState<T>>({ status: 'loading', data: null });
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setState((prev) => ({ status: 'loading', data: prev.data }));
    const res = await run();
    if (id !== reqId.current) return;
    setState(res.success ? { status: 'success', data: res.data } : { status: 'error', data: null, code: res.error.code });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    load();
  }, [load]);

  return { state, reload: load, setData: (data: T) => setState({ status: 'success', data }) };
};

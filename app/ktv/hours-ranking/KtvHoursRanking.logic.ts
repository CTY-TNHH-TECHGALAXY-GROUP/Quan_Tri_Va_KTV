'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { apiClient } from '@/lib/apiClient';
import { shiftMonth, currentMonthVn } from '@/lib/hours-format';

export interface RankRow {
  id: string;
  code: string;
  name: string;
  avatarUrl: string | null;
  isMe: boolean;
  /** null = chưa điểm danh trong tháng nên chưa có hạng. */
  rank: number | null;
  ranked: boolean;
  net: number;
  turns: number;
  /** Chỉ có giá trị ở dòng của chính mình — server không trả của người khác. */
  earned: number | null;
  penalty: number | null;
  days: number | null;
  lastDate: string | null;
}

/** Một dòng trong sổ giờ của chính mình. */
export interface LedgerRow {
  id: string;
  date: string;
  earned: number;
  penalty: number;
  balance: number;
  note: string | null;
  /** Có giá trị nghĩa là dòng PHẠT, không phải tua làm. */
  penaltyLabel: string | null;
  orderCode: string | null;
}

export const useKtvHoursRankingLogic = () => {
  const [month, setMonth] = useState<string>(currentMonthVn());
  const [rows, setRows] = useState<RankRow[]>([]);
  const [applicable, setApplicable] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [showDetail, setShowDetail] = useState(false);
  /** Số người ĐÃ điểm danh trong tháng — mẫu số của "Hạng x/y". */
  const [rankedCount, setRankedCount] = useState(0);

  const thisMonth = currentMonthVn();

  const fetchRanking = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiClient.get<any>(
        `/api/ktv/hours-ranking?month=${month}`,
        { timeout: 20000 }
      );
      setApplicable(res?.applicable !== false);
      setEnabled(res?.enabled !== false);
      setRows(res?.data || []);
      setRankedCount(Number(res?.rankedCount) || 0);
      setLedger(res?.myLedger || []);
    } catch (error: any) {
      setLoadError(error?.message || 'Không tải được bảng xếp hạng giờ.');
      setRows([]);
      setRankedCount(0);
      setLedger([]);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { fetchRanking(); }, [fetchRanking]);

  const changeMonth = (delta: number) => {
    // Không cho nhảy sang tháng chưa tới — sổ giờ chưa có gì, chỉ gây hiểu nhầm.
    const next = shiftMonth(month, delta);
    if (next > thisMonth) return;
    setShowDetail(false);   // đổi tháng thì đóng bảng chi tiết của tháng cũ
    setMonth(next);
  };

  const canGoNext = month < thisMonth;

  const me = useMemo(() => rows.find(r => r.isMe) || null, [rows]);

  /** Giờ cao nhất trong nhóm — mốc vẽ thanh tỉ lệ. */
  const maxNet = useMemo(
    () => rows.reduce((m, r) => Math.max(m, r.net), 0),
    [rows]
  );

  return {
    month, changeMonth, canGoNext,
    rows, me, maxNet, rankedCount,
    applicable, enabled,
    ledger, showDetail, setShowDetail,
    loading, loadError,
    refresh: fetchRanking,
  };
};

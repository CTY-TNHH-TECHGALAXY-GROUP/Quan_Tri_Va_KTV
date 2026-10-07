'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/lib/auth-context';
import { apiClient } from '@/lib/apiClient';
import { shiftMonth, currentMonthVn } from '@/lib/hours-format';
import { vnToday } from '@/lib/vn-time';

// 🔧 CONFIGURATION — phải khớp với /api/admin/ktv-office/hours-grant
const GRANT_STEP = 0.25;
const GRANT_MAX_HOURS = 50;
const GRANT_MAX_BACKDATE_DAYS = 60;

export interface HoursRow {
  id: string;
  code: string;
  name: string;
  avatarUrl: string | null;
  locked: boolean;
  /** Giờ làm THỰC trong dịch vụ, chưa trừ phạt. */
  earned: number;
  /** Giờ bị trừ do kỷ luật. */
  penalty: number;
  /** Giờ admin/DEV cộng thêm (bù giờ). */
  granted: number;
  /** earned − penalty + granted: con số dùng để xếp hạng và quyết định thứ tự nhận tua. */
  net: number;
  turns: number;
  days: number;
  lastDate: string | null;
  avgPerDay: number;
  /** null = chưa điểm danh trong tháng nên chưa có hạng. */
  rank: number | null;
  ranked: boolean;
}

// Định dạng giờ và tiện ích tháng nay nằm ở lib/hours-format.ts để trang này và
// trang KTV đọc ra cùng một chuỗi. Re-export cho page.tsx khỏi phải đổi import.
export { fmtHours, fmtShortDate } from '@/lib/hours-format';

export const useAdminKtvHoursLogic = () => {
  const { addToast } = useToast();
  const { role } = useAuth();
  // Chỉ ADMIN / DEV được cộng giờ. Server (`requireRole`) vẫn chặn — đây chỉ để ẩn nút.
  const canGrant = role?.id === 'admin' || role?.id === 'dev';

  const [month, setMonth] = useState<string>(currentMonthVn());
  const [searchQuery, setSearchQuery] = useState('');

  const [rawRows, setRawRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Sổ giờ chi tiết của 1 KTV, mở khi bấm vào thẻ.
  const [detailOf, setDetailOf] = useState<HoursRow | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Form "Cộng giờ" trong modal chi tiết.
  const [grantOpen, setGrantOpen] = useState(false);
  const [grantHours, setGrantHours] = useState('1');
  const [grantDate, setGrantDate] = useState(vnToday());
  const [grantReason, setGrantReason] = useState('');
  const [grantSaving, setGrantSaving] = useState(false);

  const thisMonth = currentMonthVn();

  const fetchRanking = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // Chỉ xem theo tháng: quy chế giờ loại D tính theo từng tháng, và đây cũng
      // là con số quyết định thứ tự nhận tua. API còn hỗ trợ scope=all (lũy kế
      // toàn bộ lịch sử) nhưng UI chưa dùng tới.
      const res = await apiClient.get<any>(
        `/api/admin/ktv-office/hours-ranking?scope=month&month=${month}`,
        { timeout: 20000 }
      );
      setRawRows(res?.data || []);
    } catch (error: any) {
      const msg = error?.status === 403
        ? 'Bạn không có quyền xem bảng giờ tích lũy.'
        : (error?.message || 'Không tải được bảng xếp hạng giờ.');
      setLoadError(msg);
      setRawRows([]);
      addToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [month, addToast]);

  useEffect(() => { fetchRanking(); }, [fetchRanking]);

  const changeMonth = (delta: number) => {
    // Không cho nhảy sang tháng chưa tới — sổ giờ chưa có gì, chỉ gây hiểu nhầm.
    const next = shiftMonth(month, delta);
    if (next > thisMonth) return;
    setMonth(next);
  };

  const canGoNext = month < thisMonth;

  /**
   * Xếp hạng theo GIỜ THỰC NHẬN (đã trừ phạt) — cùng con số quyết định thứ tự
   * nhận tua ở bảng điều phối, nên hai màn hình không bao giờ đọc ra hai thứ hạng.
   *
   * Hoà giờ thì chốt bằng MÃ NHÂN VIÊN tăng dần — đúng nút chặn cuối của
   * `KtvTypeDTurnService.getTurnQueue`. Trước đây chốt bằng TÊN, nên đầu tháng
   * khi cả đội cùng 0h, bảng này và trang Chấm điểm xếp ra hai thứ tự khác nhau
   * cho cùng một nhóm người.
   *
   * Tính trên TOÀN ĐỘI rồi mới lọc theo ô tìm kiếm: gõ tên một người vẫn phải thấy
   * đúng hạng của người đó trong đội, không phải hạng 1 giả.
   */
  const ranked: HoursRow[] = useMemo(() => {
    // Server đã gán `rank` và cờ `ranked` (chưa điểm danh thì rank = null, nằm
    // cuối). Client CHỈ giữ nguyên thứ tự đó — tự đánh số lại ở đây là xoá mất
    // luật "chưa điểm danh thì chưa có hạng" và bảng này lại lệch với màn KTV.
    return [...rawRows] as HoursRow[];
  }, [rawRows]);

  const rows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return ranked;
    return ranked.filter(r =>
      r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q));
  }, [ranked, searchQuery]);

  const totals = useMemo(() => {
    const earned = rawRows.reduce((a, r) => a + (Number(r.earned) || 0), 0);
    const penalty = rawRows.reduce((a, r) => a + (Number(r.penalty) || 0), 0);
    const granted = rawRows.reduce((a, r) => a + (Number(r.granted) || 0), 0);
    const turns = rawRows.reduce((a, r) => a + (Number(r.turns) || 0), 0);
    // Trung bình chỉ tính trên người CÓ giờ: cộng cả người chưa làm buổi nào
    // sẽ kéo mức trung bình xuống và không nói lên điều gì.
    const active = rawRows.filter(r => (Number(r.earned) || 0) > 0).length;
    return {
      earned,
      penalty,
      granted,
      net: earned - penalty + granted,
      turns,
      staff: rawRows.length,
      active,
      avg: active > 0 ? (earned - penalty + granted) / active : 0,
    };
  }, [rawRows]);

  /** Giờ thực nhận cao nhất — mốc để vẽ thanh tỉ lệ. */
  const maxValue = useMemo(
    () => ranked.reduce((m, r) => Math.max(m, r.net), 0),
    [ranked]
  );

  const openDetail = useCallback(async (row: HoursRow) => {
    setDetailOf(row);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await apiClient.get<any>(
        `/api/admin/ktv-office/hours-detail?staffId=${encodeURIComponent(row.code)}&month=${month}`
      );
      setDetail(res);
    } catch (error: any) {
      addToast(error?.message || 'Không tải được sổ giờ của KTV này.', 'error');
    } finally {
      setDetailLoading(false);
    }
  }, [month, addToast]);

  const closeDetail = () => {
    setDetailOf(null);
    setDetail(null);
    setGrantOpen(false);
  };

  const openGrant = () => {
    setGrantHours('1');
    setGrantDate(vnToday());
    setGrantReason('');
    setGrantOpen(true);
  };

  /** Kiểm tra phía client để báo lỗi ngay; server kiểm lại y hệt. */
  const grantError = useMemo(() => {
    const h = Number(grantHours);
    if (!Number.isFinite(h) || h <= 0) return 'Số giờ phải lớn hơn 0.';
    if (h > GRANT_MAX_HOURS) return `Tối đa ${GRANT_MAX_HOURS} giờ một lần.`;
    if (Math.abs(h / GRANT_STEP - Math.round(h / GRANT_STEP)) > 1e-9) return `Số giờ theo bước ${GRANT_STEP} (0,25 = 15 phút).`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(grantDate)) return 'Chọn ngày áp dụng.';
    const today = vnToday();
    if (grantDate > today) return 'Không cộng giờ cho ngày chưa tới.';
    const min = new Date(`${today}T00:00:00Z`); min.setUTCDate(min.getUTCDate() - GRANT_MAX_BACKDATE_DAYS);
    if (grantDate < min.toISOString().slice(0, 10)) return `Chỉ lùi tối đa ${GRANT_MAX_BACKDATE_DAYS} ngày.`;
    if (grantReason.trim().length < 5) return 'Ghi lý do (ít nhất 5 ký tự).';
    return null;
  }, [grantHours, grantDate, grantReason]);

  const submitGrant = useCallback(async () => {
    if (!detailOf || grantError) return;
    setGrantSaving(true);
    try {
      const res = await apiClient.post<any>('/api/admin/ktv-office/hours-grant', {
        staffId: detailOf.code,
        hours: Number(grantHours),
        workDate: grantDate,
        reason: grantReason.trim(),
      });
      addToast(res?.message || `Đã cộng ${grantHours} giờ cho ${detailOf.name}.`, 'success');
      setGrantOpen(false);
      // Tải lại cả sổ chi tiết lẫn bảng xếp hạng — cộng giờ đổi thứ hạng ngay.
      await Promise.all([openDetail(detailOf), fetchRanking()]);
    } catch (error: any) {
      const msg = error?.status === 403
        ? 'Chỉ ADMIN / DEV được cộng giờ.'
        : (error?.message || 'Không cộng được giờ.');
      addToast(msg, 'error');
    } finally {
      setGrantSaving(false);
    }
  }, [detailOf, grantError, grantHours, grantDate, grantReason, addToast, openDetail, fetchRanking]);

  return {
    month, changeMonth, canGoNext,
    searchQuery, setSearchQuery,
    rows, ranked, totals, maxValue,
    loading, loadError,
    refresh: fetchRanking,
    detailOf, detail, detailLoading, openDetail, closeDetail,
    canGrant, grantOpen, openGrant, closeGrant: () => setGrantOpen(false),
    grantHours, setGrantHours, grantDate, setGrantDate, grantReason, setGrantReason,
    grantError, grantSaving, submitGrant,
    grantDateMax: vnToday(),
    GRANT_STEP, GRANT_MAX_HOURS,
  };
};

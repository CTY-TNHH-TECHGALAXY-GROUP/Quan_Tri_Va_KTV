import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/components/ui/Toast';
import { apiClient } from '@/lib/apiClient';
import { useAuth } from '@/lib/auth-context';

export type SheetType = 'deduct' | 'unlock' | 'history' | 'settings' | null;
export type FilterMode = 'Tất cả' | 'Cần xử lý' | 'Điểm thấp';

const FILTER_MODES: FilterMode[] = ['Tất cả', 'Cần xử lý', 'Điểm thấp'];

const MAX_PHOTOS = 5;

/**
 * 'YYYY-MM-DD' theo giờ VN, lùi n ngày — chỉ là GIÁ TRỊ TẠM trước khi server
 * trả về ngày làm việc thật.
 *
 * ⚠️ Ngày chấm điểm phải là NGÀY LÀM VIỆC (mốc cắt 06:00), không phải ngày lịch:
 * ca đêm 04/09 kết thúc 01:30 ngày 05/09 vẫn thuộc ngày làm việc 04/09, đúng như
 * `KTVAttendance.date` và sổ cái tua đang ghi. Lấy ngày lịch thì phiếu trừ trong
 * khung 00:00–06:00 rơi sang ngày sau, đẻ thêm một "ngày đi làm" ma trong mẫu số
 * điểm tháng. Nút Hôm nay / Hôm qua vì vậy đọc `logic.today` (server tính) chứ
 * không gọi thẳng hàm này.
 */
export function vnTodayStr(daysAgo = 0): string {
  const vn = new Date(Date.now() + 7 * 60 * 60 * 1000 - daysAgo * 86400000);
  return vn.toISOString().slice(0, 10);
}

/** Dịch 'YYYY-MM-DD' đi `days` ngày (âm = lùi). */
export function shiftDay(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 'YYYY-MM' dịch đi `delta` tháng. */
function shiftMonth(monthStr: string, delta: number): string {
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Nén ảnh trước khi gửi — ảnh điện thoại 4-8MB gửi thẳng sẽ vỡ giới hạn body
 * của API route và làm lễ tân chờ rất lâu trên mạng 3G ở tiệm.
 */
function compressImage(file: File, maxSize = 1280, quality = 0.75): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Không đọc được ảnh'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Ảnh không hợp lệ'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxSize || height > maxSize) {
          const ratio = Math.min(maxSize / width, maxSize / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Trình duyệt không hỗ trợ nén ảnh'));
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

async function compressMany(files: FileList | File[], room: number, onError: (msg: string) => void) {
  const picked: string[] = [];
  for (const file of Array.from(files).slice(0, room)) {
    try {
      picked.push(await compressImage(file));
    } catch (e: any) {
      onError(e?.message || 'Không xử lý được ảnh này.');
    }
  }
  return picked;
}

/** Phiếu đang được sửa trong sheet Lịch sử. */
interface EditState {
  logId: string;
  criteriaId: string;
  note: string;
  keptPhotos: string[];      // ảnh cũ còn giữ
  removedPhotos: string[];   // ảnh cũ bị bỏ
  newPhotos: string[];       // base64 mới thêm
}

export const useAdminKtvOfficeLogic = () => {
  const { addToast } = useToast();
  const { role } = useAuth();

  // Sửa quy chế và thu hồi phiếu là quyết định quản lý — lễ tân chỉ chấm điểm.
  const isManager = role?.id === 'admin' || role?.id === 'dev' || role?.id === 'branch_manager';

  const now = new Date(Date.now() + 7 * 60 * 60 * 1000); // giờ VN
  const [month, setMonth] = useState<number>(now.getUTCMonth() + 1);
  const [year, setYear] = useState<number>(now.getUTCFullYear());
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<FilterMode>('Tất cả');

  const [staffList, setStaffList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** Ngày làm việc hôm nay theo mốc cắt 06:00 — server trả về trong summary. */
  const [businessToday, setBusinessToday] = useState<string>(vnTodayStr());
  const yesterday = shiftDay(businessToday, -1);

  // Chi tiết 1 KTV (điểm Office + sổ giờ), tải khi mở sheet Lịch sử.
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [historyTab, setHistoryTab] = useState<'office' | 'hours'>('office');
  // Tháng xem lịch sử tách riêng khỏi tháng của bảng danh sách: đang xem tháng này
  // vẫn phải tra ngược được tháng trước của một KTV mà không phải đóng sheet.
  const [detailMonth, setDetailMonth] = useState<string>(
    `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  );

  // 18 tiêu chí đọc từ DB — không hard-code ở UI để Admin sửa quy chế khỏi phải deploy.
  const [criteriaGroups, setCriteriaGroups] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Lỗi ĐÃ trừ của ngày đang chọn — hiện sẵn dấu tích và khoá, vì quy chế
  // "mỗi lỗi chỉ trừ 1 lần/ngày dù lặp lại nhiều lần".
  const [existingHits, setExistingHits] = useState<any[]>([]);
  const [existingLoading, setExistingLoading] = useState(false);

  /**
   * Ngày đang chọn KTV có đi làm không — server xét cả chấm công lẫn lịch đăng
   * ký. `canDeduct = false` thì khoá nút gửi ngay, đừng để lễ tân tích xong 5
   * lỗi, chụp ảnh, bấm gửi rồi mới bị từ chối.
   */
  const [workday, setWorkday] = useState<any>(null);

  // Màn Cài đặt bộ tiêu chí (gồm cả tiêu chí đã ngừng áp dụng).
  const [settingsGroups, setSettingsGroups] = useState<any[]>([]);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  // Sửa / thu hồi phiếu đã gửi.
  const [editState, setEditState] = useState<EditState | null>(null);
  const [revokeState, setRevokeState] = useState<{ logId: string; reason: string } | null>(null);
  const [logBusy, setLogBusy] = useState(false);

  // Hộp thoại mở khoá: lý do khoá thật + mức phí đang cấu hình, nạp khi mở sheet.
  const [unlockInfo, setUnlockInfo] = useState<{
    lockReason: string | null; lockDate: string | null;
    feeEnabled: boolean; feeMin: number;
  } | null>(null);
  const [unlockReason, setUnlockReason] = useState('');
  const [unlockFee, setUnlockFee] = useState<number>(0);

  const [sheetState, setSheetState] = useState<{
    isOpen: boolean;
    type: SheetType;
    person: string;
    code: string;
    score: number;
    workDate: string;              // 'YYYY-MM-DD' gửi lên server
    selectedIds: string[];         // criteria_id đã tích
    note: string;
    /**
     * Ảnh minh chứng của RIÊNG từng lỗi: { criteria_id: base64[] }.
     *
     * ⚠️ Trước đây là một mảng `photos` dùng chung cho cả phiếu. Tích 3 lỗi rồi
     * tải 2 ảnh thì cả 3 dòng cùng nhận đúng 2 link đó — KTV mở ra thấy mỗi tấm
     * lặp 3 lần, và tấm chụp đồng phục bị đính vào cả lỗi "bật app trễ". Trần 5
     * ảnh cũng áp cho cả rổ nên 3 lỗi cần ảnh chỉ được chia nhau 5 tấm.
     */
    photosByCriteria: Record<string, string[]>;
  }>({
    isOpen: false,
    type: null,
    person: '',
    code: '',
    score: 100,
    workDate: vnTodayStr(),
    selectedIds: [],
    note: '',
    photosByCriteria: {},
  });

  const monthStr = `${year}-${String(month).padStart(2, '0')}`;

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiClient.get<any>(`/api/admin/ktv-office/summary?month=${monthStr}`);
      setStaffList(res?.data || []);
      // Ngày làm việc do SERVER chốt theo mốc cắt 06:00 — máy quầy để sai giờ,
      // hay đang là 1h sáng, thì nút "Hôm nay" vẫn trỏ đúng ca đang chạy.
      if (res?.today) setBusinessToday(res.today);
    } catch (error: any) {
      const msg = error?.status === 403
        ? 'Bạn không có quyền xem trang chấm điểm.'
        : (error?.message || 'Không tải được danh sách KTV.');
      setLoadError(msg);
      setStaffList([]);
      addToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [monthStr, addToast]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  const fetchDetail = useCallback(async (code: string, m: string) => {
    setDetailLoading(true);
    setDetail(null);
    setEditState(null);
    setRevokeState(null);
    try {
      const res = await apiClient.get<any>(`/api/admin/ktv-office/staff/${code}?month=${m}`);
      setDetail(res);
    } catch (error: any) {
      addToast(error?.message || 'Không tải được lịch sử của KTV này.', 'error');
    } finally {
      setDetailLoading(false);
    }
  }, [addToast]);

  const changeMonth = (delta: number) => {
    let m = month + delta;
    let y = year;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setMonth(m);
    setYear(y);
  };

  /** Đổi tháng ngay trong sheet Lịch sử, không đụng tới tháng của bảng danh sách. */
  const changeDetailMonth = (delta: number) => {
    const next = shiftMonth(detailMonth, delta);
    setDetailMonth(next);
    if (sheetState.code) fetchDetail(sheetState.code, next);
  };

  const setDetailMonthDirect = (m: string) => {
    if (!/^\d{4}-\d{2}$/.test(m)) return;
    setDetailMonth(m);
    if (sheetState.code) fetchDetail(sheetState.code, m);
  };

  const fetchCriteria = useCallback(async (force = false) => {
    if (!force && criteriaGroups.length > 0) return;
    try {
      const res = await apiClient.get<any>('/api/admin/ktv-office/criteria');
      setCriteriaGroups(res?.groups || []);
    } catch (error: any) {
      addToast(error?.message || 'Không tải được danh sách tiêu chí.', 'error');
    }
  }, [criteriaGroups.length, addToast]);

  const fetchExisting = useCallback(async (code: string, workDate: string) => {
    setExistingLoading(true);
    setExistingHits([]);
    setWorkday(null);
    try {
      const res = await apiClient.get<any>(
        `/api/admin/ktv-office/deduct?staffId=${encodeURIComponent(code)}&workDate=${workDate}`
      );
      setExistingHits(res?.existing || []);
      setWorkday(res?.workday || null);
    } catch {
      setExistingHits([]); // không tra được thì để trống, server vẫn chặn trùng khi gửi
      setWorkday(null);    // không rõ thì đừng tự khoá — server vẫn là cửa chặn thật
    } finally {
      setExistingLoading(false);
    }
  }, []);

  /** Bộ tiêu chí đầy đủ cho màn Cài đặt — kèm cả tiêu chí đã tắt và số lần đã dùng. */
  const fetchSettings = useCallback(async () => {
    setSettingsLoading(true);
    try {
      const res = await apiClient.get<any>('/api/admin/ktv-office/criteria?all=1');
      setSettingsGroups(res?.groups || []);
    } catch (error: any) {
      addToast(error?.message || 'Không tải được bộ tiêu chí.', 'error');
    } finally {
      setSettingsLoading(false);
    }
  }, [addToast]);

  const openSheet = (type: Exclude<SheetType, null>, person = '', code = '', score = 100) => {
    const today = businessToday;
    setSheetState(prev => ({
      ...prev, isOpen: true, type, person, code, score,
      workDate: today, selectedIds: [], note: '', photosByCriteria: {},
    }));
    setEditState(null);
    setRevokeState(null);
    if (type === 'history') {
      setHistoryTab('office');
      setDetailMonth(monthStr);
      fetchDetail(code, monthStr);
      fetchCriteria();   // cần danh sách tiêu chí cho ô chọn khi sửa phiếu
    }
    if (type === 'deduct') {
      fetchCriteria();
      fetchExisting(code, today);
    }
    if (type === 'settings') {
      fetchSettings();
    }
    if (type === 'unlock') {
      setUnlockInfo(null);
      setUnlockReason('');
      setUnlockFee(0);
      fetchUnlockInfo(code);
    }
  };

  /** Lý do KTV bị khoá + mức phí kích hoạt lại đang áp dụng. */
  const fetchUnlockInfo = async (code: string) => {
    try {
      const res = await apiClient.get<any>(`/api/admin/staff/unlock?staffId=${encodeURIComponent(code)}`);
      if (res?.data) {
        setUnlockInfo(res.data);
        // Mức trong cài đặt là SÀN — điền sẵn, quản lý muốn thu cao hơn thì sửa lên.
        setUnlockFee(res.data.feeEnabled ? res.data.feeMin : 0);
      }
    } catch (error: any) {
      addToast(error?.message || 'Không lấy được thông tin khoá tài khoản.', 'error');
    }
  };

  const canUnlock = unlockReason.trim().length > 0
    && (!unlockInfo?.feeEnabled || unlockFee >= (unlockInfo?.feeMin || 0));

  const submitUnlock = async () => {
    if (!canUnlock || submitting) return;
    setSubmitting(true);
    try {
      const res = await apiClient.post<any>('/api/admin/staff/unlock', {
        staffId: sheetState.code,
        reason: unlockReason.trim(),
        reactivationFee: unlockInfo?.feeEnabled ? unlockFee : undefined,
      });
      addToast(
        res?.feeCharged > 0
          ? `Đã mở khoá ${sheetState.person} và ghi phí kích hoạt ${res.feeCharged.toLocaleString('vi-VN')}đ.`
          : `Đã mở khoá tài khoản của ${sheetState.person}.`,
        'success');
      closeSheet();
      await fetchSummary();
    } catch (error: any) {
      addToast(error?.message || 'Không mở khoá được tài khoản.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  /** Đổi ngày vi phạm → tải lại danh sách lỗi đã trừ của ngày đó. */
  const changeWorkDate = (workDate: string) => {
    if (!workDate) return;
    // Bỏ tích những lỗi đã bị trừ ở ngày mới, tránh gửi lên rồi bị từ chối.
    setSheetState(prev => ({ ...prev, workDate }));
    fetchExisting(sheetState.code, workDate);
  };

  const closeSheet = () => setSheetState(prev => ({ ...prev, isOpen: false }));

  const toggleCriteria = (id: string) => {
    // Lỗi đã trừ hôm đó thì khoá, không cho tích lại.
    if (existingHits.some(h => h.criteriaId === id)) return;
    setSheetState(prev => ({
      ...prev,
      selectedIds: prev.selectedIds.includes(id)
        ? prev.selectedIds.filter(x => x !== id)
        : [...prev.selectedIds, id],
    }));
  };

  /** Trần ảnh áp cho TỪNG lỗi, không phải cho cả phiếu. */
  const photosOf = (criteriaId: string): string[] => sheetState.photosByCriteria[criteriaId] || [];

  const addPhotosFor = async (criteriaId: string, files: FileList | null) => {
    if (!files || files.length === 0) return;
    const room = MAX_PHOTOS - photosOf(criteriaId).length;
    if (room <= 0) {
      addToast(`Mỗi lỗi tối đa ${MAX_PHOTOS} ảnh.`, 'error');
      return;
    }
    const picked = await compressMany(files, room, msg => addToast(msg, 'error'));
    if (!picked.length) return;
    setSheetState(prev => ({
      ...prev,
      photosByCriteria: {
        ...prev.photosByCriteria,
        [criteriaId]: [...(prev.photosByCriteria[criteriaId] || []), ...picked],
      },
    }));
  };

  const removePhotoFor = (criteriaId: string, index: number) => {
    setSheetState(prev => ({
      ...prev,
      photosByCriteria: {
        ...prev.photosByCriteria,
        [criteriaId]: (prev.photosByCriteria[criteriaId] || []).filter((_, i) => i !== index),
      },
    }));
  };

  /** Tất cả tiêu chí phẳng, để tra điểm và cờ bắt buộc ảnh. */
  const allCriteria: any[] = criteriaGroups.flatMap(g => g.items || []);
  const selectedCriteria = sheetState.selectedIds
    .map(id => allCriteria.find(c => c.id === id))
    .filter(Boolean);
  const totalPoints = selectedCriteria.reduce((a, c: any) => a + (c.points || 0), 0);
  const needPhoto = selectedCriteria.some((c: any) => c.requiresPhoto);
  /** Lỗi bắt buộc ảnh mà CHÍNH NÓ chưa có ảnh nào. */
  const missingPhotoFor: any[] = selectedCriteria
    .filter((c: any) => c.requiresPhoto && photosOf(c.id).length === 0);
  /** Ngày nghỉ + không điểm danh thì không có gì để chấm. */
  const blockedNotWorkday = workday ? workday.canDeduct === false : false;
  const canSubmit = sheetState.selectedIds.length > 0
    && missingPhotoFor.length === 0
    && !blockedNotWorkday;

  const submitDeduct = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      const res = await apiClient.post<any>('/api/admin/ktv-office/deduct', {
        staffId: sheetState.code,
        workDate: sheetState.workDate,
        criteriaIds: sheetState.selectedIds,
        note: sheetState.note,
        photosByCriteria: sheetState.photosByCriteria,
      }, { timeout: 60000 });

      addToast(`Đã trừ ${res.totalPoints} điểm của ${sheetState.person}. KTV đã nhận thông báo.`, 'success');
      closeSheet();
      await fetchSummary();
    } catch (error: any) {
      addToast(error?.message || 'Không lưu được phiếu trừ điểm.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Sửa / thu hồi phiếu đã gửi ────────────────────────────────────────────

  const startEditLog = (hit: any) => {
    setRevokeState(null);
    setEditState({
      logId: hit.logId,
      criteriaId: hit.criteriaId,
      note: hit.note || '',
      keptPhotos: [...(hit.photoUrls || [])],
      removedPhotos: [],
      newPhotos: [],
    });
  };

  const cancelEditLog = () => setEditState(null);

  const patchEdit = (patch: Partial<EditState>) => {
    setEditState(prev => (prev ? { ...prev, ...patch } : prev));
  };

  /** Bỏ một ảnh cũ khỏi phiếu — chỉ đánh dấu, tới lúc Lưu mới gửi lên. */
  const removeEditPhoto = (url: string) => {
    setEditState(prev => prev ? {
      ...prev,
      keptPhotos: prev.keptPhotos.filter(u => u !== url),
      removedPhotos: [...prev.removedPhotos, url],
    } : prev);
  };

  const removeEditNewPhoto = (index: number) => {
    setEditState(prev => prev ? { ...prev, newPhotos: prev.newPhotos.filter((_, i) => i !== index) } : prev);
  };

  const addEditPhotos = async (files: FileList | null) => {
    if (!files || files.length === 0 || !editState) return;
    const room = MAX_PHOTOS - editState.keptPhotos.length - editState.newPhotos.length;
    if (room <= 0) {
      addToast(`Tối đa ${MAX_PHOTOS} ảnh.`, 'error');
      return;
    }
    const picked = await compressMany(files, room, msg => addToast(msg, 'error'));
    if (picked.length) {
      setEditState(prev => prev ? { ...prev, newPhotos: [...prev.newPhotos, ...picked] } : prev);
    }
  };

  const saveEditLog = async () => {
    if (!editState || logBusy) return;
    setLogBusy(true);
    try {
      await apiClient.patch<any>('/api/admin/ktv-office/deduct', {
        logId: editState.logId,
        criteriaId: editState.criteriaId,
        note: editState.note,
        addPhotosBase64: editState.newPhotos,
        removePhotoUrls: editState.removedPhotos,
      }, { timeout: 60000 });

      addToast('Đã lưu thay đổi cho phiếu này.', 'success');
      setEditState(null);
      await fetchDetail(sheetState.code, detailMonth);
      await fetchSummary();
    } catch (error: any) {
      addToast(error?.message || 'Không sửa được phiếu.', 'error');
    } finally {
      setLogBusy(false);
    }
  };

  const startRevokeLog = (logId: string) => {
    setEditState(null);
    setRevokeState({ logId, reason: '' });
  };

  const cancelRevokeLog = () => setRevokeState(null);

  const setRevokeReason = (reason: string) => {
    setRevokeState(prev => (prev ? { ...prev, reason } : prev));
  };

  const confirmRevokeLog = async () => {
    if (!revokeState || logBusy) return;
    if (revokeState.reason.trim().length < 5) {
      addToast('Cần ghi lý do thu hồi (ít nhất 5 ký tự).', 'error');
      return;
    }
    setLogBusy(true);
    try {
      const res = await apiClient.delete<any>(
        `/api/admin/ktv-office/deduct?logId=${encodeURIComponent(revokeState.logId)}&reason=${encodeURIComponent(revokeState.reason.trim())}`
      );
      addToast(`Đã thu hồi phiếu, hoàn lại ${res.restoredPoints} điểm cho KTV.`, 'success');
      setRevokeState(null);
      await fetchDetail(sheetState.code, detailMonth);
      await fetchSummary();
    } catch (error: any) {
      addToast(error?.message || 'Không thu hồi được phiếu.', 'error');
    } finally {
      setLogBusy(false);
    }
  };

  // ─── Cài đặt bộ tiêu chí ───────────────────────────────────────────────────

  /** Sau mỗi lần sửa quy chế phải nạp lại bảng chấm điểm, không dùng bản cache cũ. */
  const reloadCriteriaEverywhere = async () => {
    await fetchSettings();
    await fetchCriteria(true);
  };

  const saveCriteria = async (id: string, patch: { label?: string; points?: number; requiresPhoto?: boolean; isActive?: boolean }) => {
    if (savingId) return;
    setSavingId(id);
    try {
      await apiClient.put<any>('/api/admin/ktv-office/criteria', { id, ...patch });
      addToast('Đã lưu tiêu chí.', 'success');
      await reloadCriteriaEverywhere();
    } catch (error: any) {
      addToast(error?.message || 'Không lưu được tiêu chí.', 'error');
    } finally {
      setSavingId(null);
    }
  };

  const addCriteria = async (grp: string, draft: { label: string; points: number; requiresPhoto: boolean }) => {
    if (savingId) return false;
    if (!draft.label.trim()) {
      addToast('Chưa nhập tên tiêu chí.', 'error');
      return false;
    }
    if (!Number.isFinite(draft.points) || draft.points <= 0) {
      addToast('Điểm trừ phải lớn hơn 0.', 'error');
      return false;
    }
    setSavingId(`new-${grp}`);
    try {
      const res = await apiClient.post<any>('/api/admin/ktv-office/criteria', {
        grp,
        label: draft.label.trim(),
        points: draft.points,
        requiresPhoto: draft.requiresPhoto,
      });
      addToast(`Đã thêm tiêu chí ${res.id}.`, 'success');
      await reloadCriteriaEverywhere();
      return true;
    } catch (error: any) {
      addToast(error?.message || 'Không thêm được tiêu chí.', 'error');
      return false;
    } finally {
      setSavingId(null);
    }
  };

  const deleteCriteria = async (id: string, label: string, usageCount: number) => {
    if (savingId) return;
    const warn = usageCount > 0
      ? `"${label}" đã dùng cho ${usageCount} phiếu đã chấm. Xoá sẽ chuyển sang NGỪNG ÁP DỤNG (phiếu cũ giữ nguyên). Tiếp tục?`
      : `Xoá hẳn tiêu chí "${label}"?`;
    if (!window.confirm(warn)) return;

    setSavingId(id);
    try {
      const res = await apiClient.delete<any>(`/api/admin/ktv-office/criteria?id=${encodeURIComponent(id)}`);
      addToast(res?.message || 'Đã xoá tiêu chí.', 'success');
      await reloadCriteriaEverywhere();
    } catch (error: any) {
      addToast(error?.message || 'Không xoá được tiêu chí.', 'error');
    } finally {
      setSavingId(null);
    }
  };

  /** Sửa cả nhóm: tên nhóm và/hoặc trần điểm. Server chặn nếu hạ trần xuống dưới tổng đang dùng. */
  const saveGroup = async (grp: string, patch: { grpLabel?: string; grpMax?: number }) => {
    if (savingId) return false;
    if (patch.grpLabel !== undefined && !patch.grpLabel.trim()) {
      addToast('Tên nhóm không được để trống.', 'error');
      return false;
    }
    if (patch.grpMax !== undefined && (!Number.isFinite(patch.grpMax) || patch.grpMax < 0)) {
      addToast('Trần điểm của nhóm phải là số không âm.', 'error');
      return false;
    }
    setSavingId(`grp-${grp}`);
    try {
      await apiClient.put<any>('/api/admin/ktv-office/criteria', {
        grp,
        ...(patch.grpLabel !== undefined ? { grpLabel: patch.grpLabel.trim() } : {}),
        ...(patch.grpMax !== undefined ? { grpMax: patch.grpMax } : {}),
      });
      addToast(`Đã lưu nhóm ${grp}.`, 'success');
      await reloadCriteriaEverywhere();
      return true;
    } catch (error: any) {
      addToast(error?.message || 'Không lưu được nhóm.', 'error');
      return false;
    } finally {
      setSavingId(null);
    }
  };

  const toggleFilter = () => {
    setFilterMode(prev => FILTER_MODES[(FILTER_MODES.indexOf(prev) + 1) % FILTER_MODES.length]);
  };

  return {
    isManager,
    month, year, monthStr, changeMonth,
    searchQuery, setSearchQuery,
    filterMode, toggleFilter,
    staffList, loading, loadError, refresh: fetchSummary,
    today: businessToday, yesterday,
    detail, detailLoading, historyTab, setHistoryTab,
    detailMonth, changeDetailMonth, setDetailMonth: setDetailMonthDirect,
    sheetState, openSheet, closeSheet, setSheetState,
    criteriaGroups, allCriteria, toggleCriteria,
    photosOf, addPhotosFor, removePhotoFor, missingPhotoFor,
    totalPoints, needPhoto, canSubmit, submitting, submitDeduct,
    unlockInfo, unlockReason, setUnlockReason, unlockFee, setUnlockFee, canUnlock, submitUnlock,
    existingHits, existingLoading, changeWorkDate,
    workday, blockedNotWorkday,
    editState, startEditLog, cancelEditLog, patchEdit, addEditPhotos, removeEditPhoto, removeEditNewPhoto, saveEditLog,
    revokeState, startRevokeLog, cancelRevokeLog, setRevokeReason, confirmRevokeLog,
    logBusy,
    settingsGroups, settingsLoading, savingId, saveCriteria, addCriteria, deleteCriteria, saveGroup,
    maxPhotos: MAX_PHOTOS,
  };
};

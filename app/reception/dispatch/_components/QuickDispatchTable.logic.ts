import { isUtilityService } from '@/lib/booking.logic';
import type { ServiceBlock } from '../types';

/** "HH:mm" + minutes → "HH:mm" (wraps past midnight). */
export const addMinutesToHHmm = (start: string, minutes: number): string => {
  const [h, m] = (start || '').split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

/**
 * "GỘP CHUNG KTV" = GHÉP DỊCH VỤ: dịch vụ TRƯỚC (`parentId`) giữ chặng, KTV của nó làm luôn phần phút
 * của các dịch vụ SAU (60 + 70 → 130p trên dòng KTV). Tiện ích (Phòng riêng) không cộng phút.
 * `children` = các dịch vụ SAU (thời lượng của chúng đã gồm cả dịch vụ ghép vào chúng trước đó).
 *
 * Dịch vụ SAU: KHÔNG chặng, KHÔNG KTV (xem lib/dispatch/merged-service.ts — vì sao). Nếu dịch vụ trước
 * chưa có KTV mà dịch vụ sau có, KTV đó chuyển sang dịch vụ trước thay vì mất.
 */
export const mergeServicesIntoParent = (
  services: ServiceBlock[],
  parentId: string,
  children: Pick<ServiceBlock, 'id' | 'duration'>[],
): ServiceBlock[] => {
  const childIds = children.map((c) => c.id);
  const childMinutes = children
    .filter((c) => !isUtilityService(services.find((s) => s.id === c.id) ?? c))
    .reduce((sum, c) => sum + (Number(c.duration) || 0), 0);
  const parentSvc = services.find((s) => s.id === parentId);
  const parentHasKtv = !!parentSvc?.staffList?.some((st) => st.ktvId);
  // Dịch vụ trước chưa có KTV: mượn dòng KTV của dịch vụ sau đầu tiên có KTV, đặt lại về thời lượng của dịch vụ trước.
  const carried = parentHasKtv ? null : services
    .filter((s) => childIds.includes(s.id))
    .map((s) => (s.staffList || []).filter((st) => st.ktvId))
    .find((rows) => rows.length > 0) || null;
  const baseStaff = carried && parentSvc
    ? carried.map((st) => ({ ...st, segments: (st.segments || []).map((seg, i) => i === 0
        ? { ...seg, duration: parentSvc.duration, endTime: seg.startTime ? addMinutesToHHmm(seg.startTime, parentSvc.duration) : seg.endTime }
        : seg) }))
    : parentSvc?.staffList || [];
  return services.map((svc) => {
    if (svc.id === parentId) {
      return {
        ...svc,
        mergedServiceIds: [...new Set([...(svc.mergedServiceIds || []), ...childIds])],
        staffList: childMinutes > 0
          ? baseStaff.map((st) => ({
              ...st,
              segments: (st.segments || []).map((seg, i) => {
                if (i !== 0) return seg;
                const base = seg.duration !== undefined && seg.duration !== null ? seg.duration : svc.duration;
                const duration = base + childMinutes;
                return { ...seg, duration, endTime: seg.startTime ? addMinutesToHHmm(seg.startTime, duration) : seg.endTime };
              }),
            }))
          : baseStaff,
      };
    }
    if (childIds.includes(svc.id)) {
      return { ...svc, mergedIntoId: parentId, staffList: [], options: { ...(svc.options || {}), mergedIntoId: parentId } };
    }
    return svc;
  });
};

/** KTV đang gán trên dịch vụ SAU mà KHÔNG phải KTV của dịch vụ trước — sẽ bị gỡ khi ghép (báo lại quầy). */
export const ktvsRemovedByMerge = (services: ServiceBlock[], parentId: string, childIds: string[]): string[] => {
  const parent = services.find((s) => s.id === parentId);
  const kept = new Set((parent?.staffList || []).map((st) => st.ktvId).filter(Boolean));
  if (!kept.size) return [];
  return [...new Set(services
    .filter((s) => childIds.includes(s.id))
    .flatMap((s) => (s.staffList || []).map((st) => st.ktvId))
    .filter((id): id is string => !!id && !kept.has(id)))];
};

/** Đã xong (dọn phòng / chờ đánh giá / hoàn tất / huỷ) → tiền đã chốt, KHÔNG hủy gộp dưới mọi hình thức. */
export const hasFinishedWork = (svc: ServiceBlock | undefined): boolean =>
  !!svc && (['CLEANING', 'FEEDBACK', 'DONE', 'COMPLETED', 'CANCELLED'].includes(String(svc.status || ''))
    || (svc.staffList || []).some((st) => (st.segments || []).some((seg: any) => seg.actualEndTime)));

/** Dịch vụ đã có chặng bắt đầu / đang làm / đã xong → không hủy gộp trên form (đang làm: popup + unmergeRunningService). */
export const hasStartedWork = (svc: ServiceBlock | undefined): boolean =>
  !!svc && (['IN_PROGRESS', 'PAUSED', 'CLEANING', 'FEEDBACK', 'DONE', 'COMPLETED'].includes(String(svc.status || ''))
    || (svc.staffList || []).some((st) => (st.segments || []).some((seg: any) => seg.actualStartTime || seg.actualEndTime)));

/**
 * "HỦY GỘP" = phép ngược của mergeServicesIntoParent, chỉ dùng khi CHƯA bắt đầu (hasStartedWork = false):
 *   - Dịch vụ TRƯỚC: trừ lại phút của các dịch vụ SAU (bỏ tiện ích) ở chặng đầu mỗi KTV, tính lại giờ kết thúc,
 *     trả tên về tên gốc. Không bao giờ thấp hơn 1 phút; nếu quầy đã rút ngắn dưới phần trừ → về thời lượng gốc.
 *   - Dịch vụ SAU: bỏ dấu ghép ở CẢ tầng trên và options (null → lưu xuống DB xoá được), không KTV — quầy gán lại.
 * KTV của dịch vụ trước giữ nguyên (không đổi người nhận đơn), chỉ đổi số phút.
 */
export const unmergeFromLeading = (services: ServiceBlock[], leadingId: string): ServiceBlock[] => {
  const leading = services.find((s) => s.id === leadingId);
  const followingIds = leading?.mergedServiceIds || [];
  if (!leading || !followingIds.length) return services;
  const followMinutes = services
    .filter((s) => followingIds.includes(s.id) && !isUtilityService(s))
    .reduce((sum, s) => sum + (Number(s.duration) || 0), 0);
  return services.map((svc) => {
    if (svc.id === leadingId) {
      return {
        ...svc,
        mergedServiceIds: [],
        displayName: undefined,
        options: { ...(svc.options || {}), mergedServiceIds: [], displayName: undefined, _generatedDisplayName: undefined },
        staffList: (svc.staffList || []).map((st) => ({
          ...st,
          segments: (st.segments || []).map((seg, i) => {
            if (i !== 0 || followMinutes <= 0) return seg;
            const current = Number(seg.duration) || Number(svc.duration) || 0;
            const back = current - followMinutes >= 1 ? current - followMinutes : Number(svc.duration) || 1;
            return { ...seg, duration: back, endTime: seg.startTime ? addMinutesToHHmm(seg.startTime, back) : seg.endTime };
          }),
        })),
      };
    }
    if (followingIds.includes(svc.id)) {
      return { ...svc, mergedIntoId: undefined, staffList: [], options: { ...(svc.options || {}), mergedIntoId: null } };
    }
    return svc;
  });
};

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
 * "GỘP CHUNG KTV": children become part of the parent and the KTV(s) already assigned on the
 * parent work their minutes too (VIP 90 + Khuyến mãi 30 → 120p on the KTV row). Same rule as the
 * drag-merge on the dispatch page: child minutes are added to the parent's first segment.
 * Utilities (Phòng riêng) add no minutes. `children` are the group items (their duration already
 * includes their own merged children).
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
  return services.map((svc) => {
    if (svc.id === parentId) {
      return {
        ...svc,
        mergedServiceIds: [...(svc.mergedServiceIds || []), ...childIds],
        staffList: childMinutes > 0
          ? svc.staffList.map((st) => ({
              ...st,
              segments: (st.segments || []).map((seg, i) => {
                if (i !== 0) return seg;
                const base = seg.duration !== undefined && seg.duration !== null ? seg.duration : svc.duration;
                const duration = base + childMinutes;
                return { ...seg, duration, endTime: seg.startTime ? addMinutesToHHmm(seg.startTime, duration) : seg.endTime };
              }),
            }))
          : svc.staffList,
      };
    }
    if (childIds.includes(svc.id)) return { ...svc, mergedIntoId: parentId };
    return svc;
  });
};

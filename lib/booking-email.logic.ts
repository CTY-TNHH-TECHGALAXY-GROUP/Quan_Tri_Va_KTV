import type { BookingDetails, ServicePref } from './email';
import { formatBodyAreas, normalizeStrength, isUtilityService } from './booking.logic';

/**
 * Dựng phần dữ liệu email xác nhận từ các BookingItems của một đơn.
 *
 * Nơi gọi: nút "Xác nhận đơn" (web-booking/actions.ts), route gửi lại email,
 * và script mô phỏng. Trước đây mỗi nơi tự chép tay đoạn gom này và cùng gộp
 * yêu cầu của mọi dịch vụ thành một — khiến một vùng có thể nằm ở cả "Tập trung"
 * lẫn "Tránh". Giữ logic ở một chỗ để lỗi kiểu đó không tái diễn ở nơi khác.
 */

/** Các cách form web ghi "khách không chọn KTV". */
const NO_THERAPIST = new Set(['', 'ngẫu nhiên', 'ngau nhien', 'random', 'any']);

/**
 * Chuẩn hoá yêu cầu KTV về nhãn tiếng Việt cố định để email dịch được.
 * Dữ liệu thật lẫn lộn: "Nữ" / "female", "Nam", và nhiều kiểu "không chọn"
 * ("Ngẫu nhiên", null, "", "ANY", "random"). Tên / mã KTV cụ thể giữ nguyên.
 */
export function normalizeTherapistRequest(raw: unknown): string {
  const v = String(raw ?? '').trim();
  const k = v.toLowerCase();
  if (NO_THERAPIST.has(k)) return 'Ngẫu nhiên';
  if (k === 'nữ' || k === 'nu' || k === 'female') return 'Nữ';
  if (k === 'nam' || k === 'male') return 'Nam';
  return v;
}

/** Tên dịch vụ theo ngôn ngữ của khách; thiếu bản dịch thì lùi về tiếng Anh rồi tiếng Việt. */
export function localizedServiceName(svc: any, lang: string): string {
  if (!svc) return 'Service';
  const byLang: Record<string, string | undefined> = {
    vi: svc.nameVN, kr: svc.nameKR, jp: svc.nameJP, cn: svc.nameCN,
  };
  return byLang[lang] || svc.nameEN || svc.nameVN || 'Service';
}

function parseOptions(raw: unknown): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) || {}; } catch { return {}; }
  }
  return raw as Record<string, any>;
}

/** Ghi chú chung của đơn (có thể lưu dạng JSON) — chỉ lấy phần khách viết. */
export function extractBookingNote(notes: unknown): string {
  if (!notes || typeof notes !== 'string') return '';
  const raw = notes.trim();
  if (!raw.startsWith('{')) return raw;
  try {
    const parsed = JSON.parse(raw);
    return String(parsed.customerNote || parsed.note || '').trim();
  } catch {
    return '';
  }
}

/** Trích xuất số khách thực tế từ notes (vd: 'Guests: 3') hoặc fallback về guestCount */
export function parseGuestCountFromNotes(notes?: unknown, fallback = 1): number {
  if (typeof notes === 'string') {
    const trimmed = notes.trim();
    const match = trimmed.match(/Guests:\s*(\d{1,2})(?:\s*\||$)/i);
    if (match) {
      const count = parseInt(match[1], 10);
      if (!isNaN(count) && count >= 1 && count <= 50) return count;
    }
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        const count = Number(parsed.guests || parsed.guestCount || parsed.customerGuests);
        if (!isNaN(count) && count >= 1 && count <= 50) return count;
      } catch {}
    }
  }
  const fallbackNum = Number(fallback);
  return !isNaN(fallbackNum) && fallbackNum >= 1 ? fallbackNum : 1;
}

/**
 * Dịch vụ, thời lượng, số khách và yêu cầu theo từng dịch vụ — phần BookingDetails
 * lấy từ BookingItems. Nơi gọi tự bổ sung mã đơn, ngày giờ, tiền.
 *
 * Quy tắc hiển thị:
 *  - Mỗi dịch vụ một nhóm, giữ thứ tự trong đơn.
 *  - Tiện ích / add-on (Phòng riêng...) được đính kèm vào đúng suất dịch vụ thay vì bị lọc mất.
 *  - Giữ KTV yêu cầu cho từng suất (Ngẫu nhiên / Nữ / Nam / KTV chỉ định).
 *  - Nhóm trùng hệt nhau thì gộp; cùng tên nhưng khác yêu cầu/add-on thì gắn nhãn khách hoặc hiện riêng.
 */
export function buildServiceSection(items: any[] | null | undefined, lang: string): Pick<
  BookingDetails,
  'services' | 'duration' | 'guests' | 'servicePrefs' | 'therapistRequests'
> {
  const services: { name: string; duration: number }[] = [];
  const therapistRequests: string[] = [];
  const guestIndex = new Map<string, number>();
  let duration = 0;
  let guests = 0;

  interface RawItemWithOpts {
    item: any;
    options: Record<string, any>;
    name: string;
    duration: number;
    unitIndex: number;
  }
  const mainItems: RawItemWithOpts[] = [];
  const addonItems: RawItemWithOpts[] = [];

  for (const item of items || []) {
    guests += item.quantity || 1;

    // Đánh số khách theo thứ tự xuất hiện — dùng khi một dịch vụ đặt cho nhiều người
    if (item.guest_id && !guestIndex.has(item.guest_id)) {
      guestIndex.set(item.guest_id, guestIndex.size + 1);
    }

    const name = localizedServiceName(item.Services, lang);
    const dur = item.Services?.duration || 0;
    if (item.Services) {
      duration += dur;
      services.push({ name, duration: dur });
    }

    const options = parseOptions(item.options);
    const idStr = String(item.id || '');
    const unitMatch = idStr.match(/-(\d+)-unit/);
    const unitIndex = unitMatch ? parseInt(unitMatch[1], 10) : -1;

    const entry: RawItemWithOpts = { item, options, name, duration: dur, unitIndex };

    if (isUtilityService(item) || options.isAddon) {
      addonItems.push(entry);
    } else {
      mainItems.push(entry);
    }
  }

  // Nếu đơn chỉ toàn tiện ích (không có dịch vụ chính), giữ lại để hiển thị
  const primaryItems = mainItems.length > 0 ? mainItems : addonItems;

  // Ghép Addon vào dịch vụ chính tương ứng
  const attachedAddons = new Map<number, string>();
  const usedAddons = new Set<number>();

  primaryItems.forEach((m, mIdx) => {
    // Ưu tiên 1: trùng unitIndex (ví dụ: NHS0800-2-unit1 và NHS0900-2-unit1)
    if (m.unitIndex >= 0) {
      const aIdx = addonItems.findIndex((a, idx) => !usedAddons.has(idx) && a.unitIndex === m.unitIndex);
      if (aIdx >= 0) {
        usedAddons.add(aIdx);
        const aName = addonItems[aIdx].options.displayName || addonItems[aIdx].name || 'Phòng riêng';
        attachedAddons.set(mIdx, aName);
        return;
      }
    }
    // Ưu tiên 2: trùng parentServiceId
    const aIdxParent = addonItems.findIndex(
      (a, idx) => !usedAddons.has(idx) && a.options.parentServiceId && a.options.parentServiceId === m.item.serviceId
    );
    if (aIdxParent >= 0) {
      usedAddons.add(aIdxParent);
      const aName = addonItems[aIdxParent].options.displayName || addonItems[aIdxParent].name || 'Phòng riêng';
      attachedAddons.set(mIdx, aName);
    }
  });

  const groups: ServicePref[] = [];

  primaryItems.forEach((m, mIdx) => {
    const o = m.options;
    const focus = formatBodyAreas(o.focus);
    const avoid = formatBodyAreas(o.avoid);
    const strengthRaw = o.strength ? normalizeStrength(o.strength) : '';
    const strength = strengthRaw || '';
    const therapist = normalizeTherapistRequest(o.therapist);
    const note = String(o.note || o.customerNotes || '').trim();
    const addon = attachedAddons.get(mIdx);

    // Kiểm tra xem suất này có thông tin nào cần hiển thị không
    const hasAnyOption = Boolean(focus || avoid || strength || (therapist && therapist !== 'Ngẫu nhiên') || note || addon);

    if (therapist) {
      therapistRequests.push(therapist);
    }

    if (hasAnyOption) {
      groups.push({
        name: m.name,
        guest: m.item.guest_id ? guestIndex.get(m.item.guest_id) : undefined,
        focus,
        avoid,
        strength,
        therapist,
        note,
        addon,
      });
    }
  });

  // Bỏ các nhóm trùng lặp hệt nhau (chỉ gộp khi cùng tên, cùng addon, cùng focus/avoid/strength/therapist/note)
  const seen = new Set<string>();
  const visible = groups.filter(g => {
    const key = JSON.stringify([g.name, g.addon || '', g.focus || '', g.avoid || '', g.strength || '', g.therapist || '', g.note || '']);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Cùng tên dịch vụ còn lại nhiều nhóm → cần nhãn khách để phân biệt (nếu không có addon)
  const nameCount = new Map<string, number>();
  visible.forEach(g => nameCount.set(g.name, (nameCount.get(g.name) || 0) + 1));
  const servicePrefs = visible.map(g => ({
    ...g,
    showGuest: !g.addon && (nameCount.get(g.name) || 0) > 1,
  }));

  return { services, duration, guests, servicePrefs, therapistRequests };
}

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
  if (NO_THERAPIST.has(k)) return '';
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

/**
 * Dịch vụ, thời lượng, số khách và yêu cầu theo từng dịch vụ — phần BookingDetails
 * lấy từ BookingItems. Nơi gọi tự bổ sung mã đơn, ngày giờ, tiền.
 *
 * Quy tắc hiển thị (đã chốt với vận hành):
 *  - Mỗi dịch vụ một nhóm, giữ thứ tự trong đơn.
 *  - Bỏ dịch vụ tiện ích (Phòng riêng...) khỏi khối yêu cầu; vẫn nằm ở dòng "Dịch vụ".
 *  - "Vừa" là giá trị form web tự điền cho MỌI dịch vụ, nên chỉ hiện khi dịch vụ đó
 *    có chọn Tập trung/Tránh; Nhẹ/Mạnh là lựa chọn thật nên luôn hiện.
 *  - Nhóm trùng hệt nhau thì gộp; cùng tên nhưng khác yêu cầu thì gắn nhãn khách.
 */
export function buildServiceSection(items: any[] | null | undefined, lang: string): Pick<
  BookingDetails,
  'services' | 'duration' | 'guests' | 'servicePrefs' | 'therapistRequests'
> {
  const services: { name: string; duration: number }[] = [];
  const groups: ServicePref[] = [];
  const therapistRequests: string[] = [];
  const guestIndex = new Map<string, number>();
  let duration = 0;
  let guests = 0;

  for (const item of items || []) {
    guests += item.quantity || 1;

    // Đánh số khách theo thứ tự xuất hiện — dùng khi một dịch vụ đặt cho nhiều người
    if (item.guest_id && !guestIndex.has(item.guest_id)) {
      guestIndex.set(item.guest_id, guestIndex.size + 1);
    }

    const name = localizedServiceName(item.Services, lang);
    if (item.Services) {
      const dur = item.Services.duration || 0;
      duration += dur;
      services.push({ name, duration: dur });
    }

    if (isUtilityService(item)) continue;

    const o = parseOptions(item.options);
    const focus = formatBodyAreas(o.focus);
    const avoid = formatBodyAreas(o.avoid);
    const strengthRaw = o.strength ? normalizeStrength(o.strength) : '';
    const strength = strengthRaw && (strengthRaw !== 'Vừa' || focus || avoid) ? strengthRaw : '';
    const therapist = normalizeTherapistRequest(o.therapist);
    const note = String(o.note || o.customerNotes || '').trim();

    therapistRequests.push(therapist);
    groups.push({
      name,
      guest: item.guest_id ? guestIndex.get(item.guest_id) : undefined,
      focus, avoid, strength, therapist, note,
    });
  }

  // Bỏ nhóm không có gì để nói, rồi gộp các nhóm trùng hệt nhau
  const seen = new Set<string>();
  const visible = groups.filter(g => {
    if (!(g.focus || g.avoid || g.strength || g.therapist || g.note)) return false;
    const key = JSON.stringify([g.name, g.focus, g.avoid, g.strength, g.therapist, g.note]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Cùng tên dịch vụ còn lại nhiều nhóm → cần nhãn khách để phân biệt
  const nameCount = new Map<string, number>();
  visible.forEach(g => nameCount.set(g.name, (nameCount.get(g.name) || 0) + 1));
  const servicePrefs = visible.map(g => ({ ...g, showGuest: (nameCount.get(g.name) || 0) > 1 }));

  return { services, duration, guests, servicePrefs, therapistRequests };
}

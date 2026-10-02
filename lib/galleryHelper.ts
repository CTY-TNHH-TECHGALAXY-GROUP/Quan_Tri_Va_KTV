import type { GalleryItem, EmployeeSkills } from './types';
import { SKILL_KEYS, SKILL_LABELS } from './constants/staff.constants';

/** Accept direct image links without changing CDN paths or query parameters. */
export function isGalleryImageUrl(value: string): boolean {
  const trimmed = (value || '').trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('data:') ||
    lower.startsWith('blob:')
  ) {
    return false;
  }
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return true;
  }
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export type GalleryGroupId =
  | 'coconutOil'
  | 'thaiTherapy'
  | 'shiatsu'
  | 'hotStone'
  | 'mix'
  | 'privilege'
  | 'legacy'
  | `vip:${string}`;

export const isVipGalleryGroup = (value: string): value is `vip:${string}` =>
  value.startsWith('vip:') && SKILL_KEYS.includes(value.slice(4) as typeof SKILL_KEYS[number]);

export interface GalleryGroupConfig {
  id: GalleryGroupId;
  label: string;
}

export const GALLERY_GROUPS: GalleryGroupConfig[] = [
  { id: 'privilege', label: 'Ảnh Đặc Quyền' },
  { id: 'coconutOil', label: 'Tinh Dầu Dừa' },
  { id: 'thaiTherapy', label: 'Thái / Cổ Vai Gáy' },
  { id: 'shiatsu', label: 'Bấm Huyệt Shiatsu' },
  { id: 'hotStone', label: 'Đá Nóng' },
  { id: 'mix', label: 'Mix 2–4 phương pháp' },
  { id: 'legacy', label: 'Ảnh chung' },
];

export const THERAPY_METHOD_LABELS: Record<string, string> = {
  coconutOil: 'Tinh Dầu Dừa',
  hotStone: 'Đá Nóng',
  thaiTherapy: 'Thái / Cổ Vai Gáy',
  shiatsu: 'Bấm Huyệt Shiatsu',
  mix: 'Mix 2–4 phương pháp',
  privilege: 'Đặc Quyền',
};

export const DEFAULT_THERAPY_DISPLAY_ORDER: Record<string, number> = {
  privilege: 0,
  coconutOil: 1,
  hotStone: 2,
  thaiTherapy: 3,
  shiatsu: 4,
  mix: 5,
};

export function createGalleryItem(url: string, groupId: GalleryGroupId): string | GalleryItem {
  const trimmed = url.trim();
  if (groupId === 'privilege' || groupId === 'vip:privilege') {
    return { url: trimmed, kind: 'privilege' };
  }
  if (isVipGalleryGroup(groupId)) {
    return { url: trimmed, kind: 'vip', skillId: groupId.slice(4) };
  }
  if (groupId === 'legacy') {
    return trimmed;
  }
  if (groupId === 'mix') {
    return { url: trimmed, kind: 'mix' };
  }
  return { url: trimmed, kind: 'therapy', therapyId: groupId };
}

export function getGalleryGroup(item: string | GalleryItem): GalleryGroupId {
  if (typeof item === 'string') return 'legacy';
  if (!item || typeof item !== 'object') return 'legacy';
  if (item.kind === 'privilege') return 'privilege';
  if (
    item.kind === 'vip' &&
    item.skillId &&
    ['privilege', 'dacquyen', 'dac_quyen', 'dac-quyen'].includes(item.skillId.toLowerCase())
  ) {
    return 'privilege';
  }
  if (item.kind === 'therapy' && item.therapyId === 'privilege') return 'privilege';
  if (item.kind === 'vip' && item.skillId && isVipGalleryGroup(`vip:${item.skillId}`)) {
    return `vip:${item.skillId}`;
  }
  if (item.kind === 'mix') return 'mix';
  if (item.kind === 'therapy' && item.therapyId) {
    const valid: GalleryGroupId[] = ['coconutOil', 'thaiTherapy', 'shiatsu', 'hotStone'];
    if (valid.includes(item.therapyId as GalleryGroupId)) {
      return item.therapyId as GalleryGroupId;
    }
  }
  return 'legacy';
}

/** Helper kiểm tra trùng ảnh (cùng URL và cùng metadata) */
export function checkGalleryDuplicate(
  currentUrls: (string | GalleryItem)[],
  newItem: string | GalleryItem
): boolean {
  const getUrl = (item: string | GalleryItem): string =>
    typeof item === 'string' ? item : item?.url ?? '';

  const trimmed = getUrl(newItem).trim();
  const nextKind = typeof newItem === 'string' ? 'legacy' : newItem.kind;
  const nextTherapyId =
    typeof newItem !== 'string' && newItem.kind === 'therapy'
      ? newItem.therapyId
      : typeof newItem !== 'string' && newItem.kind === 'vip'
      ? newItem.skillId
      : typeof newItem !== 'string' && newItem.kind === 'privilege'
      ? (newItem.privilegeId || 'privilege')
      : undefined;

  return currentUrls.some((item) => {
    const kind = typeof item === 'string' ? 'legacy' : item.kind;
    const therapyId =
      typeof item !== 'string' && item.kind === 'therapy'
        ? item.therapyId
        : typeof item !== 'string' && item.kind === 'vip'
        ? item.skillId
        : typeof item !== 'string' && item.kind === 'privilege'
        ? (item.privilegeId || 'privilege')
        : undefined;

    return (
      getUrl(item).trim() === trimmed &&
      kind === nextKind &&
      therapyId === nextTherapyId
    );
  });
}

/** Helper xóa ảnh theo chỉ số index, an toàn cho mảng chứa nhiều ảnh cùng URL */
export function removeGalleryItemByIndex<T>(items: T[], indexToRemove: number): T[] {
  return items.filter((_, idx) => idx !== indexToRemove);
}

/** Helper kiểm tra xem ảnh có đang bị ẩn hay không */
export function isGalleryItemHidden(item: string | GalleryItem): boolean {
  if (typeof item === 'object' && item !== null) {
    return item.hidden === true;
  }
  return false;
}

/** Đảo trạng thái ẩn/hiện của ảnh */
export function toggleGalleryItemVisibility(
  items: (string | GalleryItem)[],
  targetIndex: number
): (string | GalleryItem)[] {
  if (targetIndex < 0 || targetIndex >= items.length) return items;
  return items.map((item, idx) => {
    if (idx !== targetIndex) return item;
    if (typeof item === 'string') {
      return { url: item, kind: 'legacy', hidden: true };
    }
    return {
      ...item,
      hidden: !item.hidden,
    };
  });
}

/** Hoán đổi vị trí 2 ảnh trong mảng */
export function swapGalleryItems<T>(items: T[], indexA: number, indexB: number): T[] {
  if (
    indexA < 0 ||
    indexA >= items.length ||
    indexB < 0 ||
    indexB >= items.length ||
    indexA === indexB
  ) {
    return items;
  }
  const next = [...items];
  const temp = next[indexA];
  next[indexA] = next[indexB];
  next[indexB] = temp;
  return next;
}

/** Lấy nhãn hiển thị trực quan cho từng ảnh */
export function getGalleryItemDisplayLabel(item: string | GalleryItem): string {
  if (typeof item === 'string') return 'Ảnh chung';
  if (!item) return 'Ảnh';
  if (item.kind === 'privilege') return 'Đặc Quyền';
  if (item.kind === 'vip' && item.skillId) {
    const isPriv = ['privilege', 'dacquyen', 'dac_quyen', 'dac-quyen'].includes(item.skillId.toLowerCase());
    if (isPriv) return 'Đặc Quyền';
    return (SKILL_LABELS as any)[item.skillId] || `Kỹ năng: ${item.skillId}`;
  }
  if (item.kind === 'therapy' && item.therapyId) {
    return THERAPY_METHOD_LABELS[item.therapyId] || item.therapyId;
  }
  if (item.kind === 'mix') return 'Mix 2–4 phương pháp';
  return 'Ảnh chung';
}

export interface MenuGalleryItemWrapper {
  item: string | GalleryItem;
  originalIndex: number;
  url: string;
  isHidden: boolean;
  order: number;
  label: string;
}

/** Lấy danh sách ảnh thuộc Menu VIP (NHP) theo thứ tự hiển thị */
export function getNhpMenuGalleryItems(
  items: (string | GalleryItem)[],
  skills?: Record<string, unknown> | Partial<EmployeeSkills> | any | null
): MenuGalleryItemWrapper[] {
  const result: MenuGalleryItemWrapper[] = [];

  items.forEach((item, originalIndex) => {
    if (!item) return;
    const url = typeof item === 'string' ? item.trim() : (item.url || '').trim();
    if (!url) return;

    const isPrivilege =
      typeof item !== 'string' &&
      (item.kind === 'privilege' ||
        (item.kind === 'vip' &&
          typeof item.skillId === 'string' &&
          ['privilege', 'dacquyen', 'dac_quyen', 'dac-quyen'].includes(item.skillId.toLowerCase())));

    const isVipSkill =
      typeof item !== 'string' &&
      item.kind === 'vip' &&
      typeof item.skillId === 'string' &&
      !isPrivilege;

    if (!isPrivilege && !isVipSkill) return;

    if (isVipSkill && skills && typeof item !== 'string' && item.skillId) {
      const val = skills[item.skillId];
      const isActive = val === true || (typeof val === 'string' && val !== '' && val !== 'none');
      if (!isActive) return;
    }

    const isHidden = typeof item === 'object' && item !== null && item.hidden === true;
    const explicitOrder =
      typeof item === 'object' && item !== null
        ? ((item as any).orderNhp ?? (item as any).order)
        : undefined;

    result.push({
      item,
      originalIndex,
      url,
      isHidden,
      order: typeof explicitOrder === 'number' ? explicitOrder : (isPrivilege ? -1 : 100 + originalIndex),
      label: getGalleryItemDisplayLabel(item),
    });
  });

  return result.sort((a, b) => a.order - b.order);
}

/** Lấy danh sách ảnh thuộc Menu Điều Trị (NHT) theo thứ tự hiển thị */
export function getNhtMenuGalleryItems(
  items: (string | GalleryItem)[]
): MenuGalleryItemWrapper[] {
  const result: MenuGalleryItemWrapper[] = [];

  items.forEach((item, originalIndex) => {
    if (!item) return;
    const url = typeof item === 'string' ? item.trim() : (item.url || '').trim();
    if (!url) return;

    if (typeof item === 'string') {
      result.push({
        item,
        originalIndex,
        url,
        isHidden: false,
        order: 900 + originalIndex,
        label: 'Ảnh chung',
      });
      return;
    }

    const isTherapy = item.kind === 'therapy';
    const isMix = item.kind === 'mix';
    const isPrivilege = item.kind === 'privilege';
    const isLegacy = item.kind === 'legacy';

    if (!isTherapy && !isMix && !isPrivilege && !isLegacy) return;

    const isHidden = item.hidden === true;
    const explicitOrder = (item as any).orderNht ?? (item as any).order;

    let defaultOrder = 900 + originalIndex;
    if (isPrivilege) defaultOrder = 0;
    else if (isTherapy && item.therapyId) {
      defaultOrder = DEFAULT_THERAPY_DISPLAY_ORDER[item.therapyId] ?? 50;
    } else if (isMix) {
      defaultOrder = DEFAULT_THERAPY_DISPLAY_ORDER.mix ?? 60;
    }

    result.push({
      item,
      originalIndex,
      url,
      isHidden,
      order: typeof explicitOrder === 'number' ? explicitOrder : defaultOrder,
      label: getGalleryItemDisplayLabel(item),
    });
  });

  return result.sort((a, b) => a.order - b.order);
}

/** Di chuyển thay đổi thứ tự ảnh trong một Menu (NHP hoặc NHT) */
export function reorderMenuGalleryItems(
  items: (string | GalleryItem)[],
  menuType: 'nhp' | 'nht',
  fromMenuIdx: number,
  toMenuIdx: number,
  skills?: Record<string, unknown> | Partial<EmployeeSkills> | any | null
): (string | GalleryItem)[] {
  const menuList =
    menuType === 'nhp'
      ? getNhpMenuGalleryItems(items, skills)
      : getNhtMenuGalleryItems(items);

  if (
    fromMenuIdx < 0 ||
    fromMenuIdx >= menuList.length ||
    toMenuIdx < 0 ||
    toMenuIdx >= menuList.length ||
    fromMenuIdx === toMenuIdx
  ) {
    return items;
  }

  const reorderedMenuList = [...menuList];
  const [moved] = reorderedMenuList.splice(fromMenuIdx, 1);
  reorderedMenuList.splice(toMenuIdx, 0, moved);

  const orderKey = menuType === 'nhp' ? 'orderNhp' : 'orderNht';
  const updatedOriginalItems = [...items];

  reorderedMenuList.forEach((wrapper, newIndex) => {
    const origIdx = wrapper.originalIndex;
    const existing = updatedOriginalItems[origIdx];
    const newOrderNum = newIndex + 1;

    if (typeof existing === 'string') {
      updatedOriginalItems[origIdx] = {
        url: existing,
        kind: 'legacy',
        order: newOrderNum,
        [orderKey]: newOrderNum,
      };
    } else if (existing && typeof existing === 'object') {
      updatedOriginalItems[origIdx] = {
        ...existing,
        order: newOrderNum,
        [orderKey]: newOrderNum,
      };
    }
  });

  return updatedOriginalItems;
}

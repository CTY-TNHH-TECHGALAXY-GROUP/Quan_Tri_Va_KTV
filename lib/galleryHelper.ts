import type { GalleryItem } from './types';
import { SKILL_KEYS } from './constants/staff.constants';

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
  | 'legacy'
  | `vip:${string}`;

export const isVipGalleryGroup = (value: string): value is `vip:${string}` =>
  value.startsWith('vip:') && SKILL_KEYS.includes(value.slice(4) as typeof SKILL_KEYS[number]);

export interface GalleryGroupConfig {
  id: GalleryGroupId;
  label: string;
}

export const GALLERY_GROUPS: GalleryGroupConfig[] = [
  { id: 'coconutOil', label: 'Tinh Dầu Dừa' },
  { id: 'thaiTherapy', label: 'Thái / Cổ Vai Gáy' },
  { id: 'shiatsu', label: 'Bấm Huyệt Shiatsu' },
  { id: 'hotStone', label: 'Đá Nóng' },
  { id: 'mix', label: 'Mix 2–4 phương pháp' },
  { id: 'legacy', label: 'Ảnh chung' },
];

export function createGalleryItem(url: string, groupId: GalleryGroupId): string | GalleryItem {
  const trimmed = url.trim();
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
      : typeof newItem !== 'string' && newItem.kind === 'vip' ? newItem.skillId : undefined;

  return currentUrls.some((item) => {
    const kind = typeof item === 'string' ? 'legacy' : item.kind;
    const therapyId =
      typeof item !== 'string' && item.kind === 'therapy'
        ? item.therapyId
        : typeof item !== 'string' && item.kind === 'vip' ? item.skillId : undefined;

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

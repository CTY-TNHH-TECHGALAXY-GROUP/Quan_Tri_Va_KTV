import type { GalleryItem } from './types';

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
      : undefined;

  return currentUrls.some((item) => {
    const kind = typeof item === 'string' ? 'legacy' : item.kind;
    const therapyId =
      typeof item !== 'string' && item.kind === 'therapy'
        ? item.therapyId
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

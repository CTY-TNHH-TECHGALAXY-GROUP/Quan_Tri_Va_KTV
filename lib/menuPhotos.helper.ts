export type MenuPhotoStaff = {
  gallery_urls?: unknown;
  galleryUrls?: unknown;
  avatar_url?: unknown;
  avatarUrl?: unknown;
  photoUrl?: unknown;
};

export function normalizePhotoList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        // String thuần → giữ nguyên
        if (typeof item === 'string') return item.trim();
        // Object có URL (từ gallery metadata) → bóc tách lấy URL
        if (item && typeof item === 'object' && typeof (item as any).url === 'string') {
          return (item as any).url.trim();
        }
        return '';
      })
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return normalizePhotoList(parsed);
      } catch {}
    }
    return [trimmed];
  }
  return [];
}

export function resolveNhtConfigPhotos(
  staffId: string,
  nhtMap: Record<string, unknown>,
  legacyMap: Record<string, unknown>,
): string[] {
  const nhtPhotos = normalizePhotoList(nhtMap[staffId]);
  return nhtPhotos.length > 0
    ? nhtPhotos
    : normalizePhotoList(legacyMap[staffId]);
}

export function resolveMenuPhotos({
  staff,
  configPhotos,
  menu,
}: {
  staff?: MenuPhotoStaff | null;
  configPhotos?: unknown;
  menu: 'nhp' | 'nht';
}): {
  primary: string | null;
  photos: string[];
} {
  const config = normalizePhotoList(configPhotos);
  const gallery = normalizePhotoList(staff?.gallery_urls ?? staff?.galleryUrls);
  const rawAvatar = staff?.avatar_url || staff?.avatarUrl || staff?.photoUrl;
  const avatar = typeof rawAvatar === 'string' && rawAvatar.trim() ? rawAvatar.trim() : null;

  const sourcePhotos = config.length > 0 ? config : gallery;

  if (menu === 'nhp') {
    if (avatar) {
      const rest = sourcePhotos.filter((url) => url !== avatar);
      return {
        primary: avatar,
        photos: [avatar, ...rest],
      };
    }
    return {
      primary: sourcePhotos[0] ?? null,
      photos: sourcePhotos,
    };
  }

  // menu === 'nht': gallery/config trước, chỉ fallback avatar khi gallery/config rỗng
  if (sourcePhotos.length > 0) {
    return {
      primary: avatar ?? (sourcePhotos[0] ?? null),
      photos: sourcePhotos,
    };
  }

  return {
    primary: avatar,
    photos: avatar ? [avatar] : [],
  };
}

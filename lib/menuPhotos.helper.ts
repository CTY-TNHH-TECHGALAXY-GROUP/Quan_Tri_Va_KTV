export function normalizePhotoList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean);
}

export function resolveMenuPhotos({
  staff,
  configPhotos,
  menu,
}: {
  staff: any;
  configPhotos?: unknown;
  menu: 'nhp' | 'nht';
}) {
  const config = normalizePhotoList(configPhotos);
  const gallery = normalizePhotoList(staff?.gallery_urls ?? staff?.galleryUrls);
  const rawAvatar = staff?.avatar_url || staff?.avatarUrl || staff?.photoUrl;
  const avatar = typeof rawAvatar === 'string' && rawAvatar.trim() ? [rawAvatar.trim()] : [];

  const sourcePhotos = config.length ? config : gallery.length ? gallery : avatar;
  const primary = avatar[0] ?? null;

  if (menu === 'nhp') {
    const photos = sourcePhotos.filter(url => url && url !== primary);
    return {
      primary,
      photos: primary ? [primary, ...photos] : photos,
    };
  }

  const photos = sourcePhotos.length > 0 ? sourcePhotos : primary ? [primary] : [];
  return {
    primary,
    photos,
  };
}

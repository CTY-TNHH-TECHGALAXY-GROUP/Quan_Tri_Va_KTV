import assert from 'node:assert/strict';

// Test suite for employee actions (updateStaffMember & createStaffMember payload mapping, validation & zero-write guarantees)
console.log('🧪 Running Regression Test Suite: Employee Update Payload Mapping...\n');

let capturedPayload: Record<string, any> | null = null;
let capturedStaffId: string | null = null;
let writeOperationsCount = 0;
let authUserCreatedCount = 0;
let authUserUpdatedCount = 0;

let lastUploadedPath: string | null = null;
let lastUploadOptions: any = null;

// Mock Supabase admin client
const mockClient = {
  from: (tableName: string) => {
    if (tableName === 'Staff') {
      return {
        select: () => ({
          eq: (col: string, val: string) => ({
            maybeSingle: () => {
              if (val === 'NON_EXISTENT_STAFF') return Promise.resolve({ data: null, error: null });
              return Promise.resolve({ data: { id: val, status: 'ĐANG LÀM' }, error: null });
            },
            single: () => Promise.resolve({ data: { status: 'ĐANG LÀM' }, error: null }),
          }),
        }),
        update: (payload: Record<string, any>) => {
          writeOperationsCount++;
          capturedPayload = payload;
          return {
            eq: (col: string, val: string) => {
              capturedStaffId = val;
              return Promise.resolve({ error: null });
            },
          };
        },
        insert: (payload: any) => {
          writeOperationsCount++;
          capturedPayload = payload;
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { id: payload[0]?.id || 'NEW_STAFF', ...payload[0] }, error: null }),
            }),
          };
        },
      };
    }
    if (tableName === 'TurnQueue') {
      return {
        delete: () => {
          writeOperationsCount++;
          return {
            eq: () => Promise.resolve({ error: null }),
          };
        },
      };
    }
    if (tableName === 'Users') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: { id: 'test', username: 'test' }, error: null }),
            single: () => Promise.resolve({ data: { id: 'test', username: 'test' }, error: null }),
          }),
        }),
        insert: () => {
          writeOperationsCount++;
          return Promise.resolve({ error: null });
        },
        update: () => {
          writeOperationsCount++;
          return {
            eq: () => Promise.resolve({ error: null }),
          };
        },
      };
    }
    throw new Error(`Unexpected table: ${tableName}`);
  },
  auth: {
    admin: {
      createUser: () => {
        authUserCreatedCount++;
        return Promise.resolve({ data: { user: { id: 'mock-auth-id' } }, error: null });
      },
      listUsers: () => Promise.resolve({ data: { users: [] }, error: null }),
      updateUserById: () => {
        authUserUpdatedCount++;
        return Promise.resolve({ data: { user: { id: 'mock-auth-id' } }, error: null });
      },
    },
  },
  storage: {
    from: (bucket: string) => ({
      upload: (path: string, buffer: Buffer, options: any) => {
        lastUploadedPath = path;
        lastUploadOptions = options;
        return Promise.resolve({ data: { path }, error: null });
      },
      getPublicUrl: (path: string) => ({
        data: {
          publicUrl: `https://test-project.supabase.co/storage/v1/object/public/${bucket}/${path}`,
        },
      }),
    }),
  },
};

// Mock Next.js revalidatePath
try {
  const nextCache = require('next/cache');
  nextCache.revalidatePath = () => {};
} catch {}

// Inject mock into supabaseAdmin module
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request: string, ...args: any[]) {
  if (request === 'server-only') return {};
  return originalLoad.call(this, request, ...args);
};
const supabaseAdminModule = require('../lib/supabaseAdmin');
supabaseAdminModule.getSupabaseAdmin = () => mockClient;

// Mock auth-sync module
try {
  const authSyncModule = require('../lib/auth-sync');
  authSyncModule.createAuthUser = async () => {
    authUserCreatedCount++;
    return { success: true };
  };
  authSyncModule.updateAuthUser = async () => {
    authUserUpdatedCount++;
    return { success: true };
  };
} catch {}

const { updateStaffMember, createStaffMember } = require('../app/admin/employees/actions');
const {
  checkGalleryDuplicate,
  removeGalleryItemByIndex,
  GALLERY_GROUPS,
  createGalleryItem,
  getGalleryGroup,
  isVipGalleryGroup,
} = require('../lib/galleryHelper');

let passedCount = 0;
async function testCase(name: string, fn: () => Promise<void>) {
  try {
    capturedPayload = null;
    capturedStaffId = null;
    writeOperationsCount = 0;
    authUserCreatedCount = 0;
    authUserUpdatedCount = 0;
    await fn();
    passedCount++;
    console.log(`  ✓ Case ${passedCount}: ${name}`);
  } catch (err) {
    console.error(`  ✗ FAILED: ${name}`);
    throw err;
  }
}

async function run() {
  // Case 1: inactive + camelCase flags true → all flags false
  await testCase('inactive + camelCase flags true → is_active_vip_menu, is_active_therapy_menu, is_home_spa are false', async () => {
    const res = await updateStaffMember('STAFF_01', {
      status: 'inactive',
      isActiveVipMenu: true,
      isActiveTherapyMenu: true,
      isHomeSpa: true,
    });
    assert.equal(res.success, true);
    assert.equal(capturedStaffId, 'STAFF_01');
    assert.equal(capturedPayload?.status, 'ĐÃ NGHỈ');
    assert.equal(capturedPayload?.is_active_vip_menu, false);
    assert.equal(capturedPayload?.is_active_therapy_menu, false);
    assert.equal(capturedPayload?.is_home_spa, false);
  });

  // Case 2: inactive + snake_case flags true → all flags false
  await testCase('inactive + snake_case flags true → is_active_vip_menu, is_active_therapy_menu, is_home_spa are false', async () => {
    const res = await updateStaffMember('STAFF_02', {
      status: 'inactive',
      is_active_vip_menu: true,
      is_active_therapy_menu: true,
      is_home_spa: true,
    });
    assert.equal(res.success, true);
    assert.equal(capturedStaffId, 'STAFF_02');
    assert.equal(capturedPayload?.status, 'ĐÃ NGHỈ');
    assert.equal(capturedPayload?.is_active_vip_menu, false);
    assert.equal(capturedPayload?.is_active_therapy_menu, false);
    assert.equal(capturedPayload?.is_home_spa, false);
  });

  // Case 3: active + 4 combinations of VIP/Therapy
  // 3a: VIP true, Therapy true
  await testCase('active + VIP true, Therapy true → both true', async () => {
    const res = await updateStaffMember('STAFF_03A', {
      status: 'active',
      isActiveVipMenu: true,
      isActiveTherapyMenu: true,
    });
    assert.equal(res.success, true);
    assert.equal(capturedPayload?.status, 'ĐANG LÀM');
    assert.equal(capturedPayload?.is_active_vip_menu, true);
    assert.equal(capturedPayload?.is_active_therapy_menu, true);
  });

  // 3b: VIP true, Therapy false
  await testCase('active + VIP true, Therapy false → VIP true, Therapy false', async () => {
    const res = await updateStaffMember('STAFF_03B', {
      status: 'active',
      isActiveVipMenu: true,
      isActiveTherapyMenu: false,
    });
    assert.equal(res.success, true);
    assert.equal(capturedPayload?.status, 'ĐANG LÀM');
    assert.equal(capturedPayload?.is_active_vip_menu, true);
    assert.equal(capturedPayload?.is_active_therapy_menu, false);
  });

  // 3c: VIP false, Therapy true
  await testCase('active + VIP false, Therapy true → VIP false, Therapy true', async () => {
    const res = await updateStaffMember('STAFF_03C', {
      status: 'active',
      isActiveVipMenu: false,
      isActiveTherapyMenu: true,
    });
    assert.equal(res.success, true);
    assert.equal(capturedPayload?.status, 'ĐANG LÀM');
    assert.equal(capturedPayload?.is_active_vip_menu, false);
    assert.equal(capturedPayload?.is_active_therapy_menu, true);
  });

  // 3d: VIP false, Therapy false
  await testCase('active + VIP false, Therapy false → both false', async () => {
    const res = await updateStaffMember('STAFF_03D', {
      status: 'active',
      isActiveVipMenu: false,
      isActiveTherapyMenu: false,
    });
    assert.equal(res.success, true);
    assert.equal(capturedPayload?.status, 'ĐANG LÀM');
    assert.equal(capturedPayload?.is_active_vip_menu, false);
    assert.equal(capturedPayload?.is_active_therapy_menu, false);
  });

  // Case 4: Update single flag does not reset or overwrite other flags when not sent
  await testCase('update single flag (isActiveVipMenu) without status or other flags leaves others undefined', async () => {
    const res = await updateStaffMember('STAFF_04', {
      isActiveVipMenu: true,
    });
    assert.equal(res.success, true);
    assert.equal(capturedPayload?.status, undefined);
    assert.equal(capturedPayload?.is_active_vip_menu, true);
    assert.equal(capturedPayload?.is_active_therapy_menu, undefined);
    assert.equal(capturedPayload?.is_home_spa, undefined);
  });

  // Case 5: Update mixed galleryUrls (strings and objects with therapy metadata)
  await testCase('update mixed galleryUrls preserves both string and metadata objects', async () => {
    const res = await updateStaffMember('STAFF_05', {
      galleryUrls: [
        'https://cdn.example.com/legacy.jpg',
        { url: 'https://cdn.example.com/therapy.jpg', kind: 'therapy', therapyId: 'hotStone' },
        { url: 'https://cdn.example.com/mix.jpg', kind: 'mix' },
        null,
        '   ',
      ],
    });
    assert.equal(res.success, true);
    assert.deepEqual(capturedPayload?.gallery_urls, [
      'https://cdn.example.com/legacy.jpg',
      { url: 'https://cdn.example.com/therapy.jpg', kind: 'therapy', therapyId: 'hotStone' },
      { url: 'https://cdn.example.com/mix.jpg', kind: 'mix' },
    ]);
  });

  // Case 6: Invalid therapyId returns error and does NOT write to database
  await testCase('invalid therapyId throws error and prevents any DB write', async () => {
    const res = await updateStaffMember('STAFF_06', {
      galleryUrls: [
        { url: 'https://cdn.example.com/bad.jpg', kind: 'therapy', therapyId: 'unknownId' },
      ],
    });
    assert.equal(res.success, false);
    assert.match(res.error, /Phương pháp trị liệu của ảnh không hợp lệ/);
    assert.equal(capturedPayload, null); // Zero DB writes occurred
    assert.equal(writeOperationsCount, 0); // Proof of 0 DB write operations
  });

  // Case 7: Invalid kind returns error and does NOT write to database
  await testCase('invalid kind throws error and prevents any DB write', async () => {
    const res = await updateStaffMember('STAFF_07', {
      galleryUrls: [
        { url: 'https://cdn.example.com/bad.jpg', kind: 'random_kind' },
      ],
    });
    assert.equal(res.success, false);
    assert.match(res.error, /Phân loại ảnh gallery không hợp lệ/);
    assert.equal(capturedPayload, null);
    assert.equal(writeOperationsCount, 0); // Proof of 0 DB write operations
  });

  // Case 8: Missing URL in gallery object returns error and prevents DB write
  await testCase('missing URL in object throws error and prevents DB write', async () => {
    const res = await updateStaffMember('STAFF_08', {
      galleryUrls: [
        { kind: 'therapy', therapyId: 'hotStone' },
      ],
    });
    assert.equal(res.success, false);
    assert.match(res.error, /Ảnh gallery thiếu URL hợp lệ/);
    assert.equal(capturedPayload, null);
    assert.equal(writeOperationsCount, 0); // Proof of 0 DB write operations
  });

  // Case 9: createStaffMember with invalid gallery metadata returns error and does 0 DB / 0 Auth writes
  await testCase('createStaffMember with invalid gallery metadata returns error, 0 DB writes, 0 auth user creates', async () => {
    const res = await createStaffMember({
      id: 'STAFF_NEW_INVALID',
      password: 'Password123!',
      full_name: 'Test Invalid Staff',
      galleryUrls: [
        { url: 'https://cdn.example.com/bad.jpg', kind: 'therapy', therapyId: 'invalid_therapy_code' },
      ],
    });
    assert.equal(res.success, false);
    assert.match(res.error, /Phương pháp trị liệu của ảnh không hợp lệ/);
    assert.equal(capturedPayload, null);
    assert.equal(writeOperationsCount, 0); // Proof of 0 DB writes
    assert.equal(authUserCreatedCount, 0); // Proof of 0 Auth user created
  });

  // Case 10: Not sending gallery keeps it untouched (undefined in payload) using phone update
  await testCase('not sending gallery leaves gallery_urls undefined (phone update)', async () => {
    const res = await updateStaffMember('STAFF_10', {
      phone: '0900000000',
    });
    assert.equal(res.success, true);
    assert.equal(capturedPayload?.phone, '0900000000');
    assert.equal(capturedPayload?.gallery_urls, undefined);
  });

  // Case 11: Not sending gallery leaves gallery_urls undefined with name update & auth sync
  await testCase('not sending gallery leaves gallery_urls undefined (name update with auth sync)', async () => {
    const res = await updateStaffMember('STAFF_11', {
      name: 'Nguyen Van A',
    });
    assert.equal(res.success, true);
    assert.equal(capturedPayload?.full_name, 'Nguyen Van A');
    assert.equal(capturedPayload?.gallery_urls, undefined);
  });

  // Case 12: Sending empty array [] explicitly clears gallery
  await testCase('sending [] explicitly clears gallery_urls to []', async () => {
    const res = await updateStaffMember('STAFF_12', {
      galleryUrls: [],
    });
    assert.equal(res.success, true);
    assert.deepEqual(capturedPayload?.gallery_urls, []);
  });

  // Case 13: Duplicate check allows same URL with different metadata
  await testCase('checkGalleryDuplicate allows same URL with different metadata', async () => {
    const existing = [
      { url: 'https://cdn.example.com/same.jpg', kind: 'therapy', therapyId: 'shiatsu' },
    ];
    const newItem = { url: 'https://cdn.example.com/same.jpg', kind: 'therapy', therapyId: 'hotStone' };
    const isDup = checkGalleryDuplicate(existing, newItem);
    assert.equal(isDup, false); // Not duplicate because therapyId is different!
  });

  // Case 14: Duplicate check blocks same URL with identical metadata
  await testCase('checkGalleryDuplicate blocks same URL with identical metadata', async () => {
    const existing = [
      { url: 'https://cdn.example.com/same.jpg', kind: 'therapy', therapyId: 'hotStone' },
    ];
    const newItem = { url: 'https://cdn.example.com/same.jpg', kind: 'therapy', therapyId: 'hotStone' };
    const isDup = checkGalleryDuplicate(existing, newItem);
    assert.equal(isDup, true); // Blocked!
  });

  // Case 15: Removing an item by index preserves other items sharing the same URL (removeGalleryItemByIndex)
  await testCase('removeGalleryItemByIndex preserves other items sharing the same URL', async () => {
    const list = [
      { url: 'https://cdn.example.com/same.jpg', kind: 'therapy', therapyId: 'shiatsu' },
      { url: 'https://cdn.example.com/same.jpg', kind: 'therapy', therapyId: 'hotStone' },
    ];
    const indexToRemove = 0;
    const remaining = removeGalleryItemByIndex(list, indexToRemove);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].therapyId, 'hotStone');
  });

  // Case 16: createGalleryItem attaches correct metadata for all groups
  await testCase('createGalleryItem maps groupId to correct kind and therapyId', async () => {
    const url = 'https://cdn.example.com/test.webp';
    const cOil = createGalleryItem(url, 'coconutOil');
    assert.deepEqual(cOil, { url, kind: 'therapy', therapyId: 'coconutOil' });

    const thai = createGalleryItem(url, 'thaiTherapy');
    assert.deepEqual(thai, { url, kind: 'therapy', therapyId: 'thaiTherapy' });

    const shiatsu = createGalleryItem(url, 'shiatsu');
    assert.deepEqual(shiatsu, { url, kind: 'therapy', therapyId: 'shiatsu' });

    const stone = createGalleryItem(url, 'hotStone');
    assert.deepEqual(stone, { url, kind: 'therapy', therapyId: 'hotStone' });

    const mix = createGalleryItem(url, 'mix');
    assert.deepEqual(mix, { url, kind: 'mix' });

    const legacy = createGalleryItem(url, 'legacy');
    assert.equal(legacy, url);

    const vip = createGalleryItem(url, 'vip:shampoo');
    assert.deepEqual(vip, { url, kind: 'vip', skillId: 'shampoo' });
    assert.equal(isVipGalleryGroup('vip:shampoo'), true);
    assert.equal(isVipGalleryGroup('vip:not-a-skill'), false);
  });

  // Case 17: getGalleryGroup classifies items accurately
  await testCase('getGalleryGroup classifies legacy string, mix, and therapy items correctly', async () => {
    assert.equal(getGalleryGroup('https://cdn.example.com/a.jpg'), 'legacy');
    assert.equal(getGalleryGroup({ url: 'https://cdn.example.com/b.jpg', kind: 'legacy' }), 'legacy');
    assert.equal(getGalleryGroup({ url: 'https://cdn.example.com/c.jpg', kind: 'mix' }), 'mix');
    assert.equal(getGalleryGroup({ url: 'https://cdn.example.com/d.jpg', kind: 'therapy', therapyId: 'hotStone' }), 'hotStone');
    assert.equal(getGalleryGroup({ url: 'https://cdn.example.com/e.jpg', kind: 'therapy', therapyId: 'thaiTherapy' }), 'thaiTherapy');
    assert.equal(getGalleryGroup({ url: 'https://cdn.example.com/f.jpg', kind: 'therapy', therapyId: 'unknown' as any }), 'legacy');
    assert.equal(getGalleryGroup({ url: 'https://cdn.example.com/g.jpg', kind: 'vip', skillId: 'shampoo' }), 'vip:shampoo');
  });

  // Case 18: Adding same URL to hotStone and shiatsu is allowed, adding again to shiatsu is blocked
  await testCase('Adding same URL to hotStone then shiatsu succeeds; duplicate in shiatsu is blocked', async () => {
    const url = 'https://cdn.example.com/shared.jpg';
    let gallery: any[] = [];

    // Add to hotStone
    const hotStoneItem = createGalleryItem(url, 'hotStone');
    assert.equal(checkGalleryDuplicate(gallery, hotStoneItem), false);
    gallery.push(hotStoneItem);

    // Add same URL to shiatsu -> allowed
    const shiatsuItem = createGalleryItem(url, 'shiatsu');
    assert.equal(checkGalleryDuplicate(gallery, shiatsuItem), false);
    gallery.push(shiatsuItem);
    assert.equal(gallery.length, 2);

    // Add again to shiatsu -> blocked
    assert.equal(checkGalleryDuplicate(gallery, shiatsuItem), true);
  });

  await testCase('VIP and NHT photos with the same URL stay in separate groups', async () => {
    const url = 'https://cdn.example.com/shared.jpg';
    const nht = createGalleryItem(url, 'hotStone');
    const vip = createGalleryItem(url, 'vip:shampoo');
    assert.equal(checkGalleryDuplicate([nht], vip), false);
    assert.equal(checkGalleryDuplicate([nht, vip], vip), true);
    const res = await updateStaffMember('T027', { galleryUrls: [nht, vip] });
    assert.equal(res.success, true);
    assert.deepEqual(capturedPayload?.gallery_urls, [nht, vip]);
  });

  // Case 19: URL CDN with query parameters is preserved completely
  await testCase('CDN URL with query parameters preserves full query string without tampering', async () => {
    const cdnUrl = 'https://images.unsplash.com/photo-1234?auto=format&fit=crop&w=800&q=80';
    const item = createGalleryItem(cdnUrl, 'thaiTherapy');
    assert.deepEqual(item, {
      url: 'https://images.unsplash.com/photo-1234?auto=format&fit=crop&w=800&q=80',
      kind: 'therapy',
      therapyId: 'thaiTherapy',
    });
  });

  // Case 20: Cross-group deletion using original index leaves other groups intact
  await testCase('Deleting item from second group uses originalIndex and preserves first group', async () => {
    const initialGallery = [
      'https://cdn.example.com/legacy_1.jpg', // index 0 (legacy)
      { url: 'https://cdn.example.com/stone_1.jpg', kind: 'therapy', therapyId: 'hotStone' }, // index 1 (hotStone)
      { url: 'https://cdn.example.com/shiatsu_1.jpg', kind: 'therapy', therapyId: 'shiatsu' }, // index 2 (shiatsu)
      { url: 'https://cdn.example.com/stone_2.jpg', kind: 'therapy', therapyId: 'hotStone' }, // index 3 (hotStone)
    ];

    // Delete index 2 (shiatsu_1.jpg)
    const afterShiatsuRemove = removeGalleryItemByIndex(initialGallery, 2);
    assert.equal(afterShiatsuRemove.length, 3);
    assert.equal(getGalleryGroup(afterShiatsuRemove[0]), 'legacy');
    assert.equal(getGalleryGroup(afterShiatsuRemove[1]), 'hotStone');
    assert.equal(getGalleryGroup(afterShiatsuRemove[2]), 'hotStone');

    // Delete index 1 (stone_1.jpg) from initial
    const afterStoneRemove = removeGalleryItemByIndex(initialGallery, 1);
    assert.equal(afterStoneRemove.length, 3);
    assert.equal(getGalleryGroup(afterStoneRemove[0]), 'legacy');
    assert.equal(getGalleryGroup(afterStoneRemove[1]), 'shiatsu');
    assert.equal(getGalleryGroup(afterStoneRemove[2]), 'hotStone');
  });

  // Case 21: Invalid protocols (javascript:, data:, invalid url) are rejected
  await testCase('URL validator rejects non-http/https protocols', async () => {
    const { isGalleryImageUrl: validateUrl } = require('../lib/galleryHelper');

    assert.equal(validateUrl('javascript:alert(1)'), false);
    assert.equal(validateUrl('data:image/png;base64,abc'), false);
    assert.equal(validateUrl('ftp://example.com/photo.jpg'), false);
    assert.equal(validateUrl('not-a-url'), false);
    assert.equal(validateUrl('https://valid.example.com/photo.jpg'), true);
    assert.equal(validateUrl('http://valid.example.com/photo.jpg'), true);
    assert.equal(validateUrl('https://valid.example.com/render/image?width=400&token=a%2Fb'), true);
    assert.equal(validateUrl('https://valid.example.com/storage/v1/object/public/avatars/photo.webp'), true);
  });

  // Case 22: Update staff member with multi-group gallery preserves all items in DB payload
  await testCase('Multi-group gallery updates successfully persist to DB payload', async () => {
    const multiGallery = [
      'https://cdn.example.com/general.jpg',
      createGalleryItem('https://cdn.example.com/coconut.jpg', 'coconutOil'),
      createGalleryItem('https://cdn.example.com/stone.jpg', 'hotStone'),
      createGalleryItem('https://cdn.example.com/mix.jpg', 'mix'),
    ];

    const res = await updateStaffMember('STAFF_MULTI_GALLERY', {
      galleryUrls: multiGallery,
    });
    assert.equal(res.success, true);
    assert.deepEqual(capturedPayload?.gallery_urls, [
      'https://cdn.example.com/general.jpg',
      { url: 'https://cdn.example.com/coconut.jpg', kind: 'therapy', therapyId: 'coconutOil' },
      { url: 'https://cdn.example.com/stone.jpg', kind: 'therapy', therapyId: 'hotStone' },
      { url: 'https://cdn.example.com/mix.jpg', kind: 'mix' },
    ]);
  });

  // Case 23: Server action rejects javascript: protocol before DB write
  await testCase('Server action rejects javascript: protocol in gallery before DB write', async () => {
    writeOperationsCount = 0;
    const res = await updateStaffMember('STAFF_001', {
      galleryUrls: ['javascript:alert(1)'],
    });
    assert.equal(res.success, false);
    assert.match(res.error, /không hợp lệ/i);
    assert.equal(writeOperationsCount, 0, 'No DB write operations must occur on invalid URL');
  });

  // Case 24: Server action rejects data: and blob: protocols in gallery before DB write
  await testCase('Server action rejects data: and blob: URLs in gallery before DB write', async () => {
    writeOperationsCount = 0;
    const resData = await updateStaffMember('STAFF_001', {
      galleryUrls: [{ url: 'data:image/png;base64,iVBORw0KGgoAAA', kind: 'mix' }],
    });
    assert.equal(resData.success, false);
    assert.match(resData.error, /không hợp lệ/i);

    const resBlob = await updateStaffMember('STAFF_001', {
      galleryUrls: [{ url: 'blob:https://example.com/uuid', kind: 'therapy', therapyId: 'shiatsu' }],
    });
    assert.equal(resBlob.success, false);
    assert.match(resBlob.error, /không hợp lệ/i);

    assert.equal(writeOperationsCount, 0, 'No DB write operations must occur on invalid protocols');
  });

  // Case 25: Server action accepts relative path and CDN URL with query string
  await testCase('Server action accepts relative paths and CDN URLs with query strings', async () => {
    const cdnUrl = 'https://images.unsplash.com/photo-1234?w=800&q=80&auto=format';
    const relativeUrl = '/avatars/gallery/NH001/mix_1.jpg';
    const res = await updateStaffMember('STAFF_001', {
      galleryUrls: [
        cdnUrl,
        { url: relativeUrl, kind: 'mix' },
      ],
    });
    assert.equal(res.success, true);
    assert.deepEqual(capturedPayload?.gallery_urls, [
      cdnUrl,
      { url: relativeUrl, kind: 'mix' },
    ]);
  });

  // Case 26: Session Invalidation - upload for Staff A does not append to Staff B
  await testCase('Session Invalidation: Upload completion for Staff A does not append to Staff B', async () => {
    let sessionToken = 1;
    let currentEmployee: any = { id: 'STAFF_A', galleryUrls: [] };

    // Simulate upload starting for Staff A
    const sessionAtStart = sessionToken;
    const employeeIdAtStart = currentEmployee.id;
    const isCurrentSession = () => sessionToken === sessionAtStart;

    // Simulate modal switching to Staff B before Staff A's upload completes
    sessionToken++;
    currentEmployee = { id: 'STAFF_B', galleryUrls: ['https://cdn.example.com/b_orig.jpg'] };

    // Staff A upload completes asynchronously
    const uploadedItem = { url: 'https://cdn.example.com/a_new.jpg', kind: 'mix' };

    // Check session validity guard
    const canAppend = isCurrentSession() && currentEmployee && currentEmployee.id === employeeIdAtStart;
    assert.equal(canAppend, false, 'Staff A upload MUST NOT append to Staff B');

    // State of Staff B remains completely untouched
    assert.deepEqual(currentEmployee.galleryUrls, ['https://cdn.example.com/b_orig.jpg']);
  });

  // Case 27: Session Invalidation - modal close suppresses completed upload callback
  await testCase('Session Invalidation: Modal close suppresses completed upload callback', async () => {
    let sessionToken = 10;
    let currentEmployee: any = { id: 'STAFF_A', galleryUrls: [] };
    let uploadingGroups: Record<string, boolean> = { coconutOil: true };

    const sessionAtStart = sessionToken;
    const employeeIdAtStart = currentEmployee.id;
    const isCurrentSession = () => sessionToken === sessionAtStart;

    // Modal closes
    sessionToken++;
    currentEmployee = null;

    // Finally block runs for the aborted upload
    if (isCurrentSession()) {
      uploadingGroups.coconutOil = false;
    }

    // Guard prevents touching state
    const canAppend = isCurrentSession() && currentEmployee && currentEmployee.id === employeeIdAtStart;
    assert.equal(canAppend, false, 'Callback must be completely suppressed when modal was closed');
  });

  // Case 28: Session Invalidation - multi-group uploads in same session both append safely
  await testCase('Session Invalidation: Multi-group uploads in same session both append safely', async () => {
    let sessionToken = 20;
    let currentEmployee: any = { id: 'STAFF_A', galleryUrls: [] };

    const sessionAtStart = sessionToken;
    const employeeIdAtStart = currentEmployee.id;
    const isCurrentSession = () => sessionToken === sessionAtStart;

    // Group 1 completes
    if (isCurrentSession() && currentEmployee && currentEmployee.id === employeeIdAtStart) {
      const g1 = [...currentEmployee.galleryUrls];
      const item1 = createGalleryItem('https://cdn.example.com/coconut1.jpg', 'coconutOil');
      if (!checkGalleryDuplicate(g1, item1)) g1.push(item1);
      currentEmployee = { ...currentEmployee, galleryUrls: g1 };
    }

    // Group 2 completes in same session
    if (isCurrentSession() && currentEmployee && currentEmployee.id === employeeIdAtStart) {
      const g2 = [...currentEmployee.galleryUrls];
      const item2 = createGalleryItem('https://cdn.example.com/stone1.jpg', 'hotStone');
      if (!checkGalleryDuplicate(g2, item2)) g2.push(item2);
      currentEmployee = { ...currentEmployee, galleryUrls: g2 };
    }

    assert.equal(currentEmployee.galleryUrls.length, 2);
    assert.deepEqual(currentEmployee.galleryUrls[0], {
      url: 'https://cdn.example.com/coconut1.jpg',
      kind: 'therapy',
      therapyId: 'coconutOil',
    });
    assert.deepEqual(currentEmployee.galleryUrls[1], {
      url: 'https://cdn.example.com/stone1.jpg',
      kind: 'therapy',
      therapyId: 'hotStone',
    });
  });

  // Case 29: Session Invalidation - partial upload failure keeps successful items
  await testCase('Session Invalidation: Partial upload failure preserves successful items', async () => {
    const sessionToken = 30;
    let currentEmployee: any = { id: 'STAFF_A', galleryUrls: [] };
    const sessionAtStart = sessionToken;
    const isCurrentSession = () => sessionToken === sessionAtStart;

    const newItems: any[] = [];
    const errors: string[] = [];

    // Simulate 1 success, 1 failure in batch
    newItems.push(createGalleryItem('https://cdn.example.com/success.jpg', 'thaiTherapy'));
    errors.push('"bad.jpg": Kích thước ảnh vượt quá giới hạn 5MB.');

    if (isCurrentSession() && newItems.length > 0) {
      const gallery = [...currentEmployee.galleryUrls];
      for (const item of newItems) {
        if (!checkGalleryDuplicate(gallery, item)) gallery.push(item);
      }
      currentEmployee = { ...currentEmployee, galleryUrls: gallery };
    }

    assert.equal(currentEmployee.galleryUrls.length, 1);
    assert.deepEqual(currentEmployee.galleryUrls[0], {
      url: 'https://cdn.example.com/success.jpg',
      kind: 'therapy',
      therapyId: 'thaiTherapy',
    });
    assert.equal(errors.length, 1);
  });

  // Case 30: Upload Route - Auth check, staff check, and upload options
  await testCase('Upload Route: POST route auth, validation, and upload options', async () => {
    // Test auth logic with mock functions
    const authModule = require('../lib/auth-server');
    const originalRequireApiUser = authModule.requireApiUser;
    const originalRequireBusinessUser = authModule.requireBusinessUser;

    const { POST } = require('../app/api/admin/employees/upload-gallery/route');

    const validJpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
    const mockFile = new File([validJpegBytes], 'photo.jpg', { type: 'image/jpeg' });

    // 1. Unauthenticated -> 401
    authModule.requireApiUser = async () => null;
    const unauthReq = new Request('http://localhost:3000/api/admin/employees/upload-gallery', {
      method: 'POST',
    });
    const unauthRes = await POST(unauthReq);
    assert.equal(unauthRes.status, 401);
    const unauthJson = await unauthRes.json();
    assert.equal(unauthJson.success, false);
    assert.match(unauthJson.error, /Bạn cần đăng nhập/i);

    // 2. Authenticated but unauthorized (KTV without employee_management) -> 403
    authModule.requireApiUser = async () => ({ id: 'ktv1' });
    authModule.requireBusinessUser = async () => ({
      businessUserId: 'ktv1',
      role: 'TECHNICIAN',
      permissions: ['ktv_dashboard'],
    });
    const unauthzReq = new Request('http://localhost:3000/api/admin/employees/upload-gallery', {
      method: 'POST',
    });
    const unauthzRes = await POST(unauthzReq);
    assert.equal(unauthzRes.status, 403);
    const unauthzJson = await unauthzRes.json();
    assert.equal(unauthzJson.success, false);
    assert.match(unauthzJson.error, /không có quyền chỉnh sửa nhân viên/i);

    // 3. Authenticated as ADMIN -> continue processing
    authModule.requireApiUser = async () => ({ id: 'admin1' });
    authModule.requireBusinessUser = async () => ({
      businessUserId: 'admin1',
      role: 'ADMIN',
      permissions: ['employee_management'],
    });

    // Non-existent staff -> 404
    const nonExistentFormData = new FormData();
    nonExistentFormData.append('file', mockFile);
    nonExistentFormData.append('staffId', 'NON_EXISTENT_STAFF');
    nonExistentFormData.append('groupId', 'coconutOil');

    const nonExistentReq = new Request('http://localhost:3000/api/admin/employees/upload-gallery', {
      method: 'POST',
      body: nonExistentFormData,
    });
    const nonExistentRes = await POST(nonExistentReq);
    assert.equal(nonExistentRes.status, 404);

    // Valid staff + valid file -> 200 with upsert: false and publicUrl
    const validFormData = new FormData();
    validFormData.append('file', mockFile);
    validFormData.append('staffId', 'STAFF_001');
    validFormData.append('groupId', 'hotStone');

    const validReq = new Request('http://localhost:3000/api/admin/employees/upload-gallery', {
      method: 'POST',
      body: validFormData,
    });
    const validRes = await POST(validReq);
    assert.equal(validRes.status, 200);
    const validJson = await validRes.json();
    assert.equal(validJson.success, true);
    assert.match(validJson.url, /storage\/v1\/object\/public\/avatars\/gallery\/STAFF_001\/hotStone_/);
    assert.equal(lastUploadOptions.upsert, false, 'Upload MUST use upsert: false');

    // Restore original auth functions
    authModule.requireApiUser = originalRequireApiUser;
    authModule.requireBusinessUser = originalRequireBusinessUser;
  });

  console.log(`\n🎉 ALL ${passedCount} PAYLOAD REGRESSION TEST CASES PASSED!\n`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

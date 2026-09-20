import assert from 'node:assert/strict';

// Test suite for employee actions (updateStaffMember & createStaffMember payload mapping, validation & zero-write guarantees)
console.log('🧪 Running Regression Test Suite: Employee Update Payload Mapping...\n');

let capturedPayload: Record<string, any> | null = null;
let capturedStaffId: string | null = null;
let writeOperationsCount = 0;
let authUserCreatedCount = 0;
let authUserUpdatedCount = 0;

// Mock Supabase admin client
const mockClient = {
  from: (tableName: string) => {
    if (tableName === 'Staff') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: { status: 'ĐANG LÀM' }, error: null }),
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
};

// Mock Next.js revalidatePath
try {
  const nextCache = require('next/cache');
  nextCache.revalidatePath = () => {};
} catch {}

// Inject mock into supabaseAdmin module
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
const { checkGalleryDuplicate, removeGalleryItemByIndex } = require('../lib/galleryHelper');

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

  console.log(`\n🎉 ALL ${passedCount} PAYLOAD REGRESSION TEST CASES PASSED!\n`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

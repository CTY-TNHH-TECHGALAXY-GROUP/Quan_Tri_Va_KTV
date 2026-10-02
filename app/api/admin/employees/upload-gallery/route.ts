import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requireApiUser, requireBusinessUser } from '@/lib/auth-server';
import { GALLERY_GROUPS, isVipGalleryGroup } from '@/lib/galleryHelper';
import { v4 as uuidv4 } from 'uuid';

export const dynamic = 'force-dynamic';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

function checkImageMagicBytes(buffer: Buffer, mime: string): boolean {
  if (buffer.length < 12) return false;
  if (mime === 'image/jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mime === 'image/png') {
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    );
  }
  if (mime === 'image/webp') {
    return (
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP'
    );
  }
  return false;
}

async function checkStaffEditAuth(): Promise<
  | { authorized: true; userId: string; role: string }
  | { authorized: false; status: 401 | 403; error: string }
> {
  try {
    const apiUser = await requireApiUser();
    if (!apiUser) {
      return { authorized: false, status: 401, error: 'Bạn cần đăng nhập.' };
    }

    const bUser = await requireBusinessUser();
    if (!bUser) {
      return { authorized: false, status: 401, error: 'Bạn cần đăng nhập.' };
    }

    const role = typeof bUser.role === 'string' ? bUser.role.toUpperCase() : '';
    const isPrivileged =
      role === 'ADMIN' ||
      role === 'DEV' ||
      role === 'MANAGER' ||
      role === 'BRANCH_MANAGER';

    const hasPermission =
      isPrivileged ||
      (Array.isArray(bUser.permissions) &&
        bUser.permissions.includes('employee_management'));

    if (!hasPermission) {
      return {
        authorized: false,
        status: 403,
        error: 'Bạn không có quyền chỉnh sửa nhân viên.',
      };
    }

    return {
      authorized: true,
      userId: bUser.businessUserId || bUser.techCode || apiUser.id,
      role,
    };
  } catch (err: any) {
    if (err?.message === 'ACCOUNT_LOCKED') {
      return {
        authorized: false,
        status: 403,
        error: 'Tài khoản của bạn đã bị khóa.',
      };
    }
    return { authorized: false, status: 401, error: 'Bạn cần đăng nhập.' };
  }
}

export async function POST(request: Request) {
  try {
    // 1. Xác thực và kiểm tra quyền trước formData() và trước getSupabaseAdmin()
    const auth = await checkStaffEditAuth();
    if (!auth.authorized) {
      return NextResponse.json(
        { success: false, error: auth.error },
        { status: auth.status }
      );
    }

    // 2. Parse form data
    const formData = await request.formData();
    const file = formData.get('file');
    const staffId = formData.get('staffId');
    const groupId = formData.get('groupId');

    if (
      !(file instanceof File) ||
      typeof staffId !== 'string' ||
      !staffId.trim() ||
      typeof groupId !== 'string' ||
      !(GALLERY_GROUPS.some((group) => group.id === groupId) || isVipGalleryGroup(groupId))
    ) {
      return NextResponse.json(
        { success: false, error: 'Dữ liệu tải ảnh không hợp lệ.' },
        { status: 400 }
      );
    }

    // 3. File validation: empty file, MIME, size
    if (file.size === 0) {
      return NextResponse.json(
        { success: false, error: 'File ảnh không được rỗng.' },
        { status: 400 }
      );
    }

    if (!ALLOWED_MIME_TYPES.has(file.type) || !EXTENSIONS[file.type]) {
      return NextResponse.json(
        {
          success: false,
          error: 'Định dạng ảnh không hỗ trợ. Vui lòng chọn ảnh JPEG, PNG hoặc WebP.',
        },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { success: false, error: 'Kích thước ảnh vượt quá giới hạn 5MB.' },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // 4. Magic bytes validation
    if (!checkImageMagicBytes(buffer, file.type)) {
      return NextResponse.json(
        { success: false, error: 'Nội dung file không đúng định dạng ảnh hợp lệ.' },
        { status: 400 }
      );
    }

    // 5. Khởi tạo Supabase client
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: 'Lỗi khởi tạo hệ thống (Supabase).' },
        { status: 500 }
      );
    }

    // 6. Kiểm tra nhân viên tồn tại trong hệ thống
    const cleanStaffId = staffId.trim();
    const { data: staff, error: staffError } = await supabase
      .from('Staff')
      .select('id')
      .eq('id', cleanStaffId)
      .maybeSingle();

    if (staffError || !staff) {
      return NextResponse.json(
        { success: false, error: 'Nhân viên không tồn tại trong hệ thống.' },
        { status: 404 }
      );
    }

    // 7. Tạo tên file an toàn và upload lên bucket 'avatars'
    const fileExt = EXTENSIONS[file.type];
    const sanitizedStaffId = cleanStaffId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const sanitizedGroupId = groupId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `gallery/${sanitizedStaffId}/${sanitizedGroupId}_${Date.now()}_${uuidv4().substring(0, 8)}.${fileExt}`;

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(fileName, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error('❌ [Upload Gallery] Lỗi upload ảnh lên storage:', uploadError.message);
      return NextResponse.json(
        { success: false, error: 'Lỗi tải ảnh lên server lưu trữ.' },
        { status: 500 }
      );
    }

    if (!uploadData?.path) {
      return NextResponse.json(
        { success: false, error: 'Không lấy được đường dẫn ảnh sau khi tải.' },
        { status: 500 }
      );
    }

    const { data: publicUrlData } = supabase.storage
      .from('avatars')
      .getPublicUrl(uploadData.path);

    return NextResponse.json({
      success: true,
      url: publicUrlData.publicUrl,
    });
  } catch (error: any) {
    console.error('❌ API Error (Upload Gallery):', error?.message || error);
    return NextResponse.json(
      { success: false, error: 'Lỗi hệ thống khi tải ảnh.' },
      { status: 500 }
    );
  }
}

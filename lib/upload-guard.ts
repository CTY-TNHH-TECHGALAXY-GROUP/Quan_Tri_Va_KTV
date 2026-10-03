/**
 * Kiểm tra file ảnh tải lên từ form — dùng chung cho các route upload.
 *
 * Bucket `avatars`, `task-photos` là bucket public: nếu nhận SVG/HTML rồi trả
 * public URL thì file đó chạy được script trong trình duyệt (stored XSS).
 * Vì vậy: chỉ nhận JPEG/PNG/WebP, kiểm cả magic bytes (không tin `file.type`
 * do client gửi), giới hạn dung lượng, và đuôi file lấy từ MIME chứ không
 * lấy từ `file.name`.
 *
 * Logic sao từ app/api/admin/employees/upload-avatar/route.ts (đã chạy ổn).
 */

// 🔧 CONFIG
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB

const IMAGE_EXTENSIONS: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
};

export type ImageUploadCheck =
    | { ok: true; buffer: Buffer; mime: string; ext: string }
    | { ok: false; error: string; status: 400 };

function checkImageMagicBytes(buffer: Buffer, mime: string): boolean {
    if (buffer.length < 12) return false;
    if (mime === 'image/jpeg') {
        return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    }
    if (mime === 'image/png') {
        return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
    }
    if (mime === 'image/webp') {
        return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
    }
    return false;
}

export async function validateImageUpload(file: unknown): Promise<ImageUploadCheck> {
    if (!(file instanceof File) || file.size === 0) {
        return { ok: false, status: 400, error: 'File ảnh không hợp lệ hoặc rỗng.' };
    }
    const ext = IMAGE_EXTENSIONS[file.type];
    if (!ext) {
        return { ok: false, status: 400, error: 'Định dạng ảnh không hỗ trợ. Vui lòng chọn ảnh JPEG, PNG hoặc WebP.' };
    }
    if (file.size > MAX_IMAGE_SIZE) {
        return { ok: false, status: 400, error: 'Kích thước ảnh vượt quá giới hạn 5MB.' };
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    if (!checkImageMagicBytes(buffer, file.type)) {
        return { ok: false, status: 400, error: 'Nội dung file không đúng định dạng ảnh hợp lệ.' };
    }
    return { ok: true, buffer, mime: file.type, ext };
}

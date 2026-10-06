import { getSupabaseAdmin } from './supabaseAdmin';

/**
 * Cấu hình Email xác nhận đặt lịch.
 *
 * Toàn bộ các giá trị dưới đây được lưu trong bảng `SystemConfigs` và chỉnh sửa
 * tại /admin/settings/system (card "Cấu hình Email").
 *
 * ⚠️ Thông tin đăng nhập SMTP (host/user/pass) KHÔNG nằm ở đây — chúng vẫn được
 * đọc từ biến môi trường để tránh lưu mật khẩu trong DB.
 */
export interface EmailConfig {
    /**
     * BẬT/TẮT toàn bộ việc gửi email xác nhận cho khách.
     * Dùng chung key với công tắc ở /admin/settings/features để tránh 2 nguồn sự thật.
     */
    enable_web_advance_booking_email: boolean;

    // --- Thương hiệu ---
    email_brand_name: string;
    email_logo_url: string;
    email_website_url: string;
    email_hotline: string;
    /** Tên chi nhánh — dùng làm dự phòng cho dòng "Địa chỉ" khi chưa nhập địa chỉ */
    email_branch_name: string;
    /** Địa chỉ spa hiển thị ở dòng "Địa chỉ" trong bảng chi tiết lịch hẹn */
    email_branch_address: string;
    /** Link để khách tự xem/đổi lịch. Bỏ trống = chỉ mời khách phản hồi email. */
    email_manage_booking_url: string;
    /** Số phút spa giữ chỗ sau giờ hẹn trước khi coi là khách không đến */
    email_grace_minutes: number;
    /** Tên pháp nhân hiện ở chân thư (© <năm> <tên> • ALL RIGHTS RESERVED) */
    email_company_name: string;

    // --- Nội dung ---
    /** Khách vui lòng đến trước N phút */
    email_arrive_early_mins: number;
    /** Báo đổi/hủy lịch trước N giờ */
    email_cancel_notice_hours: number;
    /** Thời hạn chuyển cọc (giờ) */
    email_deposit_deadline_hours: number;

    // --- Tài khoản nhận cọc (VietQR) ---
    email_bank_bin: string;
    email_bank_account_no: string;
    email_bank_account_name: string;

    // --- E-Voucher Web Booking Guidance (5 thứ tiếng) ---
    voucher_webbooking_instruction_vi: string;
    voucher_webbooking_instruction_en: string;
    voucher_webbooking_instruction_cn: string;
    voucher_webbooking_instruction_jp: string;
    voucher_webbooking_instruction_kr: string;
}

export const EMAIL_CONFIG_DEFAULTS: EmailConfig = {
    enable_web_advance_booking_email: false,

    email_brand_name: 'ORIA SPA',
    email_logo_url: 'https://oria-spa.vercel.app/images/oria-logo-email.png', // Bỏ trống = hiện tên thương hiệu dạng chữ
    email_website_url: 'https://oria-spa.vercel.app',
    email_hotline: '+84 964 090 277',
    email_branch_name: 'ORIA SPA',
    email_branch_address: '11 Ngô Đức Kế, P. Sài Gòn, TP. Hồ Chí Minh, Việt Nam',
    email_manage_booking_url: '', // Chưa có trang cho khách tự đổi lịch
    email_grace_minutes: 5,
    email_company_name: 'TECHGALAXY GROUP',

    email_arrive_early_mins: 10,
    email_cancel_notice_hours: 24,
    email_deposit_deadline_hours: 2,

    email_bank_bin: '970422', // MB Bank
    email_bank_account_no: '8600289999',
    email_bank_account_name: 'CTY TNHH TECHGALAXY GROUP',

    voucher_webbooking_instruction_vi: 'Vui lòng đặt lịch qua website để áp dụng voucher này.',
    voucher_webbooking_instruction_en: 'Please book through our website to apply this voucher.',
    voucher_webbooking_instruction_cn: '请通过我们的网站预约以使用此优惠券。',
    voucher_webbooking_instruction_jp: '当クーポンをご利用の際は、ウェブサイトよりご予約ください。',
    voucher_webbooking_instruction_kr: '이 바우처를 사용하시려면 웹사이트를 통해 예약해 주세요.',
};

export const EMAIL_CONFIG_KEYS = Object.keys(EMAIL_CONFIG_DEFAULTS) as (keyof EmailConfig)[];

/** Ép kiểu giá trị lấy từ DB về đúng kiểu của default tương ứng. */
function coerce<K extends keyof EmailConfig>(key: K, raw: any): EmailConfig[K] {
    const fallback = EMAIL_CONFIG_DEFAULTS[key];

    if (raw === undefined || raw === null || raw === '') return fallback;

    if (typeof fallback === 'boolean') {
        return (raw === true || raw === 'true') as EmailConfig[K];
    }
    if (typeof fallback === 'number') {
        const n = Number(raw);
        return (Number.isFinite(n) ? n : fallback) as EmailConfig[K];
    }
    return String(raw) as EmailConfig[K];
}

/**
 * Đọc cấu hình Email từ SystemConfigs, tự merge với giá trị mặc định.
 * Nếu DB lỗi / chưa có key nào thì trả về defaults để email vẫn gửi được.
 */
export async function getEmailConfig(): Promise<EmailConfig> {
    const config = { ...EMAIL_CONFIG_DEFAULTS };

    try {
        const supabase = getSupabaseAdmin();
        if (!supabase) return config;

        const { data, error } = await supabase
            .from('SystemConfigs')
            .select('key, value')
            .in('key', EMAIL_CONFIG_KEYS as string[]);

        if (error) throw error;

        data?.forEach(row => {
            const key = row.key as keyof EmailConfig;
            if (key in config) {
                (config as any)[key] = coerce(key, row.value);
            }
        });
    } catch (e) {
        console.error('[EmailConfig] Không đọc được cấu hình, dùng mặc định:', e);
    }

    return config;
}

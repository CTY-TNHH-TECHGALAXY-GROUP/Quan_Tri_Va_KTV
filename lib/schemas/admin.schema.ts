import { z } from 'zod';

// PATCH /api/admin/settings/system
export const SystemSettingsSchema = z.record(
  z.string(), 
  z.any()
);

// POST /api/admin/settings/system/advanced
export const AdvancedSettingPostSchema = z.object({
  key: z.string().min(1, "Key is required"),
  value: z.any(),
  description: z.string().optional().nullable()
});

// PATCH /api/admin/settings/system/advanced
export const AdvancedSettingPatchSchema = z.object({
  id: z.number().int().positive("ID is required"),
  key: z.string().optional(),
  value: z.any().optional(),
  description: z.string().optional().nullable()
});

// PATCH /api/admin/staff-features
export const StaffFeaturePatchSchema = z.object({
  staffId: z.string().optional(),
  staffIds: z.array(z.string()).optional(),
  flagKey: z.string().min(1, "Missing flagKey"),
  value: z.boolean({ message: "Missing value, must be boolean" })
}).refine(data => data.staffId || (data.staffIds && data.staffIds.length > 0), {
  message: "Missing staffId or staffIds",
  path: ["staffIds"]
});

// POST /api/admin/update-wifi-ip
export const WifiIpPostSchema = z.object({
  action: z.enum(['overwrite', 'append', 'remove', 'append_rejected']),
  ipToRemove: z.string().optional(),
  rejectedIp: z.string().optional()
});

// PATCH /api/admin/notification-rules
export const NotificationRulesPatchSchema = z.object({
  rules: z.record(z.string(), z.any(), { message: "Missing or invalid rules object" })
});

// PATCH /api/admin/settings/email
export const EmailSettingsSchema = z.object({
  enable_web_advance_booking_email: z.boolean().optional(),
  email_brand_name: z.string().min(1, "Tên thương hiệu không được để trống").optional(),
  email_logo_url: z.string().url("Link logo không hợp lệ").optional().or(z.literal('')),
  email_website_url: z.string().url("Link website không hợp lệ").optional().or(z.literal('')),
  email_hotline: z.string().optional(),
  email_branch_name: z.string().optional(),
  email_arrive_early_mins: z.number().int().min(0).max(180).optional(),
  email_cancel_notice_hours: z.number().int().min(0).max(168).optional(),
  email_deposit_deadline_hours: z.number().int().min(1).max(168).optional(),
  email_bank_bin: z.string().regex(/^\d{6}$/, "Mã BIN ngân hàng phải gồm 6 chữ số").optional(),
  email_bank_account_no: z.string().regex(/^\d{6,20}$/, "Số tài khoản chỉ gồm 6-20 chữ số").optional(),
  email_bank_account_name: z.string().optional(),
});

// POST /api/admin/settings/email/test
export const EmailTestSchema = z.object({
  to: z.string().email("Email nhận không hợp lệ"),
  lang: z.enum(['vi', 'en', 'kr', 'jp', 'cn']).optional(),
  newCustomer: z.boolean().optional(),
});

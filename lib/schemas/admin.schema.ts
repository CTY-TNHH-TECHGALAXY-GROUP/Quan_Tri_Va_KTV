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
  rules: z.record(z.string(), z.any(), { required_error: "Missing or invalid rules object" })
});

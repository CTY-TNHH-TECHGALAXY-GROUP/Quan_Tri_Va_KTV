import { z } from 'zod';

// POST /api/notifications/push
export const PushNotificationSchema = z.object({
  title: z.string().optional(),
  message: z.string().optional(),
  url: z.string().optional(),
  targetStaffIds: z.array(z.string()).optional(),
  targetRoles: z.array(z.string()).optional()
});

// POST /api/notifications/trigger-webhook
export const WebhookRecordSchema = z.object({
  id: z.any().optional(),
  type: z.string().min(1, "Invalid payload record"),
  message: z.string().min(1, "Invalid payload record"),
  employeeId: z.string().optional().nullable()
}).passthrough();

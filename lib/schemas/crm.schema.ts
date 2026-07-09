import { z } from 'zod';

// PATCH /api/rooms
export const RoomPatchSchema = z.object({
  roomId: z.number().int().positive("roomId is required"),
  prep_procedure: z.array(z.string()).optional().nullable(),
  clean_procedure: z.array(z.string()).optional().nullable(),
  allowed_services: z.array(z.string()).optional().nullable(),
  default_reminders: z.array(z.number()).optional().nullable()
});

// PATCH /api/customers
export const CustomerPatchSchema = z.object({
  id: z.string().min(1, "Thiếu ID khách hàng"),
  notes: z.string().optional().nullable(),
  gender: z.enum(['male', 'female', '']).optional().nullable()
});

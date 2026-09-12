import { z } from 'zod';

// PATCH /api/rooms
export const RoomPatchSchema = z.object({
  roomId: z.string().or(z.number()),
  prep_procedure: z.array(z.string()).optional().nullable(),
  clean_procedure: z.array(z.string()).optional().nullable(),
  handover_checklist: z.array(z.string()).optional().nullable(),
  allowed_services: z.array(z.string()).optional().nullable(),
  default_reminders: z.array(z.string().or(z.number())).optional().nullable(),
  has_guests: z.boolean().optional().nullable()
});

// PATCH /api/customers
export const CustomerPatchSchema = z.object({
  id: z.string().min(1, "Thiếu ID khách hàng"),
  fullName: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  gender: z.string().optional().nullable(),
  nationality: z.string().optional().nullable(),
  preferredLang: z.string().optional().nullable()
});

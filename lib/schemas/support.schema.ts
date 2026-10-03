import { z } from 'zod';

// POST /api/support/areas
export const SupportAreaPostSchema = z.object({
  area_name: z.string().min(1, "Missing area_name")
});

// POST /api/support/tasks
export const SupportTaskPostSchema = z.union([
  z.array(z.record(z.string(), z.any())).min(1, "No tasks provided"),
  z.record(z.string(), z.any())
]);

// PATCH /api/support/tasks
export const SupportTaskPatchSchema = z.object({
  id: z.union([z.string(), z.number()], { message: "Missing id" }),
  status: z.string().min(1, "Missing status"),
  photo_url: z.string().optional().nullable()
});

// POST /api/support/templates
export const SupportTemplatePostSchema = z.object({
  task_name: z.string().min(1, "Missing task_name")
});

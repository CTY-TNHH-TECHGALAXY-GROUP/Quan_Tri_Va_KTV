import { z } from 'zod';

export const AdjustmentRequestSchema = z.object({
  staff_id: z.string().min(1, "Vui lòng chọn nhân viên"),
  amount: z.union([z.string(), z.number()]).transform((val) => Number(val)).refine((val) => !isNaN(val) && val !== 0, {
    message: "Số tiền không hợp lệ"
  }),
  type: z.enum(['GIFT', 'PENALTY', 'ADJUST'], {
    message: "Loại điều chỉnh không hợp lệ"
  }),
  wallet_type: z.string().min(1, "Loại ví không được để trống"),
  reason: z.string().min(1, "Lý do không được để trống")
});

export type AdjustmentRequest = z.infer<typeof AdjustmentRequestSchema>;

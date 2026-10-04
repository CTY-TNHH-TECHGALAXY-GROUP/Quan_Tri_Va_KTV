import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron-auth';
import { PromotionEmailService } from '@/lib/services/PromotionEmailService';

export const dynamic = 'force-dynamic';

/**
 * E-voucher email worker (Vercel cron, every 5 minutes).
 * Sends pending issue emails (auto-issued passes, retries) and expiry reminders
 * (SystemConfigs.promotion_expiry_reminder_days, default 3). promo_claim_email_batch
 * uses SKIP LOCKED, so overlapping runs never mail a pass twice.
 * `?limit=` caps passes per run (default 20, max 50).
 */
export async function GET(request: Request) {
    const unauthorized = requireCronAuth(request);
    if (unauthorized) return unauthorized;
    const limit = Math.min(Math.max(Number(new URL(request.url).searchParams.get('limit')) || 20, 1), 50);
    const res = await PromotionEmailService.processOutbox(limit);
    return NextResponse.json(res, { status: res.success ? 200 : 500 });
}

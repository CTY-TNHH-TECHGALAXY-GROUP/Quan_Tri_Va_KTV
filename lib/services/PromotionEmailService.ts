import 'server-only';
import { sendPromotionEmail } from '@/lib/promotion-email';
import { PromotionEngineService, buildPromotionQrPayload, mapPass } from '@/lib/services/PromotionEngineService';
import type { PromotionConditionsSummary, PromotionEmailLang, PromotionEmailOutcome, PromotionPassDto, PromotionResult } from '@/lib/types/promotion';

// E-voucher email delivery. The outbox state lives on CustomerPromotionPasses
// (email_status / reminder_status); promo_claim_* make sure one pass is never
// mailed twice by concurrent workers. This file only renders + sends + records.

const LANGS: PromotionEmailLang[] = ['vi', 'en', 'cn', 'jp', 'kr'];
const asLang = (v: string | null | undefined): PromotionEmailLang =>
    (LANGS as string[]).includes(String(v)) ? (v as PromotionEmailLang) : 'vi';

type Claim = {
    passId: string; kind: 'ISSUE' | 'REMINDER'; to: string; lang: string;
    pass: PromotionPassDto & { qrToken?: string | null }; campaignDescription: string | null;
    conditionsSummary?: PromotionConditionsSummary | null;
};

async function deliver(claim: Claim, reminderDays: number): Promise<PromotionEmailOutcome> {
    const qrPayload = buildPromotionQrPayload(claim.pass.qrToken);
    try {
        if (!qrPayload) throw new Error('Missing QR token');
        await sendPromotionEmail(claim.to, {
            kind: claim.kind,
            lang: asLang(claim.lang),
            pass: mapPass(claim.pass, false),
            qrPayload,
            campaignDescription: claim.campaignDescription,
            conditionsSummary: claim.conditionsSummary,
            reminderDays,
        });
        await PromotionEngineService.markEmailResult(claim.passId, claim.kind, true, null);
        return { status: 'SENT' };
    } catch (e) {
        const message = (e as Error)?.message || String(e);
        console.error(`[PromotionEmail] ${claim.kind} ${claim.passId} failed:`, message);
        await PromotionEngineService.markEmailResult(claim.passId, claim.kind, false, message);
        return { status: 'FAILED', reason: message };
    }
}

export const PromotionEmailService = {
    /** Admin issue / "resend": send the e-voucher to the email on the customer profile now. */
    async sendPassEmail(passId: string, opts: { force?: boolean; kind?: 'ISSUE' | 'REMINDER' } = {}): Promise<PromotionResult<PromotionEmailOutcome>> {
        const kind = opts.kind ?? 'ISSUE';
        const claim = await PromotionEngineService.claimPassEmail(passId, kind, !!opts.force);
        if (!claim.success) return claim as PromotionResult<PromotionEmailOutcome>;
        if (claim.data.skipped) return { success: true, data: { status: 'SKIPPED', reason: claim.data.reason } };
        const days = kind === 'REMINDER' ? await PromotionEngineService.reminderDays() : 0;
        return { success: true, data: await deliver(claim.data, days) };
    },

    /**
     * Bulk issue: send issue emails with limited concurrency inside a time budget.
     * Passes not started before the budget runs out stay PENDING → reported as QUEUED,
     * the cron (/api/cron/promotion-emails) sends them. Claims prevent double sends.
     */
    async sendMany(passIds: string[], opts: { concurrency?: number; budgetMs?: number } = {}) {
        const concurrency = opts.concurrency ?? 5;
        const deadline = Date.now() + (opts.budgetMs ?? 40_000);
        const out = new Map<string, PromotionEmailOutcome>();
        const queue = [...passIds];
        const worker = async () => {
            while (queue.length) {
                const id = queue.shift()!;
                if (Date.now() >= deadline) { out.set(id, { status: 'QUEUED' }); continue; }
                const res = await PromotionEmailService.sendPassEmail(id);
                out.set(id, res.success ? res.data : { status: 'SKIPPED', reason: res.error.code });
            }
        };
        await Promise.all(Array.from({ length: Math.min(concurrency, passIds.length) }, worker));
        return out;
    },

    /** Cron worker: pending issue emails + due expiry reminders. */
    async processOutbox(limit = 20) {
        const batch = await PromotionEngineService.claimEmailBatch(limit);
        if (!batch.success) return { success: false as const, error: batch.error };
        const days = await PromotionEngineService.reminderDays();
        const results: { passId: string; kind: string; status: string; reason?: string }[] = [];
        for (const claim of batch.data) {
            const outcome = await deliver(claim, days);
            results.push({ passId: claim.passId, kind: claim.kind, ...outcome });
        }
        return {
            success: true as const,
            data: {
                processed: results.length,
                sent: results.filter(r => r.status === 'SENT').length,
                failed: results.filter(r => r.status === 'FAILED').length,
                results,
            },
        };
    },
};

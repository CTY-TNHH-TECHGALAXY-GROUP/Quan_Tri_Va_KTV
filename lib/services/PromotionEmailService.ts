import 'server-only';
import { buildPromotionEmail, sendPromotionEmail } from '@/lib/promotion-email';
import { PromotionEngineService, buildPromotionQrPayload, hasAbsoluteVoucherBaseUrl, mapPass } from '@/lib/services/PromotionEngineService';
import { pickPromotionText } from '@/lib/promotion-voucher.i18n';
import type { PromotionConditionsSummary, PromotionEmailLang, PromotionEmailOutcome, PromotionPassDto, PromotionResult, PromotionTextI18n } from '@/lib/types/promotion';

// E-voucher email delivery. The outbox state lives on CustomerPromotionPasses
// (email_status / reminder_status); promo_claim_* make sure one pass is never
// mailed twice by concurrent workers. This file only renders + sends + records.

const LANGS: PromotionEmailLang[] = ['vi', 'en', 'cn', 'jp', 'kr'];
const asLang = (v: string | null | undefined): PromotionEmailLang =>
    (LANGS as string[]).includes(String(v)) ? (v as PromotionEmailLang) : 'en';

type Claim = {
    passId: string; kind: 'ISSUE' | 'REMINDER'; to: string; lang: string;
    pass: PromotionPassDto & { qrToken?: string | null }; campaignDescription: string | null;
    campaignDescriptionI18n?: PromotionTextI18n | null;
    conditionsSummary?: PromotionConditionsSummary | null;
};

async function deliver(claim: Claim, reminderDays: number): Promise<PromotionEmailOutcome> {
    const qrPayload = buildPromotionQrPayload(claim.pass.qrToken);
    try {
        if (!qrPayload) throw new Error('Missing QR token');
        // Never mail a QR / button that points nowhere: the link must carry the app domain.
        if (!hasAbsoluteVoucherBaseUrl()) throw new Error('PROMOTION_SCAN_BASE_URL chưa cấu hình (VD https://oria-spa.vercel.app) — không gửi e-voucher');
        const lang = asLang(claim.lang);
        const pass = mapPass(claim.pass, false);
        await sendPromotionEmail(claim.to, {
            kind: claim.kind,
            lang,
            // Campaign text in the email language; missing translation → English (v12).
            pass: { ...pass, campaign: { ...pass.campaign, name: pickPromotionText(pass.campaign.name, pass.campaign.nameI18n, lang) } },
            qrPayload,
            campaignDescription: pickPromotionText(claim.campaignDescription, claim.campaignDescriptionI18n, lang),
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

/** What the admin preview shows: the exact message the customer would receive. */
export interface PromotionEmailPreview {
    lang: PromotionEmailLang;
    from: string;
    replyTo: string;
    to: string | null;
    subject: string;
    /** Email HTML; images load from the spa site (/voucher/card, /voucher/qr, /voucher/logo). */
    html: string;
}

export const PromotionEmailService = {
    /** Render the e-voucher email for one pass without sending or touching the outbox state. */
    async previewPassEmail(passId: string, langParam?: string | null): Promise<PromotionResult<PromotionEmailPreview>> {
        const passRes = await PromotionEngineService.getPass(passId);
        if (!passRes.success) return passRes as PromotionResult<PromotionEmailPreview>;
        const pass = passRes.data as PromotionPassDto & { qrPayload?: string | null };
        if (!pass.qrPayload) return { success: false, error: { code: 'PROMOTION_NOT_FOUND', message: 'Voucher không còn QR' } };
        const campaign = await PromotionEngineService.getCampaign(pass.campaign.id);
        const lang = asLang(langParam || pass.emailLang || 'en');
        const { message } = await buildPromotionEmail(pass.customer.email ?? '', {
            kind: 'ISSUE',
            lang,
            pass: { ...pass, campaign: { ...pass.campaign, name: pickPromotionText(pass.campaign.name, pass.campaign.nameI18n, lang) } },
            qrPayload: pass.qrPayload,
            campaignDescription: campaign.success ? pickPromotionText(campaign.data.description, campaign.data.descriptionI18n, lang) : null,
            conditionsSummary: pass.conditionsSummary,
        });
        const html = message.html; // images are absolute links (no cid attachments)
        return {
            success: true,
            data: { lang, from: message.from, replyTo: message.replyTo, to: pass.customer.email ?? null, subject: message.subject, html },
        };
    },

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

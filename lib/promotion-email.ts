import 'server-only';
import QRCode from 'qrcode';
import nodemailer from 'nodemailer';
import { getEmailConfig, type EmailConfig } from '@/lib/email-config';
import { CARD_DISPLAY_WIDTH, getBrownLogoPng, getOriginalLogoPng, renderPromotionEmailCardPng } from '@/lib/promotion-email-card';
import { PROMOTION_EMAIL_I18N } from '@/lib/promotion-email.i18n';
import { formatPromotionConditions } from '@/lib/promotion-voucher.i18n';
import type { PromotionConditionsSummary, PromotionEmailLang, PromotionPassDto } from '@/lib/types/promotion';

// 🔧 EMAIL CONFIGURATION
const QR_SIZE_PX = 480;
const QR_DISPLAY_PX = 132;
const QR_CID = 'promotion-voucher-qr';
const CARD_CID = 'promotion-voucher-card';
const LOGO_CID = 'promotion-brand-logo';
const LOGO_DARK_CID = 'promotion-darkmode-logo'; // must not share a prefix with LOGO_CID (preview replaces cid: by prefix)
const CREAM = '#FFF4E0';
const CREAM_TEXT = '#F7D9A6';
// Oria Spa e-voucher palette (same as the 3D card): brown ink, amber, dark band.
const ACCENT = '#B4600F';
const INK = '#4A2C14';
const BUTTON_BG = '#24160D';
const BUTTON_TEXT = '#F4A64A';
const CARD_BG = '#1f1b16';
/** Sender shown in the inbox (user 04/10/2026). Override with PROMOTION_EMAIL_FROM_NAME. */
const FROM_NAME = process.env.PROMOTION_EMAIL_FROM_NAME || 'OriaSpa';
const REPLY_TO = process.env.SMTP_REPLY_TO || 'cskh@techgalaxygroup.com';
const SMTP_CONNECT_TIMEOUT_MS = 15_000;
const SMTP_RETRY_DELAY_MS = 1_000;
/** Network blips worth one immediate retry (seen: ETIMEDOUT to smtp.zoho.com from Vercel, 04/10/2026). */
const TRANSIENT_SMTP = /ETIMEDOUT|ECONNRESET|ECONNREFUSED|ESOCKET|ECONNECTION|EAI_AGAIN|Greeting never received/i;

/** Renders the e-voucher QR as PNG locally — the token never goes to a third-party QR service. */
export async function buildPromotionQrPng(payload: string): Promise<Buffer> {
    return QRCode.toBuffer(payload, { type: 'png', width: QR_SIZE_PX, margin: 2, errorCorrectionLevel: 'M' });
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const vnDate = (iso: string | null | undefined) => {
    if (!iso) return '';
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' })
        .format(new Date(iso));
};

const vnd = (n: number) => `${new Intl.NumberFormat('vi-VN').format(n)}đ`;

export interface PromotionEmailInput {
    kind: 'ISSUE' | 'REMINDER';
    lang: PromotionEmailLang;
    pass: PromotionPassDto;
    qrPayload: string;
    campaignDescription?: string | null;
    reminderDays?: number;
    conditionsSummary?: PromotionConditionsSummary | null;
}

/** Which inline images were attached; missing ones fall back to HTML / text. */
export interface PromotionEmailImages { card: boolean; logo: boolean; logoDark?: boolean }

export function renderPromotionEmail(input: PromotionEmailInput, cfg: EmailConfig, images: PromotionEmailImages = { card: false, logo: false }) {
    const t = PROMOTION_EMAIL_I18N[input.lang] ?? PROMOTION_EMAIL_I18N.vi;
    const { pass } = input;
    const brand = cfg.email_brand_name || 'Spa';
    const name = pass.customer.name || '';
    const benefit = pass.benefit.type === 'FREE_MINUTES' ? t.freeMinutes(pass.benefit.value)
        : pass.benefit.type === 'PERCENT_DISCOUNT' ? t.percentOff(pass.benefit.value)
        : t.fixedOff(vnd(pass.benefit.value));
    const conditions = formatPromotionConditions(input.conditionsSummary, input.lang);
    const usage = pass.usage.type === 'UNLIMITED' ? t.usageUnlimited : t.usageLimited(pass.usage.limit ?? 1);
    const subject = input.kind === 'ISSUE'
        ? t.subjectIssue(brand, pass.campaign.name)
        : t.subjectReminder(brand, input.reminderDays ?? 3);
    const intro = input.kind === 'ISSUE' ? t.introIssue : t.introReminder(vnDate(pass.validUntil));

    // The stored logo is cream (for dark headers): use the brown re-coloured copy, else brown text.
    // Light reader: brown logo on cream. Dark reader (Apple Mail, iOS Mail, Outlook): cream logo
    // on brown — both are in the mail, CSS below shows one (Gmail ignores it → light version).
    const lightLogo = images.logo
        ? `<img class="em-logo-light" src="cid:${LOGO_CID}" alt="${esc(brand)}" height="72" style="display:block;height:72px;width:auto;max-width:220px;margin:0 auto">`
        : `<div class="em-logo-light" style="font-size:22px;letter-spacing:4px;color:${INK};font-weight:700">${esc(brand)}</div>`;
    const darkLogo = images.logoDark
        ? `<div class="em-logo-dark" style="display:none;max-height:0;overflow:hidden;mso-hide:all"><img src="cid:${LOGO_DARK_CID}" alt="${esc(brand)}" height="72" style="display:block;height:72px;width:auto;max-width:220px;margin:0 auto"></div>`
        : `<div class="em-logo-dark" style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:22px;letter-spacing:4px;color:${CREAM_TEXT};font-weight:700">${esc(brand)}</div>`;
    const header = lightLogo + darkLogo;

    // Painted e-voucher (PNG of the 3D card front) + a large QR for the counter.
    const cardImage = `
<img src="cid:${CARD_CID}" alt="${esc(`${pass.campaign.name} — ${benefit} — ${pass.voucherCode}`)}" width="${CARD_DISPLAY_WIDTH}" style="display:block;width:100%;max-width:${CARD_DISPLAY_WIDTH}px;height:auto;margin:0 auto;border-radius:18px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;border-collapse:separate;border:1px solid #F0D9B5;border-radius:16px;background:#FFF8EC">
<tr><td align="center" style="padding:16px">
  <img src="cid:${QR_CID}" alt="${esc(t.qrAlt)}" width="${QR_DISPLAY_PX}" height="${QR_DISPLAY_PX}" style="display:block;width:${QR_DISPLAY_PX}px;height:auto">
  <div style="font-family:monospace;font-size:14px;letter-spacing:2px;color:${INK};margin-top:8px;font-weight:700">${esc(pass.voucherCode)}</div>
</td></tr></table>`;

    // Fallback when the card image could not be drawn: static HTML rendition of the card.
    const card = images.card ? cardImage : `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-radius:18px;overflow:hidden;background:${CARD_BG};box-shadow:0 10px 30px rgba(0,0,0,.12)">
<tr>
<td valign="top" style="padding:22px 20px;color:#f7f1e6;width:64%">
  <div style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:${ACCENT}">${esc(brand)} · E-VOUCHER</div>
  <div style="font-size:19px;font-weight:700;margin:8px 0 4px;line-height:1.3">${esc(pass.campaign.name)}</div>
  <div style="font-size:26px;font-weight:800;color:${ACCENT};margin:6px 0 12px;line-height:1.2">${esc(benefit)}</div>
  ${name ? `<div style="font-size:12px;color:#cfc6b6">${esc(t.voucherFor)}: <b style="color:#f7f1e6">${esc(name)}</b></div>` : ''}
  <div style="font-size:12px;color:#cfc6b6;margin-top:4px">${esc(t.validity)}: <b style="color:#f7f1e6">${esc(t.validFromTo(vnDate(pass.validFrom), vnDate(pass.validUntil)))}</b></div>
  <div style="font-size:12px;color:#cfc6b6;margin-top:4px">${esc(t.usage)}: <b style="color:#f7f1e6">${esc(usage)}</b></div>
  ${conditions.length ? `<div style="font-size:12px;color:#cfc6b6;margin-top:4px">${esc(t.conditions)}: <b style="color:#f7f1e6">${conditions.map(esc).join('<br>')}</b></div>` : ''}
</td>
<td valign="middle" align="center" style="padding:16px 12px;background:#fbf8f2;border-left:2px dashed ${ACCENT};width:36%">
  <img src="cid:${QR_CID}" alt="${esc(t.qrAlt)}" width="${QR_DISPLAY_PX}" height="${QR_DISPLAY_PX}" style="display:block;width:${QR_DISPLAY_PX}px;max-width:100%;height:auto">
  <div style="font-family:monospace;font-size:12px;letter-spacing:1px;color:#2b2b2b;margin-top:8px;word-break:break-all">${esc(pass.voucherCode)}</div>
</td>
</tr></table>`;

    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<style>
:root { color-scheme: light dark; supported-color-schemes: light dark; }
@media (prefers-color-scheme: dark) {
  .em-bg { background: #120B06 !important; }
  .em-panel { background: #1E140D !important; }
  .em-head { background: ${BUTTON_BG} !important; }
  .em-text { color: #F7E9D2 !important; }
  .em-muted { color: #CDB89B !important; }
  .em-foot { color: #A8957C !important; }
  .em-link { color: ${BUTTON_TEXT} !important; }
  .em-btn { background: ${BUTTON_TEXT} !important; color: ${BUTTON_BG} !important; }
  .em-logo-light { display: none !important; }
  .em-logo-dark { display: block !important; max-height: none !important; overflow: visible !important; }
}
[data-ogsc] .em-bg { background: #120B06 !important; }
[data-ogsc] .em-panel { background: #1E140D !important; }
[data-ogsc] .em-head { background: ${BUTTON_BG} !important; }
[data-ogsc] .em-text { color: #F7E9D2 !important; }
[data-ogsc] .em-muted { color: #CDB89B !important; }
[data-ogsc] .em-btn { background: ${BUTTON_TEXT} !important; color: ${BUTTON_BG} !important; }
[data-ogsc] .em-logo-light { display: none !important; }
[data-ogsc] .em-logo-dark { display: block !important; max-height: none !important; }
</style></head><body class="em-bg" style="margin:0;background:#f6f3ee;font-family:Helvetica,Arial,sans-serif">
<table class="em-bg" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f3ee;padding:24px 12px"><tr><td align="center">
<table class="em-panel" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td class="em-head" align="center" style="padding:24px 24px 20px;background:${CREAM}">${header}</td></tr>
<tr><td class="em-text" style="padding:20px 28px 0;color:#2b2b2b;font-size:15px;line-height:1.6">
<p style="margin:0 0 8px">${esc(t.greeting(name))}</p><p style="margin:0">${esc(intro)}</p></td></tr>
<tr><td style="padding:20px 20px 4px">${card}</td></tr>
${input.campaignDescription ? `<tr><td class="em-muted" style="padding:10px 28px 0;font-size:13px;color:#6b6b6b">${esc(input.campaignDescription)}</td></tr>` : ''}
<tr><td align="center" style="padding:20px 28px 4px">
<a class="em-btn" href="${esc(input.qrPayload)}" style="display:inline-block;background:${BUTTON_BG};color:${BUTTON_TEXT};text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:999px">${esc(t.viewVoucher)}</a>
</td></tr>
<tr><td class="em-text" style="padding:16px 28px 0;color:#2b2b2b;font-size:14px;line-height:1.6">
<div style="font-weight:700;margin-bottom:4px">${esc(t.howToTitle)}</div>
<ol style="margin:0;padding-left:18px">${t.howTo.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
<p class="em-muted" style="margin:10px 0 0;color:#6b6b6b">${esc(t.contactToApply(brand))}</p></td></tr>
<tr><td class="em-foot" style="padding:20px 28px 28px;color:#8a8a8a;font-size:12px;line-height:1.6">
${cfg.email_branch_address ? `<div>${esc(cfg.email_branch_address)}</div>` : ''}
${cfg.email_hotline ? `<div>${esc(t.hotline)}: ${esc(cfg.email_hotline)}</div>` : ''}
${cfg.email_website_url ? `<div><a class="em-link" href="${esc(cfg.email_website_url)}" style="color:${ACCENT}">${esc(cfg.email_website_url)}</a></div>` : ''}
<div style="margin-top:8px">${esc(t.footer)}</div></td></tr>
</table></td></tr></table></body></html>`;

    const text = [t.greeting(name), intro, '', pass.campaign.name,
        `${t.voucherCode}: ${pass.voucherCode}`, `${t.benefit}: ${benefit}`,
        `${t.validity}: ${t.validFromTo(vnDate(pass.validFrom), vnDate(pass.validUntil))}`, `${t.usage}: ${usage}`,
        ...(conditions.length ? [`${t.conditions}: ${conditions.join('; ')}`] : []),
        '', `${t.viewVoucher}: ${input.qrPayload}`,
        '', t.howToTitle, ...t.howTo.map((s, i) => `${i + 1}. ${s}`), t.contactToApply(brand)].join('\n');

    return { subject, html, text };
}

let transporter: nodemailer.Transporter | null = null;
const getTransporter = () => {
    if (!transporter) {
        transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT) || 465,
            secure: Number(process.env.SMTP_PORT) === 465,
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
            // Fail fast so a retry still fits in the function time budget (default is 2 min).
            connectionTimeout: SMTP_CONNECT_TIMEOUT_MS,
            greetingTimeout: SMTP_CONNECT_TIMEOUT_MS,
        });
    }
    return transporter;
};

/** Renders and sends one e-voucher email. Throws on SMTP failure. */
export async function sendPromotionEmail(to: string, input: PromotionEmailInput) {
    if (!process.env.SMTP_HOST || !process.env.SMTP_FROM_EMAIL) throw new Error('SMTP is not configured');
    const { message } = await buildPromotionEmail(to, input);
    try {
        await getTransporter().sendMail(message);
    } catch (e) {
        const err = e as { code?: string; message?: string };
        if (!TRANSIENT_SMTP.test(`${err.code ?? ''} ${err.message ?? ''}`)) throw e;
        console.warn(`[PromotionEmail] SMTP ${err.code ?? ''} ${err.message ?? ''} — retrying once`);
        transporter = null; // fresh connection
        await new Promise((r) => setTimeout(r, SMTP_RETRY_DELAY_MS));
        await getTransporter().sendMail(message);
    }
}

/**
 * Full message (also used by the admin preview). The card image and brown logo are
 * best-effort: if either fails the email still goes out with the HTML card / text brand.
 */
export async function buildPromotionEmail(to: string, input: PromotionEmailInput) {
    const cfg = await getEmailConfig();
    const [qr, cardPng, logoPng, logoDarkPng] = await Promise.all([
        buildPromotionQrPng(input.qrPayload),
        renderPromotionEmailCardPng({
            lang: input.lang,
            pass: input.pass,
            qrPayload: input.qrPayload,
            conditionsSummary: input.conditionsSummary,
            brandName: cfg.email_brand_name || 'Spa',
            contact: { hotline: cfg.email_hotline, websiteUrl: cfg.email_website_url, address: cfg.email_branch_address || cfg.email_branch_name },
        }).catch((e) => {
            console.error('[PromotionEmail] card image failed, sending HTML card:', (e as Error)?.message);
            return null;
        }),
        cfg.email_logo_url ? getBrownLogoPng(cfg.email_logo_url) : Promise.resolve(null),
        cfg.email_logo_url ? getOriginalLogoPng(cfg.email_logo_url) : Promise.resolve(null),
    ]);
    const { subject, html, text } = renderPromotionEmail(input, cfg, { card: !!cardPng, logo: !!logoPng, logoDark: !!logoDarkPng });
    const attachments = [
        { filename: `${input.pass.voucherCode}-qr.png`, content: qr, cid: QR_CID, contentType: 'image/png' },
        ...(cardPng ? [{ filename: `${input.pass.voucherCode}.png`, content: cardPng, cid: CARD_CID, contentType: 'image/png' }] : []),
        ...(logoPng ? [{ filename: 'logo.png', content: logoPng, cid: LOGO_CID, contentType: 'image/png' }] : []),
        ...(logoDarkPng ? [{ filename: 'logo-dark.png', content: logoDarkPng, cid: LOGO_DARK_CID, contentType: 'image/png' }] : []),
    ];
    return {
        message: {
            from: `"${FROM_NAME}" <${process.env.SMTP_FROM_EMAIL}>`,
            replyTo: REPLY_TO,
            to,
            subject,
            html,
            text,
            attachments,
        },
    };
}

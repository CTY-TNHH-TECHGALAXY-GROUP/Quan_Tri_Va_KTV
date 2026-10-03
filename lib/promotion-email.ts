import 'server-only';
import QRCode from 'qrcode';
import nodemailer from 'nodemailer';
import { getEmailConfig, type EmailConfig } from '@/lib/email-config';
import { PROMOTION_EMAIL_I18N } from '@/lib/promotion-email.i18n';
import { formatPromotionConditions } from '@/lib/promotion-voucher.i18n';
import type { PromotionConditionsSummary, PromotionEmailLang, PromotionPassDto } from '@/lib/types/promotion';

// 🔧 EMAIL CONFIGURATION
const QR_SIZE_PX = 480;
const QR_DISPLAY_PX = 132;
const QR_CID = 'promotion-voucher-qr';
const ACCENT = '#C9A96E';
const CARD_BG = '#1f1b16';

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

export function renderPromotionEmail(input: PromotionEmailInput, cfg: EmailConfig) {
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

    const header = cfg.email_logo_url
        ? `<img src="${esc(cfg.email_logo_url)}" alt="${esc(brand)}" style="max-height:52px;max-width:200px">`
        : `<div style="font-size:22px;letter-spacing:4px;color:${ACCENT};font-weight:700">${esc(brand)}</div>`;

    // Static rendition of the 3D e-voucher (email clients cannot run the 3D card):
    // main panel + perforated stub holding the QR. The button opens the live 3D card.
    const card = `
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

    const html = `<!doctype html><html><body style="margin:0;background:#f6f3ee;font-family:Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f3ee;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td align="center" style="padding:28px 24px 8px">${header}</td></tr>
<tr><td style="padding:8px 28px 0;color:#2b2b2b;font-size:15px;line-height:1.6">
<p style="margin:0 0 8px">${esc(t.greeting(name))}</p><p style="margin:0">${esc(intro)}</p></td></tr>
<tr><td style="padding:20px 20px 4px">${card}</td></tr>
${input.campaignDescription ? `<tr><td style="padding:10px 28px 0;font-size:13px;color:#6b6b6b">${esc(input.campaignDescription)}</td></tr>` : ''}
<tr><td align="center" style="padding:20px 28px 4px">
<a href="${esc(input.qrPayload)}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:999px">${esc(t.viewVoucher)}</a>
</td></tr>
<tr><td style="padding:16px 28px 0;color:#2b2b2b;font-size:14px;line-height:1.6">
<div style="font-weight:700;margin-bottom:4px">${esc(t.howToTitle)}</div>
<ol style="margin:0;padding-left:18px">${t.howTo.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
<p style="margin:10px 0 0;color:#6b6b6b">${esc(t.contactToApply(brand))}</p></td></tr>
<tr><td style="padding:20px 28px 28px;color:#8a8a8a;font-size:12px;line-height:1.6">
${cfg.email_branch_address ? `<div>${esc(cfg.email_branch_address)}</div>` : ''}
${cfg.email_hotline ? `<div>${esc(t.hotline)}: ${esc(cfg.email_hotline)}</div>` : ''}
${cfg.email_website_url ? `<div><a href="${esc(cfg.email_website_url)}" style="color:${ACCENT}">${esc(cfg.email_website_url)}</a></div>` : ''}
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
        });
    }
    return transporter;
};

/** Renders and sends one e-voucher email. Throws on SMTP failure. */
export async function sendPromotionEmail(to: string, input: PromotionEmailInput) {
    if (!process.env.SMTP_HOST || !process.env.SMTP_FROM_EMAIL) throw new Error('SMTP is not configured');
    const cfg = await getEmailConfig();
    const { subject, html, text } = renderPromotionEmail(input, cfg);
    const qr = await buildPromotionQrPng(input.qrPayload);
    await getTransporter().sendMail({
        from: `"${process.env.SMTP_FROM_NAME || cfg.email_brand_name}" <${process.env.SMTP_FROM_EMAIL}>`,
        replyTo: process.env.SMTP_REPLY_TO,
        to,
        subject,
        html,
        text,
        attachments: [{ filename: `${input.pass.voucherCode}.png`, content: qr, cid: QR_CID, contentType: 'image/png' }],
    });
}

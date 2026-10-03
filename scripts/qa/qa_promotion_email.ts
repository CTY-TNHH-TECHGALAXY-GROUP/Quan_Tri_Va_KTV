/**
 * QA — e-voucher email rendering (lib/promotion-email.ts). No DB, no SMTP.
 *
 *   npx ts-node -P scripts/qa/tsconfig.qa.json -r tsconfig-paths/register scripts/qa/qa_promotion_email.ts
 *
 * Checks the 5 languages render, the QR is a local PNG attached by cid, and the
 * raw QR token never appears in the HTML / text body.
 */
// `server-only` is resolved by Next at build time; stub it for ts-node.
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request: string, ...rest: unknown[]) {
    if (request === 'server-only') return {};
    return origLoad.call(this, request, ...rest);
};

import { finish, fatal } from './_exit';

let failures = 0;
let passes = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
    if (cond) { passes++; console.log(`  ✅ ${name}`); }
    else { failures++; console.log(`  ❌ ${name}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 300)); }
};

async function main() {
    const { renderPromotionEmail, buildPromotionQrPng } = require('@/lib/promotion-email');
    const { EMAIL_CONFIG_DEFAULTS } = require('@/lib/email-config');
    const token = 'tok_SECRET_abcdefghijklmnopqrstuvwxyz0123456';
    const qrPayload = `https://admin.example.test/voucher?t=${token}`;
    const pass = {
        id: 'p1', voucherCode: 'OCT30-X7K92A', status: 'ACTIVE', effectiveStatus: 'ACTIVE', statusReason: null,
        campaign: { id: 'c1', name: 'October +30 Minutes', campaignCode: 'OCT_FREE30_2026', status: 'ACTIVE' },
        customer: { id: 'CUS1', name: 'Charlotte <Nguyen>', phone: '0900000000', email: 'c@example.test' },
        benefit: { type: 'FREE_MINUTES', value: 30, serviceId: 'KM0001' },
        usage: { type: 'UNLIMITED', limit: null, usedCount: 0, maxPerOrder: 1, lastUsedAt: null },
        lastUsedAt: null, validFrom: '2026-10-01T00:00:00+07:00', validUntil: '2026-10-31T23:59:59+07:00',
        issuedAt: '2026-10-02T10:00:00+07:00', issueSource: 'MANUAL', issuedBy: 'admin', sourceBookingId: null,
        emailStatus: 'PENDING', emailTo: 'c@example.test', emailLang: 'vi', emailSentAt: null, emailLastError: null,
        reminderStatus: 'NONE', reminderSentAt: null,
    };
    console.log('=== QA Promotion email ===');
    const subjects = new Set<string>();
    for (const lang of ['vi', 'en', 'cn', 'jp', 'kr']) {
        for (const kind of ['ISSUE', 'REMINDER'] as const) {
            const out = renderPromotionEmail({ kind, lang, pass, qrPayload, campaignDescription: 'Tặng 30 phút', reminderDays: 3 }, EMAIL_CONFIG_DEFAULTS);
            subjects.add(out.subject);
            check(`${lang} ${kind}: subject + code + cid QR + dates`, out.subject.length > 5 && out.html.includes('OCT30-X7K92A')
                && out.html.includes('cid:promotion-voucher-qr') && out.html.includes('31/10/2026') && out.text.includes('OCT30-X7K92A'), out.subject);
            const htmlTokenHits = out.html.split(token).length - 1;
            check(`${lang} ${kind}: e-voucher card (QR in stub) + "view" button → /voucher link; token only inside that link`,
                out.html.includes('border-left:2px dashed') && out.html.includes(`href="${qrPayload}"`) && htmlTokenHits === 1
                && out.html.includes('Charlotte &lt;Nguyen&gt;'), { htmlTokenHits });
        }
    }
    check('10 distinct subjects (5 languages × issue/reminder)', subjects.size === 10, [...subjects]);
    const pct = renderPromotionEmail({ kind: 'ISSUE', lang: 'vi', pass: { ...pass, benefit: { type: 'PERCENT_DISCOUNT', value: 10, serviceId: 'KM0002' } }, qrPayload }, EMAIL_CONFIG_DEFAULTS);
    const fix = renderPromotionEmail({ kind: 'ISSUE', lang: 'en', pass: { ...pass, benefit: { type: 'FIXED_DISCOUNT', value: 50000, serviceId: 'KM0003' },
        usage: { ...pass.usage, type: 'LIMITED', limit: 10 } }, qrPayload }, EMAIL_CONFIG_DEFAULTS);
    check('benefit text: "Giảm 10%" / "50.000đ off" / "10 times"', pct.html.includes('Giảm 10%') && fix.html.includes('50.000đ off') && fix.html.includes('10 times'));
    const { pickVoucherLang, PROMOTION_VOUCHER_PAGE_I18N } = require('@/lib/promotion-voucher.i18n');
    check('voucher page language: ?lang wins, then Accept-Language, else vi',
        pickVoucherLang('kr', 'ja-JP') === 'kr' && pickVoucherLang(null, 'zh-CN,zh;q=0.9') === 'cn' && pickVoucherLang(null, 'fr-FR') === 'vi'
        && pickVoucherLang('', 'ja') === 'jp');
    check('voucher page: "contact the spa to apply" in 5 languages', ['vi', 'en', 'cn', 'jp', 'kr'].every(l =>
        PROMOTION_VOUCHER_PAGE_I18N[l].contactToApply('Oria Spa').includes('Oria Spa')));
    check('vi wording exact', PROMOTION_VOUCHER_PAGE_I18N.vi.contactToApply('Oria Spa') === 'Vui lòng liên hệ Oria Spa để áp dụng.');
    const { formatPromotionConditions } = require('@/lib/promotion-voucher.i18n');
    const sumOne = { match: 'ALL', conditions: [{ menus: ['Menu VIP'], categories: [], services: [], minMinutes: 90, minOrderAmount: null }] };
    const sumStd = { match: 'ALL', conditions: [{ menus: ['Menu Standard'], categories: [], services: ['Body A', 'Body B'], minMinutes: 90, minOrderAmount: null }] };
    const sumAny = { match: 'ANY', conditions: [{ menus: ['Menu VIP'], categories: [], services: [], minMinutes: 90, minOrderAmount: null },
                                                 { menus: ['Menu Deep Body'], categories: [], services: [], minMinutes: 120, minOrderAmount: 1000000 }] };
    check('conditions text vi: "Menu VIP · từ 90 phút"', JSON.stringify(formatPromotionConditions(sumOne, 'vi')) === '["Menu VIP · từ 90 phút"]', formatPromotionConditions(sumOne, 'vi'));
    check('conditions text vi: menu + one of services + minutes', formatPromotionConditions(sumStd, 'vi')[0] === 'Menu Standard · một trong (Body A, Body B) · từ 90 phút', formatPromotionConditions(sumStd, 'vi'));
    check('conditions text ANY + amount (en)', formatPromotionConditions(sumAny, 'en')[0] === 'Menu VIP · 90 min or longer or Menu Deep Body · 120 min or longer · order from 1.000.000đ', formatPromotionConditions(sumAny, 'en'));
    check('conditions text exists in 5 languages; empty → []', ['vi', 'en', 'cn', 'jp', 'kr'].every(l => formatPromotionConditions(sumOne, l)[0].includes('90'))
        && formatPromotionConditions({ match: 'ALL', conditions: [] }, 'vi').length === 0);
    const withCond = renderPromotionEmail({ kind: 'ISSUE', lang: 'vi', pass, qrPayload, conditionsSummary: sumOne }, EMAIL_CONFIG_DEFAULTS);
    check('email card shows "Điều kiện: Menu VIP · từ 90 phút"', withCond.html.includes('Điều kiện') && withCond.html.includes('Menu VIP · từ 90 phút')
        && withCond.text.includes('Điều kiện: Menu VIP · từ 90 phút'));
    const engine = require('@/lib/services/PromotionEngineService');
    const saved = { a: process.env.PROMOTION_SCAN_BASE_URL, b: process.env.APP_URL };
    delete process.env.PROMOTION_SCAN_BASE_URL; delete process.env.APP_URL;
    const noBase = engine.hasAbsoluteVoucherBaseUrl();
    process.env.PROMOTION_SCAN_BASE_URL = 'https://oria-spa.vercel.app/';
    const withBase = engine.hasAbsoluteVoucherBaseUrl() && engine.buildPromotionQrPayload('tok') === 'https://oria-spa.vercel.app/voucher?t=tok';
    process.env.PROMOTION_SCAN_BASE_URL = saved.a ?? ''; if (saved.b !== undefined) process.env.APP_URL = saved.b;
    check('voucher link needs the app domain: missing → emails refused; set → https://oria-spa.vercel.app/voucher?t=…', noBase === false && withBase === true, { noBase, withBase });
    const png: Buffer = await buildPromotionQrPng(qrPayload);
    check('QR PNG generated locally (valid PNG header, > 2KB)', png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && png.length > 2000, png.length);
}

main()
    .catch(e => { failures++; fatal(e); })
    .finally(() => {
        console.log(`\n=== ${failures === 0 ? 'DAT' : 'KHONG DAT'} — ${passes} pass, ${failures} fail ===`);
        finish(failures);
    });

import 'server-only';
import { readFile } from 'fs/promises';
import path from 'path';
import React from 'react';
import { ImageResponse } from 'next/og';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { Mortar, SpaStill, Sprig } from '@/components/promotions/VoucherBotanicals';
import { VOUCHER_CARD_LABELS } from '@/components/promotions/voucher-card.i18n';
import { ORIA } from '@/components/promotions/voucher.theme';
import { formatPromotionConditions } from '@/lib/promotion-voucher.i18n';
import type { PromotionConditionsSummary, PromotionEmailLang, PromotionPassDto } from '@/lib/types/promotion';

/**
 * PNG of the e-voucher FRONT for the email — same design as the admin / customer
 * 3D card (VoucherCard3D). Email clients cannot run the 3D card, CSS masks or
 * web fonts, so the server paints the card once and the email embeds it (CID).
 */

// 🔧 EMAIL CARD CONFIGURATION
const SCALE = 2; // retina: drawn at 2x, displayed at CARD_DISPLAY_WIDTH
export const CARD_DISPLAY_WIDTH = 520;
const W = CARD_DISPLAY_WIDTH * SCALE;
const H = Math.round(W / 1.38);
const BAND_H = 64 * SCALE;
const STUB_W = Math.round(W * 0.27);
const RADIUS = 24 * SCALE;
const NOTCH_R = 12 * SCALE;
const QR_PX = 112 * SCALE;
/** Colour behind the card in the email (white panel) — fills the ticket notch. */
const NOTCH_FILL = '#FFFFFF';
const LOGO_BROWN = { r: 0x4a, g: 0x2c, b: 0x14 }; // ORIA.inkSoft
const FONT_DIR = path.join(process.cwd(), 'assets', 'fonts');

type Font = { name: string; data: Buffer; weight: 400 | 500 | 600 | 700; style: 'normal' };
let fontsPromise: Promise<Font[]> | null = null;
const loadFonts = () =>
    (fontsPromise ??= Promise.all([
        readFile(path.join(FONT_DIR, 'BeVietnamPro-Medium.ttf')).then(data => ({ name: 'Be Vietnam Pro', data, weight: 500 as const, style: 'normal' as const })),
        readFile(path.join(FONT_DIR, 'BeVietnamPro-SemiBold.ttf')).then(data => ({ name: 'Be Vietnam Pro', data, weight: 600 as const, style: 'normal' as const })),
        readFile(path.join(FONT_DIR, 'BeVietnamPro-Bold.ttf')).then(data => ({ name: 'Be Vietnam Pro', data, weight: 700 as const, style: 'normal' as const })),
        readFile(path.join(FONT_DIR, 'Mansalva-Regular.ttf')).then(data => ({ name: 'Mansalva', data, weight: 400 as const, style: 'normal' as const })),
    ]).catch((e) => { fontsPromise = null; throw e; }));

const vnDate = (iso: string | null | undefined) =>
    iso ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso)) : '—';

export interface EmailCardInput {
    lang: PromotionEmailLang;
    pass: PromotionPassDto;
    qrPayload: string;
    conditionsSummary?: PromotionConditionsSummary | null;
    brandName: string;
    contact: { hotline?: string | null; websiteUrl?: string | null; address?: string | null };
}

const px = (n: number) => n * SCALE;

/**
 * Tiny React-element → SVG string serializer for the ornaments (plain svg/g/path…
 * elements only). Satori draws <img> reliably, nested function-component SVGs not;
 * react-dom/server is not allowed in app route bundles.
 */
const attrName = (k: string) => (k === 'className' ? 'class' : k === 'viewBox' ? k : k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));
const escAttr = (v: unknown) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
function svgString(node: React.ReactNode): string {
    if (node === null || node === undefined || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return escAttr(node);
    if (Array.isArray(node)) return node.map(svgString).join('');
    const el = node as React.ReactElement<Record<string, unknown>>;
    if (typeof el.type === 'function') return svgString((el.type as (p: unknown) => React.ReactNode)(el.props));
    if ((el.type as unknown) === React.Fragment) return svgString(el.props.children as React.ReactNode);
    const tag = el.type as string;
    const attrs = Object.entries(el.props)
        .filter(([k, v]) => k !== 'children' && k !== 'style' && k !== 'className' && v !== undefined && v !== null && typeof v !== 'object' && typeof v !== 'function' && v !== false)
        .map(([k, v]) => ` ${attrName(k)}="${escAttr(v === true ? '' : v)}"`)
        .join('');
    const xmlns = tag === 'svg' ? ' xmlns="http://www.w3.org/2000/svg"' : '';
    return `<${tag}${xmlns}${attrs}>${svgString(el.props.children as React.ReactNode)}</${tag}>`;
}
const svgDataUri = (node: React.ReactNode) => `data:image/svg+xml;base64,${Buffer.from(svgString(node)).toString('base64')}`;

// Ornaments + icons as data URIs, built once.
const ORNAMENTS = {
    sprig: svgDataUri(<Sprig />),
    still: svgDataUri(<SpaStill />),
    mortar: svgDataUri(<Mortar />),
};
const icon = (d: string) =>
    svgDataUri(
        <svg viewBox="0 0 24 24" fill="none" stroke={ORIA.bandText} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d={d} />
        </svg>,
    );
const ICONS = {
    phone: icon('M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z'),
    globe: icon('M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z'),
    pin: icon('M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'),
};
/* eslint-disable @next/next/no-img-element */
const Img = ({ src, w, h, style }: { src: string; w: number; h: number; style?: React.CSSProperties }) => (
    <img src={src} width={w} height={h} alt="" style={{ width: w, height: h, ...style }} />
);

/** Renders the card front as PNG (2x). Throws if fonts / rendering fail — callers fall back to the HTML card. */
export async function renderPromotionEmailCardPng(input: EmailCardInput): Promise<Buffer> {
    const L = VOUCHER_CARD_LABELS[input.lang] ?? VOUCHER_CARD_LABELS.en;
    const { pass } = input;
    const conditions = formatPromotionConditions(input.conditionsSummary, input.lang);
    const conditionText = conditions.length ? L.conditionPrefix(conditions.join('; ')) : L.complimentary;
    const qr = await QRCode.toDataURL(input.qrPayload, {
        width: QR_PX, margin: 0, errorCorrectionLevel: 'M', color: { dark: ORIA.ink, light: ORIA.cream },
    });
    const website = (input.contact.websiteUrl ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '');
    const notchX = W - STUB_W - NOTCH_R;

    const element = (
        <div style={{ width: W, height: H, display: 'flex', position: 'relative', fontFamily: 'Be Vietnam Pro', color: ORIA.ink }}>
            {/* Board */}
            <div
                style={{
                    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: RADIUS,
                    backgroundColor: '#EC8A1E',
                    // One opaque gradient (layered translucent gradients render muddy in Satori).
                    backgroundImage: 'radial-gradient(circle at 34% 38%, #FFC253 0%, #F59B2B 32%, #EA861D 62%, #CF6A18 100%)',
                }}
            >
                {/* Ornaments (behind the text) */}
                <Img src={ORNAMENTS.sprig} w={px(104)} h={px(52)} style={{ position: 'absolute', left: -px(62), top: px(170), transform: 'rotate(100deg)', opacity: 0.9 }} />
                <Img src={ORNAMENTS.sprig} w={px(124)} h={px(62)} style={{ position: 'absolute', left: px(150), top: -px(14), transform: 'rotate(6deg)', opacity: 0.85 }} />
                <Img src={ORNAMENTS.sprig} w={px(80)} h={px(40)} style={{ position: 'absolute', right: -px(18), top: -px(10), transform: 'scaleX(-1) rotate(160deg)', opacity: 0.85 }} />
                <Img src={ORNAMENTS.still} w={px(128)} h={px(84)} style={{ position: 'absolute', right: STUB_W + px(10), bottom: BAND_H + px(8), opacity: 0.95 }} />
                <Img src={ORNAMENTS.mortar} w={px(92)} h={px(69)} style={{ position: 'absolute', right: -px(4), bottom: BAND_H + px(4), opacity: 0.9 }} />

                <div style={{ display: 'flex', flex: 1 }}>
                    {/* Main area */}
                    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', flex: 1, padding: px(26) }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: px(12), fontWeight: 700, letterSpacing: px(3.5), textTransform: 'uppercase' }}>{input.brandName}</span>
                            <span style={{ fontSize: px(10), fontWeight: 700, letterSpacing: px(1.8), textTransform: 'uppercase', backgroundColor: ORIA.ink, color: ORIA.creamText, borderRadius: px(999), padding: `${px(3)}px ${px(11)}px` }}>
                                {L.eVoucher}
                            </span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', marginTop: px(14), marginBottom: px(14) }}>
                            <span style={{ fontSize: px(15), fontWeight: 600, color: ORIA.inkSoft, maxHeight: px(40), overflow: 'hidden' }}>{pass.campaign.name}</span>
                            <span style={{ fontFamily: 'Mansalva', fontSize: px(52), lineHeight: 1, textTransform: 'uppercase', marginTop: px(4), color: ORIA.ink }}>
                                {L.benefit(pass.benefit)}
                            </span>
                            <span style={{ fontSize: px(13), fontWeight: 600, color: ORIA.inkSoft, marginTop: px(6), maxWidth: '92%', maxHeight: px(36), overflow: 'hidden' }}>{conditionText}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontSize: px(10), fontWeight: 600, letterSpacing: px(1.2), textTransform: 'uppercase', color: ORIA.inkSoft, marginBottom: px(2) }}>{L.voucherCode}</span>
                            <span style={{ fontSize: px(18), fontWeight: 700, letterSpacing: px(1.8) }}>{pass.voucherCode}</span>
                            <span style={{ display: 'flex', fontSize: px(11), color: ORIA.inkSoft, marginTop: px(4) }}>
                                {L.validUntil}&nbsp;<span style={{ fontWeight: 700, color: ORIA.ink }}>{vnDate(pass.validUntil)}</span>
                            </span>
                        </div>
                    </div>

                    {/* Perforation */}
                    <div style={{ display: 'flex', width: 0, marginTop: px(16), marginBottom: px(16), borderLeft: `${px(2)}px dashed rgba(255,244,224,0.85)` }} />

                    {/* Stub */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', width: STUB_W, padding: `${px(22)}px ${px(14)}px` }}>
                        <span style={{ fontSize: px(10), fontWeight: 700, letterSpacing: px(1), textTransform: 'uppercase', textAlign: 'center', maxHeight: px(28), overflow: 'hidden' }}>
                            {pass.customer.name ?? ''}
                        </span>
                        <div style={{ display: 'flex', padding: px(6), borderRadius: px(12), backgroundColor: ORIA.cream, boxShadow: '0 4px 12px rgba(90,38,10,0.35)' }}>
                            <Img src={qr} w={QR_PX / 1.6} h={QR_PX / 1.6} />
                        </div>
                        <span style={{ fontSize: px(10), fontWeight: 600, textAlign: 'center', backgroundColor: 'rgba(43,26,14,0.85)', color: ORIA.creamText, borderRadius: px(999), padding: `${px(2)}px ${px(9)}px` }}>
                            {L.usage(pass.usage)}
                        </span>
                    </div>
                </div>

                {/* Contact band */}
                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', height: BAND_H, padding: `0 ${px(26)}px`, backgroundColor: ORIA.band, color: ORIA.bandText, fontSize: px(12), borderTop: `${px(1)}px solid rgba(244,166,74,0.3)` }}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                        {input.contact.hotline && (
                            <span style={{ display: 'flex', alignItems: 'center', fontWeight: 600, marginRight: px(16) }}>
                                <Img src={ICONS.phone} w={px(12)} h={px(12)} style={{ marginRight: px(5) }} />
                                {input.contact.hotline}
                            </span>
                        )}
                        {website && (
                            <span style={{ display: 'flex', alignItems: 'center' }}>
                                <Img src={ICONS.globe} w={px(12)} h={px(12)} style={{ marginRight: px(5) }} />
                                {website}
                            </span>
                        )}
                    </div>
                    {input.contact.address && (
                        <span style={{ display: 'flex', alignItems: 'center', marginTop: px(4) }}>
                            <Img src={ICONS.pin} w={px(12)} h={px(12)} style={{ marginRight: px(5) }} />
                            {input.contact.address}
                        </span>
                    )}
                </div>
            </div>
            {/* Ticket notch above the perforation */}
            <div style={{ position: 'absolute', top: -NOTCH_R, left: notchX, width: NOTCH_R * 2, height: NOTCH_R * 2, borderRadius: NOTCH_R, backgroundColor: NOTCH_FILL, display: 'flex' }} />
        </div>
    );

    const res = new ImageResponse(element, { width: W, height: H, fonts: await loadFonts() });
    return Buffer.from(await res.arrayBuffer());
}

const logoCache = new Map<string, Promise<Buffer | null>>();

/**
 * The brand logo is cream (made for dark headers) and disappears on the light email.
 * Re-colour every visible pixel to brown, keeping the logo's own transparency.
 */
export function getBrownLogoPng(url: string): Promise<Buffer | null> {
    let p = logoCache.get(url);
    if (!p) {
        p = (async () => {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`logo ${res.status}`);
            const src = sharp(Buffer.from(await res.arrayBuffer())).ensureAlpha();
            const { width, height } = await src.metadata();
            const alpha = await src.clone().extractChannel(3).toBuffer();
            return sharp({ create: { width: width!, height: height!, channels: 3, background: LOGO_BROWN } })
                .joinChannel(alpha)
                .png()
                .toBuffer();
        })().catch((e) => {
            console.error('[PromotionEmail] logo recolour failed:', (e as Error).message);
            logoCache.delete(url);
            return null;
        });
        logoCache.set(url, p);
    }
    return p;
}

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import VoucherPublicView from '@/components/promotions/VoucherPublicView';
import { resolveVoucherView } from '@/lib/promotion-voucher-view';
import { PROMOTION_VOUCHER_LANGS, PROMOTION_VOUCHER_PAGE_I18N, pickVoucherLang } from '@/lib/promotion-voucher.i18n';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'E-Voucher',
  // The URL carries a bearer token: keep it out of search engines and referrers.
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

type SearchParams = Promise<{ t?: string | string[]; lang?: string | string[] }>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

/** Public e-voucher page opened from the QR / email link: /voucher?t=<token>. */
const VoucherPage = async ({ searchParams }: { searchParams: SearchParams }) => {
  const params = await searchParams;
  const view = await resolveVoucherView(params.t);
  if (view.mode === 'STAFF') redirect(view.redirectTo);

  const lang = pickVoucherLang(first(params.lang), (await headers()).get('accept-language'));
  return (
    <VoucherPublicView
      view={view}
      strings={PROMOTION_VOUCHER_PAGE_I18N[lang]}
      lang={lang}
      token={first(params.t)}
      langs={PROMOTION_VOUCHER_LANGS}
    />
  );
};

export default VoucherPage;

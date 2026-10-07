'use client';

import React, { useEffect, useState } from 'react';
import { Globe, Save, Loader2, CheckCircle2, Ticket, ChevronDown, ChevronUp } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import type { PromotionEmailLang } from '@/lib/types/promotion-client';

interface CampaignWebBookingInstructionCardProps {
  campaignId: string;
}

type Instructions = Record<PromotionEmailLang, string>;

export default function CampaignWebBookingInstructionCard({ campaignId }: CampaignWebBookingInstructionCardProps) {
  const { addToast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [instructions, setInstructions] = useState<Instructions>({
    vi: '',
    en: '',
    cn: '',
    jp: '',
    kr: '',
  });

  useEffect(() => {
    let active = true;
    const fetchOverride = async () => {
      try {
        const res = await fetch(`/api/admin/promotions/campaigns/${campaignId}/webbooking-instruction`);
        const json = await res.json();
        if (active && json.success && json.data) {
          setInstructions({
            vi: json.data.vi || '',
            en: json.data.en || '',
            cn: json.data.cn || '',
            jp: json.data.jp || '',
            kr: json.data.kr || '',
          });
          // Nếu đã có cấu hình riêng, tự động mở rộng để admin xem
          if (Object.values(json.data).some(Boolean)) {
            setExpanded(true);
          }
        }
      } catch (e) {
        console.error('Không tải được câu hướng dẫn riêng của chiến dịch:', e);
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchOverride();
    return () => {
      active = false;
    };
  }, [campaignId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/promotions/campaigns/${campaignId}/webbooking-instruction`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(instructions),
      });
      const json = await res.json();
      if (json.success) {
        addToast('Đã lưu câu hướng dẫn Web Booking riêng cho chiến dịch', 'success');
      } else {
        addToast(json.error || 'Lưu thất bại', 'error');
      }
    } catch {
      addToast('Lỗi kết nối khi lưu', 'error');
    } finally {
      setSaving(false);
    }
  };

  const hasAnyCustomText = Object.values(instructions).some((v) => v.trim().length > 0);

  return (
    <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
            <Ticket size={20} aria-hidden />
          </div>
          <div>
            <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
              Câu hướng dẫn E-Voucher Web Booking riêng cho chiến dịch này
              {hasAnyCustomText && (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                  Đang ghi đè
                </span>
              )}
            </h3>
            <p className="text-xs text-gray-500">
              Tùy biến câu thông báo &quot;Please book through our website...&quot; trên E-Voucher (/voucher) của chiến dịch này.
            </p>
          </div>
        </div>
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100"
          aria-label={expanded ? 'Thu gọn' : 'Mở rộng'}
        >
          {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>
      </div>

      {expanded && (
        <div className="mt-5 border-t border-gray-100 pt-4 space-y-4">
          <p className="rounded-xl bg-amber-50/70 p-3 text-xs text-amber-800">
            💡 <strong>Mẹo:</strong> Nếu để trống các ô bên dưới, hệ thống sẽ tự động dùng câu hướng dẫn mặc định chung từ{' '}
            <a href="/admin/settings/email" target="_blank" className="font-semibold underline">
              Cấu hình Email & E-Voucher (/admin/settings/email)
            </a>.
          </p>

          {loading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="animate-spin text-gray-400" size={24} />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-gray-700">Tiếng Việt (VI)</label>
                  <input
                    type="text"
                    value={instructions.vi}
                    onChange={(e) => setInstructions((prev) => ({ ...prev, vi: e.target.value }))}
                    placeholder="Vui lòng đặt lịch qua website để áp dụng voucher này."
                    className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-gray-700">English (EN)</label>
                  <input
                    type="text"
                    value={instructions.en}
                    onChange={(e) => setInstructions((prev) => ({ ...prev, en: e.target.value }))}
                    placeholder="Please book through our website to apply this voucher."
                    className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-gray-700">中文 (CN)</label>
                  <input
                    type="text"
                    value={instructions.cn}
                    onChange={(e) => setInstructions((prev) => ({ ...prev, cn: e.target.value }))}
                    placeholder="请通过我们的网站预约以使用此优惠券。"
                    className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-gray-700">日本語 (JP)</label>
                  <input
                    type="text"
                    value={instructions.jp}
                    onChange={(e) => setInstructions((prev) => ({ ...prev, jp: e.target.value }))}
                    placeholder="当クーポンをご利用の際は、ウェブサイトよりご予約ください。"
                    className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1.5 block text-xs font-semibold text-gray-700">한국어 (KR)</label>
                  <input
                    type="text"
                    value={instructions.kr}
                    onChange={(e) => setInstructions((prev) => ({ ...prev, kr: e.target.value }))}
                    placeholder="이 바우처를 사용하시려면 웹사이트를 통해 예약해 주세요."
                    className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-amber-700 disabled:opacity-50"
                >
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  Lưu cấu hình riêng cho chiến dịch
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

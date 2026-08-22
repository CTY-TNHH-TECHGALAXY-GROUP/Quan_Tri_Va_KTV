import React, { useState, useEffect } from 'react';
import { Save, Image as ImageIcon, Loader2, CheckCircle2, Printer } from 'lucide-react';
import { PrintableInvoice, InvoiceConfig } from '@/components/invoice/PrintableInvoice';
import { apiClient } from '@/lib/apiClient';
import { API } from '@/lib/api-endpoints';
import { useSearchParams } from 'next/navigation';

export const InvoiceSettingsCard = () => {
    const [config, setConfig] = useState<InvoiceConfig>({
        spaName: 'ORIA SPA',
        slogan: 'Wellness • Beauty • Therapy',
        address: '11 Ngô Đức Kế, P. Sài Gòn, TP. Hồ Chí Minh',
        phone: '0964090277',
        email: 'cskhoria@techgalaxygroup.com',
        hotline: '0964090277',
        note1: 'Cảm ơn Quý khách đã sử dụng dịch vụ tại ORIA SPA.',
        note2: 'Vui lòng giữ hóa đơn để thuận tiện đối chiếu khi cần hỗ trợ.',
        logoUrl: ''
    });

    const searchParams = useSearchParams();
    const orderId = searchParams?.get('orderId');

    const [bookingData, setBookingData] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');

    useEffect(() => {
        const init = async () => {
            setIsLoading(true);
            await fetchInvoiceConfig();
            if (orderId) {
                await fetchBooking(orderId);
            }
            setIsLoading(false);
        };
        init();
    }, [orderId]);

    const fetchBooking = async (id: string) => {
        try {
            const res = await fetch(`/api/finance/invoice/${id}`);
            const data = await res.json();
            if (data.success && data.data) {
                setBookingData(data.data);
            }
        } catch (error) {
            console.error('Error fetching booking invoice data', error);
        }
    };

    const fetchInvoiceConfig = async () => {
        try {
            // Because SystemConfigs returns all keys, we can fetch just this one if we had a specific endpoint, 
            // but the general endpoint returns a map. We use the same endpoint as page.tsx.
            const { data } = await apiClient.get<any>(API.ADMIN.SETTINGS_SYSTEM);
            if (data && data.invoice_config) {
                const loaded = data.invoice_config;
                setConfig(prev => ({ 
                    ...prev, 
                    ...loaded,
                    phone: loaded.phone === '0900 000 000' ? '0964090277' : (loaded.phone || prev.phone),
                    hotline: loaded.hotline === '0900 000 000' ? '0964090277' : (loaded.hotline || prev.hotline),
                    email: loaded.email || prev.email,
                }));
            }
        } catch (error) {
            console.error('Failed to fetch invoice config', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleChange = (field: keyof InvoiceConfig, value: string) => {
        setConfig(prev => ({ ...prev, [field]: value }));
    };

    const handleSave = async () => {
        setIsSaving(true);
        setSaveStatus('idle');
        try {
            const result = await apiClient.patch<any>(API.ADMIN.SETTINGS_SYSTEM, {
                invoice_config: config
            });
            if (result.success) {
                setSaveStatus('success');
                setTimeout(() => setSaveStatus('idle'), 3000);
            } else {
                setSaveStatus('error');
            }
        } catch (error) {
            console.error('Error saving invoice config', error);
            setSaveStatus('error');
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) {
        return (
            <div className="bg-white rounded-[2rem] p-6 shadow-sm border border-gray-100 flex justify-center items-center h-64">
                <Loader2 className="animate-spin text-indigo-500" />
            </div>
        );
    }

    if (orderId && bookingData) {
        return (
            <div className="bg-white rounded-[2rem] p-6 shadow-sm border border-gray-100 mt-6">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
                            <Printer size={20} className="text-indigo-500" />
                        </div>
                        <h2 className="text-lg font-black text-gray-900">Chi tiết Hoá đơn</h2>
                    </div>
                    <button
                        onClick={() => window.open(`/invoice/${orderId}`, '_blank')}
                        className="bg-indigo-600 text-white px-4 py-2 rounded-xl font-bold uppercase tracking-wider text-xs hover:bg-indigo-700 active:scale-95 transition-all flex items-center gap-2"
                    >
                        <Printer size={14} />
                        IN HOÁ ĐƠN
                    </button>
                </div>
                <div className="bg-gray-100 rounded-2xl p-4 overflow-x-auto border border-gray-200 flex justify-center w-full">
                    <PrintableInvoice config={config} bookingData={bookingData} />
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-[2rem] p-6 shadow-sm border border-gray-100 mt-6">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
                        <ImageIcon size={20} className="text-indigo-500" />
                    </div>
                    <h2 className="text-lg font-black text-gray-900">Cấu hình Mẫu Hóa đơn</h2>
                </div>
                <div className="flex items-center gap-3">
                    {saveStatus === 'success' && (
                        <span className="text-emerald-500 text-xs font-bold flex items-center gap-1">
                            <CheckCircle2 size={14} /> Đã lưu
                        </span>
                    )}
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="bg-indigo-600 text-white px-4 py-2 rounded-xl font-bold uppercase tracking-wider text-xs hover:bg-indigo-700 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
                    >
                        {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                        Lưu Cấu Hình
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                {/* FORM COLUMN */}
                <div className="space-y-4">
                    <div className="space-y-1">
                        <label className="text-xs font-bold text-gray-400 uppercase">Tên Spa</label>
                        <input
                            type="text"
                            value={config.spaName}
                            onChange={(e) => handleChange('spaName', e.target.value)}
                            className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm transition-all"
                            placeholder="ORIA SPA"
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-bold text-gray-400 uppercase">Slogan</label>
                        <input
                            type="text"
                            value={config.slogan}
                            onChange={(e) => handleChange('slogan', e.target.value)}
                            className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm transition-all"
                            placeholder="Wellness • Beauty • Therapy"
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-bold text-gray-400 uppercase">URL Logo (Tùy chọn)</label>
                        <input
                            type="text"
                            value={config.logoUrl || ''}
                            onChange={(e) => handleChange('logoUrl', e.target.value)}
                            className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm transition-all"
                            placeholder="https://example.com/logo.png"
                        />
                        <p className="text-xs text-gray-500">Nếu có URL Logo, Tên Spa ở dạng chữ sẽ được ẩn đi.</p>
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-bold text-gray-400 uppercase">Địa chỉ</label>
                        <input
                            type="text"
                            value={config.address}
                            onChange={(e) => handleChange('address', e.target.value)}
                            className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm transition-all"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-gray-400 uppercase">Điện thoại</label>
                            <input
                                type="text"
                                value={config.phone}
                                onChange={(e) => handleChange('phone', e.target.value)}
                                className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm transition-all"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-gray-400 uppercase">Hotline</label>
                            <input
                                type="text"
                                value={config.hotline}
                                onChange={(e) => handleChange('hotline', e.target.value)}
                                className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm transition-all"
                            />
                        </div>
                    </div>
                    
                    <div className="space-y-1">
                        <label className="text-xs font-bold text-gray-400 uppercase">Email</label>
                        <input
                            type="text"
                            value={config.email || ''}
                            onChange={(e) => handleChange('email', e.target.value)}
                            className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm transition-all"
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-bold text-gray-400 uppercase">Ghi chú chân trang 1</label>
                        <input
                            type="text"
                            value={config.note1}
                            onChange={(e) => handleChange('note1', e.target.value)}
                            className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm transition-all"
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-bold text-gray-400 uppercase">Ghi chú chân trang 2</label>
                        <input
                            type="text"
                            value={config.note2}
                            onChange={(e) => handleChange('note2', e.target.value)}
                            className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm transition-all"
                        />
                    </div>
                </div>

                {/* PREVIEW COLUMN */}
                <div className="bg-gray-100 rounded-2xl p-4 overflow-x-auto border border-gray-200 flex justify-center max-h-[800px] overflow-y-auto">
                    {/* Scale down slightly to fit well in standard screens */}
                    <div style={{ transform: 'scale(0.85)', transformOrigin: 'top center', width: '100%', minWidth: '700px' }}>
                        <PrintableInvoice config={config} />
                    </div>
                </div>
            </div>
        </div>
    );
};

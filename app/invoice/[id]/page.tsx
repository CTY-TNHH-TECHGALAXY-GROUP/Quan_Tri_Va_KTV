'use client';

import React, { useState, useEffect } from 'react';
import { PrintableInvoice, InvoiceConfig } from '@/components/invoice/PrintableInvoice';
import { apiClient } from '@/lib/apiClient';
import { API } from '@/lib/api-endpoints';
import { Loader2 } from 'lucide-react';
import { useParams } from 'next/navigation';

export default function InvoicePrintPage() {
    const params = useParams();
    const orderId = params?.id as string;

    const [config, setConfig] = useState<InvoiceConfig>({
        spaName: 'ORIA SPA',
        slogan: 'Wellness • Beauty • Therapy',
        address: '11 Ngô Đức Kế, P. Sài Gòn, TP. Hồ Chí Minh',
        phone: '0900 000 000',
        hotline: '0900 000 000',
        note1: 'Cảm ơn Quý khách đã sử dụng dịch vụ tại ORIA SPA.',
        note2: 'Vui lòng giữ hóa đơn để thuận tiện đối chiếu khi cần hỗ trợ.',
        logoUrl: ''
    });

    const [bookingData, setBookingData] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const init = async () => {
            if (!orderId) {
                setError("Mã đơn hàng không hợp lệ");
                setIsLoading(false);
                return;
            }

            try {
                setIsLoading(true);
                // Fetch config
                const { data: configData } = await apiClient.get<any>(API.ADMIN.SETTINGS_SYSTEM);
                if (configData && configData.invoice_config) {
                    setConfig(prev => ({ ...prev, ...configData.invoice_config }));
                }

                // Fetch booking
                const res = await fetch(`/api/finance/invoice/${orderId}`);
                const bData = await res.json();
                if (bData.success && bData.data) {
                    setBookingData(bData.data);
                } else {
                    setError("Không tìm thấy đơn hàng");
                }
            } catch (err: any) {
                setError(err.message || "Lỗi tải dữ liệu hóa đơn");
            } finally {
                setIsLoading(false);
            }
        };
        init();
    }, [orderId]);

    // Automatically trigger print when ready
    useEffect(() => {
        if (!isLoading && bookingData && !error) {
            // Small delay to ensure CSS and images are loaded
            const timer = setTimeout(() => {
                window.print();
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [isLoading, bookingData, error]);

    if (isLoading) {
        return (
            <div className="flex h-screen w-screen items-center justify-center bg-gray-50">
                <Loader2 className="animate-spin text-indigo-500" size={40} />
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex h-screen w-screen items-center justify-center bg-gray-50">
                <div className="text-red-500 font-bold">{error}</div>
            </div>
        );
    }

    return (
        <div className="bg-white min-h-screen">
            <PrintableInvoice config={config} bookingData={bookingData} />
        </div>
    );
}

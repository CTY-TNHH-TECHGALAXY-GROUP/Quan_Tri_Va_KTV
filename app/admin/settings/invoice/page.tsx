'use client';

import React, { Suspense } from 'react';
import { InvoiceSettingsCard } from './InvoiceSettingsCard';

export default function InvoiceSettingsPage() {
    return (
        <div className="space-y-6">
            <Suspense fallback={<div className="p-10 text-center text-gray-500">Đang tải hóa đơn...</div>}>
                <InvoiceSettingsCard />
            </Suspense>
        </div>
    );
}

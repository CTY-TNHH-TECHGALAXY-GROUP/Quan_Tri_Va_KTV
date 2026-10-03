'use client';

import React, { Suspense } from 'react';
import { CustomerUiSettingsCard } from './CustomerUiSettingsCard';

export default function CustomerUiSettingsPage() {
    return (
        <div className="space-y-6">
            <Suspense fallback={<div className="p-10 text-center text-gray-500">Đang tải cài đặt giao diện...</div>}>
                <CustomerUiSettingsCard />
            </Suspense>
        </div>
    );
}

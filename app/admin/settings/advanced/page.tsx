'use client';

import React from 'react';
import { SystemConfigsTable } from '../system/SystemConfigsTable';

export default function AdvancedSettingsPage() {
    return (
        <div className="space-y-6">
            <div className="mb-2">
                <h1 className="text-2xl font-bold text-gray-900">Cấu Hình Nâng Cao</h1>
                <p className="text-sm text-gray-500 mt-1">
                    Bảng cấu hình gốc của hệ thống. Chú ý: Khu vực dành riêng cho Quản trị viên kỹ thuật.
                </p>
            </div>
            
            <SystemConfigsTable />
        </div>
    );
}

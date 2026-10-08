'use client';

import React from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { t } from '../_shared/officeAdmin.i18n';
import PositionsPanel from './_components/PositionsPanel';

const SupportPositionsPage = () => (
  <AppLayout title={t.positions.title}>
    <div className="min-h-screen bg-stone-50">
      <div className="max-w-6xl mx-auto px-4 py-5">
        <PositionsPanel />
      </div>
    </div>
  </AppLayout>
);

export default SupportPositionsPage;

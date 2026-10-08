'use client';

import React from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { t } from '../_shared/officeAdmin.i18n';
import ReviewQueue from './_components/ReviewQueue';

const SupportReviewsPage = () => (
  <AppLayout title={t.queue.title}>
    <div className="min-h-screen bg-white">
      <div className="max-w-6xl mx-auto px-4 py-5">
        <ReviewQueue />
      </div>
    </div>
  </AppLayout>
);

export default SupportReviewsPage;

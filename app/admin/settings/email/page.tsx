'use client';

import React from 'react';
import { EmailSettingsBlock } from './EmailSettingsBlock';

export default function EmailSettingsPage() {
    return (
        <div className="space-y-6">
            <EmailSettingsBlock defaultExpanded />
        </div>
    );
}

'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/apiClient';
import { API } from '@/lib/api-endpoints';
import { buildRatingConfig, type RatingConfig } from '@/lib/services/RatingScaleService';

// One fetch per page load; every rating input / display shares it.
let cached: Promise<RatingConfig> | null = null;
const fetchRatingConfig = () => cached ??= apiClient.get<any>(API.ADMIN.SETTINGS_SYSTEM)
    .then(res => buildRatingConfig(res?.data || {}))
    .catch(() => { cached = null; return buildRatingConfig({}); });

/** Rating scale + labels for client screens. Starts on the defaults (scale 4) until loaded. */
export const useRatingConfig = (): RatingConfig => {
    const [config, setConfig] = useState<RatingConfig>(() => buildRatingConfig({}));
    useEffect(() => { let alive = true; fetchRatingConfig().then(c => { if (alive) setConfig(c); }); return () => { alive = false; }; }, []);
    return config;
};

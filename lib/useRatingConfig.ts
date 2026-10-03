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

/** Rating config plus whether the saved settings have arrived (until then it is the scale-4 defaults). */
export const useRatingConfigStatus = (): { config: RatingConfig; loaded: boolean } => {
    const [state, setState] = useState(() => ({ config: buildRatingConfig({}), loaded: false }));
    useEffect(() => { let alive = true; fetchRatingConfig().then(c => { if (alive) setState({ config: c, loaded: true }); }); return () => { alive = false; }; }, []);
    return state;
};

/** Rating scale + labels for client screens. Starts on the defaults (scale 4) until loaded. */
export const useRatingConfig = (): RatingConfig => useRatingConfigStatus().config;

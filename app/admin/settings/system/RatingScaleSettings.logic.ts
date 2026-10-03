'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/apiClient';
import { API } from '@/lib/api-endpoints';
import { buildRatingConfig, RATING_CONFIG_KEYS, type RatingConfig, type RatingScale, type RatingLang } from '@/lib/services/RatingScaleService';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** Load / edit / save the rating-scale settings (one save for every rating key). */
export const useRatingScaleSettings = () => {
    const [config, setConfig] = useState<RatingConfig | null>(null);
    const [saveState, setSaveState] = useState<SaveState>('idle');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        apiClient.get<any>(API.ADMIN.SETTINGS_SYSTEM)
            .then(res => setConfig(buildRatingConfig(res?.data || {})))
            .catch(() => setConfig(buildRatingConfig({})));
    }, []);

    const update = (fn: (draft: RatingConfig) => void) => setConfig(prev => {
        if (!prev) return prev;
        const next = structuredClone(prev);
        fn(next);
        setSaveState('idle');
        return next;
    });

    const setScale = (scale: RatingScale) => update(d => { d.scale = scale; });
    /** `percent` is what the admin types (0–100); stored as a 0–1 rate in the admin's table. */
    const setDeduction = (kind: 'typeD' | 'abc', scale: RatingScale, star: number, percent: number) =>
        update(d => { d[kind === 'typeD' ? 'typeDTables' : 'abcTables'][scale][String(star)] = Math.round(percent * 100) / 10000; });
    const setSwitch = (kind: 'typeD' | 'abc', on: boolean) => update(d => { if (kind === 'typeD') d.typeDOn = on; else d.abcOn = on; });
    const setLabel = (scale: RatingScale, level: number, lang: RatingLang | 'internal', text: string) =>
        update(d => { d.labels[scale][level][lang] = text; });

    const save = async () => {
        if (!config) return false;
        setSaveState('saving'); setError(null);
        try {
            const res = await apiClient.patch<any>(API.ADMIN.SETTINGS_SYSTEM, {
                [RATING_CONFIG_KEYS.scale]: config.scale,
                [RATING_CONFIG_KEYS.typeDOn]: config.typeDOn,
                [RATING_CONFIG_KEYS.abcOn]: config.abcOn,
                [RATING_CONFIG_KEYS.typeD4]: config.typeDTables[4],
                [RATING_CONFIG_KEYS.typeD5]: config.typeDTables[5],
                [RATING_CONFIG_KEYS.abc4]: config.abcTables[4],
                [RATING_CONFIG_KEYS.abc5]: config.abcTables[5],
                [RATING_CONFIG_KEYS.labels]: config.labels,
            });
            if (!res?.success) throw new Error(res?.error || 'save failed');
            setSaveState('saved');
            return true;
        } catch (e: any) {
            setError(e?.message || null); setSaveState('error');
            return false;
        }
    };

    return { config, saveState, error, setScale, setDeduction, setSwitch, setLabel, save };
};

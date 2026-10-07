'use client';

import React, { useState } from 'react';
import { Star, Save, Loader2, CheckCircle2, AlertTriangle, ChevronDown } from 'lucide-react';
import { RATING_LANGS, RATING_SCALES, type RatingScale } from '@/lib/services/RatingScaleService';
import { useRatingScaleSettings } from './RatingScaleSettings.logic';
import { t } from './RatingScaleSettings.i18n';

// 🔧 UI CONFIGURATION
const LABEL_MAX_LENGTH = 40;

const levelsOf = (scale: RatingScale) => Array.from({ length: scale }, (_, i) => scale - i); // high → low

/**
 * Rendered inside each KTV-type tab: `kind` picks which deduction table the tab shows
 * (Loại D vs A/B/C). Scale and labels are shared settings, editable from any tab.
 * Collapsed by default; the header row toggles it.
 */
export const RatingScaleSettingsBlock = ({ kind }: { kind: 'typeD' | 'abc' }) => {
    const { config, saveState, error, setScale, setDeduction, setSwitch, setLabel, save } = useRatingScaleSettings();
    const [open, setOpen] = useState(false);
    if (!config) return null;
    const scale = config.scale;
    const on = kind === 'typeD' ? config.typeDOn : config.abcOn;

    const deductionColumn = (kind: 'typeD' | 'abc', title: string, hint?: string) => {
        const on = kind === 'typeD' ? config.typeDOn : config.abcOn;
        const tables = kind === 'typeD' ? config.typeDTables : config.abcTables;
        return (
        <div className={`rounded-2xl border p-4 ${on ? 'border-gray-100' : 'border-dashed border-gray-200 bg-gray-50/60'}`}>
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="text-sm font-bold text-gray-800">{title}</p>
                    {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}
                </div>
                <button type="button" role="switch" aria-checked={on} aria-label={t.switchLabel(title)}
                    onClick={() => setSwitch(kind, !on)}
                    className="flex min-h-[44px] shrink-0 items-center gap-2 rounded-xl px-2 text-xs font-bold text-gray-600">
                    <span className={`relative h-6 w-11 rounded-full transition-colors ${on ? 'bg-emerald-500' : 'bg-gray-300'}`}>
                        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
                    </span>
                    {on ? t.switchOn : t.switchOff}
                </button>
            </div>
            {!on && <p className="mt-2 text-xs text-gray-500">{t.offHint}</p>}
            <div className={`mt-3 space-y-2 ${on ? '' : 'opacity-50'}`}>
                {levelsOf(scale).map(star => (
                    <label key={star} className="flex items-center gap-3">
                        <span className="w-16 text-sm font-bold text-gray-700">{t.starRow(star)}</span>
                        <input type="number" min={0} max={100} step={1} inputMode="decimal"
                            className="min-h-[44px] w-24 rounded-xl border border-gray-200 px-3 text-right font-bold focus:border-indigo-400 focus:outline-none"
                            value={Math.round((tables[scale][String(star)] ?? 0) * 10000) / 100}
                            onChange={e => {
                                const v = Number(e.target.value);
                                if (Number.isFinite(v) && v >= 0 && v <= 100) setDeduction(kind, scale, star, v);
                            }} />
                        <span className="text-sm text-gray-500">%</span>
                        {star === scale && <span className="text-xs text-emerald-600">{t.topHint}</span>}
                    </label>
                ))}
            </div>
        </div>
        );
    };

    return (
        <div className="rounded-[2rem] border border-gray-100 bg-white p-6 shadow-sm">
            <div className={`flex flex-wrap items-start justify-between gap-3 ${open ? 'mb-4' : ''}`}>
                <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}
                    className="flex min-h-[44px] flex-1 items-center gap-3 text-left">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50">
                        <Star size={20} className="text-amber-500" />
                    </div>
                    <div className="min-w-0">
                        <h2 className="text-lg font-black text-gray-900">{t.title}</h2>
                        <p className="text-xs text-gray-500">{open ? t.subtitle : t.summary(scale, on)}</p>
                    </div>
                    <ChevronDown size={20} className={`ml-auto shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
                </button>
                {open && <div className="flex items-center gap-3">
                    {saveState === 'saved' && <span className="flex items-center gap-1 text-xs font-bold text-emerald-500"><CheckCircle2 size={14} /> {t.saved}</span>}
                    {saveState === 'error' && <span className="text-xs font-bold text-rose-500">{t.saveFailed}{error ? `: ${error}` : ''}</span>}
                    <button type="button" onClick={save} disabled={saveState === 'saving'}
                        className="flex min-h-[44px] items-center gap-2 rounded-xl bg-indigo-600 px-5 text-sm font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50">
                        {saveState === 'saving' ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                        {saveState === 'saving' ? t.saving : t.save}
                    </button>
                </div>}
            </div>

            {open && <>

            <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-bold text-gray-700">{t.scaleLabel}</span>
                <div className="flex gap-1 rounded-2xl bg-gray-100 p-1">
                    {RATING_SCALES.map(option => (
                        <button key={option} type="button" onClick={() => setScale(option)} aria-pressed={scale === option}
                            className={`min-h-[44px] rounded-xl px-5 text-sm font-bold transition-all ${scale === option ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                            {t.scaleOption(option)}
                        </button>
                    ))}
                </div>
            </div>
            {scale === 5 && (
                <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {t.qrWarning}
                </p>
            )}

            <h3 className="mt-6 text-sm font-black text-gray-900">{t.deductionTitle(scale)}</h3>
            <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
                {kind === 'typeD' ? deductionColumn('typeD', t.typeD) : deductionColumn('abc', t.abc, t.abcHint)}
            </div>

            <h3 className="mt-6 text-sm font-black text-gray-900">{t.labelsTitle(scale)}</h3>
            <p className="text-xs text-gray-500">{t.labelsHint}</p>
            <div className="mt-3 overflow-x-auto">
                <table className="min-w-[640px] w-full text-sm">
                    <thead>
                        <tr className="text-left text-xs text-gray-500">
                            <th className="py-2 pr-2">{t.colLevel}</th>
                            <th className="py-2 pr-2">{t.colInternal}</th>
                            {RATING_LANGS.map(lang => <th key={lang} className="py-2 pr-2">{lang}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {levelsOf(scale).map(level => (
                            <tr key={level} className="border-t border-gray-100">
                                <td className="py-2 pr-2 font-bold text-gray-700">{t.starRow(level)}</td>
                                {(['internal', ...RATING_LANGS] as const).map(lang => (
                                    <td key={lang} className="py-2 pr-2">
                                        <input type="text" maxLength={LABEL_MAX_LENGTH}
                                            className="min-h-[44px] w-full min-w-[96px] rounded-xl border border-gray-200 px-3 focus:border-indigo-400 focus:outline-none"
                                            value={config.labels[scale][level]?.[lang] ?? ''}
                                            onChange={e => setLabel(scale, level, lang, e.target.value)} />
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            </>}
        </div>
    );
};

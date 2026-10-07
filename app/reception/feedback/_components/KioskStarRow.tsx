'use client';

import React, { useId, useState } from 'react';

// 🔧 UI CONFIGURATION — creamy gold stars on the light kiosk card
const GRID_COLS: Record<number, string> = { 4: 'grid-cols-4', 5: 'grid-cols-5' };
const STAR_SIZE = 'h-12 w-12 sm:h-16 sm:w-16';
const STAR_GRADIENT = [['0%', '#FFF3D1'], ['50%', '#F4D58A'], ['100%', '#D4A452']] as const;
const STAR_PATH = 'M12 2.6c.3 0 .6.2.7.5l2.3 4.8 5.2.7c.6.1.9.9.4 1.3l-3.8 3.6.9 5.2c.1.6-.6 1.1-1.1.8L12 17l-4.6 2.5c-.5.3-1.2-.2-1.1-.8l.9-5.2-3.8-3.6c-.5-.4-.2-1.2.4-1.3l5.2-.7 2.3-4.8c.1-.3.4-.5.7-.5z';

type Level = { score: number; label: string };

/**
 * One horizontal row: star n = level n, its meaning under it. Tapping star n selects n
 * (stars 1..n light up); levels above `maxRating` are locked. Submission stays on the Gửi button.
 */
export const KioskStarRow = ({ scale, levels, selected, maxRating, onSelect }: {
    scale: number; levels: Level[]; selected: number; maxRating: number; onSelect: (score: number) => void;
}) => {
    const [hover, setHover] = useState<number | null>(null);
    const gradientId = `kiosk-star-${useId().replace(/:/g, '')}`;
    const lit = hover ?? selected;
    return (
        <div className={`grid ${GRID_COLS[scale] || GRID_COLS[4]} gap-1 sm:gap-3`} role="radiogroup">
            <svg width="0" height="0" className="absolute" aria-hidden="true">
                <defs>
                    <linearGradient id={gradientId} x1="0" y1="0" x2="0.4" y2="1">
                        {STAR_GRADIENT.map(([offset, color]) => <stop key={offset} offset={offset} stopColor={color} />)}
                    </linearGradient>
                </defs>
            </svg>
            {levels.map(level => {
                const locked = level.score > maxRating;
                const on = level.score <= lit;
                const isSelected = selected === level.score;
                return (
                    <button key={level.score} type="button" role="radio" aria-checked={isSelected}
                        aria-label={`${level.score}/${scale} · ${level.label}`} disabled={locked}
                        onPointerEnter={() => { if (!locked) setHover(level.score); }}
                        onPointerLeave={() => setHover(null)}
                        onClick={() => { if (!locked) onSelect(level.score); }}
                        className={`flex min-h-[88px] flex-col items-center gap-2 rounded-2xl py-2 transition-transform duration-150 ${locked ? 'cursor-not-allowed opacity-30' : 'active:scale-90'}`}>
                        <svg viewBox="0 0 24 24" className={`${STAR_SIZE} transition-all duration-200 ${on ? 'scale-105 drop-shadow-[0_2px_8px_rgba(212,164,82,0.45)]' : ''}`}>
                            <path d={STAR_PATH} fill={on ? `url(#${gradientId})` : '#F7F2E8'}
                                stroke={on ? '#E2B865' : '#E6DAC2'} strokeWidth={1.1} strokeLinejoin="round" />
                        </svg>
                        <span className={`break-keep text-center text-[11px] font-bold leading-tight [overflow-wrap:normal] sm:text-sm ${isSelected ? 'rounded-lg bg-amber-50 px-2 py-0.5 text-amber-800' : on ? 'text-amber-700' : 'text-gray-400'}`}>
                            {level.label}
                        </span>
                    </button>
                );
            })}
        </div>
    );
};

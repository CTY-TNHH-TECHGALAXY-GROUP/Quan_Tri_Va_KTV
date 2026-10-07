'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { PHONE_CODES } from './phoneCodes';

// 🔧 UI CONFIGURATION
const LIST_MAX_HEIGHT = 'max-h-56';

interface PhoneCodeSelectProps {
    /** Mã đang chọn, VD '+84'. Chuỗi rỗng = không ghép mã (SĐT đã đầy đủ / mã GUEST-). */
    value: string;
    onChange: (code: string) => void;
}

/**
 * Dropdown mã vùng tự vẽ (thay cho <input list> + <datalist> mặc định của trình duyệt):
 * nút hiện mã đang chọn, bấm ra danh sách có ô tìm theo mã hoặc tên nước.
 */
export const PhoneCodeSelect = ({ value, onChange }: PhoneCodeSelectProps) => {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const rootRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        setTimeout(() => inputRef.current?.focus(), 0);
        return () => document.removeEventListener('mousedown', onDown);
    }, [open]);

    const current = PHONE_CODES.find(c => c.code === value);
    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase().replace(/\s+/g, '');
        if (!q) return PHONE_CODES;
        return PHONE_CODES.filter(c =>
            c.code.toLowerCase().includes(q) || c.label.toLowerCase().replace(/\s+/g, '').includes(q));
    }, [query]);

    const pick = (code: string) => { onChange(code); setOpen(false); setQuery(''); };

    return (
        <div ref={rootRef} className="relative w-32 shrink-0">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className="w-full h-full min-h-[48px] px-3 bg-gray-50 border border-gray-200 rounded-xl flex items-center justify-between gap-1 font-bold text-gray-700 hover:border-emerald-400 focus:outline-none focus:border-emerald-500"
            >
                <span className="truncate text-sm">
                    {current ? current.label.split(' ')[0] + ' ' + current.code : (value || '—')}
                </span>
                <ChevronDown size={14} className={`text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>

            {open && (
                <div className="absolute z-30 left-0 mt-1 w-72 bg-white border border-gray-200 rounded-2xl shadow-xl overflow-hidden">
                    <div className="p-2 border-b border-gray-100 flex items-center gap-2">
                        <Search size={14} className="text-gray-400" />
                        <input
                            ref={inputRef}
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder="Tìm mã hoặc tên nước…"
                            className="flex-1 text-sm outline-none bg-transparent"
                        />
                    </div>
                    <div className={`${LIST_MAX_HEIGHT} overflow-y-auto p-1 custom-scrollbar`}>
                        <button type="button" onClick={() => pick('')}
                            className={`w-full text-left px-3 py-2 rounded-xl text-sm hover:bg-emerald-50 ${value === '' ? 'bg-emerald-50 font-bold text-emerald-800' : 'text-gray-600'}`}>
                            — Không ghép mã (SĐT đã đầy đủ)
                        </button>
                        {filtered.map(c => (
                            <button key={`${c.code}-${c.label}`} type="button" onClick={() => pick(c.code)}
                                className={`w-full text-left px-3 py-2 rounded-xl text-sm hover:bg-emerald-50 ${value === c.code ? 'bg-emerald-50 font-bold text-emerald-800' : 'text-gray-700'}`}>
                                {c.label}
                            </button>
                        ))}
                        {filtered.length === 0 && <p className="px-3 py-4 text-xs text-gray-400 text-center">Không có mã phù hợp</p>}
                    </div>
                </div>
            )}
        </div>
    );
};

'use client';

import React, { useState } from 'react';

// 🔧 UI CONFIGURATION
const MAX_LIST_HEIGHT = 'max-h-56';

interface Item { id: string; label: string; hint?: string | null }

/** Searchable checklist for picking members / sets / categories. */
const MultiPick = ({ items, value, onChange, searchPlaceholder, label }: {
  items: Item[]; value: string[]; onChange: (ids: string[]) => void; searchPlaceholder?: string; label: string;
}) => {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = needle ? items.filter(i => `${i.id} ${i.label}`.toLowerCase().includes(needle)) : items;
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter(v => v !== id) : [...value, id]);

  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-xs font-bold text-stone-600 mb-1">{label}</legend>
      {searchPlaceholder && (
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={searchPlaceholder} aria-label={searchPlaceholder}
          className="min-h-[40px] rounded-xl border border-stone-300 bg-white px-3 text-sm" />
      )}
      <div className={`${MAX_LIST_HEIGHT} overflow-y-auto rounded-xl border border-stone-200 divide-y divide-stone-100`}>
        {shown.map(i => (
          <label key={i.id} className="flex items-center gap-3 px-3 min-h-[44px] text-sm cursor-pointer hover:bg-stone-50">
            <input type="checkbox" className="w-5 h-5 accent-emerald-700" checked={value.includes(i.id)} onChange={() => toggle(i.id)} />
            <span className="flex-1 min-w-0 truncate">{i.label}</span>
            {i.hint && <span className="text-xs text-stone-400">{i.hint}</span>}
          </label>
        ))}
      </div>
    </fieldset>
  );
};

export default MultiPick;

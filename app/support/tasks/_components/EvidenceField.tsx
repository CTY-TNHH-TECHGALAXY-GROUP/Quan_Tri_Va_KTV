'use client';

import React, { useEffect, useState } from 'react';
import { t } from '../SupportTasks.i18n';
import type { EvidenceFieldDef } from '../SupportEmployeeTasks.logic';

interface Props {
  id: string;
  field: EvidenceFieldDef;
  value: boolean | number | undefined;
  editable: boolean;
  onChange: (value: boolean | number) => void;
}

/** A confirmation tick or a counted quantity — evidence that a photo alone cannot show. */
const EvidenceField = ({ id, field, value, editable, onChange }: Props) => {
  const [draft, setDraft] = useState(typeof value === 'number' ? String(value) : '');
  useEffect(() => { setDraft(typeof value === 'number' ? String(value) : ''); }, [value]);

  if (field.kind === 'check') {
    return (
      <label htmlFor={id} className="flex items-center gap-3 bg-stone-50 rounded-xl px-3 min-h-[48px] text-sm cursor-pointer">
        <input id={id} type="checkbox" className="w-5 h-5 accent-emerald-700" checked={value === true} disabled={!editable}
          onChange={e => onChange(e.target.checked)} />
        {field.label}
      </label>
    );
  }

  const low = typeof value === 'number' && typeof field.min === 'number' && value < field.min;
  return (
    <div className="bg-stone-50 rounded-xl px-3 py-2 flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-bold text-stone-600">{field.label}</label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={0}
          disabled={!editable}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => { if (draft !== '' && Number(draft) !== value) onChange(Number(draft)); }}
          className="w-24 min-h-[44px] rounded-lg border border-stone-300 bg-white px-3 text-base tabular-nums"
        />
        {field.unit && <span className="text-sm text-stone-600">{field.unit}</span>}
        {typeof field.min === 'number' && <span className="text-xs text-stone-400">{t.evidence.min(field.min)}</span>}
      </div>
      {low && <p className="text-xs font-semibold text-rose-700">{t.evidence.belowMin}</p>}
    </div>
  );
};

export default EvidenceField;

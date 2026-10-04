'use client';

import React from 'react';
import { Check, Plus, Trash2, X } from 'lucide-react';
import type { CampaignFormInput, PromotionApplyCondition, PromotionMenu } from '@/lib/types/promotion-client';
import { formatPromotionConditions } from '@/lib/promotion-voucher.i18n';
import { EMPTY_APPLY_CONDITION, MAX_APPLY_CONDITIONS } from './CampaignForm.logic';
import { SelectControl } from './FormControls';
import { summarizeConditions } from './VoucherCard3D.logic';
import { t } from './promotion.i18n';

type ApplyConditions = CampaignFormInput['applyConditions'];

interface ApplyConditionsEditorProps {
  value: ApplyConditions;
  onChange: (fn: (ac: ApplyConditions) => ApplyConditions) => void;
  menus: PromotionMenu[];
  disabled?: boolean;
  error?: string;
}

const numberInput =
  'min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-gray-50';

const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

const Chip = ({ on, label, count, disabled, onClick }: { on: boolean; label: string; count?: number; disabled?: boolean; onClick: () => void }) => (
  <button
    type="button"
    role="checkbox"
    aria-checked={on}
    disabled={disabled}
    onClick={onClick}
    className={`inline-flex min-h-10 items-center gap-1.5 rounded-xl border px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 ${
      on ? 'border-indigo-400 bg-indigo-50 text-indigo-800' : 'border-gray-200 bg-white text-gray-700 hover:border-indigo-200'
    }`}
  >
    <span className={`flex h-4 w-4 items-center justify-center rounded border ${on ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-300'}`} aria-hidden>
      {on && <Check size={12} />}
    </span>
    {label}
    {count !== undefined && <span className="text-xs text-gray-400">{count}</span>}
  </button>
);

/**
 * Apply-conditions editor (engine contract v7 §2.2). Each condition is an AND
 * of the criteria set; inside a criterion the values mean "one of". The engine
 * enforces it at apply time — this only builds the config and previews it.
 */
const ApplyConditionsEditor = ({ value, onChange, menus, disabled = false, error }: ApplyConditionsEditorProps) => {
  const update = (i: number, patch: Partial<PromotionApplyCondition>) =>
    onChange((ac) => ({ ...ac, conditions: ac.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));
  const remove = (i: number) => onChange((ac) => ({ ...ac, conditions: ac.conditions.filter((_, j) => j !== i) }));
  const add = () => onChange((ac) => ({ ...ac, conditions: [...ac.conditions, { ...EMPTY_APPLY_CONDITION }] }));
  const preview = formatPromotionConditions(summarizeConditions(value, menus), 'vi');

  return (
    <div className="space-y-3 sm:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-gray-700">{t.conditions.title}</span>
        {value.conditions.length > 1 && (
          <span className="w-full sm:w-72">
            <SelectControl
              aria-label={t.conditions.match}
              disabled={disabled}
              value={value.match}
              onChange={(e) => onChange((ac) => ({ ...ac, match: e.target.value as ApplyConditions['match'] }))}
            >
              <option value="ALL">{t.conditions.matchAll}</option>
              <option value="ANY">{t.conditions.matchAny}</option>
            </SelectControl>
          </span>
        )}
      </div>

      {value.conditions.length === 0 && <p className="rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-600">{t.conditions.none}</p>}

      {value.conditions.map((c, i) => {
        const scopeMenus = c.menus.length ? menus.filter((m) => c.menus.includes(m.code)) : menus;
        const categories = [...new Map(scopeMenus.flatMap((m) => m.categories).map((x) => [x.code, x])).values()];
        const services = scopeMenus
          .flatMap((m) => m.services)
          .filter((s) => !c.categories.length || s.categoryCodes.some((code) => c.categories.includes(code)))
          .filter((s) => !c.serviceIds.includes(s.id));
        const nameOf = (id: string) => menus.flatMap((m) => m.services).find((s) => s.id === id)?.name ?? id;
        const one = formatPromotionConditions(summarizeConditions({ match: 'ALL', conditions: [c] }, menus), 'vi')[0];
        return (
          <fieldset key={i} disabled={disabled} className="space-y-3 rounded-2xl border border-gray-200 p-4">
            <legend className="flex w-full items-center justify-between gap-2">
              <span className="px-1 text-sm font-semibold text-gray-800">{t.conditions.item(i + 1)}</span>
              <button type="button" onClick={() => remove(i)} aria-label={t.conditions.remove(i + 1)} className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-rose-50 hover:text-rose-600">
                <Trash2 size={16} aria-hidden />
              </button>
            </legend>

            <div>
              <p className="mb-1.5 text-xs font-medium text-gray-600">{t.conditions.menus}</p>
              <div className="flex flex-wrap gap-2">
                {menus.map((m) => (
                  <Chip key={m.code} on={c.menus.includes(m.code)} label={m.label} count={m.serviceCount} onClick={() => update(i, { menus: toggle(c.menus, m.code), categories: [], serviceIds: [] })} />
                ))}
              </div>
            </div>

            {categories.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-gray-600">{t.conditions.categories}</p>
                <div className="flex flex-wrap gap-2">
                  {categories.map((cat) => (
                    <Chip key={cat.code} on={c.categories.includes(cat.code)} label={cat.label} count={cat.serviceCount} onClick={() => update(i, { categories: toggle(c.categories, cat.code), serviceIds: [] })} />
                  ))}
                </div>
              </div>
            )}

            <div>
              <p className="mb-1.5 text-xs font-medium text-gray-600">{t.conditions.services}</p>
              {c.serviceIds.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {c.serviceIds.map((id) => (
                    <span key={id} className="inline-flex min-h-9 items-center gap-1 rounded-xl bg-indigo-50 pl-3 pr-1 text-sm text-indigo-800">
                      {nameOf(id)}
                      <button type="button" onClick={() => update(i, { serviceIds: c.serviceIds.filter((x) => x !== id) })} aria-label={t.conditions.removeService} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-indigo-100">
                        <X size={14} aria-hidden />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <SelectControl value="" onChange={(e) => e.target.value && update(i, { serviceIds: [...c.serviceIds, e.target.value] })} aria-label={t.conditions.addService}>
                <option value="">{services.length ? t.conditions.addService : t.conditions.noService}</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </SelectControl>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-600">{t.conditions.minMinutes}</span>
                <input type="number" inputMode="numeric" min={1} className={numberInput} value={c.minMinutes ?? ''} onChange={(e) => update(i, { minMinutes: e.target.value === '' ? null : Number(e.target.value) })} />
                <span className="mt-1 block text-[11px] text-gray-500">{t.conditions.minMinutesHint}</span>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-600">{t.conditions.minOrderAmount}</span>
                <input type="number" inputMode="numeric" min={0} step={10000} className={numberInput} value={c.minOrderAmount ?? ''} onChange={(e) => update(i, { minOrderAmount: e.target.value === '' ? null : Number(e.target.value) })} />
              </label>
            </div>

            {one && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{one}</p>}
          </fieldset>
        );
      })}

      {error && <p role="alert" className="text-xs font-medium text-rose-600">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {value.conditions.length < MAX_APPLY_CONDITIONS && !disabled && (
          <button type="button" onClick={add} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-dashed border-indigo-300 px-4 text-sm font-semibold text-indigo-700 hover:bg-indigo-50">
            <Plus size={16} aria-hidden />
            {t.conditions.add}
          </button>
        )}
        {preview.length > 0 && (
          <p className="text-xs text-gray-500">
            {t.conditions.preview}: <span className="font-medium text-gray-800">{preview.join('; ')}</span>
          </p>
        )}
      </div>
    </div>
  );
};

export default ApplyConditionsEditor;

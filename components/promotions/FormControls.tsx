'use client';

import React, { useState } from 'react';
import { CalendarDays, ChevronDown } from 'lucide-react';
import { t } from './promotion.i18n';

/**
 * Shared select / date controls for every Promotions filter and form.
 * Native pickers are kept (best on phones); only the chrome is styled so
 * all dropdowns look the same and an empty date is never a blank box (iOS).
 */

const base = (invalid?: boolean, disabled?: boolean) =>
  `min-h-11 w-full rounded-xl border bg-white text-sm text-gray-900 shadow-sm transition-colors focus:outline-none focus:ring-2 ${
    invalid ? 'border-rose-300 focus:ring-rose-100' : 'border-gray-200 hover:border-gray-300 focus:border-indigo-400 focus:ring-indigo-100'
  } ${disabled ? 'cursor-not-allowed bg-gray-50 text-gray-500' : ''}`;

type SelectControlProps = React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean };

export const SelectControl = ({ invalid, disabled, className = '', children, ...rest }: SelectControlProps) => (
  <span className="relative block">
    <select {...rest} disabled={disabled} className={`${base(invalid, disabled)} cursor-pointer appearance-none pl-3 pr-10 ${className}`}>
      {children}
    </select>
    <ChevronDown size={18} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden />
  </span>
);

interface DateControlProps {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  invalid?: boolean;
  'aria-label'?: string;
}

export const DateControl = ({ value, onChange, min, max, disabled, invalid, ...aria }: DateControlProps) => {
  const [focused, setFocused] = useState(false);
  const showHint = !value && !focused;
  return (
    <span className="relative block">
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        aria-label={aria['aria-label']}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        // Native picker indicator is stretched invisibly over the box: tap anywhere opens the calendar.
        className={`${base(invalid, disabled)} block appearance-none pl-3 pr-10 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0 ${
          showHint ? 'text-transparent' : ''
        }`}
      />
      {/* Dim hint while empty — iOS otherwise shows a blank box. */}
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm ${showHint ? 'text-gray-400' : 'hidden'}`}
      >
        {t.controls.pickDate}
      </span>
      <CalendarDays size={18} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden />
    </span>
  );
};

/** Visible label above a filter control (phones never rely on placeholders). */
export const FilterField = ({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) => (
  <label className={`block ${className}`}>
    <span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>
    {children}
  </label>
);

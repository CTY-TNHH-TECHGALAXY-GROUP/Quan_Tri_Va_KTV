import { useCallback, useState } from 'react';
import { getJson, sendJson } from '../_shared/officeApi';
import { t } from '../_shared/officeAdmin.i18n';

export type TimeMode = 'FREE' | 'DEADLINE' | 'WINDOW' | 'MULTI';
export const TIME_MODES: TimeMode[] = ['FREE', 'DEADLINE', 'WINDOW', 'MULTI'];

export interface SlotDraft { label: string; ref_path: string | null; refUrl: string | null; uploading?: boolean }
export interface FieldDraft { kind: 'check' | 'count'; label: string; unit: string; min: string }

export interface ConfigDraft {
  id: string;
  name: string;
  standard_text: string;
  sopText: string;
  slots: SlotDraft[];
  fields: FieldDraft[];
  time_mode: TimeMode;
  due_time: string;
  window_start: string;
  window_end: string;
  multiText: string;
  blocks_checkout: boolean;
  requires_review: boolean;
  allow_carry_over: boolean;
}

const hm = (v: unknown) => (typeof v === 'string' ? v.slice(0, 5) : '');

/** Detail config of one task template; saves through /api/support/task-template-config. */
export const useTemplateConfig = () => {
  const [draft, setDraft] = useState<ConfigDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback(async (templateId: string) => {
    setError(null);
    setLoading(true);
    try {
      const { data: d } = await getJson(`/api/support/task-template-config?id=${encodeURIComponent(templateId)}`);
      setDraft({
        id: d.id,
        name: d.name,
        standard_text: d.standard_text || '',
        sopText: (Array.isArray(d.sop) ? d.sop : []).join('\n'),
        slots: (Array.isArray(d.photo_slots) ? d.photo_slots : []).map((s: any, i: number) => ({ label: s.label || '', ref_path: s.ref_path || null, refUrl: d.refUrls?.[i] || null })),
        fields: (Array.isArray(d.evidence_fields) ? d.evidence_fields : []).map((f: any) => ({
          kind: f.kind === 'count' ? 'count' : 'check', label: f.label || '', unit: f.unit || '', min: f.min === undefined || f.min === null ? '' : String(f.min),
        })),
        time_mode: TIME_MODES.includes(d.time_mode) ? d.time_mode : 'FREE',
        due_time: hm(d.due_time),
        window_start: hm(d.window_start),
        window_end: hm(d.window_end),
        multiText: (Array.isArray(d.multi_times) ? d.multi_times : []).join(', '),
        blocks_checkout: d.blocks_checkout !== false,
        requires_review: d.requires_review !== false,
        allow_carry_over: d.allow_carry_over !== false,
      });
    } catch (e: any) {
      setError(e.message || t.common.error);
    } finally {
      setLoading(false);
    }
  }, []);

  const update = (patch: Partial<ConfigDraft>) => setDraft(d => (d ? { ...d, ...patch } : d));
  const updateSlot = (i: number, patch: Partial<SlotDraft>) =>
    setDraft(d => (d ? { ...d, slots: d.slots.map((s, j) => (j === i ? { ...s, ...patch } : s)) } : d));
  const updateField = (i: number, patch: Partial<FieldDraft>) =>
    setDraft(d => (d ? { ...d, fields: d.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) } : d));

  const uploadRef = async (i: number, file: File) => {
    updateSlot(i, { uploading: true });
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('kind', 'ref');
      const res = await fetch('/api/support/tasks/rework-photo', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || t.common.error);
      updateSlot(i, { ref_path: json.path, refUrl: json.url, uploading: false });
    } catch (e: any) {
      setError(e.message || t.common.error);
      updateSlot(i, { uploading: false });
    }
  };

  const save = async () => {
    if (!draft) return false;
    setSaving(true);
    setError(null);
    try {
      await sendJson('/api/support/task-template-config', 'PATCH', {
        id: draft.id,
        standard_text: draft.standard_text,
        sop: draft.sopText.split('\n').map(s => s.trim()).filter(Boolean),
        photo_slots: draft.slots.filter(s => s.label.trim()).map(s => ({ label: s.label.trim(), ref_path: s.ref_path })),
        evidence_fields: draft.fields.filter(f => f.label.trim()).map(f => (f.kind === 'check'
          ? { kind: 'check', label: f.label.trim() }
          : { kind: 'count', label: f.label.trim(), unit: f.unit.trim() || undefined, min: f.min.trim() === '' ? undefined : Number(f.min) })),
        time_mode: draft.time_mode,
        due_time: draft.due_time || null,
        window_start: draft.window_start || null,
        window_end: draft.window_end || null,
        multi_times: draft.multiText.split(/[,\s]+/).map(s => s.trim()).filter(Boolean),
        blocks_checkout: draft.blocks_checkout,
        requires_review: draft.requires_review,
        allow_carry_over: draft.allow_carry_over,
      });
      setDraft(null);
      return true;
    } catch (e: any) {
      setError(e.message || t.common.error);
      return false;
    } finally {
      setSaving(false);
    }
  };

  return { draft, setDraft, loading, saving, error, open, update, updateSlot, updateField, uploadRef, save };
};

export type TemplateConfigLogic = ReturnType<typeof useTemplateConfig>;

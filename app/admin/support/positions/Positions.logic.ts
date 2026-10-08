import { useCallback, useEffect, useState } from 'react';
import { getJson, sendJson, type CategoryOption, type StaffOption } from '../_shared/officeApi';
import { t } from '../_shared/officeAdmin.i18n';

// 🔧 UI CONFIGURATION
const TOAST_MS = 2600;

export type AcceptPolicy = 'MANDATORY' | 'ACCEPT_REQUIRED' | 'ACCEPT_OR_DECLINE';
export const POLICIES: AcceptPolicy[] = ['MANDATORY', 'ACCEPT_REQUIRED', 'ACCEPT_OR_DECLINE'];

export interface Position {
  id: string;
  name: string;
  branch: string | null;
  shift_start: string | null;
  shift_end: string | null;
  fixed_accept_policy: AcceptPolicy;
  adhoc_accept_policy: AcceptPolicy;
  is_active: boolean;
  memberIds: string[];
  setIds: string[];
}

export interface TemplateSet {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  version: number | null;
  categoryIds: string[];
}

export type PositionDraft = Omit<Position, 'id'> & { id?: string };
export type SetDraft = Omit<TemplateSet, 'id' | 'version'> & { id?: string };

const NEW_POSITION: PositionDraft = {
  name: '', branch: null, shift_start: null, shift_end: null,
  // Only a starting suggestion — the admin picks the real value.
  fixed_accept_policy: 'MANDATORY', adhoc_accept_policy: 'ACCEPT_REQUIRED',
  is_active: true, memberIds: [], setIds: [],
};
const NEW_SET: SetDraft = { name: '', description: null, is_active: true, categoryIds: [] };

export const usePositionsAdmin = () => {
  const [positions, setPositions] = useState<Position[]>([]);
  const [sets, setSets] = useState<TemplateSet[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [positionDraft, setPositionDraft] = useState<PositionDraft | null>(null);
  const [setDraft, setSetDraft] = useState<SetDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([getJson('/api/support/positions'), getJson('/api/support/template-sets')]);
      setPositions(p.data || []);
      setStaff(p.staff || []);
      setCategories(p.categories || []);
      setSets(s.data || []);
      setLoadError(null);
    } catch (e: any) {
      setLoadError(e.message || t.common.error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), TOAST_MS); };

  const editPosition = (p?: Position) => { setFormError(null); setPositionDraft(p ? { ...p } : { ...NEW_POSITION }); };
  const editSet = (s?: TemplateSet) => { setFormError(null); setSetDraft(s ? { id: s.id, name: s.name, description: s.description, is_active: s.is_active, categoryIds: [...s.categoryIds] } : { ...NEW_SET }); };

  /** Saved policy of the position being edited — to warn that a change only affects new tasks. */
  const originalOf = (id?: string) => positions.find(p => p.id === id) || null;

  const save = async (url: string, body: unknown, method: 'POST' | 'PATCH', close: () => void) => {
    setSaving(true);
    setFormError(null);
    try {
      await sendJson(url, method, body);
      close();
      showToast(t.common.saved);
      await load();
    } catch (e: any) {
      setFormError(e.message || t.common.error);
    } finally {
      setSaving(false);
    }
  };

  const savePosition = () => positionDraft &&
    save('/api/support/positions', positionDraft, positionDraft.id ? 'PATCH' : 'POST', () => setPositionDraft(null));
  const saveSet = () => setDraft &&
    save('/api/support/template-sets', setDraft, setDraft.id ? 'PATCH' : 'POST', () => setSetDraft(null));

  const staffName = (id: string) => staff.find(s => s.id === id)?.name || id;
  const setName = (id: string) => sets.find(s => s.id === id)?.name || id;
  const categoryName = (id: string) => categories.find(c => c.id === id)?.name || id;

  return {
    loading, loadError, reload: load,
    positions, sets, staff, categories, staffName, setName, categoryName,
    positionDraft, setPositionDraft, editPosition, savePosition, originalOf,
    setDraft, setSetDraft, editSet, saveSet,
    saving, formError, toast,
  };
};

export type PositionsLogic = ReturnType<typeof usePositionsAdmin>;

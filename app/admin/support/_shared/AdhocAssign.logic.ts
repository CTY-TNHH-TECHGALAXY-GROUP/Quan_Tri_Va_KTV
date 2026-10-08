import { useCallback, useEffect, useState } from 'react';
import { getJson, sendJson, type CategoryOption, type StaffOption } from './officeApi';

/** Working staff + task categories for pickers (one request, cached per mount). */
export const useOfficeOptions = (enabled = true) => {
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!enabled || loaded) return;
    getJson('/api/support/positions')
      .then(json => { setStaff(json.staff || []); setCategories(json.categories || []); })
      .catch(e => console.error('[office options]', e))
      .finally(() => setLoaded(true));
  }, [enabled, loaded]);

  return { staff, categories, loaded };
};

export interface AdhocForm {
  assigneeId: string;
  name: string;
  standardText: string;
  slotsText: string;
  highPriority: boolean;
  dueTime: string;          // HH:mm today (VN), optional
  blocksCheckout: boolean;
}

const EMPTY: AdhocForm = { assigneeId: '', name: '', standardText: '', slotsText: '', highPriority: true, dueTime: '', blocksCheckout: true };

/** HH:mm today in Vietnam → ISO. */
const todayVnTimeToIso = (hhmm: string) => {
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
  return new Date(`${day}T${hhmm}:00+07:00`).toISOString();
};

export const useAdhocAssign = (onDone?: () => void) => {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<AdhocForm>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = useOfficeOptions(open);

  const start = useCallback((preset: Partial<AdhocForm> = {}) => {
    setForm({ ...EMPTY, ...preset });
    setError(null);
    setOpen(true);
  }, []);

  const update = (patch: Partial<AdhocForm>) => setForm(f => ({ ...f, ...patch }));

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await sendJson('/api/support/tasks/adhoc', 'POST', {
        assigneeId: form.assigneeId,
        name: form.name,
        standardText: form.standardText,
        photoSlots: form.slotsText.split('\n').map(s => s.trim()).filter(Boolean),
        priority: form.highPriority ? 'HIGH' : 'NORMAL',
        dueAt: form.dueTime ? todayVnTimeToIso(form.dueTime) : null,
        blocksCheckout: form.blocksCheckout,
      });
      setOpen(false);
      onDone?.();
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  return { open, setOpen, form, update, start, submit, saving, error, staff: options.staff };
};

export type AdhocAssignLogic = ReturnType<typeof useAdhocAssign>;

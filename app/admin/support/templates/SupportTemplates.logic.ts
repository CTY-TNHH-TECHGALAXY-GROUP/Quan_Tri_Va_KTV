import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

// ============================================================
// 🔧 UI CONFIGURATION
// ============================================================
const TODAY_START = new Date();
TODAY_START.setHours(0, 0, 0, 0);

const TODAY_END = new Date();
TODAY_END.setHours(23, 59, 59, 999);

// ============================================================
// Types
// ============================================================
interface EmployeeCard {
  id: string;
  fullName: string;
  role: string;
  totalTasks: number;
  completedTasks: number;
}

interface CategoryItem {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
}

interface TemplateItem {
  id: string;
  name: string;
  categoryName: string;
  roomName: string;
  cron_schedule: string;
  requires_photo: boolean;
  min_photo_count: number;
  is_active: boolean;
}

export type ActiveTab = 'EMPLOYEES' | 'TEMPLATES' | 'CATEGORIES';

export const useSupportTemplates = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('EMPLOYEES');
  const [employees, setEmployees] = useState<EmployeeCard[]>([]);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [loading, setLoading] = useState(true);

  // ============================================================
  // Fetch employees with today's task progress
  // ============================================================
  const fetchEmployees = useCallback(async () => {
    // Step 1: Fetch all users (employees)
    const { data: users, error: usersErr } = await supabase
      .from('Users')
      .select('id, fullName, role')
      .order('fullName');

    if (usersErr) {
      console.error('Error fetching users:', usersErr.message, usersErr.code);
      return;
    }

    // Step 2: Fetch today's tasks for progress calculation
    const { data: todayTasks, error: tasksErr } = await supabase
      .from('Tasks')
      .select('assignee_id, status')
      .gte('created_at', TODAY_START.toISOString())
      .lte('created_at', TODAY_END.toISOString());

    if (tasksErr) {
      console.error('Error fetching tasks:', tasksErr.message, tasksErr.code);
    }

    // Step 3: Count routines per employee
    const { data: routineCounts, error: routineErr } = await supabase
      .from('EmployeeRoutines')
      .select('employee_id')
      .eq('is_active', true);

    if (routineErr) {
      console.error('Error fetching routines:', routineErr.message, routineErr.code);
    }

    // Build lookup maps
    const taskMap = new Map<string, { total: number; completed: number }>();
    (todayTasks || []).forEach(t => {
      const current = taskMap.get(t.assignee_id) || { total: 0, completed: 0 };
      current.total++;
      if (t.status === 'COMPLETED') current.completed++;
      taskMap.set(t.assignee_id, current);
    });

    const routineMap = new Map<string, number>();
    (routineCounts || []).forEach(r => {
      routineMap.set(r.employee_id, (routineMap.get(r.employee_id) || 0) + 1);
    });

    const mapped: EmployeeCard[] = (users || []).map(u => {
      const taskProgress = taskMap.get(u.id);
      const routineCount = routineMap.get(u.id) || 0;
      return {
        id: u.id,
        fullName: u.fullName || 'Chưa đặt tên',
        role: u.role || 'STAFF',
        totalTasks: taskProgress?.total || routineCount,
        completedTasks: taskProgress?.completed || 0,
      };
    });

    setEmployees(mapped);
  }, []);

  // ============================================================
  // Fetch categories (real data from Supabase)
  // ============================================================
  const fetchCategories = useCallback(async () => {
    const { data, error } = await supabase
      .from('TaskCategories')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching categories:', error.message, error.code);
      return;
    }
    setCategories(data || []);
  }, []);

  // ============================================================
  // Fetch templates (real data from Supabase)
  // ============================================================
  const fetchTemplates = useCallback(async () => {
    const { data, error } = await supabase
      .from('TaskTemplates')
      .select('*, TaskCategories(name), Rooms(name)')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching templates:', error.message, error.code);
      return;
    }

    const mapped: TemplateItem[] = (data || []).map(tpl => ({
      id: tpl.id,
      name: tpl.name,
      categoryName: (tpl as any).TaskCategories?.name || '—',
      roomName: (tpl as any).Rooms?.name || 'Chung',
      cron_schedule: tpl.cron_schedule || '—',
      requires_photo: tpl.requires_photo,
      min_photo_count: tpl.min_photo_count,
      is_active: tpl.is_active,
    }));

    setTemplates(mapped);
  }, []);

  // ============================================================
  // Initial fetch
  // ============================================================
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([fetchEmployees(), fetchCategories(), fetchTemplates()]);
      setLoading(false);
    };
    init();
  }, [fetchEmployees, fetchCategories, fetchTemplates]);

  // ============================================================
  // Role label helper
  // ============================================================
  const getRoleLabel = (role: string) => {
    const map: Record<string, string> = {
      ADMIN: 'Quản lý',
      RECEPTIONIST: 'Lễ tân',
      TECHNICIAN: 'KTV',
    };
    return map[role] || role;
  };

  return {
    activeTab,
    setActiveTab,
    employees,
    categories,
    templates,
    loading,
    getRoleLabel,
    refetchEmployees: fetchEmployees,
  };
};

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
  type: 'ROLE' | 'ROOM';
  is_active: boolean;
}

interface TemplateItem {
  id: string;
  name: string;
  categoryName: string;
  categoryType: 'ROLE' | 'ROOM';
  roomName: string;
  cron_schedule: string;
  requires_photo: boolean;
  min_photo_count: number;
  sort_order: number;
  is_active: boolean;
  assignedEmployees: string[]; // fullName list
}

export type ActiveTab = 'EMPLOYEES' | 'TEMPLATES' | 'CATEGORIES' | 'DASHBOARD' | 'REVIEWS' | 'ROOM_MATRIX';

export const useSupportTemplates = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('EMPLOYEES');
  const [employees, setEmployees] = useState<EmployeeCard[]>([]);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [rooms, setRooms] = useState<{ id: string; name: string }[]>([]);
  const [roomMatrix, setRoomMatrix] = useState<Record<string, Set<string>>>({}); // templateId -> Set<roomId>
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
  // Fetch templates + who is assigned (EmployeeRoutines)
  // ============================================================
  const fetchTemplates = useCallback(async () => {
    const { data, error } = await supabase
      .from('TaskTemplates')
      .select('*, TaskCategories(name, type)')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching templates:', error.message, error.code);
      return;
    }

    // Step 2: Fetch assigned employees
    const { data: routines, error: routineErr } = await supabase
      .from('EmployeeRoutines')
      .select('template_id, Users(fullName)')
      .eq('is_active', true);

    if (routineErr) {
      console.error('Error fetching routines for templates:', routineErr.message);
    }

    // Build lookup: template_id -> [employeeNames]
    const assignmentMap = new Map<string, string[]>();
    (routines || []).forEach((r: any) => {
      const name = r.Users?.fullName || 'Chưa rõ';
      const list = assignmentMap.get(r.template_id) || [];
      list.push(name);
      assignmentMap.set(r.template_id, list);
    });

    const mapped: TemplateItem[] = (data || []).map(tpl => ({
      id: tpl.id,
      name: tpl.name,
      categoryName: (tpl as any).TaskCategories?.name || '—',
      categoryType: (tpl as any).TaskCategories?.type || 'ROLE',
      roomName: 'Đa phòng', // We can't display a single room name here anymore
      cron_schedule: tpl.cron_schedule || '—',
      requires_photo: tpl.requires_photo,
      min_photo_count: tpl.min_photo_count,
      sort_order: tpl.sort_order || 0,
      is_active: tpl.is_active,
      assignedEmployees: assignmentMap.get(tpl.id) || [],
    }));

    setTemplates(mapped);
  }, []);

  // ============================================================
  // Fetch Rooms & Room Matrix
  // ============================================================
  const fetchRooms = useCallback(async () => {
    const { data, error } = await supabase.from('Rooms').select('id, name, type, capacity').order('name');
    if (error) {
      console.error('Error fetching rooms:', error.message);
    } else {
      setRooms(data || []);
    }
  }, []);

  const fetchRoomMatrix = useCallback(async () => {
    const { data, error } = await supabase.from('RoomTaskTemplates').select('room_id, template_id');
    if (error) {
      console.error('Error fetching room matrix:', error.message);
    } else {
      const matrix: Record<string, Set<string>> = {};
      (data || []).forEach(row => {
        if (!matrix[row.template_id]) matrix[row.template_id] = new Set();
        matrix[row.template_id].add(row.room_id);
      });
      setRoomMatrix(matrix);
    }
  }, []);

  const toggleRoomMatrix = async (templateId: string, roomId: string, isChecked: boolean) => {
    // Optimistic UI update
    setRoomMatrix(prev => {
      const next = { ...prev };
      if (!next[templateId]) next[templateId] = new Set();
      
      const newSet = new Set(next[templateId]);
      if (isChecked) {
        newSet.add(roomId);
      } else {
        newSet.delete(roomId);
      }
      next[templateId] = newSet;
      return next;
    });

    if (isChecked) {
      await supabase.from('RoomTaskTemplates').insert({ template_id: templateId, room_id: roomId });
    } else {
      await supabase.from('RoomTaskTemplates')
        .delete()
        .eq('template_id', templateId)
        .eq('room_id', roomId);
    }
  };

  // ============================================================
  // Initial fetch
  // ============================================================
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([fetchEmployees(), fetchCategories(), fetchTemplates(), fetchRooms(), fetchRoomMatrix()]);
      setLoading(false);
    };
    init();
  }, [fetchEmployees, fetchCategories, fetchTemplates, fetchRooms, fetchRoomMatrix]);

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

  // ============================================================
  // Save Category with multiple templates (Kho Việc UI)
  // ============================================================
  const saveCategoryWithTemplates = async (
    categoryId: string | null, // null means new category
    categoryName: string,
    tasksToSave: { id?: string; name: string; requires_photo: boolean; min_photo_count: number }[],
    categoryType: 'ROLE' | 'ROOM' = 'ROLE'
  ) => {
    try {
      let finalCategoryId = categoryId;
      
      // 1. Create or update category
      if (!finalCategoryId) {
        const { data: newCat, error: catErr } = await supabase
          .from('TaskCategories')
          .insert({ name: categoryName, type: categoryType })
          .select('id')
          .single();
          
        if (catErr) {
          console.error('Error creating category:', catErr.message);
          return false;
        }
        finalCategoryId = newCat.id;
      } else {
        const { error: catUpdateErr } = await supabase
          .from('TaskCategories')
          .update({ name: categoryName, type: categoryType })
          .eq('id', finalCategoryId);
          
        if (catUpdateErr) {
          console.error('Error updating category:', catUpdateErr.message);
          return false;
        }
      }

      // 2. Add new tasks or update existing
      for (let i = 0; i < tasksToSave.length; i++) {
        const t = tasksToSave[i];
        if (t.name.trim() === '') continue;
        
        if (t.id) {
          // Update existing
          await supabase.from('TaskTemplates').update({
            name: t.name,
            requires_photo: t.requires_photo,
            min_photo_count: t.min_photo_count,
            sort_order: i,
          }).eq('id', t.id);
        } else {
          // Insert new
          await supabase.from('TaskTemplates').insert({
            name: t.name,
            category_id: finalCategoryId,
            requires_photo: t.requires_photo,
            min_photo_count: t.min_photo_count,
            sort_order: i,
            is_active: true,
          });
        }
      }
      
      await Promise.all([fetchCategories(), fetchTemplates()]);
      return true;
    } catch (e) {
      console.error('saveCategoryWithTemplates exception:', e);
      return false;
    }
  };

  return {
    activeTab,
    setActiveTab,
    employees,
    categories,
    templates,
    rooms,
    roomMatrix,
    loading,
    getRoleLabel,
    saveCategoryWithTemplates,
    toggleRoomMatrix,
    refetchEmployees: fetchEmployees,
    refetchTemplates: fetchTemplates,
  };
};

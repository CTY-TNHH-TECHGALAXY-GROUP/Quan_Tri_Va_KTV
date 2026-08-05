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
  type: 'ROLE' | 'ROOM' | 'ROOM_VIRTUAL';
  is_active: boolean;
  repeat_mode?: string;
}

interface TemplateItem {
  id: string;
  name: string;
  categoryName: string;
  categoryType: 'ROLE' | 'ROOM' | 'ROOM_VIRTUAL';
  roomName: string;
  cron_schedule: string;
  requires_photo: boolean;
  min_photo_count: number;
  sort_order: number;
  is_active: boolean;
  assignedEmployees: string[]; // fullName list
}

export type ActiveTab = 'EMPLOYEES' | 'TEMPLATES' | 'ROOM_MATRIX' | 'REVIEWS' | 'DASHBOARD';

export interface MatrixCellData {
  active: boolean;
  custom_min_photo_count?: number | null;
}

export const useSupportTemplates = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('EMPLOYEES');
  const [employees, setEmployees] = useState<EmployeeCard[]>([]);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [rooms, setRooms] = useState<{ id: string; name: string }[]>([]);
  const [roomMatrix, setRoomMatrix] = useState<Record<string, Record<string, MatrixCellData>>>({});
  const [pendingMatrix, setPendingMatrix] = useState<Record<string, Record<string, MatrixCellData>>>({});
  const [isMatrixDirty, setIsMatrixDirty] = useState(false);
  const [isSavingMatrix, setIsSavingMatrix] = useState(false); // templateId -> roomId -> MatrixCellData
  
  const [virtualCategories, setVirtualCategories] = useState<CategoryItem[]>([]);
  const [virtualTemplates, setVirtualTemplates] = useState<TemplateItem[]>([]);
  
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
      .order('name', { ascending: true });

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
      .eq('is_active', true)
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
    try {
      const res = await fetch('/api/support/room-matrix');
      if (!res.ok) throw new Error('Failed to fetch room matrix');
      const { data, success } = await res.json();
      
      if (success) {
        const matrix: Record<string, Record<string, MatrixCellData>> = {};
        (data || []).forEach((row: any) => {
          if (!matrix[row.template_id]) matrix[row.template_id] = {};
          matrix[row.template_id][row.room_id] = {
            active: true,
            custom_min_photo_count: row.custom_min_photo_count,
          };
        });
        setRoomMatrix(matrix);

        // Update pendingMatrix as well when fetching fresh data
        const cloned: Record<string, Record<string, MatrixCellData>> = {};
        for (const k in matrix) {
          cloned[k] = { ...matrix[k] };
        }
        setPendingMatrix(cloned);
      }
      setIsMatrixDirty(false);
    } catch (error: any) {
      console.error('Error fetching room matrix:', error.message);
    }
  }, []);

  const toggleRoomMatrix = async (templateId: string, roomId: string, isChecked: boolean) => {
    // Only update local pending state
    setPendingMatrix(prev => {
      const next = { ...prev };
      if (!next[templateId]) next[templateId] = {};
      
      const newMap = { ...next[templateId] };
      if (isChecked) {
        newMap[roomId] = { active: true, custom_min_photo_count: null };
      } else {
        delete newMap[roomId];
      }
      next[templateId] = newMap;
      return next;
    });
    setIsMatrixDirty(true);
  };
  
  const updateCustomPhotoCount = (templateId: string, roomId: string, count: number | null) => {
    setPendingMatrix(prev => {
      const next = { ...prev };
      if (!next[templateId]) return next;
      if (!next[templateId][roomId]) return next;
      
      next[templateId] = {
        ...next[templateId],
        [roomId]: {
          ...next[templateId][roomId],
          custom_min_photo_count: count
        }
      };
      return next;
    });
    setIsMatrixDirty(true);
  };

  const saveRoomMatrix = async () => {
    setIsSavingMatrix(true);
    try {
      // Flatten pendingMatrix into array
      const matrixArr: { template_id: string; room_id: string; custom_min_photo_count?: number | null }[] = [];
      for (const tplId in pendingMatrix) {
        for (const rId in pendingMatrix[tplId]) {
          const cell = pendingMatrix[tplId][rId];
          if (cell.active) {
             matrixArr.push({ 
               template_id: tplId, 
               room_id: rId,
               custom_min_photo_count: cell.custom_min_photo_count
             });
          }
        }
      }

      const res = await fetch('/api/support/room-matrix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bulk: true, matrix: matrixArr }),
      });
      if (!res.ok) {
        throw new Error('Failed to save room matrix');
      }
      // Commit pending to current
      const cloned: Record<string, Record<string, MatrixCellData>> = {};
      for (const k in pendingMatrix) {
        cloned[k] = { ...pendingMatrix[k] };
      }
      setRoomMatrix(cloned);
      setIsMatrixDirty(false);
      alert('Đã lưu phân bổ công việc phòng thành công!');
    } catch (error) {
      console.error('Error saving room matrix:', error);
      alert('Có lỗi xảy ra khi lưu. Vui lòng thử lại.');
    } finally {
      setIsSavingMatrix(false);
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
  // Build Virtual Categories for Rooms (derived state)
  // ============================================================
  useEffect(() => {
    if (rooms.length === 0 || templates.length === 0 || Object.keys(roomMatrix).length === 0) {
      setVirtualCategories([]);
      setVirtualTemplates([]);
      return;
    }

    const formatRoomName = (name: string) => {
      if (!name) return '';
      return name.replace(/Nhà vệ sinh [Ll]ầu /g, 'NVS').replace(/Nhà tắm [Ll]ầu /g, 'NTL');
    };

    const vCats: CategoryItem[] = rooms.map(r => ({
      id: `virtual_room_${r.id}`,
      name: `Phòng ${formatRoomName(r.name)}`,
      description: 'Công việc theo ma trận phòng',
      type: 'ROOM_VIRTUAL' as any,
      is_active: true
    }));

    const vTpls: TemplateItem[] = [];
    templates.forEach(tpl => {
      const mappedRooms = roomMatrix[tpl.id];
      if (mappedRooms) {
        Object.keys(mappedRooms).forEach(roomId => {
          if (mappedRooms[roomId].active) {
            const customCount = mappedRooms[roomId].custom_min_photo_count;
            vTpls.push({
              ...tpl,
              id: `virtual_tpl_${tpl.id}_${roomId}`,
              categoryName: `Phòng ${formatRoomName(rooms.find(r => r.id === roomId)?.name || roomId)}`,
              categoryType: 'ROOM_VIRTUAL' as any,
              // Override min_photo_count from matrix if custom value exists
              min_photo_count: customCount ?? tpl.min_photo_count
            });
          }
        });
      }
    });

    setVirtualCategories(vCats);
    setVirtualTemplates(vTpls);
  }, [rooms, roomMatrix, templates]);

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
    tasksToSave: { id?: string; name: string; requires_photo: boolean; min_photo_count: number; cron_schedule?: string }[],
    categoryType: 'ROLE' | 'ROOM' = 'ROLE',
    repeatMode: string = 'DAILY'
  ) => {
    try {
      let finalCategoryId = categoryId;
      
      // 1. Create or update category
      if (!finalCategoryId) {
        const { data: newCat, error: catErr } = await supabase
          .from('TaskCategories')
          .insert({ name: categoryName, type: categoryType, repeat_mode: repeatMode })
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
          .update({ name: categoryName, type: categoryType, repeat_mode: repeatMode })
          .eq('id', finalCategoryId);
          
        if (catUpdateErr) {
          console.error('Error updating category:', catUpdateErr.message);
          return false;
        }
      }

      // 2. Add new tasks or update existing
      const savedTaskIds: string[] = [];

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
            cron_schedule: t.cron_schedule || null,
          }).eq('id', t.id);
          savedTaskIds.push(t.id);
        } else {
          // Insert new
          const { data: newTasks } = await supabase.from('TaskTemplates').insert({
            name: t.name,
            category_id: finalCategoryId,
            requires_photo: t.requires_photo,
            min_photo_count: t.min_photo_count,
            sort_order: i,
            cron_schedule: t.cron_schedule || null,
            is_active: true,
          }).select('id');
          if (newTasks && newTasks.length > 0) {
            savedTaskIds.push(newTasks[0].id);
          }
        }
      }
      
      // 3. Soft delete tasks that were removed from the UI
      if (finalCategoryId) {
        const { data: existingTasks } = await supabase
          .from('TaskTemplates')
          .select('id')
          .eq('category_id', finalCategoryId)
          .eq('is_active', true);
          
        if (existingTasks) {
          const toDelete = existingTasks
            .map(t => t.id)
            .filter(id => !savedTaskIds.includes(id));
            
          if (toDelete.length > 0) {
            await supabase
              .from('TaskTemplates')
              .update({ is_active: false })
              .in('id', toDelete);
          }
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
    pendingMatrix,
    isMatrixDirty,
    isSavingMatrix,
    saveRoomMatrix,
    virtualCategories,
    virtualTemplates,
    loading,
    getRoleLabel,
    saveCategoryWithTemplates,
    toggleRoomMatrix,
    updateCustomPhotoCount,
    refetchEmployees: fetchEmployees,
    refetchTemplates: fetchTemplates,
  };
};

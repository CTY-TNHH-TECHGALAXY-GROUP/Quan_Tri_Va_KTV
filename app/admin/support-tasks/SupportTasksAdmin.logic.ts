import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
export const useSupportTasksAdmin = () => {
    const [templates, setTemplates] = useState<any[]>([]);
    const [areas, setAreas] = useState<any[]>([]);
    const [staffs, setStaffs] = useState<any[]>([]);
    const [tasks, setTasks] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchData = async () => {
        setLoading(true);
        try {
            // Fetch templates
            const resTemp = await fetch('/api/support/templates');
            const dataTemp = await resTemp.json();
            if (dataTemp.success) setTemplates(dataTemp.data);

            // Fetch areas
            const resArea = await fetch('/api/support/areas');
            const dataArea = await resArea.json();
            if (dataArea.success) setAreas(dataArea.data);

            // Fetch staff (Hậu Cần)
            const { data: staffData } = await supabase
                .from('Staff')
                .select('id, fullName, roles')
                .contains('roles', ['SUPPORT'])
                .eq('isActive', true);
            setStaffs(staffData || []);

            // Fetch tasks assigned today
            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);
            
            const { data: taskData } = await supabase
                .from('SupportTasks')
                .select('*, SupportAreas(area_name), Staff!assignee_id(fullName)')
                .gte('created_at', startOfDay.toISOString())
                .order('created_at', { ascending: false });
            setTasks(taskData || []);

        } catch (error) {
            console.error('Error fetching admin data:', error);
            alert('Lỗi khi tải dữ liệu Hậu cần.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        
        const subTasks = supabase
            .channel('public:SupportTasksAdmin')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'SupportTasks' }, () => {
                fetchData();
            })
            .subscribe();

        return () => {
            supabase.removeChannel(subTasks);
        };
    }, []);

    const addTemplate = async (task_name: string) => {
        try {
            const res = await fetch('/api/support/templates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ task_name })
            });
            const json = await res.json();
            if (json.success) {
                alert('Đã thêm mẫu công việc!');
                fetchData();
            }
        } catch (error) {
            alert('Lỗi khi thêm mẫu công việc');
        }
    };

    const addArea = async (area_name: string) => {
        try {
            const res = await fetch('/api/support/areas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ area_name })
            });
            const json = await res.json();
            if (json.success) {
                alert('Đã thêm khu vực!');
                fetchData();
            }
        } catch (error) {
            alert('Lỗi khi thêm khu vực');
        }
    };

    const assignTasks = async (payload: any[]) => {
        try {
            const res = await fetch('/api/support/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const json = await res.json();
            if (json.success) {
                alert('Giao việc thành công!');
                fetchData();
            } else {
                alert(json.error);
            }
        } catch (error) {
            alert('Lỗi khi giao việc');
        }
    };

    return {
        templates,
        areas,
        staffs,
        tasks,
        loading,
        addTemplate,
        addArea,
        assignTasks,
        refresh: fetchData
    };
};

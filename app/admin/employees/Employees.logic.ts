'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { Employee } from '@/lib/types';
import { useAuth } from '@/lib/auth-context';
import { getStaffList, deleteStaffMember } from './actions';

// 🔧 CONFIGURATION
const DEFAULT_SKILLS = {
    hairCut: false, shampoo: true, hairExtensionShampoo: false, earCombo: false, earChuyen: false,
    machineShave: false, razorShave: false, facial: false, thaiBody: false,
    shiatsuBody: false, oilBody: true, hotStoneBody: false, scrubBody: false, bodyMix: false,
    foot: false, heelScrub: false, nailCombo: false, nailChuyen: false
};

// Legacy foot skill keys to merge into unified 'foot'
const LEGACY_FOOT_KEYS = ['oilFoot', 'hotStoneFoot', 'acupressureFoot'];

/**
 * Custom hook for Employee Management page logic.
 * Handles listing, searching, filtering, adding, editing, and deleting employees.
 */
export const useEmployeeManagement = () => {
    const { hasPermission } = useAuth();
    const [searchTerm, setSearchTerm] = useState('');
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
    const [isDetailOpen, setIsDetailOpen] = useState(false);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [mounted, setMounted] = useState(false);

    // --- DATA FETCHING ---
    const fetchEmployees = useCallback(async () => {
        setIsLoading(true);
        const res = await getStaffList();
        if (res.success && res.data) {
            const filteredData = res.data.filter((s: any) => s.work_type !== 'TYPE_C');
            const mapped: Employee[] = filteredData.map((s: any) => ({
                id: s.id,
                code: s.id,
                name: s.full_name,
                username: s.username,
                password: s.password,
                role: s.userRole || 'TECHNICIAN',
                position: s.position || 'Kỹ Thuật Viên',
                experience: s.experience || '0 năm',
                status: s.status === 'ĐANG LÀM' ? 'active' : 'inactive',
                photoUrl: s.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(s.full_name)}&background=random`,
                phone: s.phone || '',
                email: s.email || '',
                dob: s.birthday || '',
                gender: s.gender || 'Nữ',
                idCard: s.id_card || '',
                bankAccount: s.bank_account || '',
                bankName: s.bank_name || '',
                joinDate: s.join_date || '',
                height: s.height || 0,
                weight: s.weight || 0,
                baseSalary: 0,
                commissionRate: 0,
                rating: 5.0,
                isActiveVipMenu: s.is_active_vip_menu || false,
                isHomeSpa: s.is_home_spa || false,
                work_type: s.work_type || 'TYPE_A',
                baseSalaryPerHour: s.base_salary_per_hour || 180000,
                targetHoursPerMonth: s.target_hours_per_month || 80,
                skills: (() => {
                    const dbSkills = s.skills && Object.keys(s.skills).length > 0 ? s.skills : DEFAULT_SKILLS;
                    const parsedSkills: any = {};
                    for (const key in DEFAULT_SKILLS) {
                        const val = dbSkills[key];
                        // Nếu DB cũ chứa 'basic', 'expert', 'training' hoặc `true` -> true
                        parsedSkills[key] = val === true || val === 'basic' || val === 'expert' || val === 'training';
                    }
                    // Backward compat: merge legacy foot skills (oilFoot, hotStoneFoot, acupressureFoot) → foot
                    if (!parsedSkills.foot) {
                        parsedSkills.foot = LEGACY_FOOT_KEYS.some(k => {
                            const v = dbSkills[k];
                            return v === true || v === 'basic' || v === 'expert' || v === 'training';
                        });
                    }
                    return parsedSkills;
                })()
            })) as Employee[];
            setEmployees(mapped);
        }
        setIsLoading(false);
    }, []);

    useEffect(() => {
        setMounted(true);
        fetchEmployees();
    }, [fetchEmployees]);

    // --- HANDLERS ---
    const handleUpdateEmployee = useCallback((updatedEmployee: Employee) => {
        setEmployees(prev => prev.map(e => e.id === updatedEmployee.id ? updatedEmployee : e));
        setSelectedEmployee(updatedEmployee);
    }, []);

    const handleOpenDetail = (emp: Employee) => {
        setSelectedEmployee(emp);
        setIsDetailOpen(true);
    };

    const handleCloseDetail = () => {
        setIsDetailOpen(false);
    };

    const handleOpenAddModal = () => {
        setIsAddModalOpen(true);
    };

    const handleCloseAddModal = () => {
        setIsAddModalOpen(false);
    };

    const handleDeleteEmployee = async (emp: Employee) => {
        if (confirm(`Hệ thống sẽ xoá tài khoản và hồ sơ của [${emp.name}]. Bạn có chắc chắn không?`)) {
            setIsLoading(true);
            const res = await deleteStaffMember(emp.id);
            if (res.success) {
                fetchEmployees();
            } else {
                alert(res.error || "Lỗi khi xoá nhân viên!");
                setIsLoading(false);
            }
        }
    };

    // --- COMPUTED VALUES ---
    const filteredEmployees = useMemo(() => {
        const lowerSearch = searchTerm.toLowerCase();
        return employees.filter(e =>
            e.name.toLowerCase().includes(lowerSearch) ||
            e.code.toLowerCase().includes(lowerSearch) ||
            e.phone.includes(searchTerm)
        );
    }, [employees, searchTerm]);

    const stats = useMemo(() => ({
        total: employees.length,
        active: employees.filter(e => e.status === 'active').length,
        senior: employees.filter(e => e.position.includes('Cấp Cao')).length,
        avgRating: employees.length > 0
            ? (employees.reduce((acc, e) => acc + e.rating, 0) / employees.length).toFixed(2)
            : '0.00'
    }), [employees]);

    const canAccessPage = hasPermission('employee_management');

    return {
        // State
        searchTerm,
        employees,
        isLoading,
        selectedEmployee,
        isDetailOpen,
        isAddModalOpen,
        mounted,

        // Computed
        filteredEmployees,
        stats,
        canAccessPage,

        // Setters
        setSearchTerm,

        // Handlers
        fetchEmployees,
        handleUpdateEmployee,
        handleOpenDetail,
        handleCloseDetail,
        handleOpenAddModal,
        handleCloseAddModal,
        handleDeleteEmployee,
    };
};

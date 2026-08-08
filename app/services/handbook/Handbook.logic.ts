'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';

// --- TYPES ---
export interface HandbookItem {
    id: string;
    title: string;
    category: string;
    steps: string[];
    duration: string;
    notes: string;
}

// --- MOCK DATA ---
const MOCK_HANDBOOK: HandbookItem[] = [
    {
        id: 'hb1',
        title: 'Quy trình Gội Đầu Dưỡng Sinh',
        category: 'Gội Đầu',
        duration: '45 - 60 phút',
        steps: [
            'Chào đón khách và mời khách thay đồ.',
            'Khai thông huyệt đạo vùng đầu.',
            'Gội đầu lần 1 bằng dầu gội thảo dược.',
            'Massage cổ vai gáy và tay.',
            'Gội đầu lần 2 và xả tóc.',
            'Sấy tóc và mời khách dùng trà.'
        ],
        notes: 'Luôn kiểm tra nhiệt độ nước trước khi gội cho khách.'
    },
    {
        id: 'hb2',
        title: 'Quy trình Massage Body Đá Nóng',
        category: 'Massage',
        duration: '90 phút',
        steps: [
            'Khởi động cơ thể bằng kỹ thuật ấn huyệt.',
            'Thoa tinh dầu và massage nhẹ nhàng toàn thân.',
            'Sử dụng đá nóng để massage các vùng cơ căng thẳng.',
            'Đặt đá nóng dọc sống lưng và lòng bàn chân.',
            'Kết thúc bằng massage đầu và lau sạch dầu thừa.'
        ],
        notes: 'Đá nóng cần được làm nóng ở nhiệt độ 50-60 độ C.'
    }
];

/**
 * Custom hook for Service Handbook page logic.
 */
export const useServiceHandbook = () => {
    const { hasPermission, role } = useAuth();
    const [searchQuery, setSearchQuery] = useState('');
    const [handbookData, setHandbookData] = useState(MOCK_HANDBOOK);
    const [selectedItem, setSelectedItem] = useState(MOCK_HANDBOOK[0]);
    const [isEditing, setIsEditing] = useState(false);
    const [editForm, setEditForm] = useState(MOCK_HANDBOOK[0]);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    const canEdit = role?.id === 'admin' || role?.id === 'branch_manager';
    const canAccessPage = hasPermission('service_handbook');

    // --- COMPUTED ---
    const filteredHandbook = handbookData.filter(item =>
        item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.category.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // --- HANDLERS ---
    const handleSelectItem = (item: HandbookItem) => {
        if (!isEditing) setSelectedItem(item);
    };

    const handleEdit = () => {
        setEditForm({ ...selectedItem });
        setIsEditing(true);
    };

    const handleSave = () => {
        const newData = handbookData.map(item => item.id === editForm.id ? editForm : item);
        setHandbookData(newData);
        setSelectedItem(editForm);
        setIsEditing(false);
    };

    const handleCancelEdit = () => {
        setIsEditing(false);
    };

    const handleAddStep = () => {
        setEditForm({ ...editForm, steps: [...editForm.steps, ''] });
    };

    const handleRemoveStep = (index: number) => {
        const newSteps = editForm.steps.filter((_, i) => i !== index);
        setEditForm({ ...editForm, steps: newSteps });
    };

    const handleStepChange = (index: number, value: string) => {
        const newSteps = [...editForm.steps];
        newSteps[index] = value;
        setEditForm({ ...editForm, steps: newSteps });
    };

    const handleEditFormChange = (field: keyof HandbookItem, value: string) => {
        setEditForm({ ...editForm, [field]: value });
    };

    return {
        // State
        searchQuery,
        selectedItem,
        isEditing,
        editForm,
        mounted,

        // Computed
        filteredHandbook,
        canEdit,
        canAccessPage,

        // Setters
        setSearchQuery,

        // Handlers
        handleSelectItem,
        handleEdit,
        handleSave,
        handleCancelEdit,
        handleAddStep,
        handleRemoveStep,
        handleStepChange,
        handleEditFormChange,
    };
};

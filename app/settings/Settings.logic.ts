'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase';

/**
 * Custom hook for Settings page logic.
 * Handles profile updates and password changes.
 */
export const useSettings = () => {
    const { user, changePassword, updateProfile } = useAuth();
    const [mounted, setMounted] = useState(false);

    // Profile state
    const [name, setName] = useState(user?.name || '');
    const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl || '');
    const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);

    // Password state
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [isChangingPassword, setIsChangingPassword] = useState(false);

    useEffect(() => { setMounted(true); }, []);

    // Fetch latest avatar from Staff table on mount
    useEffect(() => {
        if (!user?.id) return;
        const fetchStaffAvatar = async () => {
            try {
                const supabase = createClient();
                const { data } = await supabase
                    .from('Staff')
                    .select('avatar_url')
                    .eq('id', user.id)
                    .maybeSingle();
                if (data?.avatar_url) {
                    setAvatarUrl(data.avatar_url);
                }
            } catch (e) {
                // Non-critical: keep cached value
            }
        };
        fetchStaffAvatar();
    }, [user?.id]);

    // --- Handlers ---
    const handleUpdateProfile = (e: React.FormEvent) => {
        e.preventDefault();
        setIsUpdatingProfile(true);
        setTimeout(() => {
            updateProfile(name, avatarUrl);
            setIsUpdatingProfile(false);
            alert('Đã cập nhật thông tin cá nhân thành công!');
        }, 800);
    };

    const handleChangePassword = (e: React.FormEvent) => {
        e.preventDefault();
        if (newPassword !== confirmPassword) {
            alert('Mật khẩu xác nhận không khớp!');
            return;
        }
        setIsChangingPassword(true);
        setTimeout(() => {
            changePassword(newPassword);
            setIsChangingPassword(false);
            setNewPassword('');
            setConfirmPassword('');
            alert('Đã đổi mật khẩu thành công!');
        }, 800);
    };

    const handleRandomAvatar = () => {
        const randomSeed = Math.random().toString(36).substring(7);
        setAvatarUrl(`https://picsum.photos/seed/${randomSeed}/200/200`);
    };

    const toggleShowPassword = () => setShowPassword(!showPassword);

    return {
        mounted,
        name,
        avatarUrl,
        isUpdatingProfile,
        newPassword,
        confirmPassword,
        showPassword,
        isChangingPassword,
        setName,
        setAvatarUrl,
        setNewPassword,
        setConfirmPassword,
        handleUpdateProfile,
        handleChangePassword,
        handleRandomAvatar,
        toggleShowPassword,
    };
};

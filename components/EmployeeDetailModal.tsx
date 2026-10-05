'use client';

import React, { useState, useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, User, Phone, Mail, CreditCard, Calendar, Ruler, Weight, Award, CheckCircle2, Briefcase, Edit2, Save, GraduationCap, Zap, BookOpen, Key, Loader2, Upload, Camera, Link as LinkIcon, ChevronDown, ChevronUp, Eye, EyeOff, ChevronLeft, ChevronRight } from 'lucide-react';
import { CardImageCropModal } from '@/components/admin/CardImageCropModal';
import { Employee, SkillLevel, GalleryItem } from '@/lib/types';
import { SKILL_KEYS, SKILL_LABELS } from '@/lib/constants/staff.constants';
import { updateStaffMember } from '@/app/admin/employees/actions';
import {
  checkGalleryDuplicate,
  removeGalleryItemByIndex,
  GALLERY_GROUPS,
  GalleryGroupId,
  createGalleryItem,
  getGalleryGroup,
  isGalleryImageUrl,
  isGalleryItemHidden,
  toggleGalleryItemVisibility,
  swapGalleryItems,
  getNhpMenuGalleryItems,
  getNhtMenuGalleryItems,
  reorderMenuGalleryItems,
  MenuGalleryItemWrapper,
} from '@/lib/galleryHelper';
export {
  checkGalleryDuplicate,
  removeGalleryItemByIndex,
  GALLERY_GROUPS,
  createGalleryItem,
  getGalleryGroup,
  isGalleryItemHidden,
  toggleGalleryItemVisibility,
  swapGalleryItems,
  getNhpMenuGalleryItems,
  getNhtMenuGalleryItems,
  reorderMenuGalleryItems,
};

interface EmployeeDetailModalProps {
  employee: Employee | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdate?: (updatedEmployee: Employee) => void;
}

interface CropTargetState {
  imageSrc: string;
  title: string;
  subtitle: string;
  staffCode: string;
  staffName: string;
  type: 'avatar' | 'gallery';
  groupId?: GalleryGroupId;
  pendingFiles?: File[];
}

export function EmployeeDetailModal({ employee, isOpen, onClose, onUpdate }: EmployeeDetailModalProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [galleryUrlDrafts, setGalleryUrlDrafts] = useState<
    Partial<Record<GalleryGroupId, string>>
  >({});
  const [galleryUrlErrors, setGalleryUrlErrors] = useState<
    Partial<Record<GalleryGroupId, string>>
  >({});
  const [uploadingGroups, setUploadingGroups] = useState<
    Partial<Record<GalleryGroupId, boolean>>
  >({});
  const [uploadErrors, setUploadErrors] = useState<
    Partial<Record<GalleryGroupId, string>>
  >({});
  const [editedEmployee, setEditedEmployee] = useState<Employee | null>(employee);
  const gallerySessionRef = useRef(0);
  const avatarFileRef = useRef<HTMLInputElement>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [showAvatarUrlInput, setShowAvatarUrlInput] = useState(false);
  const [avatarUrlDraft, setAvatarUrlDraft] = useState('');
  const [cropTarget, setCropTarget] = useState<CropTargetState | null>(null);
  const [isVipExpanded, setIsVipExpanded] = useState(true);
  const [isTherapyExpanded, setIsTherapyExpanded] = useState(true);
  const [isAllSkillsExpanded, setIsAllSkillsExpanded] = useState(false);

  React.useEffect(() => {
    gallerySessionRef.current += 1;
    setEditedEmployee(employee);
    setGalleryUrlDrafts({});
    setGalleryUrlErrors({});
    setUploadingGroups({});
    setUploadErrors({});
    return () => {
      gallerySessionRef.current += 1;
    };
  }, [employee, isOpen]);

  const isAvatarHidden = Boolean(
    editedEmployee?.isAvatarHidden ??
    (editedEmployee?.featureFlags?.show_avatar === false ||
     editedEmployee?.featureFlags?.hide_avatar === true ||
     editedEmployee?.featureFlags?.is_avatar_hidden === true)
  );

  const toggleAvatarVisibility = () => {
    setEditedEmployee((prev) => {
      if (!prev) return prev;
      const currentHidden = Boolean(
        prev.isAvatarHidden ??
        (prev.featureFlags?.show_avatar === false ||
         prev.featureFlags?.hide_avatar === true ||
         prev.featureFlags?.is_avatar_hidden === true)
      );
      const nextHidden = !currentHidden;
      const flags = prev.featureFlags || {};
      return {
        ...prev,
        isAvatarHidden: nextHidden,
        showAvatar: !nextHidden,
        featureFlags: {
          ...flags,
          show_avatar: !nextHidden,
          hide_avatar: nextHidden,
        },
      };
    });
  };

  const getItemUrl = (item: string | GalleryItem): string =>
    typeof item === 'string' ? item : item?.url ?? '';

  const isSkillActive = (value: unknown): boolean =>
    value === true || (typeof value === 'string' && value !== '' && value !== 'none');

  const addGalleryUrlToGroup = (groupId: GalleryGroupId) => {
    const url = (galleryUrlDrafts[groupId] ?? '').trim();
    if (!url || !editedEmployee) return;

    if (!isGalleryImageUrl(url)) {
      setGalleryUrlErrors((current) => ({
        ...current,
        [groupId]: 'Vui lòng nhập URL ảnh http:// hoặc https:// hợp lệ.',
      }));
      return;
    }

    const item = createGalleryItem(url, groupId);
    if (checkGalleryDuplicate(editedEmployee.galleryUrls ?? [], item)) {
      setGalleryUrlErrors((current) => ({
        ...current,
        [groupId]: 'Ảnh này đã có trong nhóm.',
      }));
      return;
    }

    setEditedEmployee((current) => {
      if (!current) return current;
      const gallery = current.galleryUrls ?? [];
      if (checkGalleryDuplicate(gallery, item)) return current;
      return { ...current, galleryUrls: [...gallery, item] };
    });

    setGalleryUrlDrafts((current) => ({ ...current, [groupId]: '' }));
    setGalleryUrlErrors((current) => ({ ...current, [groupId]: '' }));
  };

  const handleFileUpload = async (groupId: GalleryGroupId, files: FileList | File[] | null) => {
    if (
      !files ||
      files.length === 0 ||
      !editedEmployee ||
      !isOpen ||
      isSaving ||
      uploadingGroups[groupId]
    ) return;

    const sessionAtStart = gallerySessionRef.current;
    const employeeIdAtStart = editedEmployee.id;
    const isCurrentSession = () => gallerySessionRef.current === sessionAtStart;

    setUploadingGroups((prev) => ({ ...prev, [groupId]: true }));
    setUploadErrors((prev) => ({ ...prev, [groupId]: '' }));

    try {
      const fileArray = Array.from(files);
      const newItems: Array<string | GalleryItem> = [];
      const errors: string[] = [];

      for (const file of fileArray) {
        if (!isCurrentSession()) return;

        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
          errors.push(`"${file.name}": Chỉ chấp nhận JPG, PNG, WebP.`);
          continue;
        }
        if (file.size === 0) {
          errors.push(`"${file.name}": File rỗng.`);
          continue;
        }
        if (file.size > 5 * 1024 * 1024) {
          errors.push(`"${file.name}": Vượt quá dung lượng 5MB.`);
          continue;
        }

        const formData = new FormData();
        formData.append('file', file);
        formData.append('staffId', employeeIdAtStart);
        formData.append('groupId', groupId);

        try {
          const res = await fetch('/api/admin/employees/upload-gallery', {
            method: 'POST',
            body: formData,
          });
          const data = await res.json();
          if (!isCurrentSession()) return;

          if (!res.ok || !data.success || !data.url) {
            errors.push(`"${file.name}": ${data.error || 'Lỗi tải ảnh'}`);
            continue;
          }

          const item = createGalleryItem(data.url, groupId);
          newItems.push(item);
        } catch (err: any) {
          if (!isCurrentSession()) return;
          errors.push(`"${file.name}": ${err.message || 'Lỗi kết nối'}`);
        }
      }

      if (!isCurrentSession()) return;

      if (newItems.length > 0) {
        setEditedEmployee((current) => {
          if (
            !isCurrentSession() ||
            !current ||
            current.id !== employeeIdAtStart
          ) return current;

          const gallery = [...(current.galleryUrls ?? [])];
          for (const item of newItems) {
            if (!checkGalleryDuplicate(gallery, item)) {
              gallery.push(item);
            }
          }

          return {
            ...current,
            galleryUrls: gallery,
          };
        });
      }

      if (errors.length > 0) {
        if (isCurrentSession()) {
          setUploadErrors((prev) => ({
            ...prev,
            [groupId]: errors.join('; '),
          }));
        }
      }
    } finally {
      if (isCurrentSession()) {
        setUploadingGroups((current) => ({
          ...current,
          [groupId]: false,
        }));
      }
    }
  };

  const removeGalleryUrl = (indexToRemove: number) => {
    if (!editedEmployee) return;
    setEditedEmployee({
      ...editedEmployee,
      galleryUrls: removeGalleryItemByIndex(editedEmployee.galleryUrls || [], indexToRemove),
    });
  };

  const handleAvatarFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editedEmployee) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      alert('Chỉ chấp nhận file ảnh JPG, PNG hoặc WebP.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('Dung lượng ảnh không được vượt quá 5MB.');
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setCropTarget({
      imageSrc: objectUrl,
      title: 'Căn chỉnh Ảnh Đại Diện (Avatar)',
      subtitle: 'Khung hiển thị Card WRB Nội Bộ',
      staffCode: editedEmployee.code || 'KTV',
      staffName: editedEmployee.name || '',
      type: 'avatar',
    });
    if (e.target) e.target.value = '';
  };

  const handleApplyAvatarUrl = () => {
    const trimmed = avatarUrlDraft.trim();
    if (!trimmed) {
      alert('Vui lòng nhập đường dẫn URL ảnh.');
      return;
    }
    if (!isGalleryImageUrl(trimmed)) {
      alert('URL ảnh không hợp lệ (cần bắt đầu bằng http:// hoặc https://)');
      return;
    }
    setCropTarget({
      imageSrc: trimmed,
      title: 'Căn chỉnh Ảnh Đại Diện (Avatar)',
      subtitle: 'Khung hiển thị Card WRB Nội Bộ',
      staffCode: editedEmployee?.code || 'KTV',
      staffName: editedEmployee?.name || '',
      type: 'avatar',
    });
    setShowAvatarUrlInput(false);
    setAvatarUrlDraft('');
  };

  const handleCropConfirm = async (croppedBlob: Blob) => {
    if (!cropTarget || !editedEmployee) return;
    const currentTarget = { ...cropTarget };

    // Convert cropped blob to a File
    const croppedFile = new File([croppedBlob], `crop_${Date.now()}.jpg`, {
      type: 'image/jpeg',
    });

    if (currentTarget.type === 'avatar') {
      setCropTarget(null);
      setIsUploadingAvatar(true);
      try {
        const formData = new FormData();
        formData.append('file', croppedFile);
        formData.append('staffId', editedEmployee.id);

        const res = await fetch('/api/admin/employees/upload-avatar', {
          method: 'POST',
          body: formData,
        });
        const data = await res.json();
        if (data.success && data.url) {
          setEditedEmployee((prev) => (prev ? { ...prev, photoUrl: data.url } : null));
        } else {
          alert(data.error || 'Lỗi khi lưu ảnh đại diện');
        }
      } catch (err: any) {
        alert(err.message || 'Lỗi kết nối khi tải ảnh đại diện');
      } finally {
        setIsUploadingAvatar(false);
      }
    } else if (currentTarget.type === 'gallery' && currentTarget.groupId) {
      // Upload the cropped file to gallery
      await handleFileUpload(currentTarget.groupId, [croppedFile]);

      // If there are more pending files in queue, advance to next file!
      if (currentTarget.pendingFiles && currentTarget.pendingFiles.length > 0) {
        const nextFile = currentTarget.pendingFiles[0];
        const nextRemaining = currentTarget.pendingFiles.slice(1);
        const objectUrl = URL.createObjectURL(nextFile);
        setCropTarget({
          ...currentTarget,
          imageSrc: objectUrl,
          pendingFiles: nextRemaining,
        });
      } else {
        setCropTarget(null);
      }
    }
  };

  const handleUseOriginal = async () => {
    if (!cropTarget || !editedEmployee) return;
    const currentTarget = { ...cropTarget };

    if (currentTarget.type === 'avatar') {
      setCropTarget(null);
      if (currentTarget.imageSrc.startsWith('http')) {
        setEditedEmployee((prev) => (prev ? { ...prev, photoUrl: currentTarget.imageSrc } : null));
      }
    } else if (currentTarget.type === 'gallery' && currentTarget.groupId) {
      if (currentTarget.imageSrc.startsWith('http')) {
        const item = createGalleryItem(currentTarget.imageSrc, currentTarget.groupId);
        setEditedEmployee((prev) => {
          if (!prev) return prev;
          const gallery = [...(prev.galleryUrls || [])];
          if (!checkGalleryDuplicate(gallery, item)) gallery.push(item);
          return { ...prev, galleryUrls: gallery };
        });
      }
      // If there are more pending files in queue, advance to next file!
      if (currentTarget.pendingFiles && currentTarget.pendingFiles.length > 0) {
        const nextFile = currentTarget.pendingFiles[0];
        const nextRemaining = currentTarget.pendingFiles.slice(1);
        const objectUrl = URL.createObjectURL(nextFile);
        setCropTarget({
          ...currentTarget,
          imageSrc: objectUrl,
          pendingFiles: nextRemaining,
        });
      } else {
        setCropTarget(null);
      }
    }
  };

  if (!employee || !editedEmployee) return null;

  const toggleSkill = (skillKey: keyof Employee['skills']) => {
    if (!isEditing) return;

    setEditedEmployee(prev => {
      if (!prev) return null;

      const rawLevel = prev.skills?.[skillKey];
      const isCurrentlySkilled = rawLevel === true || (rawLevel as any) === 'basic' || (rawLevel as any) === 'expert' || (rawLevel as any) === 'training';

      return {
        ...prev,
        skills: {
          ...prev.skills,
          [skillKey]: !isCurrentlySkilled
        }
      };
    });
  };

  const handleSave = async () => {
    if (!editedEmployee) return;
    if (!editedEmployee.name || !editedEmployee.name.trim()) {
      alert('❌ Vui lòng không để trống họ và tên nhân viên.');
      return;
    }
    setIsSaving(true);
    console.log('[EmployeeDetailModal] Saving...', editedEmployee.id, { skills: editedEmployee.skills });
    try {
      const trimmedName = editedEmployee.name.trim();
      const payloadToSave: Employee = {
        ...editedEmployee,
        name: trimmedName,
      };
      // Call server action to persist to DB
      const result = await updateStaffMember(editedEmployee.id, payloadToSave);
      console.log('[EmployeeDetailModal] Save result:', result);
      if (result.success) {
        // Update local state in parent
        if (onUpdate) onUpdate(payloadToSave);
        setIsEditing(false);
        alert('✅ Đã lưu thành công!');
      } else {
        alert(`❌ Lỗi khi lưu: ${result.error}`);
      }
    } catch (err: any) {
      console.error('[EmployeeDetailModal] Save error:', err);
      alert(`❌ Lỗi hệ thống: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const updateField = (field: keyof Employee, value: any) => {
    setEditedEmployee(prev => {
      if (!prev) return null;
      return { ...prev, [field]: value };
    });
  };

  const levelInfo: Record<string, { label: string, color: string, icon: React.ReactNode }> = {
    'false': { label: 'Chưa có', color: 'text-gray-400 bg-gray-50 border-gray-100 opacity-50', icon: <X size={12} /> },
    'true': { label: 'Có tay nghề', color: 'text-emerald-700 bg-emerald-50 border-emerald-100', icon: <CheckCircle2 size={12} /> },
  };

  const handleCloseModal = () => {
    gallerySessionRef.current += 1;
    onClose();
  };

  const handleToggleItemHidden = (originalIndex: number) => {
    setEditedEmployee((prev) => {
      if (!prev || !prev.galleryUrls) return prev;
      return {
        ...prev,
        galleryUrls: toggleGalleryItemVisibility(prev.galleryUrls, originalIndex),
      };
    });
  };

  const nhpDisplayItems = getNhpMenuGalleryItems(
    editedEmployee?.galleryUrls || [],
    editedEmployee?.skills
  );

  const nhtDisplayItems = getNhtMenuGalleryItems(
    editedEmployee?.galleryUrls || []
  );

  const handleReorderNhpMenu = (fromIdx: number, toIdx: number) => {
    setEditedEmployee((prev) => {
      if (!prev || !prev.galleryUrls) return prev;
      return {
        ...prev,
        galleryUrls: reorderMenuGalleryItems(prev.galleryUrls, 'nhp', fromIdx, toIdx, prev.skills),
      };
    });
  };

  const handleReorderNhtMenu = (fromIdx: number, toIdx: number) => {
    setEditedEmployee((prev) => {
      if (!prev || !prev.galleryUrls) return prev;
      return {
        ...prev,
        galleryUrls: reorderMenuGalleryItems(prev.galleryUrls, 'nht', fromIdx, toIdx),
      };
    });
  };

  const renderGroupCard = (groupId: GalleryGroupId, groupLabel: string) => {
    const allItems = (editedEmployee?.galleryUrls || []).map((item, originalIndex) => ({
      item,
      originalIndex,
      url: getItemUrl(item),
      group: getGalleryGroup(item),
      isHidden: isGalleryItemHidden(item),
    }));
    const groupItems = allItems.filter((i) => i.group === groupId);
    const isUploading = Boolean(uploadingGroups[groupId]);
    const uploadErr = uploadErrors[groupId];
    const urlErr = galleryUrlErrors[groupId];

    const handleMoveItemInGroup = (fromGroupIdx: number, toGroupIdx: number) => {
      if (
        fromGroupIdx < 0 ||
        fromGroupIdx >= groupItems.length ||
        toGroupIdx < 0 ||
        toGroupIdx >= groupItems.length ||
        fromGroupIdx === toGroupIdx
      ) {
        return;
      }
      const indexA = groupItems[fromGroupIdx].originalIndex;
      const indexB = groupItems[toGroupIdx].originalIndex;
      setEditedEmployee((prev) => {
        if (!prev || !prev.galleryUrls) return prev;
        return {
          ...prev,
          galleryUrls: swapGalleryItems(prev.galleryUrls, indexA, indexB),
        };
      });
    };

    return (
      <div
        key={groupId}
        className="rounded-xl border border-gray-200 bg-white p-3.5 shadow-sm flex flex-col justify-between"
      >
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-gray-800 uppercase tracking-wide">
                {groupLabel}
              </span>
              <span className="text-[10px] bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded-full font-bold">
                {groupItems.length}
              </span>
            </div>

            {isEditing && (
              <div>
                <input
                  id={`file-upload-${groupId}`}
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  disabled={isSaving || isUploading}
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      const fileList = Array.from(e.target.files);
                      const firstFile = fileList[0];
                      const pendingFiles = fileList.slice(1);
                      const objectUrl = URL.createObjectURL(firstFile);
                      setCropTarget({
                        imageSrc: objectUrl,
                        title: `Căn chỉnh ảnh ${groupLabel}`,
                        subtitle: 'Khung Card hiển thị trên web_noi_bo (Tỷ lệ 3:4)',
                        staffCode: editedEmployee?.code || 'KTV',
                        staffName: editedEmployee?.name || '',
                        type: 'gallery',
                        groupId,
                        pendingFiles,
                      });
                      e.target.value = '';
                    }
                  }}
                />
                <label
                  htmlFor={`file-upload-${groupId}`}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                    isSaving || isUploading
                      ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                      : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200'
                  }`}
                >
                  {isUploading ? (
                    <>
                      <Loader2 size={12} className="animate-spin text-indigo-600" />
                      <span>Đang tải...</span>
                    </>
                  ) : (
                    <>
                      <Upload size={12} />
                      <span>+ Tải ảnh</span>
                    </>
                  )}
                </label>
              </div>
            )}
          </div>

          {isEditing && (
            <div className="flex gap-1.5 mb-2">
              <input
                type="url"
                aria-label={`URL ảnh ${groupLabel}`}
                placeholder="https://.../photo.jpg"
                value={galleryUrlDrafts[groupId] ?? ''}
                disabled={isSaving || isUploading}
                onChange={(event) => {
                  const value = event.target.value;
                  setGalleryUrlDrafts((current) => ({
                    ...current,
                    [groupId]: value,
                  }));
                  setGalleryUrlErrors((current) => ({
                    ...current,
                    [groupId]: '',
                  }));
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addGalleryUrlToGroup(groupId);
                  }
                }}
                className="flex-1 min-w-0 px-2.5 py-1 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              />
              <button
                type="button"
                disabled={
                  isSaving ||
                  isUploading ||
                  !(galleryUrlDrafts[groupId] ?? '').trim()
                }
                onClick={() => addGalleryUrlToGroup(groupId)}
                className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg shrink-0 transition-colors"
              >
                Thêm
              </button>
            </div>
          )}

          {uploadErr && (
            <p role="alert" className="text-[11px] text-red-600 font-medium mb-2">
              {uploadErr}
            </p>
          )}
          {urlErr && (
            <p role="alert" className="text-[11px] text-red-600 font-medium mb-2">
              {urlErr}
            </p>
          )}

          {groupItems.length === 0 ? (
            <div className="text-[11px] text-gray-400 italic py-2 text-center bg-gray-50 rounded-lg border border-dashed border-gray-200">
              Chưa có ảnh trong nhóm này.
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {groupItems.map(({ originalIndex, url, isHidden }, itemIdx) => (
                <GalleryThumbnailItem
                  key={`${url}-${originalIndex}`}
                  url={url}
                  index={originalIndex}
                  isEditing={isEditing}
                  isHidden={isHidden}
                  canMoveLeft={itemIdx > 0}
                  canMoveRight={itemIdx < groupItems.length - 1}
                  onMoveLeft={() => handleMoveItemInGroup(itemIdx, itemIdx - 1)}
                  onMoveRight={() => handleMoveItemInGroup(itemIdx, itemIdx + 1)}
                  onToggleHidden={() => handleToggleItemHidden(originalIndex)}
                  onRemove={() => removeGalleryUrl(originalIndex)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      handleCloseModal();
    }
  };

  return (
    <>
      <Dialog.Root open={isOpen} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60] animate-in fade-in duration-200" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-1.5rem)] sm:w-full max-w-2xl max-h-[90dvh] bg-white rounded-2xl shadow-2xl z-[70] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
          <div className="relative h-32 bg-indigo-600 shrink-0">
            <div className="absolute top-4 right-4 flex gap-2 z-10">
              {isEditing ? (
                <button
                  onClick={handleSave}
                  disabled={isSaving || Object.values(uploadingGroups).some(Boolean)}
                  className={`p-2 text-white rounded-full transition-colors shadow-lg flex items-center gap-2 px-4 ${
                    isSaving || Object.values(uploadingGroups).some(Boolean)
                      ? 'bg-gray-400 cursor-not-allowed'
                      : 'bg-emerald-500 hover:bg-emerald-600'
                  }`}
                >
                  {isSaving || Object.values(uploadingGroups).some(Boolean) ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <Save size={18} />
                  )}
                  <span className="text-sm font-bold">
                    {isSaving
                      ? 'Đang lưu...'
                      : Object.values(uploadingGroups).some(Boolean)
                      ? 'Đang tải ảnh...'
                      : 'Lưu'}
                  </span>
                </button>
              ) : (
                <button
                  onClick={() => setIsEditing(true)}
                  className="p-2 bg-white/20 hover:bg-white/30 text-white rounded-full transition-colors flex items-center gap-2 px-4 shadow-sm backdrop-blur-sm border border-white/20"
                >
                  <Edit2 size={18} />
                  <span className="text-sm font-bold">Sửa thông tin</span>
                </button>
              )}
              <button
                onClick={handleCloseModal}
                className="p-2 bg-white/20 hover:bg-white/30 text-white rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <div className="absolute -bottom-12 left-8">
              <div className="relative w-24 h-24 rounded-2xl overflow-hidden border-4 border-white shadow-lg bg-gray-100 group">
                {/* Huy hiệu Đang Ẩn trên Menu */}
                {isAvatarHidden && (
                  <div className="absolute top-1.5 left-1.5 bg-amber-500/90 text-white text-[9px] font-black px-1.5 py-0.5 rounded shadow-sm flex items-center gap-0.5 pointer-events-none z-20 backdrop-blur-2xs">
                    <EyeOff size={10} />
                    <span>Ẩn</span>
                  </div>
                )}

                {/* Nút bật/tắt mắt cho Avatar khi sửa */}
                {isEditing && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleAvatarVisibility();
                    }}
                    aria-label={isAvatarHidden ? 'Hiện avatar trên menu' : 'Ẩn avatar trên menu'}
                    title={isAvatarHidden ? 'Avatar đang ẩn trên menu - Bấm để hiện lại' : 'Avatar đang hiện trên menu - Bấm để ẩn khỏi menu'}
                    className={`absolute top-1.5 right-1.5 z-20 p-1.5 rounded-full shadow-md transition-all touch-manipulation ${
                      isAvatarHidden
                        ? 'bg-amber-600 hover:bg-amber-700 text-white ring-2 ring-white/50'
                        : 'bg-black/70 hover:bg-black/90 text-white ring-1 ring-white/30'
                    }`}
                  >
                    {isAvatarHidden ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                )}

                <img
                  src={editedEmployee.photoUrl || employee.photoUrl}
                  alt={employee.name}
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
                {isEditing && (
                  <>
                    <input
                      type="file"
                      ref={avatarFileRef}
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={handleAvatarFileSelect}
                      disabled={isSaving || isUploadingAvatar}
                    />
                    <button
                      type="button"
                      onClick={() => avatarFileRef.current?.click()}
                      disabled={isSaving || isUploadingAvatar}
                      className="absolute inset-0 bg-black/50 hover:bg-black/60 transition-colors flex flex-col items-center justify-center text-white cursor-pointer"
                      title="Bấm để tải ảnh đại diện từ máy"
                    >
                      {isUploadingAvatar ? (
                        <Loader2 size={22} className="animate-spin text-white" />
                      ) : (
                        <>
                          <Camera size={20} />
                          <span className="text-[10px] font-bold mt-0.5">Đổi ảnh</span>
                        </>
                      )}
                    </button>
                  </>
                )}
              </div>
              {isEditing && (
                <div className="mt-1 relative">
                  {showAvatarUrlInput ? (
                    <div className="flex items-center gap-1 bg-white p-1 rounded-lg shadow-xl border border-gray-200 mt-1 w-64 absolute left-0 z-30 animate-in fade-in zoom-in-95 duration-150">
                      <input
                        type="url"
                        placeholder="https://.../avatar.jpg"
                        value={avatarUrlDraft}
                        onChange={(e) => setAvatarUrlDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleApplyAvatarUrl();
                          }
                        }}
                        className="flex-1 text-xs px-2 py-1 border border-gray-200 rounded outline-none focus:border-indigo-500"
                      />
                      <button
                        type="button"
                        onClick={handleApplyAvatarUrl}
                        className="px-2 py-1 bg-indigo-600 text-white rounded text-xs font-semibold hover:bg-indigo-700"
                      >
                        Lưu
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowAvatarUrlInput(false)}
                        className="p-1 text-gray-400 hover:text-gray-600"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setShowAvatarUrlInput(true)}
                        className="inline-flex items-center gap-1 text-[10px] font-semibold text-white bg-black/50 hover:bg-black/70 px-2.5 py-1 rounded-full backdrop-blur-sm transition-colors shadow-xs"
                      >
                        <LinkIcon size={10} /> Dán link ảnh
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="pt-16 px-4 sm:px-8 pb-8 overflow-y-auto flex-1 min-h-0">
            {isEditing ? (
              <div className="space-y-1 mb-2">
                <label className="text-xs font-semibold text-indigo-600 uppercase tracking-wider block">
                  Họ và tên KTV / Nhân viên
                </label>
                <div className="relative max-w-md">
                  <input
                    type="text"
                    value={editedEmployee.name || ''}
                    onChange={(e) => updateField('name', e.target.value)}
                    placeholder="Nhập họ và tên..."
                    className="w-full text-xl font-bold text-gray-900 px-3 py-1.5 bg-indigo-50/50 border-2 border-indigo-400 focus:border-indigo-600 focus:bg-white rounded-lg outline-none transition-colors"
                  />
                </div>
                <Dialog.Title className="sr-only">
                  {editedEmployee.name || 'Hồ sơ nhân viên'}
                </Dialog.Title>
              </div>
            ) : (
              <Dialog.Title className="text-2xl font-bold text-gray-900">
                {editedEmployee.name}
              </Dialog.Title>
            )}
            <Dialog.Description className="sr-only">
              Chi tiết hồ sơ nhân viên {editedEmployee.name}
            </Dialog.Description>

            <div className="flex justify-between items-start mb-6 mt-2">
              <div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-indigo-600 font-bold text-sm tracking-wider">{editedEmployee.code}</span>
                  <span className="text-gray-300">•</span>
                  {isEditing ? (
                    <select
                      value={editedEmployee.status || 'active'}
                      onChange={(e) => updateField('status', e.target.value)}
                      className={`text-[10px] font-bold uppercase rounded-full px-2 py-0.5 outline-none cursor-pointer ${editedEmployee.status === 'active' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-gray-100 text-gray-700 border border-gray-200'}`}
                    >
                      <option value="active" className="bg-white text-gray-900">Đang hoạt động</option>
                      <option value="inactive" className="bg-white text-gray-900">Đã nghỉ</option>
                    </select>
                  ) : (
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${editedEmployee.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-700'}`}>
                      {editedEmployee.status === 'active' ? 'Đang hoạt động' : 'Đã nghỉ'}
                    </span>
                  )}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-medium text-gray-900">{editedEmployee.position}</div>
                <div className="text-xs text-gray-500 mt-1">{editedEmployee.experience} kinh nghiệm</div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                  <User size={14} /> Thông tin cá nhân
                </h3>
                <div className="space-y-3">
                  <InfoItem label="Họ và tên" value={editedEmployee.name} icon={<User size={14} />} isEditing={isEditing} onChange={(val) => updateField('name', val)} />
                  <InfoItem label="Ngày sinh" value={editedEmployee.dob} icon={<Calendar size={14} />} isEditing={isEditing} onChange={(val) => updateField('dob', val)} />
                  <InfoItem label="Giới tính" value={editedEmployee.gender} isEditing={isEditing} onChange={(val) => updateField('gender', val)} />
                  <InfoItem label="Số CCCD" value={editedEmployee.idCard} isEditing={isEditing} onChange={(val) => updateField('idCard', val)} />
                  <InfoItem label="Chiều cao" value={editedEmployee.height} icon={<Ruler size={14} />} isEditing={isEditing} onChange={(val) => updateField('height', val)} />
                  <InfoItem label="Cân nặng" value={editedEmployee.weight} icon={<Weight size={14} />} isEditing={isEditing} onChange={(val) => updateField('weight', val)} />
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                  <Phone size={14} /> Liên lạc & Tài chính
                </h3>
                <div className="space-y-3">
                  <InfoItem label="Số điện thoại" value={editedEmployee.phone} icon={<Phone size={14} />} isEditing={isEditing} onChange={(val) => updateField('phone', val)} />
                  <InfoItem label="Email" value={editedEmployee.email} icon={<Mail size={14} />} isEditing={isEditing} onChange={(val) => updateField('email', val)} />
                  <InfoItem label="STK Ngân hàng" value={editedEmployee.bankAccount} icon={<CreditCard size={14} />} isEditing={isEditing} onChange={(val) => updateField('bankAccount', val)} />
                  <InfoItem label="Ngân hàng" value={editedEmployee.bankName} isEditing={isEditing} onChange={(val) => updateField('bankName', val)} />
                  <InfoItem label="Ngày vào làm" value={editedEmployee.joinDate} icon={<Briefcase size={14} />} isEditing={isEditing} onChange={(val) => updateField('joinDate', val)} />
                </div>
              </div>
            </div>

            <div className="mt-8">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2 mb-4">
                <Key size={14} /> Thông tin cấp quyền (Hệ thống)
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-gray-50 p-4 rounded-xl border border-gray-100">
                <InfoItem label="Tên đăng nhập (ID)" value={editedEmployee.username || editedEmployee.code} isEditing={false} />
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <div className="text-[10px] text-gray-400 font-medium uppercase">Mật khẩu hiện tại</div>
                    <div className="text-sm text-gray-900 font-medium font-mono">
                      {editedEmployee.password || '---'}
                    </div>
                  </div>
                </div>

                {editedEmployee.role === 'TECHNICIAN' && (
                  <div className="md:col-span-2 mt-2 pt-4 border-t border-gray-200">
                    <div className="text-[10px] text-gray-400 font-medium uppercase mb-2">Hình thức làm việc (KTV)</div>
                    {isEditing ? (
                      <select 
                        value={editedEmployee.work_type || 'TYPE_A'} 
                        onChange={(e) => updateField('work_type', e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 font-bold text-emerald-700 text-sm"
                      >
                        <option value="TYPE_A">Loại A (Tính theo Ca/Điểm)</option>
                        <option value="TYPE_B">Loại B (Hưởng tua 180k/h)</option>
                        <option value="TYPE_C">Loại C (Cộng tác viên/Freelance)</option>
                        <option value="TYPE_D">Loại D (Khoán)</option>
                      </select>
                    ) : (
                      <div className="text-sm font-bold text-emerald-700">
                        {editedEmployee.work_type === 'TYPE_B' ? 'Loại B (Hưởng tua 180k/h)' : 
                         editedEmployee.work_type === 'TYPE_C' ? 'Loại C (Cộng tác viên/Freelance)' : 
                         editedEmployee.work_type === 'TYPE_D' ? 'Loại D (Khoán)' : 
                         'Loại A (Tính theo Ca/Điểm)'}
                      </div>
                    )}
                  </div>
                )}
              </div>
              
              {editedEmployee.role === 'TECHNICIAN' && editedEmployee.work_type === 'TYPE_B' && (
                  <div className="mt-4 p-4 bg-amber-50 rounded-xl border border-amber-200">
                    <h3 className="text-xs font-bold text-amber-900 uppercase tracking-widest border-b border-amber-200 pb-2 mb-3">Cấu hình Chỉ tiêu (Loại B)</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <div className="text-[10px] text-amber-800 font-medium uppercase mb-1">Mức lương / giờ (VNĐ)</div>
                            {isEditing ? (
                              <input 
                                type="number" 
                                value={editedEmployee.baseSalaryPerHour || 180000} 
                                onChange={(e) => updateField('baseSalaryPerHour', parseInt(e.target.value) || 0)}
                                className="w-full px-3 py-2 bg-white border border-amber-300 rounded-lg focus:ring-2 focus:ring-amber-500 font-bold text-sm"
                              />
                            ) : (
                              <div className="text-sm font-bold text-gray-900">
                                {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(editedEmployee.baseSalaryPerHour || 180000)}
                              </div>
                            )}
                        </div>
                        <div>
                            <div className="text-[10px] text-amber-800 font-medium uppercase mb-1">Chỉ tiêu tháng (Giờ)</div>
                            {isEditing ? (
                              <input 
                                type="number" 
                                value={editedEmployee.targetHoursPerMonth || 80} 
                                onChange={(e) => updateField('targetHoursPerMonth', parseInt(e.target.value) || 0)}
                                className="w-full px-3 py-2 bg-white border border-amber-300 rounded-lg focus:ring-2 focus:ring-amber-500 font-bold text-sm"
                              />
                            ) : (
                              <div className="text-sm font-bold text-gray-900">
                                {editedEmployee.targetHoursPerMonth || 80} giờ
                              </div>
                            )}
                        </div>
                    </div>
                  </div>
              )}
            </div>

            {/* ── CẤU HÌNH MENU & DỊCH VỤ (GOM CỤM ĐI LIỀN NÚT ACTIVE VÀ UPLOAD ẢNH) ── */}
            <div className="mt-8 space-y-5">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                <BookOpen size={14} className="text-amber-500" /> Cấu hình Menu & Dịch Vụ
              </h3>

              {/* 🌟 1. VIP MENU (NHP) */}
              <div className={`rounded-2xl border transition-all duration-200 overflow-hidden ${
                editedEmployee.isActiveVipMenu
                  ? 'border-amber-300 bg-amber-50/20 shadow-sm'
                  : 'border-gray-200 bg-gray-50/60'
              }`}>
                <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white/70 border-b border-amber-100/60">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="vip-menu-toggle"
                      disabled={!isEditing}
                      checked={editedEmployee.isActiveVipMenu || false}
                      onChange={(e) => {
                        updateField('isActiveVipMenu', e.target.checked);
                        if (e.target.checked) setIsVipExpanded(true);
                      }}
                      className="w-5 h-5 text-amber-500 rounded border-gray-300 focus:ring-amber-500 cursor-pointer disabled:opacity-60"
                    />
                    <label htmlFor="vip-menu-toggle" className="cursor-pointer">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-gray-900 text-sm">VIP Menu (NHP)</span>
                        {editedEmployee.isActiveVipMenu ? (
                          <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-bold rounded-full border border-amber-300">
                            Đang Bật
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 bg-gray-100 text-gray-500 text-[10px] font-medium rounded-full">
                            Đang Tắt
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Kích hoạt nhân viên trên VIP Menu và quản lý ảnh theo kỹ năng VIP
                      </p>
                    </label>
                  </div>

                  {editedEmployee.isActiveVipMenu && (
                    <button
                      type="button"
                      onClick={() => setIsVipExpanded(!isVipExpanded)}
                      className="self-end sm:self-auto px-3 py-1.5 text-amber-900 bg-amber-100/70 hover:bg-amber-100 rounded-lg transition-colors flex items-center gap-1.5 text-xs font-semibold"
                    >
                      <span>{isVipExpanded ? 'Thu gọn' : 'Mở rộng'}</span>
                      {isVipExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                    </button>
                  )}
                </div>

                {/* Nội dung VIP Menu khi Active */}
                {editedEmployee.isActiveVipMenu && isVipExpanded && (
                  <div className="p-4 space-y-4">
                    {/* Bật/tắt kỹ năng VIP */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-amber-900 uppercase tracking-wider">
                          Kỹ năng kích hoạt trên Menu VIP ({SKILL_KEYS.filter((k) => isSkillActive(editedEmployee.skills?.[k])).length})
                        </span>
                        {isEditing && (
                          <span className="text-[10px] text-amber-700 font-medium">
                            Chỉnh sửa tại mục Tất cả kỹ năng chuyên môn bên dưới
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {SKILL_KEYS.filter((k) => isSkillActive(editedEmployee.skills?.[k])).length === 0 ? (
                          <span className="text-xs text-amber-800 italic">Chưa có kỹ năng nào. Vui lòng bật kỹ năng ở mục "Tất cả kỹ năng chuyên môn" bên dưới.</span>
                        ) : (
                          SKILL_KEYS.filter((k) => isSkillActive(editedEmployee.skills?.[k])).map((key) => (
                            <span
                              key={key}
                              className="px-2.5 py-1 rounded-lg bg-amber-500 text-white text-xs font-bold flex items-center gap-1 shadow-2xs"
                            >
                              <CheckCircle2 size={12} className="text-white" />
                              <span>{SKILL_LABELS[key]}</span>
                            </span>
                          ))
                        )}
                      </div>
                    </div>

                    {/* 🌟 THỨ TỰ HIỂN THỊ HÌNH ẢNH TRÊN MENU VIP (NHP) */}
                    <div className="pt-2 border-t border-amber-100">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-black text-amber-900 uppercase tracking-wider">
                            Thứ tự hiển thị trên Menu VIP (NHP)
                          </span>
                          <span className="text-[10px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-bold">
                            {nhpDisplayItems.length} ảnh
                          </span>
                        </div>
                        {isEditing && nhpDisplayItems.length > 1 && (
                          <span className="text-[10px] text-amber-700 font-medium">
                            Bấm [Trước] hoặc [Sau] để đổi thứ tự hiển thị
                          </span>
                        )}
                      </div>
                      {nhpDisplayItems.length === 0 ? (
                        <div className="text-[11px] text-amber-700/70 italic py-2 text-center bg-amber-50/50 rounded-xl border border-dashed border-amber-200">
                          Chưa có ảnh nào trên Menu VIP. Hãy tải ảnh Đặc Quyền hoặc ảnh Kỹ năng VIP bên dưới.
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-2.5 bg-amber-50/40 p-2.5 rounded-2xl border border-amber-200/80 mb-3">
                          {nhpDisplayItems.map((wrapper, itemIdx) => (
                            <MenuDisplayOrderItem
                              key={`${wrapper.url}-${wrapper.originalIndex}`}
                              orderNumber={itemIdx + 1}
                              wrapper={wrapper}
                              isEditing={isEditing}
                              canMoveLeft={itemIdx > 0}
                              canMoveRight={itemIdx < nhpDisplayItems.length - 1}
                              onMoveLeft={() => handleReorderNhpMenu(itemIdx, itemIdx - 1)}
                              onMoveRight={() => handleReorderNhpMenu(itemIdx, itemIdx + 1)}
                              onToggleHidden={() => handleToggleItemHidden(wrapper.originalIndex)}
                            />
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Upload ảnh Đặc Quyền (VIP Menu) */}
                    <div className="pt-2 border-t border-amber-100">
                      <span className="text-xs font-bold text-amber-900 uppercase tracking-wider block mb-2.5">
                        Ảnh Đặc Quyền (VIP Menu · Hiển thị ưu tiên đầu)
                      </span>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                        {renderGroupCard('privilege', 'VIP · Ảnh Đặc Quyền')}
                      </div>
                    </div>

                    {/* Upload ảnh theo kỹ năng VIP đã bật */}
                    <div className="pt-2 border-t border-amber-100">
                      <span className="text-xs font-bold text-amber-900 uppercase tracking-wider block mb-2.5">
                        Tải ảnh theo từng kỹ năng VIP
                      </span>
                      {!SKILL_KEYS.some((key) => isSkillActive(editedEmployee.skills?.[key])) ? (
                        <div className="p-4 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-800 text-center">
                          Hãy bật ít nhất một kỹ năng VIP ở trên để hiển thị ô tải ảnh tương ứng.
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {SKILL_KEYS.filter((key) => isSkillActive(editedEmployee.skills?.[key])).map((key) => {
                            const groupId = `vip:${key}` as GalleryGroupId;
                            const groupLabel = `VIP · ${SKILL_LABELS[key]}`;
                            return renderGroupCard(groupId, groupLabel);
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* 🌿 2. MENU ĐIỀU TRỊ / DEEP BODY (NHT) */}
              <div className={`rounded-2xl border transition-all duration-200 overflow-hidden ${
                editedEmployee.isActiveTherapyMenu
                  ? 'border-emerald-300 bg-emerald-50/20 shadow-sm'
                  : 'border-gray-200 bg-gray-50/60'
              }`}>
                <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white/70 border-b border-emerald-100/60">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="therapy-menu-toggle"
                      disabled={!isEditing}
                      checked={editedEmployee.isActiveTherapyMenu || false}
                      onChange={(e) => {
                        updateField('isActiveTherapyMenu', e.target.checked);
                        if (e.target.checked) setIsTherapyExpanded(true);
                      }}
                      className="w-5 h-5 text-emerald-600 rounded border-gray-300 focus:ring-emerald-500 cursor-pointer disabled:opacity-60"
                    />
                    <label htmlFor="therapy-menu-toggle" className="cursor-pointer">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-gray-900 text-sm">Menu Điều Trị / Deep Body (NHT)</span>
                        {editedEmployee.isActiveTherapyMenu ? (
                          <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded-full border border-emerald-300">
                            Đang Bật
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 bg-gray-100 text-gray-500 text-[10px] font-medium rounded-full">
                            Đang Tắt
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Kích hoạt nhân viên trên Menu Điều trị và tải ảnh 5 phương pháp trị liệu
                      </p>
                    </label>
                  </div>

                  {editedEmployee.isActiveTherapyMenu && (
                    <button
                      type="button"
                      onClick={() => setIsTherapyExpanded(!isTherapyExpanded)}
                      className="self-end sm:self-auto px-3 py-1.5 text-emerald-900 bg-emerald-100/70 hover:bg-emerald-100 rounded-lg transition-colors flex items-center gap-1.5 text-xs font-semibold"
                    >
                      <span>{isTherapyExpanded ? 'Thu gọn' : 'Mở rộng'}</span>
                      {isTherapyExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                    </button>
                  )}
                </div>

                {/* Nội dung Menu Điều trị khi Active */}
                {editedEmployee.isActiveTherapyMenu && isTherapyExpanded && (
                  <div className="p-4 space-y-4">
                    {/* 🌿 THỨ TỰ HIỂN THỊ HÌNH ẢNH TRÊN MENU ĐIỀU TRỊ (NHT) */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-black text-emerald-900 uppercase tracking-wider">
                            Thứ tự hiển thị trên Menu Điều Trị (NHT)
                          </span>
                          <span className="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-bold">
                            {nhtDisplayItems.length} ảnh
                          </span>
                        </div>
                        {isEditing && nhtDisplayItems.length > 1 && (
                          <span className="text-[10px] text-emerald-700 font-medium">
                            Bấm [Trước] hoặc [Sau] để đổi thứ tự hiển thị
                          </span>
                        )}
                      </div>
                      {nhtDisplayItems.length === 0 ? (
                        <div className="text-[11px] text-emerald-700/70 italic py-2 text-center bg-emerald-50/50 rounded-xl border border-dashed border-emerald-200">
                          Chưa có ảnh nào trên Menu Điều Trị. Hãy tải ảnh các phương pháp trị liệu bên dưới.
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-2.5 bg-emerald-50/40 p-2.5 rounded-2xl border border-emerald-200/80 mb-3">
                          {nhtDisplayItems.map((wrapper, itemIdx) => (
                            <MenuDisplayOrderItem
                              key={`${wrapper.url}-${wrapper.originalIndex}`}
                              orderNumber={itemIdx + 1}
                              wrapper={wrapper}
                              isEditing={isEditing}
                              canMoveLeft={itemIdx > 0}
                              canMoveRight={itemIdx < nhtDisplayItems.length - 1}
                              onMoveLeft={() => handleReorderNhtMenu(itemIdx, itemIdx - 1)}
                              onMoveRight={() => handleReorderNhtMenu(itemIdx, itemIdx + 1)}
                              onToggleHidden={() => handleToggleItemHidden(wrapper.originalIndex)}
                            />
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="pt-2 border-t border-emerald-100/80">
                      <span className="text-xs font-bold text-emerald-900 uppercase tracking-wider block mb-2.5">
                        Tải ảnh 5 phương pháp trị liệu
                      </span>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {GALLERY_GROUPS.filter((g) => g.id !== 'legacy').map((group) => {
                          return renderGroupCard(group.id, `NHT · ${group.label}`);
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* ⚙️ 3. DỊCH VỤ & TÍNH NĂNG KHÁC */}
              <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <span className="text-xs font-bold text-gray-700 uppercase tracking-wider block mb-3">
                  Dịch vụ & Tính năng phụ
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <label className="flex items-center gap-2.5 p-3 rounded-xl border border-gray-100 bg-gray-50 hover:bg-gray-100/80 transition-colors cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={!isEditing}
                      checked={editedEmployee.isHomeSpa || false}
                      onChange={(e) => updateField('isHomeSpa', e.target.checked)}
                      className="w-4 h-4 text-sky-600 rounded border-gray-300 focus:ring-sky-500 cursor-pointer disabled:opacity-60"
                    />
                    <div>
                      <span className="text-xs font-bold text-gray-800 block">Đi Home Spa</span>
                      <span className="text-[10px] text-gray-500">Phục vụ tận nơi</span>
                    </div>
                  </label>
                  <label className="flex items-center gap-2.5 p-3 rounded-xl border border-gray-100 bg-gray-50 hover:bg-gray-100/80 transition-colors cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={!isEditing}
                      checked={editedEmployee.enableBonus ?? true}
                      onChange={(e) => updateField('enableBonus', e.target.checked)}
                      className="w-4 h-4 text-emerald-600 rounded border-gray-300 focus:ring-emerald-500 cursor-pointer disabled:opacity-60"
                    />
                    <div>
                      <span className="text-xs font-bold text-gray-800 block">Điểm Bonus</span>
                      <span className="text-[10px] text-gray-500">Tích lũy Ví Bonus</span>
                    </div>
                  </label>
                  <label className="flex items-center gap-2.5 p-3 rounded-xl border border-gray-100 bg-gray-50 hover:bg-gray-100/80 transition-colors cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={!isEditing}
                      checked={editedEmployee.enableKpiDemo || false}
                      onChange={(e) => updateField('enableKpiDemo', e.target.checked)}
                      className="w-4 h-4 text-amber-500 rounded border-gray-300 focus:ring-amber-500 cursor-pointer disabled:opacity-60"
                    />
                    <div>
                      <span className="text-xs font-bold text-gray-800 block">Demo KPI</span>
                      <span className="text-[10px] text-gray-500">Hiển thị thử nghiệm</span>
                    </div>
                  </label>
                </div>
              </div>

              {/* 📷 4. ẢNH CŨ CHƯA PHÂN LOẠI (Nếu có) */}
              {(() => {
                const legacyItems = (editedEmployee.galleryUrls || []).map((item, originalIndex) => ({
                  item,
                  originalIndex,
                  url: getItemUrl(item),
                  group: getGalleryGroup(item),
                })).filter(i => i.group === 'legacy');
                if (legacyItems.length === 0 && !isEditing) return null;
                return (
                  <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50/60 p-4">
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-2">
                      Ảnh cũ chưa phân loại ({legacyItems.length})
                    </span>
                    {renderGroupCard('legacy', 'Ảnh cũ chưa phân loại')}
                  </div>
                );
              })()}

              {/* 🎯 5. TẤT CẢ KỸ NĂNG CHUYÊN MÔN (Thu gọn/Mở rộng) */}
              <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Award size={16} className="text-indigo-600" />
                    <div>
                      <span className="text-xs font-bold text-gray-800 uppercase tracking-wide block">
                        Tất cả kỹ năng chuyên môn ({SKILL_KEYS.length})
                      </span>
                      <span className="text-[10px] text-gray-500">
                        {SKILL_KEYS.filter((k) => isSkillActive(editedEmployee.skills?.[k])).length} kỹ năng đã kích hoạt
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsAllSkillsExpanded(!isAllSkillsExpanded)}
                    className="px-3 py-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-1 text-xs font-semibold"
                  >
                    <span>{isAllSkillsExpanded ? 'Thu gọn' : 'Xem tất cả'}</span>
                    {isAllSkillsExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                  </button>
                </div>

                {isAllSkillsExpanded && (
                  <div className="mt-4 pt-3 border-t border-gray-100">
                    {isEditing && (
                      <p className="text-[10px] text-indigo-600 font-bold mb-2.5 animate-pulse">
                        ĐANG CHỈNH SỬA - Bấm vào kỹ năng để chuyển đổi trạng thái
                      </p>
                    )}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {SKILL_KEYS.map((key) => {
                        const rawLevel = editedEmployee.skills?.[key];
                        const isSkilled = isSkillActive(rawLevel);
                        const info = levelInfo[String(isSkilled)];
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => toggleSkill(key)}
                            disabled={!isEditing}
                            className={`flex items-center justify-between p-2.5 rounded-lg border text-left transition-all ${info.color} ${isEditing ? 'hover:border-indigo-400 hover:shadow-sm cursor-pointer active:scale-95' : 'cursor-default'}`}
                          >
                            <span className="text-xs font-bold truncate">{SKILL_LABELS[key]}</span>
                            {info.icon}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>

    {cropTarget && (
      <CardImageCropModal
        isOpen={Boolean(cropTarget)}
        imageSrc={cropTarget.imageSrc}
        title={cropTarget.title}
        subtitle={cropTarget.subtitle}
        staffCode={cropTarget.staffCode}
        staffName={cropTarget.staffName}
        onClose={() => setCropTarget(null)}
        onConfirm={handleCropConfirm}
        onUseOriginal={handleUseOriginal}
      />
    )}
  </>
  );
}

function InfoItem({
  label,
  value,
  icon,
  isEditing,
  onChange
}: {
  label: string,
  value: string | number,
  icon?: React.ReactNode,
  isEditing?: boolean,
  onChange?: (val: string) => void
}) {
  return (
    <div className="flex items-start gap-3">
      {icon && <div className="mt-0.5 text-gray-400">{icon}</div>}
      <div className="flex-1">
        <div className="text-[10px] text-gray-400 font-medium uppercase">{label}</div>
        {isEditing && onChange ? (
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full text-sm font-medium text-gray-900 border-b border-indigo-300 focus:border-indigo-600 outline-none bg-transparent py-0.5"
          />
        ) : (
          <div className="text-sm text-gray-900 font-medium">{value}</div>
        )}
      </div>
    </div>
  );
}

function GalleryThumbnailItem({
  url,
  index,
  isEditing,
  isHidden,
  canMoveLeft,
  canMoveRight,
  onMoveLeft,
  onMoveRight,
  onToggleHidden,
  onRemove,
}: {
  url: string;
  index: number;
  isEditing: boolean;
  isHidden?: boolean;
  canMoveLeft?: boolean;
  canMoveRight?: boolean;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
  onToggleHidden?: () => void;
  onRemove?: () => void;
}) {
  const [loadError, setLoadError] = useState(false);

  return (
    <div className={`relative group rounded-xl overflow-hidden border transition-all aspect-square flex items-center justify-center bg-gray-100 ${
      isHidden ? 'border-amber-300 ring-1 ring-amber-300/60' : 'border-gray-200 shadow-2xs'
    }`}>
      {loadError ? (
        <div className="p-1 text-center text-[10px] text-red-500 font-medium leading-tight">
          Lỗi tải ảnh
        </div>
      ) : (
        <img
          src={url}
          alt={`gallery-${index}`}
          className={`w-full h-full object-cover transition-opacity duration-200 ${
            isHidden ? 'opacity-40 grayscale-[40%]' : 'opacity-100'
          }`}
          referrerPolicy="no-referrer"
          onError={() => setLoadError(true)}
        />
      )}

      {/* Huy hiệu Đang Ẩn trên Menu */}
      {isHidden && (
        <div className="absolute top-1 left-1 bg-amber-500/90 text-white text-[9px] font-black px-1.5 py-0.5 rounded shadow-sm flex items-center gap-0.5 pointer-events-none z-10 backdrop-blur-2xs">
          <EyeOff size={10} />
          <span>Ẩn</span>
        </div>
      )}

      {/* Control Buttons khi Editing */}
      {isEditing && (
        <>
          {/* Top-right actions: Toggle Hidden & Remove */}
          <div className="absolute top-1 right-1 flex items-center gap-1 z-10">
            {onToggleHidden && (
              <button
                type="button"
                onClick={onToggleHidden}
                aria-label={isHidden ? 'Hiện ảnh trên menu' : 'Ẩn ảnh trên menu'}
                title={isHidden ? 'Đang ẩn - Bấm để hiện lại trên menu' : 'Đang hiện - Bấm để ẩn khỏi menu'}
                className={`p-1 rounded-full shadow-md transition-all touch-manipulation ${
                  isHidden
                    ? 'bg-amber-600 hover:bg-amber-700 text-white'
                    : 'bg-black/60 hover:bg-black/80 text-white/90 hover:text-white'
                }`}
              >
                {isHidden ? <EyeOff size={11} /> : <Eye size={11} />}
              </button>
            )}
            {onRemove && (
              <button
                type="button"
                onClick={onRemove}
                aria-label="Xóa ảnh"
                title="Xóa ảnh"
                className="bg-red-600 hover:bg-red-700 text-white rounded-full p-1 shadow-md transition-all touch-manipulation"
              >
                <X size={11} />
              </button>
            )}
          </div>

          {/* Bottom actions: Move Left / Move Right */}
          <div className="absolute bottom-1 inset-x-1 flex items-center justify-between pointer-events-none z-10">
            <button
              type="button"
              disabled={!canMoveLeft}
              onClick={onMoveLeft}
              aria-label="Di chuyển sang trước"
              title="Di chuyển sang trước"
              className={`p-1 rounded-lg shadow-sm transition-all pointer-events-auto ${
                canMoveLeft
                  ? 'bg-white/95 hover:bg-white text-gray-800 hover:text-indigo-600 shadow-md active:scale-95'
                  : 'bg-white/40 text-gray-300 cursor-not-allowed opacity-0 group-hover:opacity-40'
              }`}
            >
              <ChevronLeft size={13} />
            </button>
            <button
              type="button"
              disabled={!canMoveRight}
              onClick={onMoveRight}
              aria-label="Di chuyển sang sau"
              title="Di chuyển sang sau"
              className={`p-1 rounded-lg shadow-sm transition-all pointer-events-auto ${
                canMoveRight
                  ? 'bg-white/95 hover:bg-white text-gray-800 hover:text-indigo-600 shadow-md active:scale-95'
                  : 'bg-white/40 text-gray-300 cursor-not-allowed opacity-0 group-hover:opacity-40'
              }`}
            >
              <ChevronRight size={13} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function MenuDisplayOrderItem({
  orderNumber,
  wrapper,
  isEditing,
  canMoveLeft,
  canMoveRight,
  onMoveLeft,
  onMoveRight,
  onToggleHidden,
}: {
  orderNumber: number;
  wrapper: MenuGalleryItemWrapper;
  isEditing: boolean;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onToggleHidden: () => void;
}) {
  const [loadError, setLoadError] = useState(false);
  const { url, isHidden, label } = wrapper;

  return (
    <div
      className={`relative group rounded-xl overflow-hidden border bg-white flex flex-col p-1.5 shadow-2xs transition-all ${
        isHidden ? 'border-amber-300 ring-1 ring-amber-300/60 bg-amber-50/20' : 'border-gray-200'
      }`}
    >
      {/* Container ảnh thumbnail */}
      <div className="relative aspect-square w-full rounded-lg overflow-hidden bg-gray-100 flex items-center justify-center">
        {loadError ? (
          <div className="p-1 text-center text-[10px] text-red-500 font-medium leading-tight">
            Lỗi tải ảnh
          </div>
        ) : (
          <img
            src={url}
            alt={label}
            className={`w-full h-full object-cover transition-opacity duration-200 ${
              isHidden ? 'opacity-40 grayscale-[40%]' : 'opacity-100'
            }`}
            referrerPolicy="no-referrer"
            onError={() => setLoadError(true)}
          />
        )}

        {/* Số thứ tự hiển thị nội bộ */}
        <div className="absolute top-1 left-1 bg-black/75 text-white text-[10px] font-black px-1.5 py-0.5 rounded-md shadow-sm z-10 pointer-events-none">
          #{orderNumber}
        </div>

        {/* Badge Ẩn */}
        {isHidden && (
          <div className="absolute top-1 right-1 bg-amber-500/90 text-white text-[9px] font-black px-1.5 py-0.5 rounded shadow-sm flex items-center gap-0.5 pointer-events-none z-10 backdrop-blur-2xs">
            <EyeOff size={10} />
            <span>Ẩn</span>
          </div>
        )}

        {/* Nút Ẩn/Hiện khi Editing */}
        {isEditing && (
          <button
            type="button"
            onClick={onToggleHidden}
            aria-label={isHidden ? 'Hiện ảnh trên menu' : 'Ẩn ảnh trên menu'}
            title={isHidden ? 'Đang ẩn - Bấm để hiện lại trên menu' : 'Đang hiện - Bấm để ẩn khỏi menu'}
            className={`absolute ${isHidden ? 'top-6' : 'top-1'} right-1 z-10 p-1 rounded-full shadow-md transition-all touch-manipulation ${
              isHidden
                ? 'bg-amber-600 hover:bg-amber-700 text-white'
                : 'bg-black/60 hover:bg-black/80 text-white'
            }`}
          >
            {isHidden ? <EyeOff size={11} /> : <Eye size={11} />}
          </button>
        )}
      </div>

      {/* Tên nhãn mô tả ảnh */}
      <div className="mt-1 px-0.5">
        <span className="text-[10px] font-bold text-gray-700 truncate block" title={label}>
          {label}
        </span>
      </div>

      {/* Hai nút di chuyển thứ tự Lên/Xuống */}
      {isEditing && (
        <div className="mt-1 flex items-center justify-between gap-1 pt-1 border-t border-gray-100">
          <button
            type="button"
            disabled={!canMoveLeft}
            onClick={onMoveLeft}
            title="Đẩy lên trước"
            className={`flex-1 py-1 rounded-md text-[10px] font-bold flex items-center justify-center gap-0.5 transition-all ${
              canMoveLeft
                ? 'bg-gray-100 hover:bg-indigo-50 hover:text-indigo-600 text-gray-700 active:scale-95'
                : 'bg-gray-50 text-gray-300 cursor-not-allowed'
            }`}
          >
            <ChevronLeft size={12} />
            <span>Trước</span>
          </button>
          <button
            type="button"
            disabled={!canMoveRight}
            onClick={onMoveRight}
            title="Đẩy xuống sau"
            className={`flex-1 py-1 rounded-md text-[10px] font-bold flex items-center justify-center gap-0.5 transition-all ${
              canMoveRight
                ? 'bg-gray-100 hover:bg-indigo-50 hover:text-indigo-600 text-gray-700 active:scale-95'
                : 'bg-gray-50 text-gray-300 cursor-not-allowed'
            }`}
          >
            <span>Sau</span>
            <ChevronRight size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

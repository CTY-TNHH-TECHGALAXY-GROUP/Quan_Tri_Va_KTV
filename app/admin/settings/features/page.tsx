'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Loader2, Settings2, ToggleLeft, ToggleRight, Target } from 'lucide-react';
import { apiClient } from '@/lib/apiClient';
import { API } from '@/lib/api-endpoints';
import { useToast } from '@/components/ui/Toast';

// 🔧 SYSTEM-WIDE FEATURE TOGGLES
const SYSTEM_TOGGLES = [
    {
        key: 'enable_web_advance_booking_email',
        label: '🌐 Gửi Email Yêu Cầu Đặt Cọc',
        description: 'Tự động gửi email yêu cầu đặt cọc cho khách khi Lễ tân bấm Xác nhận đơn từ Web.',
    },
    {
        key: 'auto_demote_type_b_to_a',
        label: '⏬ Tự động giáng chức KTV Loại B',
        description: 'Tự động chuyển KTV Loại B xuống Loại A nếu không đạt đủ chỉ tiêu.',
    }
] as const;

const useSystemToggles = () => {
    const [values, setValues] = useState<Record<string, boolean>>({});
    const [loading, setLoading] = useState(true);
    const [updating, setUpdating] = useState<string | null>(null);
    const { addToast } = useToast();

    const fetchConfigs = useCallback(async () => {
        try {
            setLoading(true);
            const json = await apiClient.get<any>(API.ADMIN.SETTINGS_SYSTEM);
            const data = json.data || {};
            const parsed: Record<string, boolean> = {};
            for (const toggle of SYSTEM_TOGGLES) {
                const raw = data[toggle.key];
                parsed[toggle.key] = raw === true || raw === 'true';
            }
            setValues(parsed);
        } catch (err) {
            console.error('Failed to fetch system toggles:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

    const toggle = useCallback(async (key: string, newValue: boolean) => {
        setUpdating(key);
        setValues(prev => ({ ...prev, [key]: newValue }));
        // Lật cần gạt về chỗ cũ thôi thì chưa đủ: admin thấy nó tự nhảy lại sẽ
        // tưởng mình bấm hụt và bấm tiếp, chứ không biết là LƯU HỎNG.
        const revert = (msg: string) => {
            setValues(prev => ({ ...prev, [key]: !newValue }));
            addToast(`Không lưu được cài đặt: ${msg}`, 'error');
        };
        try {
            const json = await apiClient.patch<any>(API.ADMIN.SETTINGS_SYSTEM, { [key]: newValue });
            if (!json.success) {
                revert(json.error || 'máy chủ từ chối');
            }
        } catch (err: any) {
            // apiClient ném lỗi với mọi mã khác 2xx nên nhánh trên hiếm khi chạy —
            // chỗ bắt lỗi thật sự là đây.
            revert(err?.message || 'lỗi kết nối');
        } finally {
            setUpdating(null);
        }
    }, [addToast]);

    return { values, loading, updating, toggle };
};

const useDisciplineConfigs = () => {
    const { addToast } = useToast();
    const [values, setValues] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(true);
    const [updating, setUpdating] = useState<string | null>(null);

    const fetchConfigs = useCallback(async () => {
        try {
            setLoading(true);
            const json = await apiClient.get<any>(API.ADMIN.SETTINGS_SYSTEM);
            const data = json.data || {};
            setValues({
                ktv_discipline_demotion_threshold: Number(data.ktv_discipline_demotion_threshold || 80),
                ktv_continuous_work_gap_mins: Number(data.ktv_continuous_work_gap_mins || 30),
                ktv_continuous_work_exempt_hours: Number(data.ktv_continuous_work_exempt_hours || 4),
            });
        } catch (err) {
            console.error('Failed to fetch system configs:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

    const updateConfig = useCallback(async (key: string, newValue: number) => {
        setUpdating(key);
        try {
            const json = await apiClient.patch<any>(API.ADMIN.SETTINGS_SYSTEM, { [key]: newValue });
            if (json.success) {
                setValues(prev => ({ ...prev, [key]: newValue }));
                addToast('Đã lưu.', 'success');
            } else {
                addToast(`Không lưu được: ${json.error || 'máy chủ từ chối'}`, 'error');
            }
        } catch (error: any) {
            // Hỏng mà chỉ console.error thì nút "Lưu" biến mất như đã lưu xong,
            // trong khi giá trị cũ vẫn nguyên trong DB.
            console.error('Error update:', error);
            addToast(`Không lưu được: ${error?.message || 'lỗi kết nối'}`, 'error');
        } finally {
            setUpdating(null);
        }
    }, [addToast]);

    return { values, loading, updating, updateConfig };
};

const FeatureFlagsPage = () => {
    return (
        <div className="max-w-5xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Quản Lý Tính Năng</h1>
                    <p className="text-sm text-gray-500 mt-1">
                        Bật/tắt các tính năng và cài đặt tự động hoá của hệ thống
                    </p>
                </div>
            </div>

            {/* ═══ SYSTEM-WIDE TOGGLES ═══ */}
            <SystemToggleSection />

            {/* ═══ KTV DISCIPLINE SETTINGS ═══ */}
            <DisciplineSettingsSection />

            {/* ═══ BÀN GIAO PHÒNG ═══ */}
            <HandoverSettingsSection />
        </div>
    );
};

// ═══ System Toggle Section Component ═══
const SystemToggleSection = () => {
    const { values, loading, updating, toggle } = useSystemToggles();

    if (loading) {
        return (
            <div className="bg-white border border-gray-200 rounded-2xl p-6 flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            </div>
        );
    }

    return (
        <div className="bg-gradient-to-br from-gray-50 to-slate-50 border border-gray-200 rounded-2xl p-5 space-y-3">
            <div className="flex items-center gap-2 mb-1">
                <Settings2 size={16} className="text-gray-600" />
                <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Tính năng hệ thống</h2>
            </div>
            {SYSTEM_TOGGLES.map(def => {
                const isEnabled = values[def.key] === true;
                const isUpdating = updating === def.key;
                return (
                    <div
                        key={def.key}
                        className="flex items-center justify-between bg-white rounded-xl border border-gray-100 px-4 py-3"
                    >
                        <div>
                            <p className="text-sm font-semibold text-gray-800">{def.label}</p>
                            <p className="text-xs text-gray-400 mt-0.5">{def.description}</p>
                        </div>
                        <button
                            onClick={() => toggle(def.key, !isEnabled)}
                            disabled={!!updating}
                            className="flex items-center gap-1.5 cursor-pointer disabled:cursor-wait"
                        >
                            {isUpdating ? (
                                <Loader2 size={22} className="animate-spin text-gray-400" />
                            ) : isEnabled ? (
                                <ToggleRight size={32} className="text-emerald-500" />
                            ) : (
                                <ToggleLeft size={32} className="text-gray-300" />
                            )}
                            <span className={`text-xs font-bold ${isEnabled ? 'text-emerald-600' : 'text-gray-400'}`}>
                                {isEnabled ? 'ON' : 'OFF'}
                            </span>
                        </button>
                    </div>
                );
            })}
        </div>
    );
};

// ═══ KTV Discipline Settings Section Component ═══
const DisciplineSettingsSection = () => {
    const { values, loading, updating, updateConfig } = useDisciplineConfigs();
    const [localValues, setLocalValues] = useState<Record<string, string>>({});

    useEffect(() => {
        if (!loading) {
            setLocalValues({
                ktv_discipline_demotion_threshold: values.ktv_discipline_demotion_threshold?.toString() || '80',
                ktv_continuous_work_gap_mins: values.ktv_continuous_work_gap_mins?.toString() || '30',
                ktv_continuous_work_exempt_hours: values.ktv_continuous_work_exempt_hours?.toString() || '4',
            });
        }
    }, [values, loading]);

    if (loading) {
        return (
            <div className="bg-white border border-gray-200 rounded-2xl p-6 flex items-center justify-center mt-6">
                <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            </div>
        );
    }

    const renderInput = (key: string, label: string, desc: string, suffix: string) => {
        const isUpdating = updating === key;
        const localVal = localValues[key] || '';
        const savedVal = values[key]?.toString() || '';
        const isChanged = localVal !== savedVal;

        return (
            <div key={key} className="flex flex-col sm:flex-row sm:items-center justify-between bg-white rounded-xl border border-gray-100 px-4 py-3 gap-3">
                <div>
                    <p className="text-sm font-semibold text-gray-800">{label}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="relative">
                        <input 
                            type="number" 
                            className="w-24 pl-3 pr-8 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all text-right"
                            value={localVal}
                            onChange={(e) => setLocalValues(prev => ({ ...prev, [key]: e.target.value }))}
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 font-medium">{suffix}</span>
                    </div>
                    {isChanged && (
                        <button
                            onClick={() => updateConfig(key, Number(localVal))}
                            disabled={!!updating}
                            className="px-3 py-1.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 text-xs font-bold rounded-lg transition-colors disabled:opacity-50"
                        >
                            {isUpdating ? 'Đang lưu...' : 'Lưu'}
                        </button>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="bg-gradient-to-br from-indigo-50 to-slate-50 border border-gray-200 rounded-2xl p-5 space-y-3">
            <div className="flex items-center gap-2 mb-1">
                <Target size={16} className="text-indigo-600" />
                <h2 className="text-sm font-bold text-indigo-700 uppercase tracking-wide">Cài đặt Điểm Chuyên Cần KTV</h2>
            </div>
            
            {renderInput('ktv_discipline_demotion_threshold', '🚨 Ngưỡng giáng chức (Loại B xuống A)', 'Số điểm tối thiểu để KTV không bị tự động giáng chức.', 'điểm')}
            {renderInput('ktv_continuous_work_gap_mins', '🔗 Khoảng cách ghép tua liên tục', 'Nếu khoảng cách giữa 2 tua <= số phút này, KTV được tính là đang làm việc liên tục.', 'phút')}
            {renderInput('ktv_continuous_work_exempt_hours', '🛡️ Ngưỡng thời gian miễn phạt', 'Nếu KTV làm việc liên tục đạt ngưỡng này, họ có quyền TỪ CHỐI tua tiếp theo mà không bị trừ điểm.', 'giờ')}
        </div>
    );
};

// ═══ Bàn Giao Phòng ═══
const HANDOVER_KEYS = [
    {
        key: 'max_handover_skip',
        fallback: 2,
        label: '📸 Số đơn được nợ bàn giao',
        desc: 'KTV bấm "Bỏ qua" khi chưa chụp đủ ảnh thì bị ghi nợ. Nợ đủ số này là không bỏ qua thêm được nữa, phải trả bớt đã. Tính chung mọi lúc, KHÔNG reset theo ngày. Đặt 0 để cấm bỏ qua hoàn toàn.',
        suffix: 'đơn',
    },
    {
        key: 'reception_auto_approve_minutes',
        fallback: 15,
        label: '⏱️ Thời gian quầy có để duyệt ảnh',
        desc: 'KTV nộp ảnh xong, quầy có ngần này phút để duyệt hoặc trả lại. Quá hạn thì hệ thống tự duyệt, tránh treo đơn vì quầy bận.',
        suffix: 'phút',
    },
    {
        key: 'max_handover_reject',
        fallback: 2,
        label: '↩️ Số lần quầy được bắt dọn lại',
        desc: 'Trên cùng một đơn, quầy trả lại được tối đa ngần này lần. Hết lượt thì phải chọn trừ tiền hoặc tước tua thay vì bắt dọn mãi.',
        suffix: 'lần',
    },
];

const HandoverSettingsSection = () => {
    const { addToast } = useToast();
    const [values, setValues] = useState<Record<string, number>>({});
    const [local, setLocal] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [updating, setUpdating] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const json = await apiClient.get<any>(API.ADMIN.SETTINGS_SYSTEM);
                const data = json.data || {};
                const next: Record<string, number> = {};
                HANDOVER_KEYS.forEach(k => { next[k.key] = Number(data[k.key] ?? k.fallback); });
                setValues(next);
                setLocal(Object.fromEntries(Object.entries(next).map(([k, v]) => [k, String(v)])));
            } catch (err) {
                console.error('Failed to fetch handover configs:', err);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const save = async (key: string, newValue: number) => {
        setUpdating(key);
        try {
            const json = await apiClient.patch<any>(API.ADMIN.SETTINGS_SYSTEM, { [key]: newValue });
            if (json.success) {
                setValues(prev => ({ ...prev, [key]: newValue }));
                addToast('Đã lưu.', 'success');
            } else {
                addToast(`Không lưu được: ${json.error || 'máy chủ từ chối'}`, 'error');
            }
        } catch (error: any) {
            console.error('Error update:', error);
            addToast(`Không lưu được: ${error?.message || 'lỗi kết nối'}`, 'error');
        } finally {
            setUpdating(null);
        }
    };

    if (loading) {
        return (
            <div className="bg-white border border-gray-200 rounded-2xl p-6 flex items-center justify-center mt-6">
                <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            </div>
        );
    }

    return (
        <div className="bg-gradient-to-br from-blue-50 to-slate-50 border border-gray-200 rounded-2xl p-5 space-y-3">
            <div className="flex items-center gap-2 mb-1">
                <Target size={16} className="text-blue-600" />
                <h2 className="text-sm font-bold text-blue-700 uppercase tracking-wide">Bàn Giao Phòng</h2>
            </div>

            {HANDOVER_KEYS.map(({ key, label, desc, suffix }) => {
                const localVal = local[key] ?? '';
                const changed = localVal !== String(values[key] ?? '');
                return (
                    <div key={key} className="flex flex-col sm:flex-row sm:items-center justify-between bg-white rounded-xl border border-gray-100 px-4 py-3 gap-3">
                        <div className="sm:max-w-md">
                            <p className="text-sm font-semibold text-gray-800">{label}</p>
                            <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{desc}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <div className="relative">
                                <input
                                    type="number"
                                    min={0}
                                    className="w-24 pl-3 pr-12 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all text-right"
                                    value={localVal}
                                    onChange={(e) => setLocal(prev => ({ ...prev, [key]: e.target.value }))}
                                />
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 font-medium">{suffix}</span>
                            </div>
                            {changed && (
                                <button
                                    onClick={() => save(key, Number(localVal))}
                                    disabled={!!updating}
                                    className="px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 text-xs font-bold rounded-lg transition-colors disabled:opacity-50"
                                >
                                    {updating === key ? 'Đang lưu...' : 'Lưu'}
                                </button>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

export default FeatureFlagsPage;

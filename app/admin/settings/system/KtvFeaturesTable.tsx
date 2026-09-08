import React, { useState } from 'react';
import { Search, ToggleLeft, ToggleRight, Loader2, RefreshCw, Zap, ZapOff } from 'lucide-react';
import { useStaffFeatures, FEATURE_FLAG_DEFS } from './KtvFeatures.logic';
import { walletLabel } from '@/lib/featureFlags';

const ANIMATION_DURATION = '200ms';
const TABLE_ROW_HEIGHT = '52px';

export const KtvFeaturesTable = ({ activeTab }: { activeTab: 'TYPE_A' | 'TYPE_B' | 'TYPE_C' | 'TYPE_D' }) => {
    const {
        staffList,
        allStaffCount,
        loading,
        updating,
        searchQuery,
        setSearchQuery,
        toggleFlag,
        bulkToggle,
        bulkTargetCount,
        isFlagOn,
        refetch,
    } = useStaffFeatures(activeTab);

    const [selectedBulkFeature, setSelectedBulkFeature] = useState<string>(FEATURE_FLAG_DEFS[0].key);

    const TYPE_LABEL: Record<string, string> = {
        TYPE_A: 'Loại A', TYPE_B: 'Loại B', TYPE_C: 'Loại C', TYPE_D: 'Loại D',
    };

    const typeLabel = TYPE_LABEL[activeTab] || activeTab;

    const getLabel = (def: any) => {
        // Nhãn ví lấy từ nguồn chung để app KTV và admin không gọi hai tên khác nhau.
        if (def.key === 'tua_wallet') return `💰 ${walletLabel('TUA', activeTab).toUpperCase()}`;
        if (def.key === 'bonus_wallet') return `💎 ${walletLabel('BONUS', activeTab).toUpperCase()}`;
        return def.label;
    };

    /**
     * Thao tác hàng loạt phải nói rõ đụng bao nhiêu người của loại nào — và
     * kèm cảnh báo đăng xuất, vì đổi cờ là ép đúng những người đó đăng nhập lại.
     */
    const confirmBulk = (value: boolean) => {
        const def = FEATURE_FLAG_DEFS.find(d => d.key === selectedBulkFeature);
        const label = def ? getLabel(def) : selectedBulkFeature;
        const verb = value ? 'BẬT' : 'TẮT';
        const scope = searchQuery.trim() ? ' (đang lọc theo ô tìm kiếm)' : '';
        const ok = window.confirm(
            `${verb} "${label}" cho ${bulkTargetCount} KTV ${typeLabel}${scope}.\n\n`
            + `Các loại KTV khác giữ nguyên.\n`
            + `Nếu "Ép đăng xuất" đang bật, ${bulkTargetCount} người này phải đăng nhập lại.\n\nTiếp tục?`
        );
        if (ok) bulkToggle(selectedBulkFeature, value);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[40vh] bg-white border border-gray-200 rounded-2xl">
                <div className="text-center space-y-3">
                    <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mx-auto" />
                    <p className="text-gray-500 text-sm">Đang tải dữ liệu nhân viên...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-bold text-gray-900">Quản Lý Tính Năng KTV</h2>
                    <p className="text-sm text-gray-500">
                        Bật/tắt cho <b>từng nhân viên</b> {typeLabel}. Đổi cờ ở đây
                        chỉ ảnh hưởng đúng người đó; muốn tắt cả loại thì dùng công tắc phía trên.
                    </p>
                </div>
                <button
                    onClick={refetch}
                    className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
                >
                    <RefreshCw size={16} />
                    Làm mới
                </button>
            </div>

            {/* Search + Bulk Actions */}
            <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                <div className="relative w-full md:w-96">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Search className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                        type="text"
                        placeholder="Tìm theo mã NV hoặc tên..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="block w-full pl-10 pr-3 py-2 border border-gray-200 rounded-xl leading-5 bg-gray-50 focus:outline-none focus:bg-white focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 sm:text-sm transition-all"
                    />
                </div>
                
                <div className="flex items-center gap-3 w-full md:w-auto overflow-x-auto pb-2 md:pb-0">
                    <select
                        value={selectedBulkFeature}
                        onChange={(e) => setSelectedBulkFeature(e.target.value)}
                        className="py-2 px-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 bg-white min-w-[200px]"
                    >
                        {FEATURE_FLAG_DEFS.map(def => (
                            <option key={def.key} value={def.key}>{getLabel(def)}</option>
                        ))}
                    </select>
                    
                    <button
                        onClick={() => confirmBulk(true)}
                        disabled={updating === `bulk-${selectedBulkFeature}`}
                        className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors disabled:opacity-50 whitespace-nowrap"
                        title={`Bật cho ${bulkTargetCount} KTV ${typeLabel} đang hiển thị`}
                    >
                        <Zap size={14} />
                        Bật hết ({bulkTargetCount})
                    </button>
                    <button
                        onClick={() => confirmBulk(false)}
                        disabled={updating === `bulk-${selectedBulkFeature}`}
                        className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-50 whitespace-nowrap"
                        title={`Tắt cho ${bulkTargetCount} KTV ${typeLabel} đang hiển thị`}
                    >
                        <ZapOff size={14} />
                        Tắt hết ({bulkTargetCount})
                    </button>
                </div>
            </div>

            {/* Staff Table */}
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="bg-gray-50 border-b border-gray-200">
                                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3 w-24">
                                    Mã NV
                                </th>
                                {FEATURE_FLAG_DEFS.map(def => (
                                    <th
                                        key={def.key}
                                        className="text-center text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3 w-40"
                                        title={def.description}
                                    >
                                        {getLabel(def)}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {staffList.length === 0 ? (
                                <tr>
                                    <td colSpan={1 + FEATURE_FLAG_DEFS.length} className="text-center text-gray-400 py-12 text-sm">
                                        {searchQuery ? 'Không tìm thấy nhân viên' : 'Không có dữ liệu'}
                                    </td>
                                </tr>
                            ) : (
                                staffList.map(staff => (
                                    <tr
                                        key={staff.id}
                                        className="hover:bg-gray-50/50 transition-colors"
                                        style={{ height: TABLE_ROW_HEIGHT }}
                                    >
                                        <td className="px-4 py-2">
                                            <span className="text-sm font-mono font-semibold text-indigo-600">
                                                {staff.id}
                                            </span>
                                        </td>
                                        {FEATURE_FLAG_DEFS.map(def => {
                                            // Dùng chung bộ giải mã với app KTV: cờ THIẾU không
                                            // mặc nhiên là TẮT (ví tua thiếu cờ = ĐANG BẬT).
                                            const isEnabled = isFlagOn(staff, def.key);
                                            const isUpdating = updating === `${staff.id}-${def.key}`;

                                            return (
                                                <td key={def.key} className="px-4 py-2 text-center">
                                                    <button
                                                        onClick={() => toggleFlag(staff.id, def.key, !isEnabled)}
                                                        disabled={!!updating}
                                                        className={`inline-flex items-center gap-1.5 transition-all cursor-pointer disabled:cursor-wait`}
                                                        style={{ transitionDuration: ANIMATION_DURATION }}
                                                    >
                                                        {isUpdating ? (
                                                            <Loader2 size={20} className="animate-spin text-gray-400" />
                                                        ) : isEnabled ? (
                                                            <ToggleRight size={28} className="text-emerald-500" />
                                                        ) : (
                                                            <ToggleLeft size={28} className="text-gray-300" />
                                                        )}
                                                        <span className={`text-xs font-medium ${isEnabled ? 'text-emerald-600' : 'text-gray-400'}`}>
                                                            {isEnabled ? 'ON' : 'OFF'}
                                                        </span>
                                                    </button>
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Footer */}
                <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 text-xs text-gray-400">
                    Hiển thị {staffList.length} / {allStaffCount} nhân viên
                </div>
            </div>
        </div>
    );
};

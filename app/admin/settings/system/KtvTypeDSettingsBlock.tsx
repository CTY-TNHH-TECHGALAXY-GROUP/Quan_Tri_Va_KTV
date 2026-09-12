import React, { useState, useEffect } from 'react';
import { Save, Loader2, CheckCircle2, DollarSign, Star, Coins, AlertTriangle, ShieldCheck, Trophy } from 'lucide-react';
import { apiClient } from '@/lib/apiClient';
import { API } from '@/lib/api-endpoints';
import { TYPE_D_DISCIPLINE_CASES, type TypeDDisciplineCaseKey } from '@/lib/constants/staff.constants';

/**
 * Ba chế tài, viết bằng tiếng người. Giá trị phải khớp `TypeDDisciplineAction`
 * bên `staff.constants.ts` — cron đọc đúng mấy chuỗi này.
 */
const CHE_TAI = [
    { value: 'NONE',           label: 'Bỏ qua — không xử lý' },
    { value: 'DEDUCT',         label: 'Chỉ trừ giờ' },
    { value: 'LOCK',           label: 'Khoá tài khoản' },
    { value: 'DEDUCT_OR_LOCK', label: 'Trừ giờ, không đủ thì khoá' },
] as const;

/** Thứ tự hiện trên bảng — theo dòng thời gian một ngày làm việc. */
const THU_TU_CASE: TypeDDisciplineCaseKey[] = [
    'NO_REGISTRATION',
    'NO_SHOW_NO_NOTICE',
    'LATE_REPORTED_NO_SHOW',
    'ABSENT_REPORTED_NO_SHOW',
];


export function KtvTypeDSettingsBlock() {
    const [configs, setConfigs] = useState<any>({});
    const [isLoading, setIsLoading] = useState(true);
    const [savingGroup, setSavingGroup] = useState<string | null>(null);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');

    useEffect(() => {
        fetchConfigs();
    }, []);

    const fetchConfigs = async () => {
        try {
            const data = await apiClient.get<any>(API.ADMIN.SETTINGS_SYSTEM);
            if (data.data) {
                // Ensure json objects are parsed if they are strings, but usually they are already parsed by API
                const parsed = { ...data.data };
                if (typeof parsed.ktv_type_d_rating_deduction === 'string') {
                    try { parsed.ktv_type_d_rating_deduction = JSON.parse(parsed.ktv_type_d_rating_deduction); } catch(e){}
                }
                if (typeof parsed.ktv_type_d_discipline_rules === 'string') {
                    try { parsed.ktv_type_d_discipline_rules = JSON.parse(parsed.ktv_type_d_discipline_rules); } catch(e){}
                }
                
                // Defaults
                if (!parsed.ktv_type_d_rating_deduction) {
                    parsed.ktv_type_d_rating_deduction = { "0": 0, "1": 0.75, "2": 0.5, "3": 0.25, "4": 0 };
                }
                if (!parsed.ktv_type_d_discipline_rules) { parsed.ktv_type_d_discipline_rules = { "ABSENT_NO_NOTICE":10, "ABSENT_EARLY_NOTICE":5, "LATE_NO_UPDATE":5, "ORDER_REJECT_MULTIPLIER":3, "MIN_HOURS_TO_REJECT":3 }; }
                // Cấu hình cũ chưa có khối CASES → điền mặc định quy chế, để bảng
                // bên dưới hiện đúng thứ hệ thống đang áp chứ không hiện ô trống.
                if (!parsed.ktv_type_d_discipline_rules.CASES) {
                    parsed.ktv_type_d_discipline_rules = {
                        ...parsed.ktv_type_d_discipline_rules,
                        CASES: Object.fromEntries(Object.entries(TYPE_D_DISCIPLINE_CASES)
                            .map(([k, v]) => [k, { action: v.action, hours: v.hours }])),
                    };
                }
                setConfigs(parsed);
            }
        } catch (error) {
            console.error('Error fetching type d configs', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSaveGroup = async (keys: string[], groupName: string) => {
        setSavingGroup(groupName);
        setSaveStatus('idle');
        try {
            const payload: any = {};
            keys.forEach(k => {
                payload[k] = configs[k];
            });
            const result = await apiClient.patch<any>(API.ADMIN.SETTINGS_SYSTEM, payload);
            if (result.success) {
                setSaveStatus('success');
                setTimeout(() => setSaveStatus('idle'), 3000);
            } else {
                setSaveStatus('error');
            }
        } catch (error) {
            console.error('Error saving configs', error);
            setSaveStatus('error');
        } finally {
            setSavingGroup(null);
        }
    };

    const handleChange = (key: string, value: any) => {
        setConfigs((prev: any) => ({ ...prev, [key]: value }));
    };

    if (isLoading) {
        return (
            <div className="flex justify-center p-12">
                <Loader2 size={32} className="animate-spin text-indigo-500" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* 1. Khung giá tua */}
                <div className="bg-white rounded-[2rem] p-6 shadow-sm border border-gray-100">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                                <DollarSign size={20} className="text-blue-500" />
                            </div>
                            <h2 className="text-lg font-black text-gray-900">Khung giá tua (VNĐ/Giờ)</h2>
                        </div>
                        <SaveButton group="rates" savingGroup={savingGroup} saveStatus={saveStatus} onClick={() => handleSaveGroup(['ktv_type_d_vip_rate_per_60m', 'ktv_type_d_pt_rate_per_60m'], 'rates')} />
                    </div>
                    <div className="space-y-4">
                        <NumberInput label="Rate VIP - dịch vụ mã NHP / NHT / VIP" value={configs.ktv_type_d_vip_rate_per_60m ?? 180000} onChange={(v: any) => handleChange('ktv_type_d_vip_rate_per_60m', v)} suffix="VNĐ/giờ" />
                        <NumberInput label="Rate Phổ thông - các dịch vụ còn lại (NHS...)" value={configs.ktv_type_d_pt_rate_per_60m ?? 100000} onChange={(v: any) => handleChange('ktv_type_d_pt_rate_per_60m', v)} suffix="VNĐ/giờ" />
                    </div>
                </div>

                {/* 2. Bonus */}
                <div className="bg-white rounded-[2rem] p-6 shadow-sm border border-gray-100">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center">
                                <Coins size={20} className="text-amber-500" />
                            </div>
                            <h2 className="text-lg font-black text-gray-900">Bonus Điểm</h2>
                        </div>
                        <SaveButton group="bonus" savingGroup={savingGroup} saveStatus={saveStatus} onClick={() => handleSaveGroup(['ktv_type_d_bonus_points', 'ktv_bonus_rate_TYPE_D', 'enable_ktv_bonus_TYPE_D'], 'bonus')} />
                    </div>
                    <div className="space-y-4">
                        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
                            <div>
                                <p className="font-bold text-gray-900">Trạng thái Bonus</p>
                                <p className="text-xs text-gray-500">Bật/tắt thưởng điểm cho TYPE_D</p>
                            </div>
                            <Toggle value={configs.enable_ktv_bonus_TYPE_D ?? false} onChange={(v: any) => handleChange('enable_ktv_bonus_TYPE_D', v)} />
                        </div>
                        <NumberInput label="Điểm cơ bản mỗi tua" value={configs.ktv_type_d_bonus_points ?? 20} onChange={(v: any) => handleChange('ktv_type_d_bonus_points', v)} suffix="Điểm" />
                        <NumberInput label="Tỉ lệ quy đổi điểm" value={configs.ktv_bonus_rate_TYPE_D ?? 1000} onChange={(v: any) => handleChange('ktv_bonus_rate_TYPE_D', v)} suffix="VNĐ/1đ" />
                    </div>
                </div>

                {/* 3. Phụ & Quỹ */}
                <div className="bg-white rounded-[2rem] p-6 shadow-sm border border-gray-100">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center">
                                <ShieldCheck size={20} className="text-emerald-500" />
                            </div>
                            <h2 className="text-lg font-black text-gray-900">Phụ phí & Quỹ</h2>
                        </div>
                        <SaveButton group="funds" savingGroup={savingGroup} saveStatus={saveStatus} onClick={() => handleSaveGroup(['ktv_type_d_internal_fund', 'ktv_type_d_internal_fund_enabled', 'ktv_type_d_reactivation_fee', 'ktv_type_d_reactivation_fee_enabled', 'ktv_deposit_amount_TYPE_D', 'ktv_deposit_enabled_TYPE_D'], 'funds')} />
                    </div>
                    {/* Mỗi khoản một cần gạt riêng: tắt khoản này không ảnh hưởng khoản kia. */}
                    <div className="space-y-4">
                        <FeeRow
                            title="Thu quỹ nội bộ"
                            hint="Thu tự động mỗi tháng"
                            enabled={configs.ktv_type_d_internal_fund_enabled ?? false}
                            onToggle={(v: any) => handleChange('ktv_type_d_internal_fund_enabled', v)}
                            amount={configs.ktv_type_d_internal_fund ?? 250000}
                            onAmount={(v: any) => handleChange('ktv_type_d_internal_fund', v)}
                        />
                        <FeeRow
                            title="Phí kích hoạt lại"
                            hint="Thu khi mở lại tài khoản đã khoá"
                            enabled={configs.ktv_type_d_reactivation_fee_enabled ?? false}
                            onToggle={(v: any) => handleChange('ktv_type_d_reactivation_fee_enabled', v)}
                            amount={configs.ktv_type_d_reactivation_fee ?? 1000000}
                            onAmount={(v: any) => handleChange('ktv_type_d_reactivation_fee', v)}
                        />
                        <FeeRow
                            title="Tiền cọc ví"
                            hint="Giữ trong ví khi bắt đầu làm"
                            enabled={configs.ktv_deposit_enabled_TYPE_D ?? false}
                            onToggle={(v: any) => handleChange('ktv_deposit_enabled_TYPE_D', v)}
                            amount={configs.ktv_deposit_amount_TYPE_D ?? 1000000}
                            onAmount={(v: any) => handleChange('ktv_deposit_amount_TYPE_D', v)}
                        />
                        <p className="text-xs text-gray-400 italic mt-2">* Phí bảo trì và Giặt đồ dùng chung mức global.</p>
                    </div>
                </div>

                {/* 4. Khấu trừ theo sao */}
                <div className="bg-white rounded-[2rem] p-6 shadow-sm border border-gray-100">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-rose-50 rounded-xl flex items-center justify-center">
                                <Star size={20} className="text-rose-500" />
                            </div>
                            <h2 className="text-lg font-black text-gray-900">Khấu trừ đánh giá (%)</h2>
                        </div>
                        <SaveButton group="stars" savingGroup={savingGroup} saveStatus={saveStatus} onClick={() => handleSaveGroup(['ktv_type_d_rating_deduction'], 'stars')} />
                    </div>
                    <div className="space-y-3">
                        {[0,1,2,3,4].map(star => (
                            <div key={star} className="flex items-center gap-4">
                                <div className="w-16 font-bold text-gray-700">{star} Sao</div>
                                <NumberInput
                                    value={((configs.ktv_type_d_rating_deduction?.[star] !== undefined ? configs.ktv_type_d_rating_deduction[star] : (star === 4 ? 0 : 1))) * 100}
                                    onChange={(v: any) => {
                                        const newVal = { ...configs.ktv_type_d_rating_deduction, [star]: v / 100 };
                                        handleChange('ktv_type_d_rating_deduction', newVal);
                                    }}
                                    suffix="%"
                                />
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* 5. Kỷ luật trừ giờ */}
            <div className="bg-white rounded-[2rem] p-6 shadow-sm border border-gray-100">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center">
                            <AlertTriangle size={20} className="text-red-500" />
                        </div>
                        <h2 className="text-lg font-black text-gray-900">Kỷ luật trừ giờ tích lũy</h2>
                    </div>
                    <SaveButton group="discipline" savingGroup={savingGroup} saveStatus={saveStatus} onClick={() => handleSaveGroup(['ktv_type_d_discipline_enabled', 'ktv_type_d_discipline_rules'], 'discipline')} />
                </div>
                
                <div className="space-y-4 max-w-2xl">
                    {/* Công tắc tổng — phải đặt ngay đầu thẻ, vì mấy ô số bên dưới
                        chỉ có nghĩa khi nó đang BẬT. */}
                    <div className="flex items-center justify-between p-4 bg-red-50/60 rounded-xl border border-red-100">
                        <div className="pr-4">
                            <p className="font-bold text-gray-900">Áp dụng kỷ luật Loại D</p>
                            <p className="text-xs text-gray-500 leading-relaxed">
                                BẬT = trừ giờ tích luỹ khi vắng, trễ, bỏ ca đã đăng ký, từ chối tua;
                                và tự khoá tài khoản theo quy chế.<br />
                                TẮT = <b>không trừ giờ, không khoá, không chặn từ chối tua</b> —
                                hệ thống chỉ ghi log để bạn xem trước sẽ đụng vào ai.
                            </p>
                        </div>
                        <Toggle
                            value={boolConfig(configs.ktv_type_d_discipline_enabled, false)}
                            onChange={(v: any) => handleChange('ktv_type_d_discipline_enabled', v)}
                        />
                    </div>

                    {/* ─── Bảng chế tài: mỗi tình huống một dòng ─────────────────
                        Trước đây chỉ chỉnh được SỐ GIỜ, còn "khoá hay trừ" thì
                        viết cứng trong cron — muốn đổi phải sửa code rồi deploy.
                        Tệ hơn: ba ô số này cron KHÔNG hề đọc, sửa xong hệ thống
                        vẫn trừ theo hằng số. Nay cả hai đều thật. */}
                    <div>
                        <p className="text-xs font-black uppercase tracking-wider text-gray-500 mb-1">Chốt sổ cuối ngày</p>
                        <p className="text-[11px] text-gray-400 mb-3 leading-relaxed">
                            Cron chạy <b>00:00 mỗi đêm</b>, chốt lại ngày vừa qua — KTV không bị phạt
                            giữa ngày. Mỗi người chỉ dính <b>một</b> trong các dòng dưới đây.
                            &ldquo;Không đủ thì khoá&rdquo; nghĩa là quỹ giờ tích luỹ tháng ít hơn số giờ
                            phạt thì khoá tài khoản và KHÔNG trừ giờ.
                        </p>

                        <div className="rounded-2xl border border-gray-100 overflow-hidden">
                            <div className="grid grid-cols-12 gap-2 bg-gray-50 px-4 py-2.5 text-[10px] font-black uppercase tracking-wider text-gray-400">
                                <div className="col-span-5">Trường hợp</div>
                                <div className="col-span-2">Xét lúc nào</div>
                                <div className="col-span-3">Chế tài</div>
                                <div className="col-span-2 text-right">Số giờ</div>
                            </div>

                            {THU_TU_CASE.map((key) => {
                                const rules = configs.ktv_type_d_discipline_rules || {};
                                const cai = rules.CASES?.[key] || TYPE_D_DISCIPLINE_CASES[key];
                                const doiCase = (patch: any) => handleChange('ktv_type_d_discipline_rules', {
                                    ...rules,
                                    CASES: { ...(rules.CASES || {}), [key]: { ...cai, ...patch } },
                                });
                                return (
                                    <div key={key} className="grid grid-cols-12 gap-2 items-start px-4 py-3 border-t border-gray-50">
                                        <div className="col-span-5">
                                            <p className="text-sm font-bold text-gray-700 leading-snug">
                                                {TYPE_D_DISCIPLINE_CASES[key].label}
                                            </p>
                                            <p className="text-[11px] text-gray-400 leading-relaxed mt-1">
                                                {TYPE_D_DISCIPLINE_CASES[key].moTa}
                                            </p>
                                        </div>
                                        <div className="col-span-2">
                                            <p className="text-[11px] font-black text-indigo-600 leading-tight">
                                                {TYPE_D_DISCIPLINE_CASES[key].quetLuc}
                                            </p>
                                            <p className="text-[10px] text-gray-400 leading-tight mt-0.5">
                                                {TYPE_D_DISCIPLINE_CASES[key].quetBoi}
                                            </p>
                                        </div>
                                        <div className="col-span-3">
                                            <select
                                                value={cai.action}
                                                onChange={(e) => doiCase({ action: e.target.value })}
                                                className="w-full bg-gray-50 border border-gray-100 rounded-xl px-3 py-2 text-xs font-bold text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                                            >
                                                {CHE_TAI.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                                            </select>
                                        </div>
                                        <div className="col-span-2">
                                            {/* Khoá thẳng thì số giờ vô nghĩa — khoá ô lại cho khỏi hiểu nhầm. */}
                                            {cai.action === 'LOCK' || cai.action === 'NONE' ? (
                                                <p className="text-right text-sm text-gray-300 font-bold">—</p>
                                            ) : (
                                                <input
                                                    type="number" min={0}
                                                    value={cai.hours ?? 0}
                                                    onChange={(e) => doiCase({ hours: Number(e.target.value) || 0 })}
                                                    className="w-full bg-gray-50 border border-gray-100 rounded-xl px-3 py-2 text-sm font-black text-gray-800 text-right focus:outline-none focus:ring-2 focus:ring-indigo-200"
                                                />
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* ─── Các lỗi phạt ngay lúc KTV bấm, không đợi chốt sổ ────── */}
                    <div className="pt-1">
                        <p className="text-xs font-black uppercase tracking-wider text-gray-500 mb-1">Phạt ngay khi vi phạm</p>
                        <p className="text-[11px] text-gray-400 mb-3 leading-relaxed">
                            Trừ vào đúng lúc KTV thao tác, không đợi chốt sổ. Mỗi loại lỗi trong cùng
                            một ngày chỉ trừ một lần (riêng từ chối tua tính từng tua).
                        </p>
                        <div className="space-y-4">
                            <NumberInput khiNao="Lúc điểm danh" hint="Trừ NGAY lúc điểm danh. So với giờ đã đăng ký; nếu đã bấm Báo trễ thì so với giờ mới đã hẹn. Đến đúng giờ hoặc sớm hơn thì không sao." label="Đến trễ (kể cả đã báo trễ mà vẫn trễ hơn giờ đã báo)" value={configs.ktv_type_d_discipline_rules?.LATE_NO_UPDATE ?? 5} onChange={(v:any) => handleChange('ktv_type_d_discipline_rules', {...configs.ktv_type_d_discipline_rules, LATE_NO_UPDATE: v})} suffix="Giờ" />
                            <NumberInput khiNao="Lúc đổi lịch" hint="Trừ NGAY lúc KTV bấm đổi. Ba mốc: ngày làm còn ở TƯƠNG LAI → đổi thoải mái, không phạt; từ 00:00 đến trước 07:00 của CHÍNH NGÀY LÀM → vẫn đổi được nhưng trừ số giờ này; từ 07:00 trở đi → không cho đổi nữa, chỉ còn đường báo trễ." label="Bỏ ca đã đăng ký — đổi sang OFF từ 00:00 đến trước 07:00 ngày làm" value={configs.ktv_type_d_discipline_rules?.ABSENT_EARLY_NOTICE ?? 5} onChange={(v:any) => handleChange('ktv_type_d_discipline_rules', {...configs.ktv_type_d_discipline_rules, ABSENT_EARLY_NOTICE: v})} suffix="Giờ" />
                            <NumberInput khiNao="Lúc bấm Nghỉ đột xuất" hint="Trừ NGAY lúc KTV bấm Nghỉ đột xuất ở màn chấm công. Chỉ áp dụng khi nhân viên đó được bật cờ sudden_leave_penalty." label="Nghỉ đột xuất" value={configs.ktv_type_d_discipline_rules?.ABSENT_NO_NOTICE ?? 10} onChange={(v:any) => handleChange('ktv_type_d_discipline_rules', {...configs.ktv_type_d_discipline_rules, ABSENT_NO_NOTICE: v})} suffix="Giờ" />
                            <NumberInput khiNao="Lúc bấm Từ chối tua" hint="Trừ NGAY lúc bấm Từ chối. Trừ theo THỜI LƯỢNG TUA nhân hệ số này — tua 60 phút với hệ số 3 thì mất 3 giờ. Mỗi tua bị từ chối tính riêng." label="Từ chối tua đã gán (hệ số x thời lượng)" value={configs.ktv_type_d_discipline_rules?.ORDER_REJECT_MULTIPLIER ?? 3} onChange={(v:any) => handleChange('ktv_type_d_discipline_rules', {...configs.ktv_type_d_discipline_rules, ORDER_REJECT_MULTIPLIER: v})} suffix="x giờ tua" />
                            <NumberInput khiNao="Lúc bấm Từ chối tua" hint="Quỹ giờ phải LỚN HƠN mức này mới được từ chối tua. Thấp hơn hoặc bằng: hệ thống cảnh báo trước, KTV xác nhận lần hai thì vẫn từ chối được nhưng bị KHOÁ TÀI KHOẢN. Đặt 0 để bỏ cửa chặn." label="Hạn mức giờ tối thiểu mới được từ chối tua" value={configs.ktv_type_d_discipline_rules?.MIN_HOURS_TO_REJECT ?? 3} onChange={(v:any) => handleChange('ktv_type_d_discipline_rules', {...configs.ktv_type_d_discipline_rules, MIN_HOURS_TO_REJECT: v})} suffix="Giờ" />
                        </div>
                    </div>

                    <p className="text-[11px] text-gray-400 leading-relaxed bg-gray-50 rounded-xl px-3 py-2.5">
                        Đổi ở đây là có hiệu lực ngay, không cần deploy. Riêng <b>giờ chạy</b> của cron nằm
                        trong <code>vercel.json</code>, đổi phải deploy lại.
                    </p>
                </div>
            </div>

            {/* 6. Hien thi cho KTV */}
            <div className="bg-white rounded-[2rem] p-6 shadow-sm border border-gray-100">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-violet-50 rounded-xl flex items-center justify-center">
                            <Trophy size={20} className="text-violet-500" />
                        </div>
                        <h2 className="text-lg font-black text-gray-900">Hiển thị cho KTV</h2>
                    </div>
                    <SaveButton group="ktvVisibility" savingGroup={savingGroup} saveStatus={saveStatus} onClick={() => handleSaveGroup(['ktv_type_d_hours_ranking_enabled'], 'ktvVisibility')} />
                </div>

                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl max-w-2xl">
                    <div className="pr-4">
                        <p className="font-bold text-gray-900">Bảng xếp hạng giờ tích lũy</p>
                        <p className="text-xs text-gray-500 leading-relaxed">
                            BẬT = KTV Loại D tự xem được thứ hạng giờ của cả nhóm ngay trên app của họ.
                            TẮT = chỉ quầy và quản lý xem được.
                        </p>
                    </div>
                    <Toggle
                        value={boolConfig(configs.ktv_type_d_hours_ranking_enabled, true)}
                        onChange={(v: any) => handleChange('ktv_type_d_hours_ranking_enabled', v)}
                    />
                </div>
            </div>
        </div>
    );
}

// ----- UI Helpers -----

/**
 * SystemConfigs.value là jsonb — cùng một cần gạt có thể về `true`, `"true"` hoặc
 * `'\"true\"'` tuỳ nó được ghi từ đâu. So `=== true` là hỏng thầm lặng.
 */
function boolConfig(raw: any, fallback: boolean): boolean {
    if (raw === undefined || raw === null || raw === '') return fallback;
    if (typeof raw === 'boolean') return raw;
    return String(raw).replace(/"/g, '').toLowerCase() === 'true';
}

function SaveButton({ group, savingGroup, saveStatus, onClick }: any) {
    return (
        <div className="flex items-center gap-3">
            {saveStatus === 'success' && savingGroup === group && (
                <span className="text-emerald-500 text-xs font-bold flex items-center gap-1"><CheckCircle2 size={14} /> Đã lưu</span>
            )}
            <button
                onClick={onClick}
                disabled={savingGroup === group}
                className="bg-indigo-600 text-white px-4 py-2 rounded-xl font-bold uppercase tracking-wider text-xs hover:bg-indigo-700 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
            >
                {savingGroup === group ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Lưu
            </button>
        </div>
    );
}

function NumberInput({ label, value, onChange, suffix = 'VNĐ', hint, khiNao }: any) {
    const [displayValue, setDisplayValue] = useState('');

    useEffect(() => {
        setDisplayValue(value ? Number(value).toLocaleString('vi-VN') : '0');
    }, [value]);

    const handleChange = (e: any) => {
        const raw = e.target.value.replace(/[^0-9]/g, '');
        setDisplayValue(raw ? Number(raw).toLocaleString('vi-VN') : '');
    };

    const handleBlur = () => {
        const raw = displayValue.replace(/[^0-9]/g, '');
        onChange(raw ? Number(raw) : 0);
    };

    return (
        <div>
            {label && (
                <div className="flex items-baseline flex-wrap gap-x-2 gap-y-1 mb-1">
                    <label className="text-xs font-black uppercase tracking-wider text-gray-500">{label}</label>
                    {/* Cùng vai trò với cột "Xét lúc nào" của bảng bên trên. */}
                    {khiNao && (
                        <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-md whitespace-nowrap">
                            {khiNao}
                        </span>
                    )}
                </div>
            )}
            {hint && <p className="text-[11px] text-gray-400 leading-relaxed mb-2">{hint}</p>}
            <div className="relative">
                <input
                    type="text"
                    value={displayValue}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    className="w-full bg-gray-50 border-2 border-gray-100 rounded-xl px-4 py-3 text-lg font-bold text-gray-900 focus:border-indigo-400 focus:ring-0 transition-colors"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 font-bold text-gray-400">{suffix}</span>
            </div>
        </div>
    );
}

/**
 * Một khoản phụ phí: cần gạt riêng + ô số tiền của chính nó.
 *
 * Tắt cần gạt thì làm mờ ô tiền và khoá nhập — nhìn là biết khoản này đang
 * không thu, khỏi phải đoán qua con số. Số tiền vẫn giữ nguyên để bật lại là
 * dùng tiếp, không phải gõ lại.
 */
function FeeRow({ title, hint, enabled, onToggle, amount, onAmount }: any) {
    return (
        <div className={`rounded-xl border-2 transition-colors ${enabled ? 'border-emerald-100 bg-emerald-50/30' : 'border-gray-100 bg-gray-50/60'}`}>
            <div className="flex items-center justify-between p-4">
                <div>
                    <p className={`font-bold ${enabled ? 'text-gray-900' : 'text-gray-400'}`}>{title}</p>
                    <p className="text-xs text-gray-500">{enabled ? hint : 'Đang tắt — không thu khoản này'}</p>
                </div>
                <Toggle value={enabled} onChange={onToggle} />
            </div>
            <div className={enabled ? 'px-4 pb-4' : 'px-4 pb-4 opacity-40 pointer-events-none'}>
                <NumberInput value={amount} onChange={onAmount} />
            </div>
        </div>
    );
}

function Toggle({ value, onChange }: any) {
    return (
        <button
            onClick={() => onChange(!value)}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                value ? 'bg-indigo-500' : 'bg-gray-300'
            }`}
        >
            <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    value ? 'translate-x-5' : 'translate-x-0'
                }`}
            />
        </button>
    );
}

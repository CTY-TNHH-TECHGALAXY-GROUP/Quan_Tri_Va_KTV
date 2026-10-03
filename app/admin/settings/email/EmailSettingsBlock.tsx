'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
    Mail, Save, Loader2, CheckCircle2, AlertCircle, ChevronDown, ChevronUp,
    Send, Eye, Building2, Landmark, Clock, ShieldCheck, ShieldAlert
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const LANGS = [
    { code: 'vi', label: 'Tiếng Việt' },
    { code: 'en', label: 'English' },
    { code: 'kr', label: '한국어' },
    { code: 'jp', label: '日本語' },
    { code: 'cn', label: '中文' },
] as const;

/**
 * Tạm ẩn các ô cấu hình liên quan đến đặt cọc (email hiện không hiển thị khối này).
 * Đổi thành true khi bật lại SHOW_DEPOSIT_SECTION trong lib/email.ts —
 * giá trị vẫn được giữ nguyên trong SystemConfigs nên không mất dữ liệu.
 */
const SHOW_DEPOSIT_FIELDS = false;

type EmailConfig = Record<string, any>;

interface SmtpInfo {
    configured: boolean;
    host: string | null;
    fromEmail: string | null;
    fromName: string | null;
    replyTo: string | null;
}

/** Ô nhập text dùng chung trong card này. */
const TextField = ({ label, hint, value, onChange, placeholder, type = 'text', suffix }: any) => (
    <div>
        <label className="block text-xs font-black uppercase tracking-wider text-gray-500 mb-2">{label}</label>
        <div className="relative">
            <input
                type={type}
                value={value ?? ''}
                placeholder={placeholder}
                onChange={(e) => onChange(type === 'number' ? Number(e.target.value) : e.target.value)}
                className="w-full bg-gray-50 border-2 border-gray-100 rounded-xl px-4 py-3 text-sm font-bold text-gray-900 focus:border-indigo-400 focus:ring-0 transition-colors"
            />
            {suffix && <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400">{suffix}</span>}
        </div>
        {hint && <p className="text-[11px] text-gray-400 mt-1.5 font-medium">{hint}</p>}
    </div>
);

export function EmailSettingsBlock({ defaultExpanded = false }: { defaultExpanded?: boolean } = {}) {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);
    const [config, setConfig] = useState<EmailConfig>({});
    const [initialConfig, setInitialConfig] = useState<EmailConfig>({});
    const [smtp, setSmtp] = useState<SmtpInfo | null>(null);

    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    // Xem trước & gửi thử
    const [previewLang, setPreviewLang] = useState<string>('vi');
    const [previewNewCustomer, setPreviewNewCustomer] = useState(true);
    const [showPreview, setShowPreview] = useState(false);
    const [previewNonce, setPreviewNonce] = useState(0);
    const [testEmail, setTestEmail] = useState('');
    const [isSendingTest, setIsSendingTest] = useState(false);
    const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

    useEffect(() => {
        if (isExpanded && Object.keys(config).length === 0) {
            fetchConfig();
        }
    }, [isExpanded]);

    const fetchConfig = async () => {
        setIsLoading(true);
        setErrorMsg(null);
        try {
            const res = await fetch('/api/admin/settings/email');
            const result = await res.json();
            if (result.success) {
                setConfig(result.data);
                setInitialConfig(result.data);
                setSmtp(result.smtp);
            } else {
                setErrorMsg(result.error || 'Không tải được cấu hình Email.');
            }
        } catch (error: any) {
            setErrorMsg(error.message || 'Không tải được cấu hình Email.');
        } finally {
            setIsLoading(false);
        }
    };

    const change = (key: string, value: any) => setConfig(prev => ({ ...prev, [key]: value }));

    const hasChanges = useMemo(
        () => Object.keys(config).some(k => config[k] !== initialConfig[k]),
        [config, initialConfig]
    );

    const handleSave = async () => {
        setIsSaving(true);
        setSaveStatus('idle');
        setErrorMsg(null);
        try {
            // Chỉ gửi những key thực sự thay đổi
            const payload: EmailConfig = {};
            Object.keys(config).forEach(k => {
                if (config[k] !== initialConfig[k]) payload[k] = config[k];
            });

            const res = await fetch('/api/admin/settings/email', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const result = await res.json();

            if (result.success) {
                setConfig(result.data);
                setInitialConfig(result.data);
                setSaveStatus('success');
                setPreviewNonce(n => n + 1); // Buộc iframe tải lại theo cấu hình mới
                setTimeout(() => setSaveStatus('idle'), 3000);
            } else {
                setSaveStatus('error');
                setErrorMsg(result.error || 'Lưu thất bại.');
            }
        } catch (error: any) {
            setSaveStatus('error');
            setErrorMsg(error.message || 'Lưu thất bại.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleSendTest = async () => {
        if (!testEmail.trim()) {
            setTestResult({ ok: false, msg: 'Vui lòng nhập email nhận thử.' });
            return;
        }
        if (hasChanges) {
            setTestResult({ ok: false, msg: 'Bạn có thay đổi chưa lưu — hãy bấm Lưu trước khi gửi thử.' });
            return;
        }

        setIsSendingTest(true);
        setTestResult(null);
        try {
            const res = await fetch('/api/admin/settings/email/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to: testEmail.trim(), lang: previewLang, newCustomer: previewNewCustomer }),
            });
            const result = await res.json();
            setTestResult(
                result.success
                    ? { ok: true, msg: `Đã gửi email mẫu tới ${testEmail.trim()}.` }
                    : { ok: false, msg: result.error || 'Gửi thất bại.' }
            );
        } catch (error: any) {
            setTestResult({ ok: false, msg: error.message || 'Gửi thất bại.' });
        } finally {
            setIsSendingTest(false);
        }
    };

    const previewUrl = `/api/admin/settings/email/test?lang=${previewLang}&newCustomer=${previewNewCustomer}&v=${previewNonce}`;
    const enabled = config.enable_web_advance_booking_email === true;

    return (
        <div className="bg-white rounded-[2rem] p-6 shadow-sm border border-gray-100 overflow-hidden">
            {/* HEADER */}
            <div
                className="flex items-center justify-between cursor-pointer select-none group"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-sky-50 rounded-xl flex items-center justify-center group-hover:bg-sky-100 transition-colors">
                        <Mail size={20} className="text-sky-500" />
                    </div>
                    <div>
                        <h2 className="text-lg font-black text-gray-900 flex items-center gap-2">
                            Cấu Hình Email
                            {isExpanded ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
                        </h2>
                        <p className="text-[11px] text-gray-400 font-medium mt-0.5">
                            Email xác nhận gửi cho khách sau khi lễ tân duyệt đơn đặt web.
                        </p>
                    </div>
                </div>

                {isExpanded && hasChanges && (
                    <button
                        onClick={(e) => { e.stopPropagation(); handleSave(); }}
                        disabled={isSaving}
                        className="bg-indigo-600 text-white px-4 py-2 rounded-xl font-bold uppercase tracking-wider text-xs hover:bg-indigo-700 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
                    >
                        {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                        Lưu
                    </button>
                )}
                {isExpanded && !hasChanges && saveStatus === 'success' && (
                    <span className="text-emerald-500 text-xs font-bold flex items-center gap-1"><CheckCircle2 size={14} /> Đã lưu</span>
                )}
            </div>

            <AnimatePresence>
                {isExpanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0, marginTop: 0 }}
                        animate={{ height: 'auto', opacity: 1, marginTop: 24 }}
                        exit={{ height: 0, opacity: 0, marginTop: 0 }}
                        className="overflow-hidden"
                    >
                        {isLoading ? (
                            <div className="flex items-center justify-center py-12 text-gray-400">
                                <Loader2 size={24} className="animate-spin" />
                            </div>
                        ) : (
                            <div className="space-y-6">
                                {errorMsg && (
                                    <div className="flex items-start gap-2 p-3 bg-rose-50 border border-rose-100 rounded-xl text-[12px] font-medium text-rose-700">
                                        <AlertCircle size={14} className="mt-0.5 shrink-0" /> {errorMsg}
                                    </div>
                                )}

                                {/* TRẠNG THÁI SMTP (đọc từ biến môi trường) */}
                                <div className={`p-4 rounded-xl border ${smtp?.configured ? 'bg-emerald-50 border-emerald-100' : 'bg-amber-50 border-amber-100'}`}>
                                    <div className="flex items-center gap-2 mb-1">
                                        {smtp?.configured
                                            ? <ShieldCheck size={16} className="text-emerald-600" />
                                            : <ShieldAlert size={16} className="text-amber-600" />}
                                        <h3 className={`text-xs font-black uppercase tracking-wider ${smtp?.configured ? 'text-emerald-700' : 'text-amber-700'}`}>
                                            Máy chủ gửi (SMTP) {smtp?.configured ? '· Đã kết nối' : '· Chưa cấu hình'}
                                        </h3>
                                    </div>
                                    <p className={`text-[11px] font-medium leading-relaxed ${smtp?.configured ? 'text-emerald-800' : 'text-amber-800'}`}>
                                        {smtp?.configured ? (
                                            <>Gửi qua <strong>{smtp.host}</strong> từ <strong>{smtp.fromName} &lt;{smtp.fromEmail}&gt;</strong>
                                                {smtp.replyTo && <> · Trả lời về <strong>{smtp.replyTo}</strong></>}.</>
                                        ) : (
                                            <>Chưa có <code>SMTP_HOST</code> / <code>SMTP_USER</code> / <code>SMTP_PASS</code>. Email sẽ không gửi được.</>
                                        )}
                                        {' '}Vì lý do bảo mật, mật khẩu SMTP chỉ đặt trong biến môi trường, không lưu trong bảng cấu hình.
                                    </p>
                                </div>

                                {/* CÔNG TẮC TỔNG */}
                                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-100">
                                    <div>
                                        <label className="block text-sm font-black text-gray-900 mb-1">Gửi email xác nhận cho khách</label>
                                        <p className="text-[11px] text-gray-500 font-medium">
                                            BẬT = Tự gửi email ngay khi lễ tân xác nhận đơn web. TẮT = Không gửi (nút &quot;Gửi thử&quot; bên dưới vẫn hoạt động).
                                            Đây cũng chính là công tắc &quot;Gửi email đặt lịch trước&quot; ở trang Tính năng.
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => change('enable_web_advance_booking_email', !enabled)}
                                        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${enabled ? 'bg-sky-500' : 'bg-gray-300'}`}
                                    >
                                        <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${enabled ? 'translate-x-5' : 'translate-x-0'}`} />
                                    </button>
                                </div>

                                {/* THƯƠNG HIỆU */}
                                <div>
                                    <h3 className="text-xs font-black uppercase tracking-wider text-gray-400 mb-4 flex items-center gap-2">
                                        <Building2 size={14} className="text-sky-400" /> Thương hiệu hiển thị trong email
                                    </h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                        <TextField
                                            label="Tên thương hiệu"
                                            hint="Hiện ở tiêu đề email và phần ký tên cuối thư."
                                            value={config.email_brand_name}
                                            onChange={(v: string) => change('email_brand_name', v)}
                                            placeholder="ORIA SPA"
                                        />
                                        <TextField
                                            label="Tên chi nhánh"
                                            hint="Chỉ dùng làm dự phòng cho dòng &quot;Địa chỉ&quot; khi ô địa chỉ bên dưới bỏ trống."
                                            value={config.email_branch_name}
                                            onChange={(v: string) => change('email_branch_name', v)}
                                            placeholder="ORIA SPA"
                                        />
                                        <TextField
                                            label="Địa chỉ spa"
                                            hint="Hiện ở dòng &quot;Địa chỉ&quot; trong bảng chi tiết lịch hẹn. Bỏ trống thì ẩn dòng này."
                                            value={config.email_branch_address}
                                            onChange={(v: string) => change('email_branch_address', v)}
                                            placeholder="11 Ngô Đức Kế, P. Sài Gòn, TP. Hồ Chí Minh"
                                        />
                                        <TextField
                                            label="Link logo"
                                            hint="Ảnh phải truy cập công khai qua HTTPS (hòm thư không đọc được file nội bộ)."
                                            value={config.email_logo_url}
                                            onChange={(v: string) => change('email_logo_url', v)}
                                            placeholder="https://.../logo.png"
                                        />
                                        <TextField
                                            label="Link website"
                                            hint="Khách bấm vào logo sẽ mở link này."
                                            value={config.email_website_url}
                                            onChange={(v: string) => change('email_website_url', v)}
                                            placeholder="https://nganha.vercel.app"
                                        />
                                        <TextField
                                            label="Hotline"
                                            hint="Hiện ở cuối thư dưới dạng link bấm gọi."
                                            value={config.email_hotline}
                                            onChange={(v: string) => change('email_hotline', v)}
                                            placeholder="+84 964 090 277"
                                        />
                                        <TextField
                                            label="Tên pháp nhân (chân thư)"
                                            hint="Hiện ở chân email: © (năm hiện tại) TÊN • ALL RIGHTS RESERVED."
                                            value={config.email_company_name}
                                            onChange={(v: string) => change('email_company_name', v)}
                                            placeholder="TECHGALAXY GROUP"
                                        />
                                        <TextField
                                            label="Link quản lý lịch hẹn"
                                            hint="Trang cho khách tự xem/đổi lịch. Bỏ trống thì email chỉ mời khách phản hồi thư hoặc gọi hotline."
                                            value={config.email_manage_booking_url}
                                            onChange={(v: string) => change('email_manage_booking_url', v)}
                                            placeholder="(chưa có — để trống)"
                                        />
                                    </div>
                                </div>

                                <hr className="border-gray-100" />

                                {/* NỘI DUNG / THỜI GIAN */}
                                <div>
                                    <h3 className="text-xs font-black uppercase tracking-wider text-gray-400 mb-4 flex items-center gap-2">
                                        <Clock size={14} className="text-indigo-400" /> Mốc thời gian nhắc khách
                                    </h3>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                                        <TextField
                                            label="Đến sớm trước"
                                            type="number" suffix="phút"
                                            hint="Câu nhắc &quot;vui lòng đến trước N phút&quot;."
                                            value={config.email_arrive_early_mins}
                                            onChange={(v: number) => change('email_arrive_early_mins', v)}
                                        />
                                        <TextField
                                            label="Báo hủy trước"
                                            type="number" suffix="giờ"
                                            hint="Thời hạn khách cần báo khi đổi/hủy lịch."
                                            value={config.email_cancel_notice_hours}
                                            onChange={(v: number) => change('email_cancel_notice_hours', v)}
                                        />
                                        <TextField
                                            label="Giữ chỗ thêm"
                                            type="number" suffix="phút"
                                            hint="Spa giữ chỗ thêm bao lâu sau giờ hẹn nếu khách đến trễ."
                                            value={config.email_grace_minutes}
                                            onChange={(v: number) => change('email_grace_minutes', v)}
                                        />
                                        {SHOW_DEPOSIT_FIELDS && (
                                            <TextField
                                                label="Hạn chuyển cọc"
                                                type="number" suffix="giờ"
                                                hint="Chỉ áp dụng với khách mới (đơn có yêu cầu đặt cọc)."
                                                value={config.email_deposit_deadline_hours}
                                                onChange={(v: number) => change('email_deposit_deadline_hours', v)}
                                            />
                                        )}
                                    </div>
                                </div>

                                {SHOW_DEPOSIT_FIELDS && (<>
                                <hr className="border-gray-100" />

                                {/* TÀI KHOẢN NHẬN CỌC */}
                                <div>
                                    <h3 className="text-xs font-black uppercase tracking-wider text-gray-400 mb-4 flex items-center gap-2">
                                        <Landmark size={14} className="text-emerald-400" /> Tài khoản nhận tiền cọc (mã VietQR)
                                    </h3>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                                        <TextField
                                            label="Mã BIN ngân hàng"
                                            hint="6 chữ số. Ví dụ MB Bank = 970422, Vietcombank = 970436."
                                            value={config.email_bank_bin}
                                            onChange={(v: string) => change('email_bank_bin', v)}
                                            placeholder="970422"
                                        />
                                        <TextField
                                            label="Số tài khoản"
                                            value={config.email_bank_account_no}
                                            onChange={(v: string) => change('email_bank_account_no', v)}
                                            placeholder="8600289999"
                                        />
                                        <TextField
                                            label="Tên chủ tài khoản"
                                            value={config.email_bank_account_name}
                                            onChange={(v: string) => change('email_bank_account_name', v)}
                                            placeholder="CTY TNHH TECHGALAXY GROUP"
                                        />
                                    </div>
                                    <p className="text-[11px] text-gray-400 mt-3 font-medium">
                                        Mã QR nội địa được sinh động theo số tiền cọc và mã đơn của từng khách. Sai thông tin ở đây đồng nghĩa khách chuyển tiền nhầm tài khoản — hãy kiểm tra kỹ bằng nút &quot;Xem trước&quot;.
                                    </p>
                                </div>
                                </>)}

                                <hr className="border-gray-100" />

                                {/* XEM TRƯỚC & GỬI THỬ */}
                                <div>
                                    <h3 className="text-xs font-black uppercase tracking-wider text-gray-400 mb-4 flex items-center gap-2">
                                        <Eye size={14} className="text-amber-400" /> Xem trước &amp; gửi thử
                                    </h3>

                                    <div className="flex flex-wrap items-center gap-2 mb-4">
                                        {LANGS.map(l => (
                                            <button
                                                key={l.code}
                                                onClick={() => { setPreviewLang(l.code); setPreviewNonce(n => n + 1); }}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${previewLang === l.code ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                                            >
                                                {l.label}
                                            </button>
                                        ))}
                                        <div className="w-px h-6 bg-gray-200 mx-1" />
                                        <button
                                            onClick={() => { setPreviewNewCustomer(!previewNewCustomer); setPreviewNonce(n => n + 1); }}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${previewNewCustomer ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                                        >
                                            {previewNewCustomer ? 'Khách mới (có đặt cọc)' : 'Khách cũ (không cọc)'}
                                        </button>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-3 mb-4">
                                        <button
                                            onClick={() => { setShowPreview(!showPreview); setPreviewNonce(n => n + 1); }}
                                            className="flex items-center gap-1.5 px-4 py-2.5 bg-gray-900 text-white text-xs font-bold uppercase tracking-wider rounded-xl hover:bg-gray-800 active:scale-95 transition-all"
                                        >
                                            <Eye size={14} /> {showPreview ? 'Ẩn xem trước' : 'Xem trước email'}
                                        </button>
                                        <a
                                            href={previewUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="text-xs font-bold text-indigo-600 hover:text-indigo-700 underline underline-offset-2"
                                        >
                                            Mở trong tab mới
                                        </a>
                                    </div>

                                    <AnimatePresence>
                                        {showPreview && (
                                            <motion.div
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: 'auto', opacity: 1 }}
                                                exit={{ height: 0, opacity: 0 }}
                                                className="overflow-hidden mb-5"
                                            >
                                                <iframe
                                                    key={previewUrl}
                                                    src={previewUrl}
                                                    title="Xem trước email xác nhận"
                                                    className="w-full h-[560px] rounded-2xl border-2 border-gray-100 bg-[#1a120e]"
                                                />
                                                <p className="text-[11px] text-gray-400 mt-2 font-medium">
                                                    Đây là đơn mẫu. Mã QR quốc tế trong bản xem trước là ảnh giữ chỗ; email thật đính kèm ảnh QR trong hệ thống.
                                                </p>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>

                                    <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                                        <label className="block text-xs font-black uppercase tracking-wider text-gray-500 mb-2">
                                            Gửi email mẫu tới
                                        </label>
                                        <div className="flex flex-wrap gap-3">
                                            <input
                                                type="email"
                                                value={testEmail}
                                                onChange={(e) => setTestEmail(e.target.value)}
                                                placeholder="ban@example.com"
                                                className="flex-1 min-w-[220px] bg-white border-2 border-gray-100 rounded-xl px-4 py-3 text-sm font-bold text-gray-900 focus:border-sky-400 focus:ring-0 transition-colors"
                                            />
                                            <button
                                                onClick={handleSendTest}
                                                disabled={isSendingTest || !smtp?.configured}
                                                className="flex items-center gap-1.5 px-5 py-3 bg-sky-600 text-white text-xs font-bold uppercase tracking-wider rounded-xl hover:bg-sky-700 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                {isSendingTest ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                                                Gửi thử
                                            </button>
                                        </div>
                                        <p className="text-[11px] text-gray-400 mt-2 font-medium">
                                            Gửi đúng ngôn ngữ và loại khách đang chọn ở trên. Email thử vẫn được gửi kể cả khi công tắc đang TẮT.
                                        </p>
                                        {testResult && (
                                            <div className={`flex items-start gap-2 mt-3 p-3 rounded-xl text-[12px] font-medium ${testResult.ok ? 'bg-emerald-50 border border-emerald-100 text-emerald-700' : 'bg-rose-50 border border-rose-100 text-rose-700'}`}>
                                                {testResult.ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <AlertCircle size={14} className="mt-0.5 shrink-0" />}
                                                {testResult.msg}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

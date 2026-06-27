'use client';

import React from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import {
    ShieldAlert, MapPin, Clock, CheckCircle2,
    ExternalLink, Loader2, XCircle, LogOut, LogIn, Camera, AlertCircle, SwitchCamera
} from 'lucide-react';
import { format } from 'date-fns';
import { useKTVAttendance } from './Attendance.logic';
import { t } from './Attendance.i18n';

const KTVAttendancePage = () => {
    const {
        checkStatus,
        currentRecord,
        errorMsg,
        mounted,
        initialLoading,
        canAccessPage,
        canCheckOut,
        checkoutBlockedUntil,
        isLoadingShift,
        isLate,
        checkIsLate,
        handleAttendance,
        handleRetry,
        clearError,
        activeShiftType,
        shiftFetchError,
        retryFetchShift,
        isOffToday,
        allowEarlyCheckout,
        minPhotoBrightness,
        user,
    } = useKTVAttendance();

    // 🔧 UI CONFIGURATION
    const MAX_PHOTOS = 5;
    const WATERMARK_FONT_SIZE = 18;
    const WATERMARK_PADDING = 12;
    const WATERMARK_BG_OPACITY = 0.55;

    const getAverageBrightness = (canvas: HTMLCanvasElement): number => {
        const ctx = canvas.getContext('2d');
        if (!ctx) return 255;
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let total = 0;
        let count = 0;
        for (let i = 0; i < data.length; i += 40) { // Sample mỗi 10 pixel
            total += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            count++;
        }
        return count > 0 ? total / count : 255;
    };

    const [isFormOpen, setIsFormOpen] = React.useState(false);
    const [formType, setFormType] = React.useState<'CHECK_IN' | 'CHECK_OUT' | 'LATE_CHECKIN'>('CHECK_IN');
    const [photos, setPhotos] = React.useState<string[]>([]);
    const [reason, setReason] = React.useState<string>('');
    const [selectedShiftType, setSelectedShiftType] = React.useState<string>('');
    const [estimatedEndTime, setEstimatedEndTime] = React.useState<string>('');
    const [deviceIP, setDeviceIP] = React.useState<string>('');
    const [wantsToWithdraw, setWantsToWithdraw] = React.useState(false);

    // WebRTC Camera States
    const [useFallbackCamera, setUseFallbackCamera] = React.useState(false);
    const [isCameraOpen, setIsCameraOpen] = React.useState(false);
    const [stream, setStream] = React.useState<MediaStream | null>(null);
    const [facingMode, setFacingMode] = React.useState<'environment' | 'user'>('environment');
    const videoRef = React.useRef<HTMLVideoElement>(null);

    const openWebRTCCamera = async (mode: 'environment' | 'user' = 'environment') => {
        try {
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                setUseFallbackCamera(true);
                throw new Error("Trình duyệt không hỗ trợ Camera, tự động chuyển sang chế độ dự phòng.");
            }
            // Timeout 3s chống treo trên iOS
            const mediaStream = await Promise.race([
                navigator.mediaDevices.getUserMedia({ 
                    video: { facingMode: { ideal: mode } } 
                }),
                new Promise<MediaStream>((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 3000))
            ]);
            setStream(mediaStream);
            setFacingMode(mode);
            setIsCameraOpen(true);
        } catch (err) {
            setUseFallbackCamera(true);
            alert('Không thể truy cập Camera trực tiếp. Hệ thống đã tự động bật "Chụp dự phòng"!');
        }
    };

    const toggleCameraMode = () => {
        const newMode = facingMode === 'environment' ? 'user' : 'environment';
        openWebRTCCamera(newMode);
    };

    const closeWebRTCCamera = () => {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            setStream(null);
        }
        setIsCameraOpen(false);
    };

    React.useEffect(() => {
        return () => {
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }
        };
    }, [stream]);

    React.useEffect(() => {
        if (isCameraOpen && videoRef.current && stream) {
            videoRef.current.muted = true;
            videoRef.current.defaultMuted = true;
            videoRef.current.playsInline = true;
            videoRef.current.srcObject = stream;
            videoRef.current.play().catch(e => console.error("Camera play error:", e));
        }
    }, [isCameraOpen, stream]);

    const captureFromVideo = () => {
        if (!videoRef.current || photos.length >= MAX_PHOTOS) return;
        const video = videoRef.current;
        let { videoWidth: width, videoHeight: height } = video;
        
        const maxWidth = 800;
        if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        ctx.drawImage(video, 0, 0, width, height);

        // 🔆 Kiểm tra độ sáng trước khi chấp nhận
        const brightness = getAverageBrightness(canvas);
        console.log(`🔆 [Brightness Check] Giá trị: ${brightness.toFixed(1)} | Ngưỡng: ${minPhotoBrightness}`);
        if (brightness < minPhotoBrightness) {
            alert('⚠️ Ảnh quá tối!\nVui lòng bật đèn hoặc di chuyển đến nơi có đủ ánh sáng rồi chụp lại.');
            return;
        }

        // Watermark
        const now = new Date();
        const vnTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
        const pad = (n: number) => String(n).padStart(2, '0');
        const timeStr = `${pad(vnTime.getHours())}:${pad(vnTime.getMinutes())}:${pad(vnTime.getSeconds())}`;
        const dateStr = `${pad(vnTime.getDate())}/${pad(vnTime.getMonth() + 1)}/${vnTime.getFullYear()}`;
        const line1 = `${timeStr}  ${dateStr}`;
        const line2 = `IP: ${deviceIP || 'N/A'}`;

        const fontSize = Math.max(WATERMARK_FONT_SIZE, Math.floor(canvas.width * 0.03));
        const padding = WATERMARK_PADDING;
        ctx.font = `bold ${fontSize}px Arial, Helvetica, sans-serif`;
        ctx.textBaseline = 'top';

        const line1Width = ctx.measureText(line1).width;
        const line2Width = ctx.measureText(line2).width;
        const boxWidth = Math.max(line1Width, line2Width) + padding * 2;
        const lineHeight = fontSize + 4;
        const boxHeight = lineHeight * 2 + padding * 2;
        const boxX = 8;
        const boxY = 8;

        ctx.fillStyle = `rgba(0, 0, 0, ${WATERMARK_BG_OPACITY})`;
        ctx.beginPath();
        const r = 8;
        ctx.moveTo(boxX + r, boxY);
        ctx.lineTo(boxX + boxWidth - r, boxY);
        ctx.quadraticCurveTo(boxX + boxWidth, boxY, boxX + boxWidth, boxY + r);
        ctx.lineTo(boxX + boxWidth, boxY + boxHeight - r);
        ctx.quadraticCurveTo(boxX + boxWidth, boxY + boxHeight, boxX + boxWidth - r, boxY + boxHeight);
        ctx.lineTo(boxX + r, boxY + boxHeight);
        ctx.quadraticCurveTo(boxX, boxY + boxHeight, boxX, boxY + boxHeight - r);
        ctx.lineTo(boxX, boxY + r);
        ctx.quadraticCurveTo(boxX, boxY, boxX + r, boxY);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(line1, boxX + padding, boxY + padding);
        ctx.fillText(line2, boxX + padding, boxY + padding + lineHeight);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
        setPhotos(prev => {
            if (prev.length < MAX_PHOTOS) return [...prev, dataUrl];
            return prev;
        });
    };

    // Fetch public IP on mount
    React.useEffect(() => {
        const fetchIP = async () => {
            try {
                const res = await fetch('https://api.ipify.org?format=json');
                const data = await res.json();
                if (data.ip) setDeviceIP(data.ip);
            } catch {
                setDeviceIP('N/A');
            }
        };
        fetchIP();
    }, []);

    if (!mounted) return null;

    if (!canAccessPage) {
        return (
            <AppLayout title="Chấm Công">
                <div className="flex flex-col items-center justify-center h-64 text-center">
                    <ShieldAlert size={48} className="text-red-500 mb-4" />
                    <h2 className="text-xl font-bold text-gray-900">{t.noAccess}</h2>
                </div>
            </AppLayout>
        );
    }

    const openForm = (type: 'CHECK_IN' | 'CHECK_OUT' | 'LATE_CHECKIN', isEarlyCheckout?: boolean) => {
        if (type === 'CHECK_IN') {
            checkIsLate();
        }
        setFormType(type);
        setPhotos([]);
        setReason('');
        setEstimatedEndTime('');
        
        if (type === 'CHECK_OUT' && isEarlyCheckout) {
            setSelectedShiftType('SUDDEN_OFF_CHECKOUT');
        } else {
            setSelectedShiftType(activeShiftType || 'FREE');
        }
        setIsFormOpen(true);
    };

    // Compress image and draw watermark (timestamp + IP) onto photo
    const compressImage = (file: File, maxWidth = 800, quality = 0.6): Promise<string> => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(file);
            img.onload = () => {
                URL.revokeObjectURL(url);
                const canvas = document.createElement('canvas');
                let { width, height } = img;
                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (!ctx) { reject(new Error('Canvas not supported')); return; }
                ctx.drawImage(img, 0, 0, width, height);

                // 🔆 Kiểm tra độ sáng
                const brightness = getAverageBrightness(canvas);
                if (brightness < minPhotoBrightness) {
                    reject(new Error('TOO_DARK'));
                    return;
                }

                // === WATERMARK: Timestamp + IP ===
                const now = new Date();
                const vnTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
                const pad = (n: number) => String(n).padStart(2, '0');
                const timeStr = `${pad(vnTime.getHours())}:${pad(vnTime.getMinutes())}:${pad(vnTime.getSeconds())}`;
                const dateStr = `${pad(vnTime.getDate())}/${pad(vnTime.getMonth() + 1)}/${vnTime.getFullYear()}`;
                const line1 = `${timeStr}  ${dateStr}`;
                const line2 = `IP: ${deviceIP || 'N/A'}`;

                const fontSize = WATERMARK_FONT_SIZE;
                const padding = WATERMARK_PADDING;
                ctx.font = `bold ${fontSize}px Arial, Helvetica, sans-serif`;
                ctx.textBaseline = 'top';

                const line1Width = ctx.measureText(line1).width;
                const line2Width = ctx.measureText(line2).width;
                const boxWidth = Math.max(line1Width, line2Width) + padding * 2;
                const lineHeight = fontSize + 4;
                const boxHeight = lineHeight * 2 + padding * 2;
                const boxX = 8;
                const boxY = 8;

                // Semi-transparent black background (compatible fallback for roundRect)
                ctx.fillStyle = `rgba(0, 0, 0, ${WATERMARK_BG_OPACITY})`;
                ctx.beginPath();
                const r = 8;
                ctx.moveTo(boxX + r, boxY);
                ctx.lineTo(boxX + boxWidth - r, boxY);
                ctx.quadraticCurveTo(boxX + boxWidth, boxY, boxX + boxWidth, boxY + r);
                ctx.lineTo(boxX + boxWidth, boxY + boxHeight - r);
                ctx.quadraticCurveTo(boxX + boxWidth, boxY + boxHeight, boxX + boxWidth - r, boxY + boxHeight);
                ctx.lineTo(boxX + r, boxY + boxHeight);
                ctx.quadraticCurveTo(boxX, boxY + boxHeight, boxX, boxY + boxHeight - r);
                ctx.lineTo(boxX, boxY + r);
                ctx.quadraticCurveTo(boxX, boxY, boxX + r, boxY);
                ctx.closePath();
                ctx.fill();

                // White text
                ctx.fillStyle = '#FFFFFF';
                ctx.fillText(line1, boxX + padding, boxY + padding);
                ctx.fillText(line2, boxX + padding, boxY + padding + lineHeight);

                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = url;
        });
    };

    const handleCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        const remainingSlots = MAX_PHOTOS - photos.length;
        const filesToProcess = files.slice(0, remainingSlots);

        for (const file of filesToProcess) {
            try {
                const compressed = await compressImage(file);
                setPhotos(prev => {
                    if (prev.length < MAX_PHOTOS) return [...prev, compressed];
                    return prev;
                });
            } catch (err: any) {
                if (err?.message === 'TOO_DARK') {
                    alert('⚠️ Ảnh quá tối! Vui lòng chụp lại ở nơi có đủ ánh sáng.');
                    continue;
                }
                // Fallback to raw FileReader if compression fails
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const result = ev.target?.result as string;
                    if (result) {
                        setPhotos(prev => {
                            if (prev.length < MAX_PHOTOS) return [...prev, result];
                            return prev;
                        });
                    }
                };
                reader.readAsDataURL(file);
            }
        }
        
        // Reset input để có thể chọn lại cùng 1 file nếu lỡ xoá
        if (e.target) {
            e.target.value = '';
        }
    };

    const handleSubmitForm = () => {
        if (selectedShiftType === 'SUDDEN_OFF') {
            if (!window.confirm("Bạn đã chắc chắn muốn xin nghỉ đột xuất hôm nay không?")) {
                return;
            }
            setIsFormOpen(false);
            handleAttendance('SUDDEN_OFF', null, null, null);
            return;
        }

        setIsFormOpen(false);
        handleAttendance(
            formType, 
            photos.length > 0 ? photos : null, 
            reason, 
            (formType === 'CHECK_IN' || formType === 'CHECK_OUT') ? selectedShiftType : null,
            (formType === 'CHECK_IN' && selectedShiftType === 'FREE') ? estimatedEndTime : null,
            wantsToWithdraw
        );
    };

    return (
        <AppLayout title="Chấm Công">
            <div className="max-w-sm mx-auto px-4 py-8 space-y-6 relative">
                <div>
                    <p className="text-sm text-gray-500">{t.pageSubtitle}</p>
                </div>

                <div className="bg-white rounded-3xl border border-gray-100 shadow-lg p-8 flex flex-col items-center gap-6">

                    {/* INITIAL LOADING */}
                    {initialLoading && (
                        <>
                            <div className="w-24 h-24 rounded-full bg-gray-50 flex items-center justify-center">
                                <Loader2 size={40} className="text-gray-400 animate-spin" />
                            </div>
                            <p className="text-sm text-gray-500 font-medium">{t.loadingStatus}</p>
                        </>
                    )}

                    {/* IDLE */}
                    {!initialLoading && checkStatus === 'IDLE' && (
                        <>
                            <div className="text-center">
                                <p className="font-semibold text-gray-800">{t.startShift}</p>
                                <p className="text-sm text-gray-400 mt-1">Yêu cầu chụp ảnh tại cơ sở</p>
                            </div>
                            <div className="w-full space-y-3">
                                <button
                                    onClick={() => openForm('CHECK_IN')}
                                    className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-lg rounded-2xl transition-all shadow-md shadow-emerald-200"
                                >
                                    Ngân Hà Xin Chào
                                </button>
                            </div>
                        </>
                    )}

                    {/* LOADING GPS */}
                    {!initialLoading && checkStatus === 'LOADING_GPS' && (
                        <>
                            <div className="w-24 h-24 rounded-full bg-blue-50 flex items-center justify-center">
                                <MapPin size={40} className="text-blue-400 animate-bounce" />
                            </div>
                            <div className="flex items-center gap-2 text-blue-600 font-medium">
                                <Loader2 size={18} className="animate-spin" />
                                Đang kiểm tra vị trí & tải ảnh...
                            </div>
                        </>
                    )}

                    {/* PENDING */}
                    {!initialLoading && checkStatus === 'PENDING' && (
                        <>
                            {currentRecord?.checkType === 'SUDDEN_OFF' ? (
                                <>
                                    <div className="w-24 h-24 rounded-full bg-amber-50 flex items-center justify-center">
                                        <Clock size={40} className="text-amber-500 animate-pulse" />
                                    </div>
                                    <div className="text-center space-y-2">
                                        <p className="font-bold text-amber-700 text-xl">Đang chờ duyệt</p>
                                        <p className="text-sm text-gray-600 font-medium bg-amber-50/50 p-4 rounded-xl border border-amber-100 shadow-sm leading-relaxed">
                                            Yêu cầu <span className="font-bold text-amber-800 uppercase">Nghỉ đột xuất</span> của bạn đang được hệ thống ghi nhận.
                                        </p>
                                        {currentRecord?.checkedAt && (
                                            <p className="text-xs text-gray-400 font-medium mt-1">
                                                Gửi lúc: {format(new Date(currentRecord.checkedAt), 'HH:mm:ss dd/MM/yyyy')}
                                            </p>
                                        )}
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="w-24 h-24 rounded-full bg-amber-50 flex items-center justify-center">
                                        <Clock size={40} className="text-amber-500 animate-pulse" />
                                    </div>
                                    <div className="text-center space-y-1">
                                        <p className="font-bold text-amber-700 text-lg">{t.pendingTitle}</p>
                                        <p className="text-sm text-gray-500">{t.pendingDesc}</p>
                                        {currentRecord?.checkedAt && (
                                            <p className="text-xs text-gray-400 mt-1">
                                                {t.sentAt(format(new Date(currentRecord.checkedAt), 'HH:mm:ss dd/MM/yyyy'))}
                                            </p>
                                        )}
                                    </div>
                                </>
                            )}
                        </>
                    )}

                    {/* CONFIRMED */}
                    {!initialLoading && checkStatus === 'CONFIRMED' && (
                        <>
                            {currentRecord?.checkType === 'SUDDEN_OFF' ? (
                                <>
                                    <div className="w-24 h-24 rounded-full bg-blue-50 flex items-center justify-center">
                                        <CheckCircle2 size={40} className="text-blue-600" />
                                    </div>
                                    <div className="text-center space-y-2">
                                        <p className="font-bold text-blue-700 text-xl">Đã xin nghỉ</p>
                                        <p className="text-sm text-gray-600 font-medium bg-blue-50/50 p-4 rounded-xl border border-blue-100 shadow-sm leading-relaxed">
                                            Yêu cầu <span className="font-bold text-blue-800 uppercase">Nghỉ đột xuất</span> của bạn đã được ghi nhận.<br/>
                                            <span className="text-xs font-semibold text-gray-500 mt-2 block">Chúc bạn một ngày nghỉ ngơi vui vẻ!</span>
                                        </p>
                                        {currentRecord?.checkedAt && (
                                            <p className="text-xs text-gray-400 font-medium">
                                                Ghi nhận lúc: {format(new Date(currentRecord.checkedAt), 'HH:mm — dd/MM/yyyy')}
                                            </p>
                                        )}
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="w-24 h-24 rounded-full bg-emerald-50 flex items-center justify-center">
                                        <CheckCircle2 size={40} className="text-emerald-600" />
                                    </div>
                                    <div className="text-center space-y-1">
                                        <p className="font-bold text-emerald-700 text-lg">{t.confirmedTitle}</p>
                                        <p className="text-sm text-gray-500">{t.confirmedDesc}</p>
                                        {currentRecord?.checkedAt && (
                                            <p className="text-xs text-gray-400 mt-1">
                                                {t.shiftStart(format(new Date(currentRecord.checkedAt), 'HH:mm — dd/MM/yyyy'))}
                                            </p>
                                        )}
                                        {activeShiftType === 'FREE' && currentRecord?.estimatedEndTime && (
                                            <p className="text-[13px] font-bold text-teal-600 mt-1.5">
                                                Giờ về dự kiến: {currentRecord.estimatedEndTime}
                                            </p>
                                        )}
                                    </div>
                                    {/* Checkout time restriction warning */}
                                    {isLoadingShift ? (
                                        <div className="w-full flex items-center justify-center gap-2 py-3 text-gray-400 text-sm">
                                            <Loader2 size={16} className="animate-spin" />
                                            Đang kiểm tra giờ ca...
                                        </div>
                                    ) : !canCheckOut && checkoutBlockedUntil ? (
                                        <div className="w-full bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-center space-y-2">
                                            <p className="text-amber-700 text-sm font-semibold">
                                                {t.cannotCheckOutYet(checkoutBlockedUntil)}
                                            </p>
                                        </div>
                                    ) : null}
                                    <button
                                        onClick={() => {
                                            let isEarly = false;
                                            if (!canCheckOut && checkoutBlockedUntil) {
                                                if (!window.confirm(`Bạn chưa tới giờ tan ca (${checkoutBlockedUntil}). Bạn có chắc chắn muốn tan ca SỚM không?`)) {
                                                    return;
                                                }
                                                isEarly = true;
                                            }

                                            // Thông báo nhắc nhở riêng cho Ca Tự Do nếu về sớm hơn giờ dự kiến
                                            if (activeShiftType === 'FREE' && currentRecord?.estimatedEndTime) {
                                                const vnNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
                                                const [estH, estM] = currentRecord.estimatedEndTime.split(':').map(Number);
                                                
                                                const estDate = new Date(vnNow);
                                                estDate.setUTCHours(estH, estM, 0, 0); 
                                                
                                                if (vnNow.getTime() < estDate.getTime()) {
                                                    if (!window.confirm(`⚠️ Bạn đang tan ca sớm hơn giờ dự kiến (${currentRecord.estimatedEndTime}).\n\nVui lòng thông báo cho lễ tân biết để sắp xếp khách nhé!\n\nNhấn OK để tiếp tục tan ca.`)) {
                                                        return;
                                                    }
                                                }
                                            }

                                            openForm('CHECK_OUT', isEarly);
                                        }}
                                        disabled={isLoadingShift || (!allowEarlyCheckout && !canCheckOut)}
                                        className="w-full py-4 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white font-bold text-lg rounded-2xl transition-all shadow-md shadow-rose-200 flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
                                    >
                                        <LogOut size={22} /> Ngân Hà Xin Cảm ơn
                                    </button>
                                </>
                            )}
                        </>
                    )}

                    {/* REJECTED */}
                    {!initialLoading && checkStatus === 'REJECTED' && (
                        <>
                            <div className="w-24 h-24 rounded-full bg-red-50 flex items-center justify-center">
                                <XCircle size={40} className="text-red-500" />
                            </div>
                            <div className="text-center space-y-1">
                                <p className="font-bold text-red-700 text-lg">{t.rejectedTitle}</p>
                                <p className="text-sm text-gray-500">{t.rejectedDesc}</p>
                            </div>
                            <button
                                onClick={handleRetry}
                                className="w-full py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-2xl transition-all"
                            >
                                {t.retry}
                            </button>
                        </>
                    )}

                    {/* CHECKED OUT */}
                    {!initialLoading && checkStatus === 'CHECKED_OUT' && (
                        <>
                            <div className="w-24 h-24 rounded-full bg-slate-100 flex items-center justify-center">
                                <LogOut size={40} className="text-slate-500" />
                            </div>
                            <div className="text-center space-y-1">
                                <p className="font-bold text-slate-700 text-lg">{t.checkedOutTitle}</p>
                                <p className="text-sm text-gray-400">{t.checkedOutDesc}</p>
                            </div>
                        </>
                    )}

                    {/* Inline error has been moved to Modal */}
                </div>

                {/* FORM MODAL */}
                {isFormOpen && (
                    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                        <div className="bg-white rounded-3xl p-6 w-full max-w-sm space-y-5 shadow-2xl animate-in zoom-in-95 duration-200">
                            <h3 className="text-lg font-black text-gray-900 text-center uppercase tracking-wide">
                                {formType === 'CHECK_IN' ? 'Ngân Hà Xin Chào' :
                                 formType === 'CHECK_OUT' ? 'Ngân Hà Xin Cảm ơn' :
                                 'Điểm danh bổ sung'}
                            </h3>

                            {formType === 'CHECK_IN' && (
                                <div className="space-y-2">
                                    <label className="text-sm font-semibold text-gray-700 block">Ca làm việc hôm nay</label>
                                    {activeShiftType ? (
                                        <select 
                                            value={selectedShiftType}
                                            onChange={(e) => setSelectedShiftType(e.target.value)}
                                            className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none bg-white font-medium text-gray-700"
                                        >
                                            <option value={activeShiftType}>
                                                {activeShiftType === 'SHIFT_1' ? 'Ca 1 (09:00 - 17:00)' :
                                                 activeShiftType === 'SHIFT_2' ? 'Ca 2 (11:00 - 19:00)' :
                                                 activeShiftType === 'SHIFT_3' ? 'Ca 3 (17:00 - 00:00)' : 
                                                 activeShiftType === 'FREE' ? 'Ca tự do (Linh hoạt)' :
                                                 activeShiftType === 'SUPPORT' ? 'Ca Hành Chính (Hậu Cần)' :
                                                 activeShiftType === 'REQUEST' ? 'Làm khách yêu cầu' : activeShiftType}
                                            </option>
                                            <option value="SUDDEN_OFF">Nghỉ đột xuất</option>
                                        </select>
                                    ) : (
                                        <>
                                            {isOffToday && (
                                                <div className="bg-blue-50 text-blue-700 p-2.5 rounded-lg text-xs mb-2 font-medium flex items-center gap-2">
                                                    <AlertCircle size={14} className="shrink-0" />
                                                    <span>Hôm nay là ngày OFF của bạn.</span>
                                                </div>
                                            )}
                                            {!isOffToday && shiftFetchError ? (
                                                <div className="bg-red-50 border border-red-200 rounded-xl p-3 space-y-2">
                                                    <p className="text-xs font-semibold text-red-700 flex items-center gap-1.5">
                                                        <AlertCircle size={14} className="shrink-0" />
                                                        Không tải được ca làm việc. Vui lòng thử lại.
                                                    </p>
                                                    <button 
                                                        onClick={() => retryFetchShift()}
                                                        className="w-full py-2 bg-red-100 hover:bg-red-200 text-red-700 text-xs font-bold rounded-lg transition-colors"
                                                    >
                                                        🔄 Tải lại ca làm việc
                                                    </button>
                                                </div>
                                            ) : (
                                                <select 
                                                    value={selectedShiftType}
                                                    onChange={(e) => setSelectedShiftType(e.target.value)}
                                                    className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none bg-white font-medium text-gray-700"
                                                >
                                                    <option value="FREE">Ca tự do (Linh hoạt)</option>
                                                    <option value="REQUEST">Làm khách yêu cầu</option>
                                                    {!isOffToday && <option value="SUDDEN_OFF">Nghỉ đột xuất</option>}
                                                </select>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}

                            {selectedShiftType !== 'SUDDEN_OFF' && selectedShiftType !== 'SUDDEN_OFF_CHECKOUT' && user?.roleId !== 'support' && (
                                <div className="space-y-2 animate-in fade-in slide-in-from-top-2 pt-2 border-t border-gray-100">
                                    <label className="flex items-start gap-3 cursor-pointer p-3 bg-indigo-50/50 hover:bg-indigo-50 border border-indigo-100 rounded-xl transition-colors">
                                        <div className="flex items-center h-5 mt-0.5">
                                            <input
                                                type="checkbox"
                                                checked={wantsToWithdraw}
                                                onChange={(e) => setWantsToWithdraw(e.target.checked)}
                                                className="w-4 h-4 text-indigo-600 bg-white border-gray-300 rounded focus:ring-indigo-500 focus:ring-2"
                                            />
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-sm font-bold text-indigo-900">Hôm nay tôi muốn rút tiền mặt</span>
                                            <span className="text-xs text-indigo-600 font-medium mt-0.5">Vui lòng báo Thu ngân chuẩn bị giúp tôi</span>
                                        </div>
                                    </label>
                                </div>
                            )}

                            {formType === 'CHECK_IN' && selectedShiftType === 'FREE' && (
                                <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                                    <label className="text-sm font-semibold text-gray-700 block text-left flex gap-1 items-center">
                                        Dự kiến về lúc mấy giờ? <span className="text-rose-500">(*)</span>
                                    </label>
                                    <input 
                                        type="time" 
                                        value={estimatedEndTime} 
                                        onChange={e => setEstimatedEndTime(e.target.value)}
                                        className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none bg-white font-medium text-gray-700" 
                                        required
                                    />
                                    <p className="text-xs text-gray-500 font-medium">Giúp Lễ tân nắm bắt thời gian để sắp xếp khách cho bạn.</p>
                                </div>
                            )}
                            
                            {formType === 'CHECK_OUT' && selectedShiftType === 'SUDDEN_OFF_CHECKOUT' && (
                                <div className="bg-amber-50 text-amber-700 p-3 rounded-xl border border-amber-200 text-sm mb-2 font-medium flex flex-col gap-1">
                                    <div className="flex items-center gap-2">
                                        <AlertCircle size={16} className="shrink-0 text-amber-600" />
                                        <span className="font-bold">ĐĂNG KÝ TAN CA SỚM</span>
                                    </div>
                                    <span className="text-amber-600 text-xs pl-6">Hành động này sẽ được ghi nhận là Nghỉ đột xuất.</span>
                                </div>
                            )}
                            {/* Sections hidden if SUDDEN_OFF is selected */}
                            {selectedShiftType !== 'SUDDEN_OFF' && (
                                <>
                                    {/* Camera input (Multiple Photos) */}
                                    <div className="space-y-2">
                                        <label className="text-sm font-semibold text-gray-700 flex justify-between items-center">
                                            <span>
                                                {formType === 'CHECK_OUT' ? t.checkOutPhotoOptional : t.photoRequired}
                                            </span>
                                            {photos.length > 0 && photos.length < MAX_PHOTOS && (
                                                <span className="text-xs text-emerald-600 font-medium">Tối đa {MAX_PHOTOS} ảnh</span>
                                            )}
                                        </label>
                                        
                                        {photos.length > 0 && (
                                            <div className="grid grid-cols-2 gap-3 mb-3">
                                                {photos.map((photo, index) => (
                                                    <div key={index} className="relative w-full h-32 rounded-xl overflow-hidden bg-black/5 border border-gray-200">
                                                        <img src={photo} className="w-full h-full object-cover" />
                                                        <button 
                                                            onClick={() => setPhotos(prev => prev.filter((_, i) => i !== index))}
                                                            className="absolute top-1 right-1 bg-black/60 text-white p-1 rounded-full shadow hover:bg-black/80 transition-colors"
                                                        >
                                                            <XCircle size={16} />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {photos.length < MAX_PHOTOS && (
                                            <div className="flex gap-3">
                                                {useFallbackCamera ? (
                                                    <label className="flex-1 flex flex-col items-center justify-center h-24 border-2 border-emerald-300 bg-emerald-50 hover:bg-emerald-100 transition-all rounded-xl cursor-pointer">
                                                        <Camera size={24} className="text-emerald-500 mb-1" />
                                                        <span className="text-sm font-medium text-emerald-700">Chụp dự phòng</span>
                                                        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleCapture} />
                                                    </label>
                                                ) : (
                                                    <button 
                                                        onClick={() => openWebRTCCamera(facingMode)}
                                                        className="flex-1 flex flex-col items-center justify-center h-24 border-2 border-emerald-300 bg-emerald-50 hover:bg-emerald-100 transition-all rounded-xl cursor-pointer"
                                                    >
                                                        <Camera size={24} className="text-emerald-500 mb-1" />
                                                        <span className="text-sm font-medium text-emerald-700">Chụp ảnh</span>
                                                    </button>
                                                )}
                                                <label className="flex-[0.7] flex flex-col items-center justify-center h-24 border-2 border-dashed border-gray-300 bg-gray-50 hover:bg-gray-100 focus:ring-2 focus:ring-emerald-500 transition-all rounded-xl cursor-pointer">
                                                    <span className="text-xs font-medium text-gray-500">Tải từ máy</span>
                                                    <input type="file" accept="image/*" multiple className="hidden" onChange={handleCapture} />
                                                </label>
                                            </div>
                                        )}
                                    </div>

                                    {(formType === 'LATE_CHECKIN' || (formType === 'CHECK_IN' && isLate) || (formType === 'CHECK_OUT' && selectedShiftType === 'SUDDEN_OFF_CHECKOUT')) && (
                                        <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                                            {formType === 'CHECK_IN' && isLate && (
                                                <div className="text-xs font-medium text-amber-700 bg-amber-50 p-2 rounded-lg border border-amber-200 mb-2">
                                                    {t.lateWarning}
                                                </div>
                                            )}
                                            <label className="text-sm font-semibold text-gray-700 block text-left flex gap-1 items-center">
                                                {formType === 'LATE_CHECKIN' ? t.reasonRequiredGeneral : formType === 'CHECK_OUT' ? 'Lý do tan ca sớm' : t.reasonRequired} 
                                                <span className="text-rose-500">(*)</span>
                                            </label>
                                            <textarea 
                                                value={reason} onChange={e => setReason(e.target.value)}
                                                className="w-full border border-gray-200 rounded-xl min-h-[80px] max-h-32 p-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none resize-y" 
                                                placeholder={formType === 'CHECK_OUT' ? 'Bắt buộc nhập lý do tan ca sớm...' : t.reasonPlaceholder}
                                            />
                                        </div>
                                    )}
                                </>
                            )}

                            <div className="flex gap-3 pt-2">
                                <button onClick={() => setIsFormOpen(false)} className="flex-1 py-3.5 bg-gray-100 text-gray-700 rounded-xl font-bold hover:bg-gray-200 transition-colors">Hủy</button>
                                <button 
                                   onClick={handleSubmitForm}
                                   disabled={selectedShiftType !== 'SUDDEN_OFF' && ((formType !== 'CHECK_OUT' && photos.length === 0) || ((formType === 'LATE_CHECKIN' || (formType === 'CHECK_IN' && isLate) || (formType === 'CHECK_OUT' && selectedShiftType === 'SUDDEN_OFF_CHECKOUT')) && !reason.trim()) || (formType === 'CHECK_IN' && selectedShiftType === 'FREE' && !estimatedEndTime) || (formType === 'CHECK_IN' && shiftFetchError && !isOffToday))}
                                   className="flex-1 py-3.5 bg-emerald-600 active:scale-95 transition-transform text-white rounded-xl font-bold disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center gap-2">
                                    <CheckCircle2 size={18} /> Gửi
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* WEBRTC CAMERA MODAL */}
                {isCameraOpen && (
                    <div className="fixed inset-0 bg-black z-[70] flex flex-col">
                        <div className="relative flex-1 bg-black flex items-center justify-center overflow-hidden">
                            <video 
                                ref={videoRef} 
                                autoPlay 
                                playsInline
                                muted
                                className="w-full h-full object-cover"
                            />
                            <button 
                                onClick={closeWebRTCCamera}
                                className="absolute top-4 left-4 bg-black/50 text-white p-2 rounded-full backdrop-blur z-10"
                            >
                                <XCircle size={24} />
                            </button>
                            <button 
                                onClick={toggleCameraMode}
                                className="absolute top-4 left-16 bg-black/50 text-white p-2 rounded-full backdrop-blur z-10 hover:bg-black/70 transition-colors"
                            >
                                <SwitchCamera size={24} />
                            </button>
                            <div className="absolute top-4 right-4 bg-black/50 text-white px-3 py-1.5 rounded-full text-sm font-bold backdrop-blur flex items-center gap-2 z-10">
                                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                                Đã chụp: {photos.length}/{MAX_PHOTOS}
                            </div>
                        </div>
                        <div className="bg-black p-4 pb-8 flex flex-col items-center justify-center gap-4">
                            <div className="flex items-center justify-between w-full px-6">
                                <div className="w-16">
                                    {photos.length > 0 && (
                                        <div className="w-12 h-12 rounded-lg border-2 border-white overflow-hidden shadow-lg shadow-black">
                                            <img src={photos[photos.length - 1]} className="w-full h-full object-cover" />
                                        </div>
                                    )}
                                </div>
                                <button 
                                    onClick={captureFromVideo}
                                    disabled={photos.length >= MAX_PHOTOS}
                                    className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center bg-transparent active:scale-95 transition-transform disabled:opacity-50 mx-auto"
                                >
                                    <div className="w-16 h-16 rounded-full bg-white transition-transform active:scale-90"></div>
                                </button>
                                <button 
                                    onClick={closeWebRTCCamera}
                                    className="w-16 text-white font-bold text-sm text-right"
                                >
                                    Xong
                                </button>
                            </div>
                            <button
                              onClick={() => {
                                closeWebRTCCamera();
                                setUseFallbackCamera(true);
                              }}
                              className="px-4 py-2 mt-2 bg-rose-500/20 text-rose-300 rounded-full border border-rose-500/30 text-[11px] font-bold active:scale-95 transition-transform backdrop-blur flex items-center gap-2"
                            >
                              ⚠️ Lỗi đen màn hình? Chụp dự phòng
                            </button>
                        </div>
                    </div>
                )}

                {/* ERROR MODAL */}
                {errorMsg && (
                    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
                        <div className="bg-white rounded-3xl p-6 w-full max-w-sm space-y-4 shadow-2xl animate-in zoom-in-95 duration-200 text-center relative">
                            <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-2">
                                <ShieldAlert size={32} className="text-red-600" />
                            </div>
                            <h3 className="text-xl font-bold text-gray-900">Lỗi Điểm Danh</h3>
                            <p className="text-gray-600 text-sm leading-relaxed whitespace-pre-line">{errorMsg}</p>
                            <button 
                                onClick={clearError}
                                className="w-full mt-4 py-3.5 bg-gray-100 text-gray-800 font-bold rounded-xl hover:bg-gray-200 transition-colors"
                            >
                                Đóng
                            </button>
                        </div>
                    </div>
                )}

            </div>
        </AppLayout>
    );
};

export default KTVAttendancePage;

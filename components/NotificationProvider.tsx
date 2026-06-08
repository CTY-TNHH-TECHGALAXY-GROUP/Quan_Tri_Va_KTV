'use client';

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { motion, AnimatePresence } from 'motion/react';
import { Bell, ShieldAlert, X, CheckCircle, Info, AlertTriangle, Check, Star, ArrowRight, MapPin, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

// --- TYPES ---
interface Notification {
    id: string;
    type: string;
    message: string;
    createdAt: string;
    isRead: boolean;
    employeeId?: string;
    bookingId?: string;
}

interface NotificationContextType {
    notifications: Notification[];
    markAsRead: (id: string) => void;
    soundEnabled: boolean;
    setSoundEnabled: (enabled: boolean) => void;
    unlockAudio: () => void;
    playSound: (type: string) => void;
    setKtvScreen: (screen: string) => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

// --- CONFIG ---
const SOUND_MAP: Record<string, string> = {
    'EMERGENCY': '/sounds/quay-bao-khan-cap.wav',
    'SOS': '/sounds/quay-bao-khan-cap.wav',
    'SUDDEN_OFF': '/sounds/quay-bao-khan-cap.wav',
    'ADD_SERVICE': '/sounds/reception-notification.wav',
    'COMPLAINT': '/sounds/quay-danh-gia-te.wav',
    'EARLY_EXIT': '/sounds/quay-khach-ve-som.wav',
    'WATER': '/sounds/reception-notification.wav',
    'BUY_MORE': '/sounds/reception-notification.wav',
    'SUPPORT': '/sounds/reception-notification.wav',
    'NEW_ORDER': '/sounds/quay-don-hang-moi.wav',
    'KTV_NEW_ORDER': '/sounds/ktv-don-hang-moi.wav',
    'REWARD': '/sounds/ktv-nhan-thuong.wav',
    'ATTENDANCE': '/sounds/reception-notification.wav',
    'ATTENDANCE_REQUEST': '/sounds/reception-notification.wav',
    'ATTENDANCE_RESPONSE': '/sounds/reception-notification.wav',
    'CHECK_IN': '/sounds/reception-notification.wav',
    'LEAVE_REQUEST': '/sounds/reception-notification.wav',
    'LEAVE_RESPONSE': '/sounds/reception-notification.wav',
    'SHIFT_CHANGE': '/sounds/reception-notification.wav',
    'SHIFT_RESPONSE': '/sounds/reception-notification.wav',
    'WALLET': '/sounds/reception-notification.wav',
    'KTV_REVIEW': '/sounds/reception-notification.wav',
    'default': '/sounds/reception-notification.wav'
};

export const NotificationProvider = ({ children }: { children: React.ReactNode }) => {
    const { user, role } = useAuth();
    const [toastQueue, setToastQueue] = useState<Notification[]>([]);
    const [soundEnabled, setSoundEnabled] = useState(true);
    const [ktvScreen, setKtvScreen] = useState<string>('DASHBOARD');
    const [notifRules, setNotifRules] = useState<Record<string, any>>({});
    const [isOnShift, setIsOnShift] = useState<boolean>(false);

    // 🔄 Sync KTV on-shift status in real-time
    useEffect(() => {
        if (!user || role?.id !== 'ktv') {
            setIsOnShift(false);
            return;
        }

        const fetchInitialShiftStatus = async () => {
            try {
                const { data, error } = await supabase
                    .from('Users')
                    .select('isOnShift')
                    .eq('id', user.id)
                    .single();
                if (!error && data) {
                    setIsOnShift(data.isOnShift || false);
                    console.log(`📡 [NotificationProvider] Initial isOnShift: ${data.isOnShift}`);
                }
            } catch (err) {
                console.error('Error fetching initial shift status:', err);
            }
        };

        fetchInitialShiftStatus();

        // Subscribe to realtime updates for this user's isOnShift field
        const userChannel = supabase
            .channel(`user_shift_status_${user.id}`)
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'Users',
                filter: `id=eq.${user.id}`
            }, (payload: any) => {
                const updatedUser = payload.new;
                if (updatedUser && updatedUser.isOnShift !== undefined) {
                    setIsOnShift(updatedUser.isOnShift);
                    console.log(`📡 [NotificationProvider] Realtime isOnShift updated to: ${updatedUser.isOnShift}`);
                }
            })
            .subscribe();

        return () => {
            supabase.removeChannel(userChannel);
        };
    }, [user, role]);
    const audioUnlockedRef = useRef<boolean>(false);
    const audioInstanceRef = useRef<HTMLAudioElement | null>(null);
    const lastSoundTimeRef = useRef<number>(0);
    const pushRegisteredRef = useRef<boolean>(false);
    const router = useRouter();

    // 🔧 Fetch notification rules from SystemConfigs on mount
    useEffect(() => {
        fetch('/api/admin/notification-rules')
            .then(r => r.json())
            .then(d => {
                if (d.success && d.data) setNotifRules(d.data);
            })
            .catch(err => console.warn('⚠️ [NotifRules] Fetch failed:', err));
    }, []);

    // 🔧 VAPID KEY for Push Subscription (same as in usePushNotifications.ts and push API)
    const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || 'BNEVJHwVmuU6e7vYPOm1S2hpAWprAhUNl6ew85ktt_HBH2osu4wkrbMXnC8uFj5IZtYXBawvSa1C33bVHTeo6lE';

    const urlBase64ToUint8Array = (base64String: string) => {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
        return outputArray;
    };

    // 📲 Auto-register Push Notifications (runs once per session on first user tap)
    const registerPushIfNeeded = async () => {
        if (pushRegisteredRef.current || !user?.id) return;
        if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
            console.log('⏭️ [Push] Not supported in this browser');
            return;
        }
        
        pushRegisteredRef.current = true; // Prevent duplicate calls
        
        try {
            console.log('📲 [Push] Registering Service Worker...');
            const reg = await navigator.serviceWorker.register('/sw.js');
            await navigator.serviceWorker.ready; // Wait for SW to be active
            console.log('✅ [Push] Service Worker ready');

            const existingSub = await reg.pushManager.getSubscription();
            
            if (existingSub) {
                console.log('✅ [Push] Already subscribed, syncing to DB...');
                // Sync existing subscription to DB (in case it was lost)
                await fetch('/api/ktv/push-sync', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        staffId: user.id,
                        subscription: existingSub.toJSON(),
                        userAgent: navigator.userAgent
                    })
                }).catch(err => {
                    console.warn('⚠️ [Push] Sync failed (Network/AdBlocker):', err.message);
                });
                return;
            }

            // Request permission (requires user gesture — we're inside unlockAudio click handler)
            console.log('📲 [Push] Requesting notification permission...');
            const permission = await Notification.requestPermission();
            console.log('📲 [Push] Permission result:', permission);
            
            if (permission !== 'granted') {
                console.log('⏭️ [Push] Permission denied or dismissed');
                return;
            }

            const sub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
            });
            console.log('✅ [Push] Subscribed successfully');

            // Save subscription via API route (bypasses RLS)
            const res = await fetch('/api/ktv/push-sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    staffId: user.id,
                    subscription: sub.toJSON(),
                    userAgent: navigator.userAgent
                })
            }).catch(err => {
                console.warn('⚠️ [Push] Sync failed (Network/AdBlocker):', err.message);
                return null;
            });
            
            if (!res) return;
            
            const result = await res.json();

            if (result.success) {
                console.log('✅ [Push] Subscription saved for', user.id);
            } else {
                console.error('❌ [Push] Error saving subscription:', result.error);
            }
        } catch (err) {
            console.error('❌ [Push] Registration failed:', err);
            pushRegisteredRef.current = false; // Allow retry
        }
    };

    // Prime the audio instance on first load
    useEffect(() => {
        if (typeof window !== 'undefined' && !audioInstanceRef.current) {
            audioInstanceRef.current = new Audio();
            audioInstanceRef.current.volume = 0.5;
        }
    }, []);

    const unlockAudio = () => {
        // 📲 Auto-register push on first tap (needs user gesture for Notification.requestPermission)
        registerPushIfNeeded();

        if (audioUnlockedRef.current || !audioInstanceRef.current) return;
        
        const audio = audioInstanceRef.current;
        // iOS needs a real play() on a real file during a user gesture
        audio.src = '/sounds/quay-don-hang-moi.wav';
        audio.volume = 0.01;
        
        const playPromise = audio.play();
        if (playPromise !== undefined) {
            playPromise.then(() => {
                audioUnlockedRef.current = true;
                console.log('✅ [NotificationProvider] Audio context primed.');
                audio.pause();
                audio.currentTime = 0;
                audio.volume = 0.5;
            }).catch(err => {
                console.debug('⏳ [NotificationProvider] Priming failed (interaction needed):', err);
            });
        }
    };

    // 🔊 Auto-unlock Audio Context on first user interaction (critical for iOS/Android mobile browsers)
    useEffect(() => {
        const handleFirstInteraction = () => {
            console.log('👆 [NotificationProvider] User interaction detected, priming audio context...');
            unlockAudio();
            // Remove listeners immediately
            document.removeEventListener('click', handleFirstInteraction);
            document.removeEventListener('touchstart', handleFirstInteraction);
        };

        if (typeof window !== 'undefined') {
            document.addEventListener('click', handleFirstInteraction);
            document.addEventListener('touchstart', handleFirstInteraction);
        }

        return () => {
            if (typeof window !== 'undefined') {
                document.removeEventListener('click', handleFirstInteraction);
                document.removeEventListener('touchstart', handleFirstInteraction);
            }
        };
    }, [user]);

    const playSound = (type: string) => {
        if (!soundEnabled || !audioInstanceRef.current) return;
        const normalizedType = (type || 'default').toUpperCase().trim();
        const now = Date.now();
        
        // Giới hạn tần suất phát (tránh bị rè hoặc chồng chéo quá nhanh), trừ khẩn cấp
        if (normalizedType !== 'EMERGENCY' && normalizedType !== 'COMPLAINT' && now - lastSoundTimeRef.current < 2000) {
            console.log('🔇 [NotificationProvider] Sound throttled:', normalizedType);
            return;
        }

        let soundKey = normalizedType;
        
        // Xử lý riêng biệt cho KTV để có âm thanh đặc thù
        if (role?.id === 'ktv') {
            if (normalizedType === 'NEW_ORDER') {
                soundKey = 'KTV_NEW_ORDER';
            } else if (normalizedType === 'REWARD') {
                soundKey = 'REWARD';
            }
        }

        const soundPath = SOUND_MAP[soundKey] || SOUND_MAP[normalizedType] || SOUND_MAP['default'];
        console.log(`🔊 [NotificationProvider] Type: ${type} -> Key: ${soundKey} -> Path: ${soundPath}`);
        
        const audio = audioInstanceRef.current;
        audio.volume = (normalizedType === 'EMERGENCY' || normalizedType === 'SOS') ? 1.0 : 0.7;
        try {
            audio.pause();
            audio.src = soundPath;
            audio.load();
            
            const playPromise = audio.play();
            if (playPromise !== undefined) {
                playPromise.catch(err => {
                    console.warn('🔇 [NotificationProvider] play blocked:', err);
                    audioUnlockedRef.current = false;
                });
            }
        } catch (e) {
            console.error('❌ [NotificationProvider] Error playing sound:', e);
        }
        lastSoundTimeRef.current = now;
    };

    const addToast = (notif: Notification, shouldPlaySound = true) => {
        setToastQueue(prev => {
            // Avoid duplicates
            if (prev.some(n => n.id === notif.id)) return prev;
            return [...prev, notif];
        });
        if (shouldPlaySound) playSound(notif.type);
        
        // 🔥 THAY ĐỔI: Tự động ẩn cho KTV sau 7 giây
        if (role?.id === 'ktv') {
            setTimeout(() => {
                removeToast(notif.id);
            }, 7000);
        }
    };

    const removeToast = (id: string) => {
        setToastQueue(prev => prev.filter(n => n.id !== id));
    };

    const clearAllToasts = () => {
        setToastQueue([]);
    };

    const markAsRead = async (id: string) => {
        // Update local state
        setToastQueue(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
        
        // Update database if it's a UUID (StaffNotifications)
        if (id.length > 20) { 
            await supabase.from('StaffNotifications').update({ isRead: true }).eq('id', id);
        }
    };

    useEffect(() => {
        if (!user) return;

        const roleId = role?.id;
        const isReception = roleId === 'reception' || roleId === 'admin';
        const isKtv = roleId === 'ktv';

        console.log(`📡 [NotificationProvider] Listening for ${roleId}...`);

        // Handler for incoming realtime notifications — Rules-based filtering
        const handleRealtimePayload = (payload: { new: unknown }) => {
            const newNotif = payload.new as Notification;
            console.log('🔔 [NotificationProvider] New notification received:', newNotif);

            const notifType = (newNotif.type || '').toUpperCase();
            const rule = notifRules[notifType];

            // If rules loaded and this type exists → check enabled
            if (rule && rule.enabled === false) {
                console.log('⏭️ [NotificationProvider] Type disabled by admin:', notifType);
                return;
            }

            // Check 1: Role in allowed_roles?
            const roleAllowed = rule?.allowed_roles?.includes(roleId) ?? false;

            // Check 2: Is target employee? (employeeId matches current user)
            const isTargetEmployee = rule?.include_target_employee !== false
                && newNotif.employeeId
                && newNotif.employeeId === user.id;

            // Must pass at least one condition
            if (rule && !roleAllowed && !isTargetEmployee) {
                console.log('⏭️ [NotificationProvider] Filtered out by rules:', {
                    notifType, roleId, roleAllowed, isTargetEmployee
                });
                return;
            }

            // Check 3: On-shift requirement (ONLY for KTV role)
            // Admin/Reception always receive — no on-shift check
            if (isKtv && rule?.require_on_shift) {
                // KTV off-shift → skip (unless they are target employee for personal notifs)
                // For now, KTV who is target employee always receives regardless
                if (!isTargetEmployee && !isOnShift) {
                    console.log('⏭️ [NotificationProvider] KTV off-shift, skipping:', notifType);
                    return;
                }
            }

            // Fallback for legacy types without rules: use old logic
            if (!rule) {
                // Hardcode safety for KTV specific notifications
                if (notifType === 'KTV_NEW_ORDER' || notifType === 'REWARD') {
                    if (!isKtv || newNotif.employeeId !== user.id) return;
                }

                if (roleId === 'admin') {
                    const isGlobal = !newNotif.employeeId;
                    const isComplaint = notifType === 'COMPLAINT';
                    if (!isGlobal && !isComplaint) return;
                } else if (isKtv) {
                    if (newNotif.employeeId !== user.id) return;
                } else if (isReception && newNotif.employeeId) {
                    return;
                } else if (newNotif.employeeId && newNotif.employeeId !== user.id) {
                    // Catch-all safety for other roles (Manager, Dev)
                    return;
                }
            }

            // 🔊 Sound: use rule-configured sound or fallback to SOUND_MAP
            if (isKtv && notifType === 'NEW_ORDER') {
                addToast({ ...newNotif, type: 'KTV_NEW_ORDER' });
            } else {
                addToast(newNotif);
            }
        };

        // Create and subscribe to the Supabase Realtime channel
        const createChannel = () => {
            const ch = supabase
                .channel('global_notifications_' + Date.now()) // unique name to avoid stale channels
                .on('postgres_changes', {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'StaffNotifications'
                }, handleRealtimePayload)
                .subscribe((status) => {
                    console.log(`📡 [NotificationProvider] Channel status: ${status}`);
                });
            return ch;
        };

        let channel = createChannel();

        // 🔄 RECONNECT: Re-subscribe when tab becomes visible again (after background / OS kill)
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                console.log('👁️ [NotificationProvider] Tab became visible — reconnecting Realtime...');
                // Remove old channel and create a fresh one
                supabase.removeChannel(channel);
                channel = createChannel();
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);

        // 💓 HEARTBEAT: Removed — Supabase client handles WebSocket keepalive internally.
        // The visibilitychange handler above already reconnects when tab becomes active.
        // Old pattern (supabase.channel('heartbeat_ping').subscribe()) was creating/destroying
        // a channel every 30s, causing unnecessary egress overhead.

        // 📲 Register Periodic Sync for SW keep-alive (if supported)
        if ('serviceWorker' in navigator && 'periodicSync' in (navigator as unknown as Record<string, unknown>)) {
            navigator.serviceWorker.ready.then((sw) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (sw as any).periodicSync?.register('keep-alive', { minInterval: 60_000 }).catch(() => {
                    console.debug('[NotificationProvider] periodicSync not granted');
                });
            });
        }

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            supabase.removeChannel(channel);
        };
    }, [user, role]);

    // Sorting logic: Unread first, then read. Within each group, newest first.
    const sortedToasts = [...toastQueue].sort((a, b) => {
        if (a.isRead === b.isRead) {
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        }
        return a.isRead ? 1 : -1;
    });

    return (
        <NotificationContext.Provider value={{ 
            notifications: toastQueue, 
            markAsRead, 
            soundEnabled, 
            setSoundEnabled,
            unlockAudio,
            playSound,
            setKtvScreen
        }}>
            {children}
            
            {/* TOAST UI */}
            {role?.id === 'ktv' ? (
                // GIAO DIỆN TIN NHẮN CHO KTV (Trên đầu)
                <div suppressHydrationWarning className="fixed top-4 left-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
                    <AnimatePresence>
                        {sortedToasts.filter(n => !n.isRead).length >= 2 && (
                            <motion.div
                                key="ktv-clear-all"
                                initial={{ opacity: 0, y: -8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -8 }}
                                className="pointer-events-auto flex justify-end"
                            >
                                <button
                                    onClick={clearAllToasts}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-800/80 backdrop-blur-sm text-white text-[11px] font-bold shadow-lg hover:bg-slate-700 active:scale-95 transition-all"
                                >
                                    <X size={12} strokeWidth={3} />
                                    Đóng tất cả ({sortedToasts.filter(n => !n.isRead).length})
                                </button>
                            </motion.div>
                        )}
                    </AnimatePresence>
                    <AnimatePresence>
                        {sortedToasts.filter(n => !n.isRead).map((n) => (
                                <KtvMessageToast 
                                    key={n.id} 
                                    notification={n} 
                                    currentScreen={ktvScreen}
                                    onClose={() => markAsRead(n.id)}
                                    onRedirect={() => {
                                        const t = (n.type || '').toUpperCase();
                                        if (t === 'KTV_NEW_ORDER') {
                                            if (ktvScreen === 'REVIEW') {
                                                alert('Vui lòng đánh giá tính cách khách hàng trước khi chuyển ca!');
                                            } else if (ktvScreen === 'HANDOVER' || ktvScreen === 'REWARD') {
                                                window.dispatchEvent(new Event('KTV_FAST_TRACK'));
                                            } else {
                                                router.push('/ktv/dashboard');
                                            }
                                        } else {
                                            router.push('/ktv/history');
                                        }
                                    }}
                                />
                        ))}
                    </AnimatePresence>
                </div>
            ) : (
                // GIAO DIỆN TOAST CHO QUẦY (Dưới góc)
                <div suppressHydrationWarning className="fixed bottom-[calc(env(safe-area-inset-bottom)+1.5rem)] left-4 right-4 sm:left-auto sm:right-6 sm:w-96 z-[9999] flex flex-col gap-3 pointer-events-none">
                    {/* Nút đóng tất cả — chỉ xuất hiện khi có >= 2 thông báo */}
                    <AnimatePresence>
                        {sortedToasts.length >= 2 && (
                            <motion.div
                                key="clear-all-btn"
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 8 }}
                                className="pointer-events-auto flex justify-end"
                            >
                                <button
                                    onClick={clearAllToasts}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-800/80 backdrop-blur-sm text-white text-[11px] font-bold shadow-lg hover:bg-slate-700 active:scale-95 transition-all"
                                >
                                    <X size={12} strokeWidth={3} />
                                    Đóng tất cả ({sortedToasts.length})
                                </button>
                            </motion.div>
                        )}
                    </AnimatePresence>
                    <AnimatePresence>
                        {sortedToasts.map((n) => (
                            <Toast 
                                key={n.id} 
                                notification={n} 
                                onClose={() => removeToast(n.id)} 
                                onMarkDone={() => markAsRead(n.id)}
                                onRedirect={() => {
                                    const t = (n.type || '').toUpperCase();
                                    if (t === 'CHECK_IN' || t === 'ATTENDANCE' || t === 'ATTENDANCE_REQUEST' || t === 'ATTENDANCE_RESPONSE' || t === 'LEAVE_REQUEST' || t === 'SUDDEN_OFF') {
                                        router.push('/reception/ktv-hub');
                                    } else if (t === 'REWARD') {
                                        router.push('/ktv/history');
                                    } else if (t === 'SHIFT_CHANGE') {
                                        router.push('/reception/ktv-hub');
                                    } else {
                                        router.push('/reception/dispatch');
                                    }
                                }}
                            />
                        ))}
                    </AnimatePresence>
                </div>
            )}
        </NotificationContext.Provider>
    );
};

const KtvMessageToast = ({ notification, currentScreen, onClose, onRedirect }: { notification: Notification, currentScreen: string, onClose: () => void, onRedirect: () => void }) => {
    const isLocked = currentScreen === 'REVIEW';
    const type = notification.type?.toUpperCase();
    const isComplaint = type === 'COMPLAINT';
    const isCheckIn = type === 'CHECK_IN' || type === 'ATTENDANCE' || type === 'ATTENDANCE_REQUEST' || type === 'ATTENDANCE_RESPONSE';
    const isKtvNewOrder = type === 'KTV_NEW_ORDER';
    const isShift = type === 'SHIFT_RESPONSE';
    const isLeave = type === 'LEAVE_RESPONSE';
    const isWallet = type === 'WALLET';
    
    // Determine title and icon based on notification type
    let title = 'Phần thưởng mới';
    let iconElement = <Star size={20} className="text-white fill-white" />;
    let iconBg = 'bg-emerald-500';
    let borderClass = 'border-emerald-100';
    let titleColor = 'text-emerald-600';

    if (isComplaint) {
        title = 'Thông báo khẩn';
        iconElement = <ShieldAlert size={20} />;
        iconBg = 'bg-white/20';
        borderClass = 'border-rose-500';
        titleColor = 'text-rose-100';
    } else if (isKtvNewOrder) {
        title = 'Đơn hàng mới';
        iconElement = <Bell size={20} className="text-white" />;
        iconBg = 'bg-amber-500';
        borderClass = 'border-amber-200';
        titleColor = 'text-amber-600';
    } else if (isCheckIn) {
        title = 'Điểm danh';
        iconElement = <CheckCircle size={20} className="text-white" />;
        iconBg = 'bg-blue-500';
        borderClass = 'border-blue-100';
        titleColor = 'text-blue-600';
    } else if (isShift) {
        title = 'Thông báo ca';
        iconElement = <Info size={20} className="text-white" />;
        iconBg = 'bg-indigo-500';
        borderClass = 'border-indigo-100';
        titleColor = 'text-indigo-600';
    } else if (isLeave) {
        title = 'Kết quả nghỉ phép';
        iconElement = <Info size={20} className="text-white" />;
        iconBg = 'bg-violet-500';
        borderClass = 'border-violet-100';
        titleColor = 'text-violet-600';
    } else if (isWallet) {
        title = 'Thông báo ví';
        iconElement = <Info size={20} className="text-white" />;
        iconBg = 'bg-teal-500';
        borderClass = 'border-teal-100';
        titleColor = 'text-teal-600';
    }

    return (
        <motion.div
            initial={{ y: -50, opacity: 0, scale: 0.9 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -50, opacity: 0, scale: 0.9 }}
            onClick={() => !isLocked && onRedirect()}
            className={`pointer-events-auto p-4 rounded-[24px] shadow-2xl border-2 flex items-center gap-4 transition-all active:scale-95
                ${isComplaint ? 'bg-rose-600 border-rose-500 text-white' : 'bg-white/95 backdrop-blur-md text-slate-800'} ${borderClass}
                ${isLocked ? 'cursor-default opacity-90' : 'cursor-pointer'}`}
        >
            <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${iconBg}`}>
                {iconElement}
            </div>
            <div className="flex-1 min-w-0" onClick={() => !isLocked && onRedirect()}>
                <p className={`text-[9px] font-black uppercase tracking-widest opacity-70 mb-0.5 ${isComplaint ? 'text-rose-100' : titleColor}`}>
                    {title}
                </p>
                <p className="text-xs font-bold leading-tight truncate">{notification.message}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
                {!isLocked && (
                    <button 
                        onClick={(e) => { e.stopPropagation(); onRedirect(); }}
                        className="p-1.5 opacity-40 hover:opacity-100 transition-opacity"
                    >
                        <ArrowRight size={16} />
                    </button>
                )}
                <button 
                    onClick={(e) => { e.stopPropagation(); onClose(); }}
                    className={`p-1.5 rounded-full transition-colors ${isComplaint ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-500'}`}
                >
                    <X size={16} />
                </button>
            </div>
        </motion.div>
    );
};

const Toast = ({ 
    notification, 
    onClose, 
    onMarkDone, 
    onRedirect 
}: { 
    notification: Notification, 
    onClose: () => void, 
    onMarkDone: () => void,
    onRedirect: () => void
}) => {
    const { role } = useAuth();
    const [confirmLoading, setConfirmLoading] = React.useState<'confirm' | 'reject' | null>(null);

    const type = notification.type?.toUpperCase();
    const isCritical = type === 'EMERGENCY' || type === 'SOS' || type === 'COMPLAINT' || type === 'SUDDEN_OFF';
    const isEarlyExit = type === 'EARLY_EXIT';
    const isWater = type === 'WATER';
    const isBuyMore = type === 'BUY_MORE' || type === 'ADD_SERVICE' || type === 'NORMAL';
    const isReward = type === 'REWARD';
    const isNewOrder = type === 'NEW_ORDER';
    const isCheckIn = type === 'CHECK_IN' || type === 'ATTENDANCE' || type === 'ATTENDANCE_REQUEST' || type === 'ATTENDANCE_RESPONSE';
    const isLeaveReq = type === 'LEAVE_REQUEST';
    const isShiftChange = type === 'SHIFT_CHANGE';
    const isKtvReview = type === 'KTV_REVIEW';
    const isWalletNotif = type === 'WALLET';

    // Parse attendanceId from message tag [AID:uuid] — bookingId FK cannot be used
    const aidMatch = notification.message?.match(/\[AID:([a-f0-9-]+)\]/i);
    const attendanceId = aidMatch?.[1] ?? null;
    const isAuto = notification.message?.includes('[AUTO]');
    
    // Clean message: hide tags from UI
    const displayMessage = notification.message?.replace(/\s*\[(AID:[a-f0-9-]+|AUTO)\]/gi, '')?.trim() ?? '';

    const isAdminCheckIn = isCheckIn && !!attendanceId && !isAuto && (role?.id === 'admin' || role?.id === 'reception');

    const handleAttendanceAction = async (action: 'CONFIRM' | 'REJECT') => {
        setConfirmLoading(action === 'CONFIRM' ? 'confirm' : 'reject');
        try {
            await fetch('/api/ktv/attendance/confirm', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ attendanceId, action }),
            });
        } catch (e) {
            console.error('[Toast] Confirm error:', e);
        } finally {
            setConfirmLoading(null);
            onMarkDone();
            onClose();
        }
    };

    let bgColor = notification.isRead ? 'bg-gray-50/90' : 'bg-white';
    let borderColor = notification.isRead ? 'border-gray-200' : 'border-slate-200';
    let icon = <Bell className={notification.isRead ? 'text-gray-400' : 'text-slate-500'} size={20} />;
    let title = 'Thông báo';

    if (isCritical) {
        bgColor = notification.isRead ? 'bg-rose-900/40' : 'bg-rose-600';
        borderColor = 'border-rose-500';
        icon = <ShieldAlert className="text-white animate-pulse" size={22} />;
        title = type === 'COMPLAINT' ? '🚨 Đánh giá tệ' : type === 'SUDDEN_OFF' ? '⚠️ Nghỉ đột xuất' : '🆘 Khẩn cấp';
    } else if (isEarlyExit) {
        bgColor = notification.isRead ? 'bg-amber-100/40' : 'bg-amber-50';
        borderColor = 'border-amber-200';
        icon = <AlertTriangle className="text-amber-600" size={20} />;
        title = '🏃 Khách về sớm';
    } else if (isWater) {
        bgColor = notification.isRead ? 'bg-sky-100/40' : 'bg-sky-50';
        borderColor = 'border-sky-200';
        icon = <Info className="text-sky-600" size={20} />;
        title = '💧 Khách gọi nước';
    } else if (isBuyMore) {
        bgColor = notification.isRead ? 'bg-violet-100/40' : 'bg-violet-50';
        borderColor = 'border-violet-200';
        icon = <CheckCircle className="text-violet-600" size={20} />;
        title = '✨ Khách mua thêm';
    } else if (isReward) {
        bgColor = notification.isRead ? 'bg-emerald-100/40' : 'bg-emerald-50';
        borderColor = 'border-emerald-200';
        icon = <CheckCircle className="text-emerald-600" size={20} />;
        title = '🎁 Khách thưởng';
    } else if (isNewOrder) {
        bgColor = notification.isRead ? 'bg-blue-100/40' : 'bg-blue-50';
        borderColor = 'border-blue-200';
        icon = <Bell className="text-blue-600" size={20} />;
        title = '📋 Đơn hàng mới';
    } else if (isCheckIn) {
        bgColor = notification.isRead ? 'bg-violet-100/40' : 'bg-violet-50';
        borderColor = 'border-violet-200';
        icon = <MapPin className="text-violet-600" size={20} />;
        title = '📍 KTV điểm danh';
    } else if (isLeaveReq) {
        bgColor = notification.isRead ? 'bg-orange-100/40' : 'bg-orange-50';
        borderColor = 'border-orange-200';
        icon = <Info className="text-orange-600" size={20} />;
        title = '📋 KTV xin nghỉ';
    } else if (isShiftChange) {
        bgColor = notification.isRead ? 'bg-indigo-100/40' : 'bg-indigo-50';
        borderColor = 'border-indigo-200';
        icon = <Info className="text-indigo-600" size={20} />;
        title = '🔄 KTV đổi ca';
    } else if (isKtvReview) {
        bgColor = notification.isRead ? 'bg-teal-100/40' : 'bg-teal-50';
        borderColor = 'border-teal-200';
        icon = <Info className="text-teal-600" size={20} />;
        title = '📝 KTV đánh giá khách';
    } else if (isWalletNotif) {
        bgColor = notification.isRead ? 'bg-cyan-100/40' : 'bg-cyan-50';
        borderColor = 'border-cyan-200';
        icon = <Info className="text-cyan-600" size={20} />;
        title = '💰 Thông báo ví';
    }

    return (
        <motion.div
            layout
            initial={{ opacity: 0, x: 50, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
            className={`pointer-events-auto p-4 rounded-2xl shadow-2xl border transition-all duration-500 ${bgColor} ${borderColor} flex gap-4 items-center ${notification.isRead ? 'opacity-60 scale-[0.98]' : ''} ${isCritical && !notification.isRead ? 'ring-4 ring-rose-500/20' : ''}`}
        >
            <div className={`p-2 rounded-xl shrink-0 ${isCritical ? (notification.isRead ? 'bg-white/10' : 'bg-white/20') : 'bg-white shadow-sm'}`}>
                {icon}
            </div>
            
            <div 
                className="flex-1 min-w-0 cursor-pointer"
                onClick={onRedirect}
            >
                <div className="flex items-center gap-2 mb-1">
                    <p className={`text-[10px] font-black uppercase tracking-widest ${isCritical ? 'text-rose-100' : 'text-slate-500'}`}>
                        {title}
                    </p>
                    {notification.isRead && (
                        <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full ${isCritical ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-400'}`}>
                            ĐÃ XỬ LÝ
                        </span>
                    )}
                </div>
                <p className={`text-sm font-bold leading-tight ${isCritical ? 'text-white' : 'text-slate-800'} ${notification.isRead ? 'line-through opacity-70' : ''} break-words`}>
                    {displayMessage}
                </p>
                <div className="flex items-center gap-2 mt-1.5">
                    <p className={`text-[9px] font-bold opacity-60 ${isCritical ? 'text-rose-100' : 'text-slate-400'}`}>
                        {new Date(notification.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                    {isCritical && !notification.isRead && (
                        <span className="w-1.5 h-1.5 bg-white rounded-full animate-ping" />
                    )}
                </div>
            </div>

            <div className="flex flex-col gap-2">
                {/* CHECK_IN: admin xác nhận / từ chối */}
                {isAdminCheckIn && !notification.isRead && (
                    <>
                        <button
                            onClick={(e) => { e.stopPropagation(); handleAttendanceAction('CONFIRM'); }}
                            disabled={!!confirmLoading}
                            className="p-2 rounded-xl bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-all hover:scale-110 shadow-sm disabled:opacity-50"
                            title="Xác nhận điểm danh"
                        >
                            {confirmLoading === 'confirm' ? <Loader2 size={15} className="animate-spin" /> : <Check size={16} strokeWidth={3} />}
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); handleAttendanceAction('REJECT'); }}
                            disabled={!!confirmLoading}
                            className="p-2 rounded-xl bg-rose-50 text-rose-500 hover:bg-rose-100 transition-all hover:scale-110 shadow-sm disabled:opacity-50"
                            title="Từ chối điểm danh"
                        >
                            {confirmLoading === 'reject' ? <Loader2 size={15} className="animate-spin" /> : <X size={15} />}
                        </button>
                    </>
                )}
                {/* Normal notifications: tích xanh */}
                {!isAdminCheckIn && !notification.isRead && (
                    <button 
                        onClick={(e) => {
                            e.stopPropagation();
                            onMarkDone();
                            onClose();
                        }}
                        className={`p-2 rounded-xl transition-all hover:scale-110 shadow-sm ${isCritical ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'}`}
                        title="Đánh dấu hoàn thành"
                    >
                        <Check size={16} strokeWidth={3} />
                    </button>
                )}
                <button 
                    onClick={(e) => {
                        e.stopPropagation();
                        onClose();
                    }}
                    className={`p-1 rounded-lg transition-colors ${isCritical ? 'hover:bg-white/10 text-white' : 'hover:bg-slate-100 text-slate-400'}`}
                >
                    <X size={16} />
                </button>
            </div>
        </motion.div>
    );
};

export const useNotifications = () => {
    const context = useContext(NotificationContext);
    if (context === undefined) {
        throw new Error('useNotifications must be used within a NotificationProvider');
    }
    return context;
};

'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

const VAPID_PUBLIC_KEY = 'BNEVJHwVmuU6e7vYPOm1S2hpAWprAhUNl6ew85ktt_HBH2osu4wkrbMXnC8uFj5IZtYXBawvSa1C33bVHTeo6lE'; // Sẽ đưa vào env sau

export function usePushNotifications(staffId: string | undefined) {
    const [isSupported, setIsSupported] = useState(false);
    const [permission, setPermission] = useState<NotificationPermission>('default');
    const [subscription, setSubscription] = useState<PushSubscription | null>(null);
    const [isRegistering, setIsRegistering] = useState(false);

    useEffect(() => {
        if (typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window) {
            setIsSupported(true);
            setPermission(Notification.permission);
            
            // Register SW and check for existing subscription
            navigator.serviceWorker.register('/sw.js').then(reg => {
                console.log('SW Registered');
                return reg.pushManager.getSubscription();
            }).then(sub => {
                setSubscription(sub);
            });
        }
    }, []);

    const urlBase64ToUint8Array = (base64String: string) => {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding)
            .replace(/\-/g, '+')
            .replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    };

    const subscribe = useCallback(async () => {
        if (!isSupported || !staffId) return false;
        
        setIsRegistering(true);
        try {
            const result = await Notification.requestPermission();
            setPermission(result);

            if (result === 'granted') {
                const reg = await navigator.serviceWorker.ready;
                const sub = await reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
                });

                setSubscription(sub);

                // Save to database
                const { error } = await supabase
                    .from('StaffPushSubscriptions')
                    .upsert({
                        staff_id: staffId,
                        subscription: sub.toJSON(),
                        user_agent: navigator.userAgent,
                        updated_at: new Date().toISOString()
                    }, {
                        onConflict: 'staff_id,subscription'
                    });

                if (error) {
                    console.error('Error saving subscription:', error);
                    return false;
                }
                console.log('Push Subscription saved successfully');
                return true;
            }
            return false;
        } catch (err) {
            console.error('Failed to subscribe to push notifications:', err);
            return false;
        } finally {
            setIsRegistering(false);
        }
    }, [isSupported, staffId]);

    return {
        isSupported,
        permission,
        subscription,
        subscribe,
        isRegistering
    };
}

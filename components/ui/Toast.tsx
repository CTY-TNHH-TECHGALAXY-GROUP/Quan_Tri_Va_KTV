'use client';
import React, { useState, useEffect, createContext, useContext, ReactNode, useCallback } from 'react';
import { CheckCircle2, XCircle, AlertCircle, Info, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

type ToastVariant = 'success' | 'error' | 'warning' | 'info';

interface ToastMessage {
    id: string;
    message: string;
    variant: ToastVariant;
}

interface ToastContextType {
    addToast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider = ({ children }: { children: ReactNode }) => {
    const [toasts, setToasts] = useState<ToastMessage[]>([]);

    const addToast = useCallback((message: string, variant: ToastVariant = 'info') => {
        const id = Math.random().toString(36).substring(2, 9);
        setToasts(prev => [...prev, { id, message, variant }]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 3000);
    }, []);

    const removeToast = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    return (
        <ToastContext.Provider value={{ addToast }}>
            {children}
            <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 pointer-events-none items-center">
                <AnimatePresence>
                    {toasts.map(toast => (
                        <motion.div
                            key={toast.id}
                            initial={{ opacity: 0, y: 50, scale: 0.9 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-2xl shadow-lg border max-w-[90vw] w-max ${
                                toast.variant === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' :
                                toast.variant === 'error' ? 'bg-red-50 border-red-200 text-red-800' :
                                toast.variant === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-800' :
                                'bg-white border-gray-200 text-gray-800'
                            }`}
                        >
                            {toast.variant === 'success' && <CheckCircle2 size={20} className="text-emerald-600 shrink-0" />}
                            {toast.variant === 'error' && <XCircle size={20} className="text-red-600 shrink-0" />}
                            {toast.variant === 'warning' && <AlertCircle size={20} className="text-amber-600 shrink-0" />}
                            {toast.variant === 'info' && <Info size={20} className="text-blue-600 shrink-0" />}
                            
                            <span className="text-sm font-semibold">{toast.message}</span>
                            
                            <button
                                onClick={() => removeToast(toast.id)}
                                className="ml-2 text-gray-400 hover:text-gray-600 transition-colors"
                            >
                                <X size={16} />
                            </button>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        </ToastContext.Provider>
    );
};

export const useToast = () => {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
};

'use client';
import React from 'react';
import { AlertCircle, CheckCircle2, Loader2, XCircle } from 'lucide-react';

interface ConfirmDialogProps {
    open: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    variant?: 'danger' | 'warning' | 'normal';
    onConfirm: () => void;
    onCancel: () => void;
    isLoading?: boolean;
}

export const ConfirmDialog = ({
    open,
    title,
    message,
    confirmText = 'Xác nhận',
    cancelText = 'Hủy',
    variant = 'danger',
    onConfirm,
    onCancel,
    isLoading = false
}: ConfirmDialogProps) => {
    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl animate-in zoom-in-95">
                <div className={`mx-auto w-12 h-12 rounded-full flex items-center justify-center mb-4 ${
                    variant === 'danger' ? 'bg-red-100 text-red-600' :
                    variant === 'warning' ? 'bg-amber-100 text-amber-600' :
                    'bg-blue-100 text-blue-600'
                }`}>
                    {variant === 'danger' ? <XCircle size={24} /> :
                     variant === 'warning' ? <AlertCircle size={24} /> :
                     <CheckCircle2 size={24} />}
                </div>
                <h3 className="text-lg font-bold text-center text-gray-900 mb-2">
                    {title}
                </h3>
                <p className="text-sm text-gray-600 text-center mb-6 leading-relaxed">
                    {message}
                </p>
                <div className="flex gap-3">
                    <button 
                        onClick={onCancel}
                        disabled={isLoading}
                        className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-2xl hover:bg-gray-200 transition-colors disabled:opacity-50"
                    >
                        {cancelText}
                    </button>
                    <button 
                        onClick={onConfirm}
                        disabled={isLoading}
                        className={`flex-1 py-3 text-white font-bold rounded-2xl transition-all shadow-md flex justify-center items-center ${
                            variant === 'danger' ? 'bg-red-600 hover:bg-red-700 shadow-red-200' :
                            variant === 'warning' ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-200' :
                            'bg-blue-600 hover:bg-blue-700 shadow-blue-200'
                        } disabled:opacity-50`}
                    >
                        {isLoading ? <Loader2 size={18} className="animate-spin" /> : confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
};

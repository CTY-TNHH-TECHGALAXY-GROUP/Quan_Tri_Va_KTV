'use client';

import React, { useState, useRef } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import {
    Camera, CheckCircle, Image as ImageIcon, MapPin, Search, PlusCircle,
    XCircle, SwitchCamera, Loader2, ArrowRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useSupportDashboard } from './SupportDashboard.logic';

export default function SupportDashboard() {
    const {
        roomsToClean, myTasks, loadingRooms, loadingTasks,
        markRoomDone, markTaskDone, refreshRooms, refreshTasks
    } = useSupportDashboard();

    const [activeTab, setActiveTab] = useState<'ROOMS' | 'TASKS'>('TASKS');
    const [selectedItem, setSelectedItem] = useState<{ id: string, type: 'ROOM' | 'TASK' } | null>(null);

    // Camera states
    const [isCameraOpen, setIsCameraOpen] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
    const [processingPhoto, setProcessingPhoto] = useState(false);

    const openCamera = async (mode = facingMode) => {
        try {
            if (stream) {
                stream.getTracks().forEach(t => t.stop());
            }
            const newStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: mode }
            });
            setStream(newStream);
            if (videoRef.current) {
                videoRef.current.srcObject = newStream;
            }
            setIsCameraOpen(true);
        } catch (error) {
            console.error('Camera error:', error);
            alert('Không thể mở camera. Vui lòng kiểm tra quyền truy cập.');
        }
    };

    const closeCamera = () => {
        if (stream) {
            stream.getTracks().forEach(t => t.stop());
            setStream(null);
        }
        setIsCameraOpen(false);
        setSelectedItem(null);
    };

    const toggleCamera = () => {
        const newMode = facingMode === 'environment' ? 'user' : 'environment';
        setFacingMode(newMode);
        openCamera(newMode);
    };

    const capturePhoto = async () => {
        if (!videoRef.current || !selectedItem) return;
        setProcessingPhoto(true);

        const canvas = document.createElement('canvas');
        const video = videoRef.current;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.drawImage(video, 0, 0);
            
            // Add watermark
            ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            ctx.fillRect(0, canvas.height - 40, canvas.width, 40);
            ctx.fillStyle = '#fff';
            ctx.font = '16px Arial';
            ctx.fillText(new Date().toLocaleString('vi-VN'), 10, canvas.height - 15);

            const photoUrl = canvas.toDataURL('image/jpeg', 0.8);
            
            // Submit
            if (selectedItem.type === 'ROOM') {
                await markRoomDone(selectedItem.id, photoUrl);
            } else {
                await markTaskDone(selectedItem.id, photoUrl);
            }
            closeCamera();
        }
        setProcessingPhoto(false);
    };

    const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !selectedItem) return;

        setProcessingPhoto(true);
        const reader = new FileReader();
        reader.onload = async (event) => {
            const photoUrl = event.target?.result as string;
            if (selectedItem.type === 'ROOM') {
                await markRoomDone(selectedItem.id, photoUrl);
            } else {
                await markTaskDone(selectedItem.id, photoUrl);
            }
            setSelectedItem(null);
            setProcessingPhoto(false);
        };
        reader.readAsDataURL(file);
    };

    const handleActionClick = (id: string, type: 'ROOM' | 'TASK') => {
        setSelectedItem({ id, type });
        // Mặc định mở camera, hoặc cho phép người dùng chọn upload
        openCamera();
    };

    return (
        <AppLayout title="Hậu Cần Dashboard">
            <div className="max-w-3xl mx-auto p-4 pb-24">
                {/* Tabs - Tạm ẩn phần Phòng Cần Dọn theo yêu cầu
                <div className="flex bg-white rounded-xl shadow-sm p-1 mb-6 border border-slate-100">
                    <button
                        onClick={() => setActiveTab('ROOMS')}
                        className={`flex-1 py-3 text-sm font-bold rounded-lg transition-all ${
                            activeTab === 'ROOMS' 
                            ? 'bg-emerald-500 text-white shadow-md' 
                            : 'text-slate-500 hover:bg-slate-50'
                        }`}
                    >
                        Phòng Cần Dọn
                        {roomsToClean.length > 0 && (
                            <span className="ml-2 bg-rose-500 text-white text-xs px-2 py-0.5 rounded-full">
                                {roomsToClean.length}
                            </span>
                        )}
                    </button>
                    <button
                        onClick={() => setActiveTab('TASKS')}
                        className={`flex-1 py-3 text-sm font-bold rounded-lg transition-all ${
                            activeTab === 'TASKS' 
                            ? 'bg-indigo-500 text-white shadow-md' 
                            : 'text-slate-500 hover:bg-slate-50'
                        }`}
                    >
                        Công Việc
                        {myTasks.length > 0 && (
                            <span className="ml-2 bg-rose-500 text-white text-xs px-2 py-0.5 rounded-full">
                                {myTasks.length}
                            </span>
                        )}
                    </button>
                </div>
                */}

                {/* Content */}
                <AnimatePresence mode="wait">
                    {activeTab === 'ROOMS' && (
                        <motion.div
                            key="ROOMS"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className="space-y-4"
                        >
                            {loadingRooms ? (
                                <div className="text-center py-10 text-slate-500">Đang tải...</div>
                            ) : roomsToClean.length === 0 ? (
                                <div className="text-center py-12 bg-white rounded-3xl border border-slate-100">
                                    <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
                                        <CheckCircle className="text-emerald-500" size={32} />
                                    </div>
                                    <h3 className="text-lg font-bold text-slate-800">Tuyệt vời!</h3>
                                    <p className="text-slate-500">Hiện tại không có phòng nào cần dọn.</p>
                                </div>
                            ) : (
                                roomsToClean.map(room => (
                                    <div key={room.id} className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 flex items-center justify-between">
                                        <div>
                                            <h4 className="text-xl font-bold text-slate-800">{room.roomName}</h4>
                                            <p className="text-sm text-slate-500 flex items-center gap-1 mt-1">
                                                <span className="font-mono bg-slate-100 px-2 py-0.5 rounded text-xs">{room.billCode}</span>
                                            </p>
                                            <p className="text-xs text-rose-500 mt-2 font-medium">Khách vừa trả phòng</p>
                                        </div>
                                        <button
                                            onClick={() => handleActionClick(room.id, 'ROOM')}
                                            className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center hover:bg-emerald-100 transition-colors shadow-sm"
                                        >
                                            <Camera size={24} />
                                        </button>
                                    </div>
                                ))
                            )}
                        </motion.div>
                    )}

                    {activeTab === 'TASKS' && (
                        <motion.div
                            key="TASKS"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className="space-y-4"
                        >
                            {loadingTasks ? (
                                <div className="text-center py-10 text-slate-500">Đang tải...</div>
                            ) : myTasks.length === 0 ? (
                                <div className="text-center py-12 bg-white rounded-3xl border border-slate-100">
                                    <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-4">
                                        <CheckCircle className="text-indigo-500" size={32} />
                                    </div>
                                    <h3 className="text-lg font-bold text-slate-800">Đã hoàn tất</h3>
                                    <p className="text-slate-500">Bạn không có công việc nào cần làm.</p>
                                </div>
                            ) : (
                                myTasks.map(task => (
                                    <div key={task.id} className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
                                        <div className="flex justify-between items-start mb-4">
                                            <div>
                                                <h4 className="text-lg font-bold text-slate-800">{task.task_name}</h4>
                                                {task.SupportAreas && (
                                                    <p className="text-sm text-indigo-600 flex items-center gap-1 mt-1 font-medium bg-indigo-50 px-2 py-1 rounded-lg w-fit">
                                                        <MapPin size={14} /> {task.SupportAreas.area_name}
                                                    </p>
                                                )}
                                                <p className="text-xs text-slate-400 mt-2">
                                                    Giao lúc: {new Date(task.created_at).toLocaleTimeString('vi-VN')}
                                                </p>
                                            </div>
                                        </div>
                                        
                                        <div className="flex gap-3">
                                            <button
                                                onClick={() => handleActionClick(task.id, 'TASK')}
                                                className="flex-1 py-3 bg-emerald-50 text-emerald-600 font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-emerald-100 transition-colors"
                                            >
                                                <Camera size={18} /> Chụp ảnh xong
                                            </button>
                                            <label className="flex-1 py-3 bg-slate-50 text-slate-600 font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-slate-100 transition-colors cursor-pointer border border-slate-200">
                                                <ImageIcon size={18} /> Upload
                                                <input 
                                                    type="file" 
                                                    accept="image/*" 
                                                    className="hidden" 
                                                    onChange={(e) => {
                                                        setSelectedItem({ id: task.id, type: 'TASK' });
                                                        handleUpload(e);
                                                    }} 
                                                />
                                            </label>
                                        </div>
                                    </div>
                                ))
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Camera Modal */}
                {isCameraOpen && (
                    <div className="fixed inset-0 bg-black z-[100] flex flex-col">
                        <div className="relative flex-1 bg-black flex items-center justify-center overflow-hidden">
                            <video 
                                ref={videoRef} 
                                autoPlay 
                                playsInline
                                muted
                                className="w-full h-full object-cover"
                            />
                            
                            {/* Controls Overlay */}
                            <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/60 to-transparent flex justify-between items-center z-10">
                                <button 
                                    onClick={closeCamera}
                                    className="p-2 text-white bg-black/40 rounded-full backdrop-blur hover:bg-black/60"
                                >
                                    <XCircle size={28} />
                                </button>
                                <button 
                                    onClick={toggleCamera}
                                    className="p-2 text-white bg-black/40 rounded-full backdrop-blur hover:bg-black/60"
                                >
                                    <SwitchCamera size={28} />
                                </button>
                            </div>

                            <div className="absolute bottom-10 left-0 right-0 flex justify-center z-10">
                                <button 
                                    onClick={capturePhoto}
                                    disabled={processingPhoto}
                                    className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center bg-transparent active:scale-95 transition-transform disabled:opacity-50"
                                >
                                    {processingPhoto ? (
                                        <Loader2 className="animate-spin text-white" size={32} />
                                    ) : (
                                        <div className="w-16 h-16 rounded-full bg-white transition-transform active:scale-90"></div>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </AppLayout>
    );
}

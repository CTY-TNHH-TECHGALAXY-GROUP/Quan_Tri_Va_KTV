'use client';

// 🔧 UI CONFIGURATION
const ANIMATION_DURATION = 0.25;

import React, { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase';
import { apiClient } from '@/lib/apiClient';
import { API } from '@/lib/api-endpoints';
import {
  ShieldAlert, Tablet, Trash2, Power, PowerOff,
  RefreshCw, AlertCircle, CheckCircle2, Plus, Wifi, X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Types from Supabase
interface RegisteredDevice {
  id: string;
  device_id: string;
  device_name: string;
  device_type: string;
  is_active: boolean;
  registered_at: string;
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

const DeviceManagementPage = () => {
  const { hasPermission } = useAuth();
  const [devices, setDevices] = useState<RegisteredDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [isUpdatingWifi, setIsUpdatingWifi] = useState(false);
  const [isWifiModalOpen, setIsWifiModalOpen] = useState(false);
  const [wifiData, setWifiData] = useState<{clientIp: string, currentIps: any[], lastRejected: any | null}>({ clientIp: '', currentIps: [], lastRejected: null });
  const [isFetchingWifi, setIsFetchingWifi] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // Fetch devices from Supabase
  const fetchDevices = async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('RegisteredDevices')
        .select('*')
        .order('registered_at', { ascending: false });

      if (error) throw error;
      setDevices(data || []);
    } catch (err) {
      console.error('Error fetching devices:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (mounted) fetchDevices();
  }, [mounted]);

  // Toggle device active status
  const toggleDevice = async (deviceId: string, currentStatus: boolean) => {
    try {
      const supabase = createClient();
      await supabase
        .from('RegisteredDevices')
        .update({ is_active: !currentStatus })
        .eq('id', deviceId);
      fetchDevices();
    } catch (err) {
      console.error('Error toggling device:', err);
    }
  };

  // Delete device
  const deleteDevice = async (deviceId: string) => {
    if (!confirm('Xóa thiết bị này? Tablet sẽ cần đăng ký lại.')) return;
    try {
      const supabase = createClient();
      await supabase
        .from('RegisteredDevices')
        .delete()
        .eq('id', deviceId);
      fetchDevices();
    } catch (err) {
      console.error('Error deleting device:', err);
    }
  };

  // Update Wifi IP Modal Actions
  const openWifiModal = async () => {
    setIsWifiModalOpen(true);
    setIsFetchingWifi(true);
    try {
      const data = await apiClient.get<any>(API.ADMIN.UPDATE_WIFI_IP);
      if (data.success) {
        setWifiData({ clientIp: data.clientIp, currentIps: data.currentIps, lastRejected: data.lastRejected });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsFetchingWifi(false);
    }
  };

  const updateWifiAction = async (action: 'overwrite' | 'append' | 'remove' | 'append_rejected', ipToRemove?: string, rejectedIp?: string) => {
    setIsUpdatingWifi(true);
    try {
      const data = await apiClient.post<any>(API.ADMIN.UPDATE_WIFI_IP, { action, ipToRemove, rejectedIp });
      if (data.success) {
        setWifiData(prev => ({ ...prev, currentIps: data.currentIps, lastRejected: action === 'append_rejected' ? null : prev.lastRejected }));
        if (action !== 'remove') {
          alert(`✅ Cập nhật thành công!`);
        }
      } else {
        alert(`❌ Lỗi: ${data.error}`);
      }
    } catch (err) {
      console.error(err);
      alert('Đã xảy ra lỗi khi gọi API.');
    } finally {
      setIsUpdatingWifi(false);
    }
  };

  if (!mounted) return null;

  if (!hasPermission('device_management')) {
    return (
      <AppLayout title="Thiết Bị">
        <div className="flex flex-col items-center justify-center h-64 text-center">
          <ShieldAlert size={48} className="text-red-500 mb-4" />
          <h2 className="text-xl font-bold text-gray-900">Không có quyền truy cập</h2>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Quản Lý Thiết Bị">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
              <Tablet size={24} className="text-indigo-600" />
              Quản Lý Thiết Bị Sảnh
            </h1>
            <p className="text-xs text-gray-500 mt-1">
              <span className="text-indigo-600 font-semibold">{devices.filter(d => d.is_active).length} thiết bị đang hoạt động</span>
              {' · '}
              <span className="text-gray-400">{devices.length} tổng</span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={openWifiModal}
              className="flex items-center gap-2 px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl text-sm font-bold transition-colors border border-blue-200 shadow-sm"
            >
              <Wifi size={14} className={isUpdatingWifi ? 'animate-pulse' : ''} />
              Cập nhật IP Wi-Fi
            </button>
            <button
              onClick={fetchDevices}
              disabled={loading}
              className="flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl text-sm font-bold text-gray-700 transition-colors"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Làm mới
            </button>
          </div>
        </div>

        {/* Info Banner */}
        <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4 mb-6">
          <p className="text-sm text-indigo-700 font-medium">
            📱 Để đăng ký Tablet mới, mở <code className="bg-indigo-100 px-1.5 py-0.5 rounded text-xs font-bold">nganha.vercel.app/register-device</code> trên thiết bị cần đăng ký.
          </p>
          <p className="text-xs text-indigo-500 mt-1">Mã PIN: <strong>8899</strong></p>
        </div>

        {/* Devices Table */}
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <RefreshCw size={24} className="animate-spin text-indigo-400" />
          </div>
        ) : devices.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
            <Tablet size={32} className="text-gray-300 mb-3" />
            <p className="text-sm font-bold text-gray-400">Chưa có thiết bị nào được đăng ký</p>
            <p className="text-xs text-gray-400 mt-1">Mở link đăng ký trên Tablet để bắt đầu</p>
          </div>
        ) : (
          <div className="space-y-3">
            <AnimatePresence>
              {devices.map((device) => (
                <motion.div
                  key={device.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className={`bg-white rounded-2xl border-2 p-4 transition-all ${
                    device.is_active
                      ? 'border-white hover:border-indigo-100 shadow-sm hover:shadow-md'
                      : 'border-gray-100 bg-gray-50 opacity-60'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    {/* Device Info */}
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
                        device.is_active
                          ? 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-200'
                          : 'bg-gray-200 text-gray-400'
                      }`}>
                        <Tablet size={22} />
                      </div>
                      <div>
                        <p className="font-bold text-gray-900">{device.device_name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            device.is_active
                              ? 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                              : 'bg-gray-100 text-gray-400'
                          }`}>
                            {device.is_active ? '● Hoạt động' : '○ Tắt'}
                          </span>
                          <span className="text-[10px] text-gray-400">{device.device_type}</span>
                        </div>
                      </div>
                    </div>

                    {/* Meta + Actions */}
                    <div className="flex items-center gap-3">
                      <div className="text-right hidden sm:block">
                        <p className="text-[10px] text-gray-400 font-mono">{device.device_id.substring(0, 8)}...</p>
                        <p className="text-[10px] text-gray-400">
                          {new Date(device.registered_at).toLocaleDateString('vi-VN')}
                        </p>
                      </div>

                      {/* Toggle Active */}
                      <button
                        onClick={() => toggleDevice(device.id, device.is_active)}
                        className={`p-2 rounded-xl transition-colors ${
                          device.is_active
                            ? 'text-emerald-600 hover:bg-emerald-50'
                            : 'text-gray-400 hover:bg-gray-100'
                        }`}
                        title={device.is_active ? 'Tắt thiết bị' : 'Bật thiết bị'}
                      >
                        {device.is_active ? <Power size={18} /> : <PowerOff size={18} />}
                      </button>

                      {/* Delete */}
                      <button
                        onClick={() => deleteDevice(device.id)}
                        className="p-2 rounded-xl text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                        title="Xóa thiết bị"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}

        {/* Wifi IP Modal */}
        <AnimatePresence>
          {isWifiModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col"
              >
                <div className="p-4 border-b flex justify-between items-center bg-gray-50">
                  <h3 className="font-bold flex items-center gap-2"><Wifi size={18} className="text-blue-600"/> Quản lý Wi-Fi Điểm Danh</h3>
                  <button onClick={() => setIsWifiModalOpen(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                    <X size={20} />
                  </button>
                </div>
                <div className="p-4 flex-1 overflow-y-auto max-h-[60vh]">
                  {isFetchingWifi ? (
                    <div className="flex justify-center py-8"><RefreshCw className="animate-spin text-gray-400" /></div>
                  ) : (
                    <div className="space-y-4">
                      <div className="bg-blue-50 p-3 rounded-xl border border-blue-100 flex justify-between items-center">
                        <div>
                          <p className="text-xs text-blue-600 font-medium mb-1">IP mạng hiện tại của bạn:</p>
                          <p className="text-lg font-bold text-blue-800 font-mono">{wifiData.clientIp}</p>
                        </div>
                      </div>

                      {wifiData.lastRejected && (
                        <div className="bg-amber-50 p-3 rounded-xl border border-amber-200">
                          <p className="text-xs font-bold text-amber-700 mb-1 flex items-center gap-1"><AlertCircle size={14}/> Phát hiện IP vừa bị từ chối</p>
                          <p className="text-sm text-amber-800 mb-2">
                            Nhân viên <strong className="font-bold">{wifiData.lastRejected.name}</strong> vừa điểm danh thất bại bằng IP <code className="bg-amber-100 px-1 py-0.5 rounded font-bold font-mono">{wifiData.lastRejected.ip}</code> lúc {new Date(wifiData.lastRejected.time).toLocaleTimeString('vi-VN')}.
                          </p>
                          <button
                            onClick={() => updateWifiAction('append_rejected', undefined, wifiData.lastRejected.ip)}
                            disabled={isUpdatingWifi}
                            className="w-full py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg transition-colors shadow-sm"
                          >
                            + Thêm IP bị từ chối này vào danh sách
                          </button>
                        </div>
                      )}

                      <div>
                        <h4 className="text-sm font-bold text-gray-700 mb-2">Danh sách IP đang cho phép:</h4>
                        {wifiData.currentIps.length === 0 ? (
                          <p className="text-xs text-gray-500 italic">Chưa có IP nào.</p>
                        ) : (
                          <div className="space-y-2">
                            {wifiData.currentIps.map((item, idx) => (
                              <div key={idx} className="flex items-center justify-between bg-gray-50 p-2.5 rounded-lg border">
                                <div>
                                  <p className="font-mono text-sm font-bold text-gray-800">{item.ip}</p>
                                  <p className="text-[10px] text-gray-500">{new Date(item.addedAt).toLocaleString('vi-VN')}</p>
                                </div>
                                <button
                                  onClick={() => updateWifiAction('remove', item.ip)}
                                  disabled={isUpdatingWifi}
                                  className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                                  title="Xóa IP này"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <div className="p-4 border-t bg-gray-50 flex gap-2">
                   <button
                     onClick={() => updateWifiAction('append')}
                     disabled={isUpdatingWifi || isFetchingWifi}
                     className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl disabled:opacity-50 transition-colors shadow-sm"
                   >
                     + Thêm IP hiện tại
                   </button>
                   <button
                     onClick={() => {
                       if(confirm('Điều này sẽ xóa hết các IP cũ. Bạn có chắc không?')) updateWifiAction('overwrite');
                     }}
                     disabled={isUpdatingWifi || isFetchingWifi}
                     className="flex-1 py-2.5 bg-white hover:bg-red-50 text-red-600 text-sm font-bold rounded-xl border border-red-200 disabled:opacity-50 transition-colors"
                   >
                     Ghi đè bằng IP hiện tại
                   </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </AppLayout>
  );
};

export default DeviceManagementPage;

'use client';

import React, { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/lib/auth-context';
import { ShieldAlert, Plus, Edit2, Trash2, Image as ImageIcon, Star, TrendingUp } from 'lucide-react';
import { getServices } from './actions';

import { Service } from '@/lib/types';

import { EditServiceDrawer } from './EditServiceDrawer';

export default function ServiceMenuPage() {
  const { hasPermission } = useAuth();
  const [activeCategory, setActiveCategory] = useState('Tất cả');
  const [mounted, setMounted] = useState(false);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Drawer states
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [selectedService, setSelectedService] = useState<Service | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await getServices();
      if (res.success && res.data) {
        setServices(res.data as Service[]);
      } else {
        console.error('❌ [ServiceMenu] Error fetching services:', res.error);
      }
    } catch (error) {
      console.error('❌ [ServiceMenu] Unexpected error:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setMounted(true);
    fetchData();
  }, []);

  const handleEditClick = (service: Service) => {
    setSelectedService(service);
    setIsDrawerOpen(true);
  };

  const handleDrawerClose = () => {
    setIsDrawerOpen(false);
    setTimeout(() => setSelectedService(null), 300); // clear after animation
  };

  if (!mounted) return null;

  if (!hasPermission('service_menu')) {
    return (
      <AppLayout title="Menu Dịch Vụ">
        <div className="flex flex-col items-center justify-center h-64 text-center">
          <ShieldAlert size={48} className="text-red-500 mb-4" />
          <h2 className="text-xl font-bold text-gray-900">Không có quyền truy cập</h2>
        </div>
      </AppLayout>
    );
  }

  const categories = ['Tất cả', ...Array.from(new Set(services.map(s => s.category).filter(Boolean)))];
  
  const filteredServices = activeCategory === 'Tất cả' 
    ? services 
    : services.filter(s => s.category === activeCategory);

  return (
    <AppLayout title="Menu Dịch Vụ">
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-sm text-gray-500">Thiết lập danh sách dịch vụ, giá tiền và thời lượng.</p>
          </div>
          <button className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium text-sm transition-colors">
            <Plus size={16} />
            Thêm Dịch Vụ Mới
          </button>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-2">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                activeCategory === cat 
                  ? 'bg-indigo-600 text-white' 
                  : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr>
                  <th className="p-4 border-b border-gray-200 bg-gray-50 font-semibold text-gray-700 text-sm w-16">Ảnh</th>
                  <th className="p-4 border-b border-gray-200 bg-gray-50 font-semibold text-gray-700 text-sm">Tên Dịch Vụ</th>
                  <th className="p-4 border-b border-gray-200 bg-gray-50 font-semibold text-gray-700 text-sm">Danh Mục</th>
                  <th className="p-4 border-b border-gray-200 bg-gray-50 font-semibold text-gray-700 text-sm text-right">Giá Tiền</th>
                  <th className="p-4 border-b border-gray-200 bg-gray-50 font-semibold text-gray-700 text-sm text-center">Thời Lượng</th>
                  <th className="p-4 border-b border-gray-200 bg-gray-50 font-semibold text-gray-700 text-sm text-center">Trạng Thái</th>
                  <th className="p-4 border-b border-gray-200 bg-gray-50 font-semibold text-gray-700 text-sm w-24"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="p-12 text-center text-gray-400 font-medium">Đang tải dữ liệu...</td>
                  </tr>
                ) : filteredServices.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-12 text-center text-gray-400 font-medium">Không tìm thấy dịch vụ nào.</td>
                  </tr>
                ) : (
                  filteredServices.map(service => (
                    <tr key={service.id} className="hover:bg-gray-50 transition-colors">
                      <td className="p-4">
                        <div className="w-12 h-12 bg-gray-100 rounded-lg overflow-hidden flex items-center justify-center text-gray-400 border border-gray-100">
                          {(service.imageUrl || service.image_url) ? (
                            <img src={service.imageUrl || service.image_url} alt={service.nameVN || service.name} className="w-full h-full object-cover" />
                          ) : (
                            <ImageIcon size={20} />
                          )}
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex flex-col gap-1">
                          <span className="font-medium text-gray-900">{service.nameVN || service.name}</span>
                          <div className="flex flex-wrap gap-1">
                            {service.isBestSeller && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[10px] font-bold border border-amber-100">
                                <TrendingUp size={10} /> Bán chạy
                              </span>
                            )}
                            {service.isBestChoice && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[10px] font-bold border border-indigo-100">
                                <Star size={10} /> Ưu tiên
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="p-4 text-gray-600 text-sm">{service.category}</td>
                      <td className="p-4 text-right font-medium text-indigo-600">
                        {(service.priceVND || service.price || 0).toLocaleString()}đ
                      </td>
                      <td className="p-4 text-center text-gray-600 text-sm">
                        {service.duration} phút
                      </td>
                      <td className="p-4 text-center">
                        <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${
                          (service.isActive !== false) ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'
                        }`}>
                          {(service.isActive !== false) ? 'Đang bán' : 'Tạm ngưng'}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center justify-end gap-2">
                          <button 
                            onClick={() => handleEditClick(service)}
                            className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
                          >
                            <Edit2 size={16} />
                          </button>
                          <button className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <EditServiceDrawer 
        isOpen={isDrawerOpen}
        onClose={handleDrawerClose}
        service={selectedService}
        onSuccess={() => {
          fetchData(); // reload on success
        }}
      />
    </AppLayout>
  );
}

'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, User, Phone, Sparkles, Loader2, Plus, Search, Clock, Tag, Image as ImageIcon, Globe, Users, Flag } from 'lucide-react';
import { searchCustomers } from '../actions';

interface ServiceOption {
  id: string;
  nameVN: string;
  nameEN?: string;
  name?: string;
  price?: number;
  priceVND?: number;
  duration: number;
  category?: string;
  image_url?: string;
  imageUrl?: string;
}

interface AddOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  services: ServiceOption[];
  onConfirm: (data: { customerName: string; customerPhone: string; customerEmail: string; serviceIds: string[]; customerLang: string; guestCount?: number; nationality?: string; }) => Promise<void>;
  selectedDate: string;
}

// 🌐 LANGUAGE OPTIONS
const LANG_OPTIONS = [
  { code: 'vi', label: 'Tiếng Việt', flag: '🇻🇳' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'kr', label: '한국어', flag: '🇰🇷' },
  { code: 'jp', label: '日本語', flag: '🇯🇵' },
  { code: 'cn', label: '中文', flag: '🇨🇳' },
];

const NATIONALITY_OPTIONS = [
  'Việt Nam', 'Hàn Quốc', 'Nhật Bản', 'Trung Quốc', 'Đài Loan', 'Mỹ', 'Khác'
];

// 🔧 UI CONFIGURATION
const ANIMATION_DURATION = 0.3;

export const AddOrderModal = ({ isOpen, onClose, services, onConfirm, selectedDate }: AddOrderModalProps) => {
  const [customerName, setCustomerName] = useState('');
  const [contactType, setContactType] = useState<'phone' | 'email'>('phone');
  const [contactValue, setContactValue] = useState('');
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [customerLang, setCustomerLang] = useState('vi');
  const [guestCount, setGuestCount] = useState<number>(1);
  const [nationality, setNationality] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState('Tất cả');

  // Autocomplete states
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    if (showSuggestions) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showSuggestions]);

  // Debounce search
  useEffect(() => {
    // Chỉ search nếu đang mở dropdown và có text
    const query = customerName;
    if (!query || query.length < 2) {
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      const res = await searchCustomers(query);
      if (res?.success && res.data) {
        setSuggestions(res.data);
      } else {
        setSuggestions([]);
      }
      setIsSearching(false);
    }, 300);

    return () => clearTimeout(timer);
  }, [customerName]);

  const handleSelectCustomer = (customer: any) => {
    setCustomerName(customer.fullName || '');
    if (customer.phone) {
      setContactType('phone');
      setContactValue(customer.phone);
    } else if (customer.email) {
      setContactType('email');
      setContactValue(customer.email);
    }
    setShowSuggestions(false);
  };

  const categories = useMemo(() => {
    const cats = ['Tất cả', ...Array.from(new Set(services.map(s => s.category).filter(Boolean)))];
    return cats as string[];
  }, [services]);

  const filteredServices = useMemo(() => {
    return services.filter(s => {
      const searchStr = searchTerm.toLowerCase();
      const matchesSearch = 
        (s.nameVN || '').toLowerCase().includes(searchStr) ||
        (s.nameEN || '').toLowerCase().includes(searchStr) ||
        (s.name || '').toLowerCase().includes(searchStr);
      
      const matchesCategory = activeCategory === 'Tất cả' || s.category === activeCategory;
      return matchesSearch && matchesCategory;
    });
  }, [services, searchTerm, activeCategory]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName || serviceIds.length === 0) {
      alert('Vui lòng nhập tên khách và chọn dịch vụ!');
      return;
    }

    setLoading(true);
    try {
      await onConfirm({
        customerName,
        customerPhone: contactType === 'phone' ? contactValue : '',
        customerEmail: contactType === 'email' ? contactValue : '',
        serviceIds,
        customerLang,
        guestCount,
        nationality
      });
      // Reset form
      setCustomerName('');
      setContactType('phone');
      setContactValue('');
      setServiceIds([]);
      setCustomerLang('vi');
      setGuestCount(1);
      setNationality('');
      setSearchTerm('');
      onClose();
    } catch (err) {
      console.error('Lỗi khi lưu đơn:', err);
    } finally {
      setLoading(false);
    }
  };

  const selectedServices = services.filter(s => serviceIds.includes(s.id));

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm overflow-hidden">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: ANIMATION_DURATION, ease: 'easeOut' }}
            className="bg-white w-full max-w-4xl max-h-[95vh] rounded-[32px] shadow-2xl overflow-hidden border border-gray-100 flex flex-col"
          >
            {/* Header */}
            <div className="bg-gradient-to-r from-rose-500 to-rose-600 px-8 py-6 flex items-center justify-between text-white shrink-0">
              <div className="flex items-center gap-4">
                <div className="bg-white/20 p-3 rounded-2xl backdrop-blur-md shadow-inner">
                  <Sparkles size={24} className="text-white" />
                </div>
                <div>
                  <h3 className="font-black text-xl leading-tight uppercase tracking-tight">Tạo Đơn Nhanh</h3>
                  <p className="text-white/70 text-[10px] font-bold uppercase tracking-widest mt-0.5">{selectedDate}</p>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="p-2.5 hover:bg-white/10 rounded-full transition-colors text-white/80 hover:text-white"
              >
                <X size={24} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex-1 overflow-hidden flex flex-col p-8 gap-5">
              {/* Row 1: Customer Name */}
              <div className="space-y-1.5 shrink-0" ref={dropdownRef}>
                <label className="text-[11px] font-black text-gray-400 uppercase tracking-wider ml-1">Tên khách hàng *</label>
                <div className="relative">
                  <User size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    autoFocus
                    type="text"
                    value={customerName}
                    onChange={(e) => {
                      setCustomerName(e.target.value);
                      setShowSuggestions(true);
                    }}
                    onFocus={() => {
                      if (customerName.length >= 2) setShowSuggestions(true);
                    }}
                    placeholder="Nhập tên khách..."
                    className="w-full pl-11 pr-10 py-3.5 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all outline-none font-bold text-gray-700 placeholder:text-gray-300"
                    required
                  />
                  {isSearching && (
                    <div className="absolute right-4 top-1/2 -translate-y-1/2">
                      <Loader2 size={16} className="text-gray-400 animate-spin" />
                    </div>
                  )}

                  <AnimatePresence>
                    {showSuggestions && suggestions.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: -5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -5 }}
                        className="absolute z-10 w-full mt-2 bg-white border border-gray-100 rounded-2xl shadow-xl overflow-hidden"
                      >
                        <div className="max-h-48 overflow-y-auto p-1 custom-scrollbar">
                          {suggestions.map((cust) => (
                            <button
                              key={cust.id}
                              type="button"
                              onClick={() => handleSelectCustomer(cust)}
                              className="w-full text-left px-4 py-2.5 rounded-xl hover:bg-rose-50 transition-colors flex flex-col gap-0.5"
                            >
                              <span className="text-sm font-bold text-gray-900">{cust.fullName}</span>
                              <div className="flex items-center gap-3 text-[11px] font-medium text-gray-500">
                                {cust.phone && <span className="flex items-center gap-1"><Phone size={10} /> {cust.phone}</span>}
                                {cust.email && <span className="flex items-center gap-1"><Tag size={10} /> {cust.email}</span>}
                              </div>
                            </button>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {/* Row 2: Language + Contact side by side */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 shrink-0">
                {/* Language Selector */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-black text-gray-400 uppercase tracking-wider ml-1 flex items-center gap-1.5">
                    <Globe size={11} /> Ngôn ngữ
                  </label>
                  <div className="flex gap-1.5">
                    {LANG_OPTIONS.map(opt => (
                      <button
                        key={opt.code}
                        type="button"
                        onClick={() => setCustomerLang(opt.code)}
                        className={`flex-1 py-2.5 rounded-xl text-center transition-all border-2 flex flex-col items-center justify-center gap-0.5 ${
                          customerLang === opt.code
                            ? 'bg-rose-50 border-rose-500 shadow-sm'
                            : 'bg-gray-50 border-transparent hover:border-gray-200'
                        }`}
                        title={opt.label}
                      >
                        <span className="text-base leading-none">{opt.flag}</span>
                        <span className={`text-[9px] font-black uppercase ${
                          customerLang === opt.code ? 'text-rose-600' : 'text-gray-400'
                        }`}>{opt.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Contact: Phone / Email Toggle + Shared Input */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-black text-gray-400 uppercase tracking-wider ml-1 flex items-center gap-1.5">
                    Liên hệ
                  </label>
                  {/* Toggle Buttons */}
                  <div className="flex gap-2 mb-1.5">
                    <button
                      type="button"
                      onClick={() => { setContactType('phone'); setContactValue(''); }}
                      className={`flex-1 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all border-2 ${
                        contactType === 'phone'
                          ? 'bg-gray-900 text-white border-gray-900 shadow-lg shadow-gray-200'
                          : 'bg-gray-50 text-gray-400 border-gray-100 hover:border-gray-300'
                      }`}
                    >
                      {contactType === 'phone' && <Phone size={14} />}
                      Phone
                    </button>
                    <button
                      type="button"
                      onClick={() => { setContactType('email'); setContactValue(''); }}
                      className={`flex-1 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all border-2 ${
                        contactType === 'email'
                          ? 'bg-gray-900 text-white border-gray-900 shadow-lg shadow-gray-200'
                          : 'bg-gray-50 text-gray-400 border-gray-100 hover:border-gray-300'
                      }`}
                    >
                      {contactType === 'email' && <Tag size={14} />}
                      Email
                    </button>
                  </div>
                  {/* Shared Input */}
                  <div className="relative">
                    {contactType === 'phone'
                      ? <Phone size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" />
                      : <Tag size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" />
                    }
                    <input
                      type={contactType === 'phone' ? 'tel' : 'email'}
                      value={contactValue}
                      onChange={(e) => setContactValue(e.target.value)}
                      placeholder={contactType === 'phone' ? '+84 123 456 789' : 'abc@gmail.com'}
                      className="w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all outline-none font-bold text-gray-700 placeholder:text-gray-300 text-sm"
                    />
                  </div>
                </div>
              </div>

              {/* Row 3: Nationality & Guest Count side by side */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 shrink-0">
                <div className="space-y-1.5 relative">
                  <label className="text-[11px] font-black text-gray-400 uppercase tracking-wider ml-1 flex items-center gap-1.5">
                    <Flag size={11} /> Quốc tịch
                  </label>
                  <input
                    type="text"
                    list="nationality_list"
                    value={nationality}
                    onChange={(e) => setNationality(e.target.value)}
                    placeholder="VD: Việt Nam, Hàn Quốc..."
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all outline-none font-bold text-gray-700 placeholder:text-gray-300 text-sm"
                  />
                  <datalist id="nationality_list">
                    {NATIONALITY_OPTIONS.map((nat) => (
                      <option key={nat} value={nat} />
                    ))}
                  </datalist>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-black text-gray-400 uppercase tracking-wider ml-1 flex items-center gap-1.5">
                    <Users size={11} /> Số lượng khách
                  </label>
                  <div className="flex gap-2">
                    <select
                      value={guestCount > 5 ? 'other' : guestCount.toString()}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === 'other') {
                          setGuestCount(6);
                        } else {
                          setGuestCount(parseInt(val, 10));
                        }
                      }}
                      className="flex-1 px-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all outline-none font-bold text-gray-700 text-sm"
                    >
                      <option value="1">1 (Khách lẻ)</option>
                      <option value="2">2 người</option>
                      <option value="3">3 người</option>
                      <option value="4">4 người</option>
                      <option value="5">5 người</option>
                      <option value="other">Nhập số khác...</option>
                    </select>
                    {guestCount > 5 && (
                      <input
                        type="number"
                        min={1}
                        value={guestCount}
                        onChange={(e) => setGuestCount(parseInt(e.target.value || '1', 10))}
                        className="w-20 px-2 py-3 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all outline-none font-bold text-gray-700 text-sm text-center"
                      />
                    )}
                  </div>
                </div>
              </div>

              {/* Service Selection Board */}
              <div className="flex-1 min-h-0 flex flex-col border border-gray-100 rounded-[24px] bg-gray-50/30 overflow-hidden">
                <div className="p-4 bg-white border-b border-gray-100 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-black text-gray-400 uppercase tracking-wider ml-1 flex items-center gap-2">
                       <Tag size={12} className="text-rose-500" /> Chọn Dịch Vụ {serviceIds.length > 0 && <span className="text-emerald-500 lowercase">(đã chọn: {selectedServices.map(s => s.nameVN).join(', ')})</span>}
                    </label>
                  </div>
                  
                  {/* Search & Filter */}
                  <div className="flex flex-col gap-3">
                    <div className="relative w-full">
                      <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input 
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Tìm kiếm dịch vụ..."
                        className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-100 transition-all"
                      />
                    </div>
                    <div className="flex gap-1 overflow-x-auto no-scrollbar pb-1 sm:pb-0">
                      {categories.map(cat => (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setActiveCategory(cat)}
                          className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase whitespace-nowrap transition-all border ${
                            activeCategory === cat 
                              ? 'bg-rose-500 text-white border-rose-500 shadow-lg shadow-rose-100' 
                              : 'bg-white text-gray-400 border-gray-100 hover:border-gray-300'
                          }`}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Service List */}
                <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {filteredServices.length > 0 ? (
                      filteredServices.map(svc => (
                        <button
                          key={svc.id}
                          type="button"
                          onClick={() => {
                            setServiceIds(prev => 
                              prev.includes(svc.id) ? prev.filter(id => id !== svc.id) : [...prev, svc.id]
                            );
                          }}
                          className={`flex items-center gap-3 p-3 rounded-[20px] text-left transition-all border-2 group relative overflow-hidden ${
                            serviceIds.includes(svc.id) 
                              ? 'bg-rose-50 border-rose-500' 
                              : 'bg-white border-transparent hover:border-gray-100'
                          }`}
                        >
                          {/* Image Placeholder or Image */}
                          <div className={`w-14 h-14 rounded-2xl shrink-0 flex items-center justify-center overflow-hidden border ${serviceIds.includes(svc.id) ? 'border-rose-200' : 'border-gray-100'}`}>
                            {(svc.image_url || svc.imageUrl) ? (
                              <img src={svc.image_url || svc.imageUrl} alt={svc.nameVN} className="w-full h-full object-cover" />
                            ) : (
                              <div className={`w-full h-full flex items-center justify-center ${serviceIds.includes(svc.id) ? 'bg-rose-100 text-rose-500' : 'bg-gray-50 text-gray-300'}`}>
                                <ImageIcon size={20} />
                              </div>
                            )}
                          </div>
                          
                          <div className="flex-1 min-w-0">
                            <h4 className={`text-sm font-black truncate ${serviceIds.includes(svc.id) ? 'text-rose-700' : 'text-gray-900 group-hover:text-rose-500 transition-colors'}`}>
                              {svc.nameVN || svc.nameEN || svc.name}
                            </h4>
                            <div className="flex items-center gap-3 mt-1 text-[11px] font-black uppercase tracking-tight">
                              <span className="text-rose-500">{(svc.priceVND || svc.price || 0).toLocaleString()}đ</span>
                              <span className="text-gray-300 flex items-center gap-1">
                                <Clock size={10} /> {svc.duration}p
                              </span>
                            </div>
                            {svc.category && (
                              <div className="mt-1.5">
                                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${serviceIds.includes(svc.id) ? 'bg-rose-100 text-rose-600' : 'bg-gray-100 text-gray-400'}`}>
                                  {svc.category}
                                </span>
                              </div>
                            )}
                          </div>

                          {serviceIds.includes(svc.id) && (
                            <div className="absolute top-1 right-1">
                              <Plus size={14} className="text-rose-500 rotate-45" />
                            </div>
                          )}
                        </button>
                      ))
                    ) : (
                      <div className="col-span-full py-12 text-center">
                        <p className="text-sm font-bold text-gray-400">Không tìm thấy dịch vụ phù hợp</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Submit Button */}
              <div className="shrink-0">
                <button
                  disabled={loading || serviceIds.length === 0 || !customerName}
                  type="submit"
                  className="w-full bg-gray-900 hover:bg-black text-white py-4.5 rounded-[24px] font-black text-sm uppercase tracking-[0.2em] shadow-2xl shadow-gray-200 active:scale-[0.98] transition-all flex items-center justify-center gap-3 disabled:opacity-30 disabled:grayscale"
                >
                  {loading ? (
                    <Loader2 size={24} className="animate-spin" />
                  ) : (
                    <>
                      <Sparkles size={20} className="text-rose-400" />
                      Tạo Đơn Ngay
                    </>
                  )}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

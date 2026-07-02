'use client';

import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/lib/supabase';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, parseISO, differenceInMinutes } from 'date-fns';

const supabase = createClient();

// 🔧 SHIFT CONFIGURATION
const SHIFT_START_TIMES: Record<string, string> = {
  'SHIFT_1': '09:00',
  'SHIFT_2': '11:00',
  'SHIFT_3': '17:00',
  'FREE': '09:00',
  'REQUEST': '09:00',
};

export interface AttendanceRecord {
  date: string;
  employeeId: string;
  employeeName: string;
  shiftType: string;
  checkIn: string | null;
  checkOut: string | null;
  lateMins: number;
  status: 'present' | 'late' | 'off' | 'suddenOff' | 'absent' | 'free' | 'request';
}

export const usePayrollLogic = () => {
  const [selectedMonth, setSelectedMonth] = useState(new Date());
  const [dateRange, setDateRange] = useState<{ start: string; end: string } | null>(() => {
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    return { start: todayStr, end: todayStr };
  });
  const [selectedStaffId, setSelectedStaffId] = useState<string>('ALL');

  useEffect(() => {
    if (selectedStaffId === 'ALL') {
      const todayStr = format(new Date(), 'yyyy-MM-dd');
      setDateRange({ start: todayStr, end: todayStr });
    } else {
      setDateRange(null);
    }
  }, [selectedStaffId]);
  const [staffList, setStaffList] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [shifts, setShifts] = useState<any[]>([]);
  const [leaves, setLeaves] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const monthStr = format(selectedMonth, 'yyyy-MM');
  const startDate = startOfMonth(selectedMonth);
  const endDate = endOfMonth(selectedMonth);

  const fetchData = async () => {
    setLoading(true);
    try {
      const startDateISO = format(startDate, 'yyyy-MM-dd');
      const endDateISO = format(endDate, 'yyyy-MM-dd');

      const [staffRes, attRes, payrollDataRes, usersRes] = await Promise.all([
        supabase.from('Staff').select('id, full_name').eq('status', 'ĐANG LÀM'),
        supabase.from('KTVAttendance')
          .select('id, employeeId, date, checkType, status, checkedAt')
          .gte('date', startDateISO)
          .lte('date', endDateISO)
          .eq('status', 'CONFIRMED'),
        fetch(`/api/finance/payroll/shifts?dateFrom=${startDateISO}&dateTo=${endDateISO}`).then(r => r.json()).catch(() => ({ data: { shifts: [], leaves: [] } })),
        supabase.from('Users').select('id, code'),
      ]);

      if (staffRes.data) setStaffList(staffRes.data);
      
      // Chuyển đổi KTVAttendance (event-based) → daily summary
      // Gom CHECK_IN + CHECK_OUT cùng ngày/KTV thành 1 record
      if (attRes.data) {
        const dailyMap = new Map<string, { employee_id: string; date: string; check_in_time: string | null; check_out_time: string | null; status: string }>();
        const userMap = new Map((usersRes.data || []).map((u: any) => [u.id, u.code]));
        
        for (const record of attRes.data) {
          // Map UUID -> Mã NV (NH0xx). Nếu không có, dùng nguyên UUID.
          const staffCode = userMap.get(record.employeeId) || record.employeeId;
          // Lấy date từ record.date, nếu null thì extract từ checkedAt (lỗi CSDL cũ thiếu date)
          let recordDate = record.date;
          if (!recordDate && record.checkedAt) {
            // Chuyển checkedAt sang giờ local VN (hoặc cắt chuỗi)
            recordDate = format(new Date(record.checkedAt), 'yyyy-MM-dd');
          }
          if (!recordDate) continue; // Bỏ qua nếu không có cả date và checkedAt

          const key = `${staffCode}_${recordDate}`;

          if (!dailyMap.has(key)) {
            dailyMap.set(key, {
              employee_id: staffCode,
              date: recordDate,
              check_in_time: null,
              check_out_time: null,
              status: 'on_duty'
            });
          }
          const entry = dailyMap.get(key)!;
          
          if (record.checkType === 'CHECK_IN' || record.checkType === 'LATE_CHECKIN') {
            if (record.checkedAt) {
              const d = new Date(record.checkedAt);
              entry.check_in_time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            }
            if (record.checkType === 'LATE_CHECKIN') {
              entry.status = 'on_duty'; // Vẫn tính có mặt, lateMins sẽ tính riêng
            }
          } else if (record.checkType === 'CHECK_OUT') {
            if (record.checkedAt) {
              const raw = record.checkedAt;
              const d = new Date(raw);
              entry.check_out_time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
              entry.status = 'off_duty';
            }
          }
        }
        
        setAttendance(Array.from(dailyMap.values()));
      }
      
      if (payrollDataRes.data) {
        setShifts(payrollDataRes.data.shifts || []);
        setLeaves(payrollDataRes.data.leaves || []);
      }
    } catch (error) {
      console.error('Error fetching payroll data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedMonth]);

  const processedData = useMemo(() => {
    const days = eachDayOfInterval({ start: startDate, end: endDate });
    const records: AttendanceRecord[] = [];

    staffList.forEach(staff => {
      // Find all shifts for this staff (already sorted by effectiveFrom asc)
      const staffShifts = shifts.filter(s => s.employeeId === staff.id);

      days.forEach(day => {
        const dateStr = format(day, 'yyyy-MM-dd');
        const dayLeave = leaves.find(l => l.employeeId === staff.id && l.date === dateStr);

        // Bỏ qua các ngày tương lai, TRỪ KHI ngày đó đã được đăng ký nghỉ phép
        if (day > new Date() && !dayLeave) {
          return;
        }
        
        // Find the active shift for THIS day
        let shiftType = 'SHIFT_1'; // Default
        for (const s of staffShifts) {
            const effDate = s.effectiveFrom ? s.effectiveFrom.slice(0, 10) : '';
            if (effDate && effDate <= dateStr) {
                shiftType = s.shiftType;
            }
        }
        
        // Find leave (đã được tìm ở trên để check tương lai)
        
        // Find attendance
        const dayAtt = attendance.find(a => a.employee_id === staff.id && a.date === dateStr);

        let status: AttendanceRecord['status'] = 'absent';
        let lateMins = 0;

        const now = new Date();
        const todayAtZero = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        
        let isPastGracePeriod = false;
        
        if (day < todayAtZero) {
            isPastGracePeriod = true;
        } else if (day.getTime() === todayAtZero.getTime()) {
            const shiftStartTime = SHIFT_START_TIMES[shiftType];
            if (shiftStartTime) {
                const [sh, sm] = shiftStartTime.split(':').map(Number);
                const cutoffTimeInMins = sh * 60 + sm + 45; // 45 mins grace period before marking as sudden off
                const nowInMins = now.getHours() * 60 + now.getMinutes();
                if (nowInMins >= cutoffTimeInMins) {
                    isPastGracePeriod = true;
                }
            }
        }

        if (dayLeave) {
          if (dayLeave.reason === 'OVERRIDE:FREE') {
            status = 'free';
            shiftType = 'FREE';
          } else if (dayLeave.reason === 'OVERRIDE:REQUEST') {
            status = 'request';
            shiftType = 'REQUEST';
          } else {
            // Bất kể có đi làm hay không, có đơn xin nghỉ là tính OFF
            status = dayLeave.is_sudden_off ? 'suddenOff' : 'off';
          }
        } else if (dayAtt && (dayAtt.check_in_time || dayAtt.check_out_time)) {
          // They came to work!
          if (dayAtt.status === 'on_duty' || dayAtt.status === 'off_duty') {
            const isFlexibleShift = shiftType === 'FREE' || shiftType === 'REQUEST';
            
            if (isFlexibleShift) {
                status = shiftType === 'FREE' ? 'free' : 'request' as any; // Show explicitly as Tự do / Yêu cầu
            } else {
                status = 'present';
                // Calculate late mins based on check_in_time
                const shiftStartTime = SHIFT_START_TIMES[shiftType];
                if (shiftStartTime && dayAtt.check_in_time) {
                  const [sh, sm] = shiftStartTime.split(':').map(Number);
                  const [ah, am] = dayAtt.check_in_time.split(':').map(Number);
                  
                  const scheduledTotal = sh * 60 + sm;
                  const actualTotal = ah * 60 + am;

                  if (actualTotal > scheduledTotal) {
                    lateMins = actualTotal - scheduledTotal;
                    if (lateMins > 0) status = 'late';
                  }
                }
            }
          } else if (dayAtt.status === 'off_leave') {
            status = 'off';
          } else if (dayAtt.status === 'absent') {
            status = 'absent';
          }
        } else {
          // No attendance and no leave request
          const isFlexibleShift = shiftType === 'FREE' || shiftType === 'REQUEST';
          if (isPastGracePeriod && !isFlexibleShift) {
              status = 'suddenOff';
          } else {
              status = 'absent';
          }
        }

        records.push({
          date: dateStr,
          employeeId: staff.id,
          employeeName: staff.full_name,
          shiftType: shiftType,
          checkIn: (status === 'free' || status === 'request') ? (dayAtt?.check_in_time || '--:--') : (dayAtt?.check_in_time || null),
          checkOut: (status === 'free' || status === 'request') ? (dayAtt?.check_out_time || '--:--') : (dayAtt?.check_out_time || null),
          lateMins,
          status
        });
      });
    });

    let filteredRecords = records;
    if (dateRange && dateRange.start && dateRange.end) {
        filteredRecords = filteredRecords.filter(r => r.date >= dateRange.start && r.date <= dateRange.end);
    }
    if (selectedStaffId && selectedStaffId !== 'ALL') {
        filteredRecords = filteredRecords.filter(r => r.employeeId === selectedStaffId);
    }

    return filteredRecords;
  }, [staffList, attendance, shifts, leaves, startDate, endDate, dateRange, selectedStaffId]);

  const summary = useMemo(() => {
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const totalSuddenOff = processedData.filter(r => r.status === 'suddenOff').length;
    const totalLeave = processedData.filter(r => r.status === 'off').length;

    let baseDays = 30;
    if (startDate) {
        const month = startDate.getMonth(); // 0-11
        if (month === 1) { // Feb
            const year = startDate.getFullYear();
            const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
            baseDays = isLeap ? 29 : 28;
        }
    }

    return {
      totalDays: baseDays - totalLeave - totalSuddenOff,
      totalWorkingStaff: processedData.filter(r => r.checkIn).length,
      totalLate: processedData.filter(r => r.status === 'late').length,
      totalSuddenOff,
      totalLeave,
      freeShifts: processedData.filter(r => r.shiftType === 'FREE' && r.checkIn).length,
      requestShifts: processedData.filter(r => r.shiftType === 'REQUEST' && r.checkIn).length,
      forgotCheckOut: processedData.filter(r => r.checkIn && !r.checkOut && r.date < todayStr).length
    };
  }, [processedData, startDate]);

  const [activeCardFilter, setActiveCardFilter] = useState<string | null>(null);

  useEffect(() => {
    setActiveCardFilter(null);
  }, [selectedStaffId, selectedMonth, dateRange]);

  const displayData = useMemo(() => {
    if (!activeCardFilter) return processedData;
    const todayStr = format(new Date(), 'yyyy-MM-dd');

    return processedData.filter(r => {
      switch (activeCardFilter) {
        case 'working': return selectedStaffId === 'ALL' ? !!r.checkIn : (r.status !== 'off' && r.status !== 'suddenOff');
        case 'late': return r.status === 'late';
        case 'suddenOff': return r.status === 'suddenOff';
        case 'off': return r.status === 'off';
        case 'free': return r.shiftType === 'FREE' && r.checkIn;
        case 'request': return r.shiftType === 'REQUEST' && r.checkIn;
        case 'forgotCheckOut': return r.checkIn && !r.checkOut && r.date < todayStr;
        default: return true;
      }
    });
  }, [processedData, activeCardFilter, selectedStaffId]);

  const handleOverrideAttendance = async (employeeId: string, employeeName: string, date: string, newStatus: string) => {
    try {
      const res = await fetch('/api/finance/payroll/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId,
          employeeName,
          date,
          newStatus
        })
      });
      const data = await res.json();
      if (data.success) {
        fetchData(); // reload
        return true;
      } else {
        alert(data.error || 'Có lỗi xảy ra');
        return false;
      }
    } catch (err) {
      console.error(err);
      alert('Lỗi kết nối máy chủ');
      return false;
    }
  };

  return {
    selectedMonth,
    setSelectedMonth,
    dateRange,
    setDateRange,
    selectedStaffId,
    setSelectedStaffId,
    staffList,
    processedData,
    displayData,
    summary,
    loading,
    refresh: fetchData,
    activeCardFilter,
    setActiveCardFilter,
    handleOverrideAttendance
  };
};

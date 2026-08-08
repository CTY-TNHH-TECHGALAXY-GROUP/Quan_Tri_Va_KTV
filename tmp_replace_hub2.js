const fs = require('fs');
const path = 'app/reception/ktv-hub/page.tsx';
let content = fs.readFileSync(path, 'utf8');

const lines = content.split('\n');

let startIndex = -1;
let endIndex = -1;

for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('const LeaveOffTab = () => {')) {
        startIndex = i;
    }
    if (startIndex !== -1 && i > startIndex && lines[i].includes('{/* ── SHIFT SUB-TAB ── */}')) {
        endIndex = i;
        break;
    }
}

if (startIndex !== -1 && endIndex !== -1) {
    console.log('Found startIndex:', startIndex, 'endIndex:', endIndex);

    const before = lines.slice(0, startIndex).join('\n');
    const after = lines.slice(endIndex).join('\n');

    const newLeaveOffTab = `const LeaveOffTab = () => {
    const leaveLogic = useLeaveManagement();
    const shiftLogic = useShiftManagement();

    const [subTab, setSubTab] = useState<'off' | 'shift'>('off');

    // KTV Leave Logic (New Calendar)
    const {
        isLoading,
        actionLoading,
        leaveList,
        handleDelete,
        calendarMonth,
        selectedDate,
        setSelectedDate,
        goToPrevMonth,
        goToNextMonth,
        goToToday,
    } = leaveLogic;

    // Shift Logic
    const {
        allShifts,
        pendingShifts,
        isLoadingShifts,
        shiftActionLoading,
        handleShiftAction,
        staffList,
        isLoadingStaff,
        unassignedStaff,
        assignModalOpen,
        setAssignModalOpen,
        assignEmployeeId,
        setAssignEmployeeId,
        assignShiftType,
        setAssignShiftType,
        isAssigning,
        handleAssignShift,
        openAssignModal,
    } = shiftLogic;

    // --- CALENDAR LOGIC ---
    const MONTH_NAMES = [
        'Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6',
        'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12',
    ];
    const WEEKDAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
    const BLOCKED_HOLIDAYS = ['04-30', '05-01', '09-02', '01-01'];

    const { year, month } = calendarMonth;
    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);
    const daysInMonth = lastDayOfMonth.getDate();

    let startDow = firstDayOfMonth.getDay(); 
    startDow = startDow === 0 ? 6 : startDow - 1; 

    const leaveByDate: Record<string, typeof leaveList> = {};
    leaveList.forEach(leave => {
        if (!leaveByDate[leave.date]) leaveByDate[leave.date] = [];
        leaveByDate[leave.date].push(leave);
    });

    const todayStr = (() => {
        const now = new Date();
        return \`\${now.getFullYear()}-\${String(now.getMonth() + 1).padStart(2, '0')}-\${String(now.getDate()).padStart(2, '0')}\`;
    })();

    const handleDateClick = (dateStr: string) => {
        setSelectedDate(dateStr === selectedDate ? null : dateStr);
    };

    const selectedLeaves = selectedDate ? (leaveByDate[selectedDate] || []) : [];

    const formatLeaveDate = (dateStr: string) => {
        try {
            return format(new Date(dateStr + 'T00:00:00'), 'EEEE, dd/MM', { locale: vi });
        } catch {
            return dateStr;
        }
    };

    return (
        <div className="space-y-4">
            {/* ── TABS ── */}
            <div className="flex bg-gray-100 rounded-2xl p-1 gap-1 w-full max-w-sm mx-auto mb-4">
                <button
                    onClick={() => setSubTab('off')}
                    className={\`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all \${subTab === 'off' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}\`}
                >
                    <CalendarOff size={15} /> Lịch OFF
                </button>
                <button
                    onClick={() => setSubTab('shift')}
                    className={\`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all \${subTab === 'shift' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}\`}
                >
                    <Briefcase size={15} /> Phân Ca
                    {pendingShifts.length > 0 && (
                        <span className="bg-amber-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full">
                            {pendingShifts.length}
                        </span>
                    )}
                </button>
            </div>

            {/* ── OFF SUB-TAB ── */}
            {subTab === 'off' && (
                <div className="space-y-5">
                    {/* ── CALENDAR ── */}
                    <div className="bg-white rounded-3xl border border-gray-100 shadow-lg overflow-hidden">
                        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                            <button onClick={goToPrevMonth} className="p-2 hover:bg-white rounded-xl transition-colors shadow-sm border border-transparent hover:border-gray-200">
                                <ChevronLeft size={18} className="text-gray-500" />
                            </button>
                            <button onClick={goToToday} className="text-base font-black text-gray-800 px-4 py-1.5 hover:bg-white rounded-xl transition-colors shadow-sm border border-transparent hover:border-gray-200">
                                {MONTH_NAMES[month]} {year}
                            </button>
                            <button onClick={goToNextMonth} className="p-2 hover:bg-white rounded-xl transition-colors shadow-sm border border-transparent hover:border-gray-200">
                                <ChevronRight size={18} className="text-gray-500" />
                            </button>
                        </div>

                        <div className="px-4 py-4">
                            {isLoading ? (
                                <div className="flex items-center justify-center py-12 gap-2 text-gray-400">
                                    <Loader2 size={20} className="animate-spin" />
                                    <span className="text-sm">Đang tải lịch...</span>
                                </div>
                            ) : (
                                <>
                                    <div className="grid grid-cols-7 gap-1 mb-2">
                                        {WEEKDAY_LABELS.map((day, i) => (
                                            <div key={day} className={\`text-center text-[10px] font-bold uppercase tracking-wider py-1 \${i === 6 ? 'text-red-400' : i === 5 ? 'text-blue-400' : 'text-gray-400'}\`}>
                                                {day}
                                            </div>
                                        ))}
                                    </div>

                                    <div className="grid grid-cols-7 gap-1">
                                        {Array.from({ length: startDow }).map((_, i) => (
                                            <div key={\`empty-\${i}\`} className="aspect-square" />
                                        ))}

                                        {Array.from({ length: daysInMonth }).map((_, i) => {
                                            const day = i + 1;
                                            const dateStr = \`\${year}-\${String(month + 1).padStart(2, '0')}-\${String(day).padStart(2, '0')}\`;
                                            const dayLeaves = leaveByDate[dateStr] || [];
                                            const isToday = dateStr === todayStr;
                                            const isSelected = dateStr === selectedDate;
                                            const isBlocked = BLOCKED_HOLIDAYS.includes(dateStr.slice(5));
                                            const offCount = dayLeaves.length;
                                            const dow = (startDow + i) % 7;
                                            
                                            let cellStyle = 'text-gray-600 hover:bg-gray-50 border border-transparent';
                                            
                                            if (isSelected) {
                                                cellStyle = 'bg-indigo-600 text-white shadow-md shadow-indigo-200 scale-105 font-bold border-indigo-600 z-10';
                                            } else if (isBlocked) {
                                                cellStyle = 'bg-gray-100 text-gray-400 cursor-not-allowed';
                                            } else if (isToday) {
                                                cellStyle = 'bg-indigo-50 text-indigo-700 border-indigo-200 font-black';
                                            } else if (offCount > 0) {
                                                cellStyle = 'bg-rose-50 text-rose-700 border-rose-100 font-bold hover:bg-rose-100';
                                            } else if (dow === 6) {
                                                cellStyle = 'text-red-400 hover:bg-red-50/50';
                                            } else if (dow === 5) {
                                                cellStyle = 'text-blue-400 hover:bg-blue-50/50';
                                            }

                                            return (
                                                <button
                                                    key={dateStr}
                                                    onClick={() => handleDateClick(dateStr)}
                                                    className={\`aspect-square rounded-xl flex flex-col items-center justify-center relative transition-all text-sm \${cellStyle}\`}
                                                >
                                                    <span className="leading-none">{day}</span>
                                                    
                                                    {offCount > 0 && !isSelected && (
                                                        <div className="absolute -bottom-1.5 -right-1.5 bg-rose-500 text-white text-[9px] font-black w-4 h-4 flex items-center justify-center rounded-full shadow-sm border-2 border-white">
                                                            {offCount}
                                                        </div>
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    {/* ── CHI TIẾT NGÀY ĐƯỢC CHỌN ── */}
                    {selectedDate && (
                        <div className="bg-white rounded-3xl border border-gray-100 shadow-xl overflow-hidden animate-in fade-in slide-in-from-bottom-4">
                            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3 bg-indigo-50/50">
                                <div className="bg-indigo-100 text-indigo-600 p-2 rounded-xl">
                                    <CalendarDays size={18} />
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-gray-900">Chi tiết ngày {format(new Date(selectedDate), 'dd/MM/yyyy')}</h3>
                                    <p className="text-xs text-gray-500">Có {selectedLeaves.length} nhân sự đăng ký OFF</p>
                                </div>
                            </div>

                            <div className="p-4">
                                {selectedLeaves.length === 0 ? (
                                    <div className="text-center py-8">
                                        <CheckCircle2 size={32} className="text-emerald-400 mx-auto mb-2" />
                                        <p className="text-sm text-gray-500">Không có ai OFF ngày này.</p>
                                        <p className="text-xs text-gray-400 mt-1">Đội hình đầy đủ!</p>
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {selectedLeaves.map(leave => {
                                            const loadState = actionLoading[leave.id];
                                            return (
                                                <div key={leave.id} className="flex items-center justify-between p-3 rounded-2xl border border-gray-100 bg-gray-50 hover:bg-white transition-colors group">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-8 h-8 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center font-bold text-xs shrink-0">
                                                            {leave.employeeName.charAt(0)}
                                                        </div>
                                                        <div>
                                                            <p className="font-bold text-sm text-gray-900">{leave.employeeName}</p>
                                                            {leave.reason && (
                                                                <p className="text-[10px] text-gray-500 italic mt-0.5">&ldquo;{leave.reason}&rdquo;</p>
                                                            )}
                                                        </div>
                                                    </div>
                                                    
                                                    <button
                                                        onClick={() => handleDelete(leave.id)}
                                                        disabled={!!loadState}
                                                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all disabled:opacity-50"
                                                        title="Huỷ ngày OFF này"
                                                    >
                                                        {loadState === 'delete' ? <Loader2 size={16} className="animate-spin text-red-500" /> : <Trash2 size={16} />}
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}
`;
    
    fs.writeFileSync(path, before + '\n' + newLeaveOffTab + '\n' + after);
    console.log('Successfully replaced LeaveOffTab in ktv-hub.');
} else {
    console.log('Could not find markers in ktv-hub page.');
}

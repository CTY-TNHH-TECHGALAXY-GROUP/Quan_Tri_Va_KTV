const fs = require('fs');

function updatePage(path) {
    if (!fs.existsSync(path)) return;
    let content = fs.readFileSync(path, 'utf8');

    // Mẫu thẻ cũ cần thay thế (nằm trong <div className="p-4"> ... </div> của chi tiết ngày)
    // Thay vì dùng regex phức tạp, ta có thể tìm thẻ bắt đầu và thẻ kết thúc.

    const targetStart = '{selectedLeaves.length === 0 ? (';
    const startIdx = content.indexOf(targetStart);
    if (startIdx === -1) {
        console.log(`Could not find target in ${path}`);
        return;
    }

    const targetEndStr = ')}';
    // Let's find the closing tag of that block. Since there are multiple blocks, it's safer to use regex to replace from <div className="p-4"> to </div>
    // Actually, in ktv-hub/page.tsx:
    /*
                            <div className="p-4">
                                {selectedLeaves.length === 0 ? (
                                    ...
                                )}
                            </div>
                        </div>
                    )}
    */

    const p4Start = content.indexOf('<div className="p-4">', startIdx - 100);
    if (p4Start === -1) return;

    // Find the next </div></div>)}
    const nextCode = content.substring(p4Start);
    const endBoundary = nextCode.indexOf('</div>\n                        </div>\n                    )}');

    if (endBoundary === -1) {
        console.log(`End boundary not found in ${path}`);
        return;
    }

    const replacement = `<div className="p-4 space-y-5">
                                {/* KHU VỰC NGƯỜI NGHỈ */}
                                <div>
                                    <h4 className="text-[11px] font-black text-rose-500 mb-2 uppercase tracking-wider flex items-center justify-between">
                                        Nhân sự OFF
                                        <span className="bg-rose-100 text-rose-700 py-0.5 px-2 rounded-full text-[10px]">
                                            {selectedLeaves.length}
                                        </span>
                                    </h4>
                                    {selectedLeaves.length === 0 ? (
                                        <div className="text-center py-4 bg-gray-50/50 rounded-2xl border border-gray-100 border-dashed">
                                            <p className="text-xs text-gray-400 font-medium">Không có ai OFF.</p>
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-2 gap-2">
                                            {selectedLeaves.map(leave => {
                                                const loadState = actionLoading[leave.id];
                                                return (
                                                    <div key={leave.id} className="flex items-center justify-between p-2 rounded-xl border border-rose-100 bg-rose-50/50 group">
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-7 h-7 rounded-full bg-white border border-rose-100 text-rose-600 flex items-center justify-center font-black text-xs shrink-0 shadow-sm">
                                                                {leave.employeeId}
                                                            </div>
                                                            <div>
                                                                <p className="font-bold text-xs text-gray-900">{leave.employeeId}</p>
                                                                {leave.reason && (
                                                                    <p className="text-[9px] text-gray-500 italic truncate max-w-[80px]">&ldquo;{leave.reason}&rdquo;</p>
                                                                )}
                                                            </div>
                                                        </div>
                                                        
                                                        <button
                                                            onClick={() => handleDelete(leave.id)}
                                                            disabled={!!loadState}
                                                            className="p-1.5 text-rose-300 hover:text-rose-600 hover:bg-rose-100 rounded-lg transition-all disabled:opacity-50"
                                                            title="Huỷ ngày OFF này"
                                                        >
                                                            {loadState === 'delete' ? <Loader2 size={12} className="animate-spin text-rose-500" /> : <Trash2 size={12} />}
                                                        </button>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>

                                {/* KHU VỰC NGƯỜI LÀM */}
                                <div>
                                    <h4 className="text-[11px] font-black text-emerald-600 mb-2 uppercase tracking-wider flex items-center justify-between">
                                        Nhân sự làm việc
                                        <span className="bg-emerald-100 text-emerald-700 py-0.5 px-2 rounded-full text-[10px]">
                                            {allShifts.filter(shift => !selectedLeaves.some(l => l.employeeId === shift.employeeId)).length}
                                        </span>
                                    </h4>
                                    <div className="grid grid-cols-3 gap-2">
                                        {allShifts
                                            .filter(shift => !selectedLeaves.some(l => l.employeeId === shift.employeeId))
                                            .map(shift => (
                                                <div key={shift.id} className="flex items-center gap-2 p-1.5 rounded-xl border border-emerald-100/50 bg-emerald-50/30">
                                                    <div className="w-6 h-6 rounded-full bg-white border border-emerald-100 text-emerald-600 flex items-center justify-center font-black text-[10px] shrink-0 shadow-sm">
                                                        {shift.employeeId}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="font-bold text-[11px] text-gray-800 truncate">{shift.employeeId}</p>
                                                        <p className="text-[9px] text-emerald-600/70 font-semibold truncate">{shift.shiftType}</p>
                                                    </div>
                                                </div>
                                        ))}
                                    </div>
                                </div>
                            </div>`;

    const newContent = content.substring(0, p4Start) + replacement + '\n                        </div>\n                    )}' + content.substring(p4Start + endBoundary + 48);

    fs.writeFileSync(path, newContent);
    console.log(`Updated ${path}`);
}

updatePage('app/reception/ktv-hub/page.tsx');
updatePage('app/reception/leave-management/page.tsx');

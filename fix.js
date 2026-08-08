const fs = require('fs');
const filePath = 'app/reception/ktv-hub/page.tsx';
let content = fs.readFileSync(filePath, 'utf8');

const target = `                                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                    <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">{turn.employee_id}</span>
                                    {turn.turns_completed > 0 && (
                                        <span className="text-[10px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded font-bold border border-indigo-100">
                                            Đã làm {turn.turns_completed} tua
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Status badge */}
                            <div className={\`px-2.5 py-1.5 rounded-xl text-[10px] font-bold flex items-center gap-1 shrink-0 \${turn.status === 'waiting' ? 'bg-emerald-100 text-emerald-700' :
                                turn.status === 'working' ? 'bg-rose-100 text-rose-700' :
                                    'bg-gray-100 text-gray-500'
                                }\`}>
                                {turn.status === 'waiting' ? <CheckCircle2 size={10} /> :
                                    turn.status === 'working' ? <Timer size={10} className="animate-spin" /> :
                                        <Moon size={10} />}
                                <span className="hidden sm:inline">
                                    {turn.status === 'waiting' ? 'Sẵn sàng' : turn.status === 'working' ? 'Đang làm' : 'Tan ca'}
                                </span>
                            </div>`;

const replacement = `                                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                    <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">{turn.employee_id}</span>
                                    {turn.turns_completed > 0 && (
                                        <span className="text-[10px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded font-bold border border-indigo-100">
                                            Đã làm {turn.turns_completed} tua
                                        </span>
                                    )}
                                    {shifts[turn.employee_id] === 'FREE' && (
                                        <span className="text-[9px] bg-teal-50 text-teal-600 px-1.5 py-0.5 rounded-full font-bold border border-teal-100">Tự Do</span>
                                    )}
                                    {shifts[turn.employee_id] === 'REQUEST' && (
                                        <span className="text-[9px] bg-pink-50 text-pink-600 px-1.5 py-0.5 rounded-full font-bold border border-pink-100">Khách YC</span>
                                    )}
                                </div>
                            </div>

                            {/* Status badge */}
                            <div className={\`px-2.5 py-1.5 rounded-xl text-[10px] font-bold flex items-center gap-1 shrink-0 \${suddenOffs.has(turn.employee_id) ? 'bg-red-100 text-red-700 border border-red-200' : turn.status === 'waiting' ? 'bg-emerald-100 text-emerald-700' :
                                turn.status === 'working' ? 'bg-rose-100 text-rose-700' :
                                    'bg-gray-100 text-gray-500'
                                }\`}>
                                {suddenOffs.has(turn.employee_id) ? <XCircle size={10} /> : turn.status === 'waiting' ? <CheckCircle2 size={10} /> :
                                    turn.status === 'working' ? <Timer size={10} className="animate-spin" /> :
                                        <Moon size={10} />}
                                <span className="hidden sm:inline">
                                    {suddenOffs.has(turn.employee_id) ? 'OFF Đột Xuất' : turn.status === 'waiting' ? 'Sẵn sàng' : turn.status === 'working' ? 'Đang làm' : 'Tan ca'}
                                </span>
                            </div>`;

content = content.replace(target, replacement);
// Ensure we handle potential CRLF issues in the regex
const targetCRLF = target.replace(/\\n/g, '\\r\\n');
content = content.replace(targetCRLF, replacement);

fs.writeFileSync(filePath, content, 'utf8');
console.log("Done!");

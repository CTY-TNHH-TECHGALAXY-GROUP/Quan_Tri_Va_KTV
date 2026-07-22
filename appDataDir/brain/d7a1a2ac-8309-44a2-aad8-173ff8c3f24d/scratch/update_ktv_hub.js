const fs = require('fs');
const path = 'c:\\Users\\ADMIN\\OneDrive\\Desktop\\Ngan Ha\\Quan_Tri_Va_KTV\\app\\reception\\ktv-hub\\page.tsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Add selectedDate state
content = content.replace(
    'const TurnTab = ({ staffs }: { staffs: StaffData[] }) => {\r\n    const [turns, setTurns] = useState<(TurnQueueData & { staff?: StaffData })[]>([]);',
    `const TurnTab = ({ staffs }: { staffs: StaffData[] }) => {\r\n    // Luôn sử dụng múi giờ Việt Nam (UTC+7) làm mặc định\r\n    const getVietnamDateString = () => {\r\n        const d = new Date();\r\n        const utc = d.getTime() + (d.getTimezoneOffset() * 60000);\r\n        const vnTime = new Date(utc + (3600000 * 7));\r\n        return vnTime.toISOString().split('T')[0];\r\n    };\r\n    const [selectedDate, setSelectedDate] = useState<string>(getVietnamDateString());\r\n    const [turns, setTurns] = useState<(TurnQueueData & { staff?: StaffData })[]>([]);`
);

// 2. Update useEffect dependency
content = content.replace(
    '        }\r\n    }, [staffs]);',
    '        }\r\n    }, [staffs, selectedDate]);'
);

// 3. Update fetchExtras
content = content.replace(
    '    const fetchExtras = async () => {\r\n        const today = new Date().toISOString().split(\'T\')[0];',
    '    const fetchExtras = async () => {\r\n        const today = selectedDate;'
);

// 4. Update removeChannel dependency
content = content.replace(
    '        return () => {\r\n            supabase.removeChannel(channel);\r\n        };\r\n    }, [staffs]);',
    '        return () => {\r\n            supabase.removeChannel(channel);\r\n        };\r\n    }, [staffs, selectedDate]);'
);

// 5. Update fetchTurns API call
content = content.replace(
    '    const fetchTurns = async () => {\r\n        setLoading(true);\r\n        try {\r\n            const res = await fetch(\'/api/turns\');',
    '    const fetchTurns = async () => {\r\n        setLoading(true);\r\n        try {\r\n            const res = await fetch(`/api/turns?date=${selectedDate}`);'
);

// 6. Update fetchTurnsFromDB
content = content.replace(
    '    const fetchTurnsFromDB = async () => {\r\n        const today = new Date().toISOString().split(\'T\')[0];',
    '    const fetchTurnsFromDB = async () => {\r\n        const today = selectedDate;'
);

// 7. Add Date Picker UI
content = content.replace(
    '<h3 className="font-bold text-gray-900 text-sm">Sổ hàng đợi tua</h3>\r\n                    <button',
    `<div className="flex items-center gap-3">\r\n                        <h3 className="font-bold text-gray-900 text-sm">Sổ hàng đợi tua</h3>\r\n                        <input\r\n                            type="date"\r\n                            value={selectedDate}\r\n                            onChange={(e) => setSelectedDate(e.target.value)}\r\n                            className="text-xs font-medium border border-gray-200 rounded-md px-2 py-1 outline-none focus:border-indigo-500 text-gray-700 bg-gray-50"\r\n                        />\r\n                    </div>\r\n                    <button`
);

fs.writeFileSync(path, content, 'utf8');
console.log('Successfully updated page.tsx');

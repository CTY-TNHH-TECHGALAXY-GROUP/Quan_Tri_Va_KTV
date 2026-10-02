const fs = require('fs');

async function main() {
  const file = 'components/shared/ScheduleBoard/ScheduleBoard.tsx';
  let content = fs.readFileSync(file, 'utf8');

  // Fix Unicode corruption for "Khách cũ"
  content = content.replace(/KhA\ch c\c/g, "Khách cũ");
  content = content.replace(/Email \(Tu\3 ch\\?n\)/g, "Email (Tùy chọn)");
  content = content.replace(/Lịch Trực Quan \(Demo\)/g, "Lịch Điều Phối");

  // Fetch all countries
  const res = await fetch('https://gist.githubusercontent.com/anubhavshrimal/75f6183458db8c453306f93521e93d37/raw/f77e7598a8503f1f70528ae1cbf9f66755698a16/CountryCodes.json');
  const data = await res.json();
  
  let datalistOptions = '';
  data.forEach(c => {
    const code = c.code;
    const flag = code.toUpperCase().replace(/./g, char => String.fromCodePoint(char.charCodeAt(0) + 127397));
    datalistOptions += `                           <option value="${c.dial_code}">${flag} ${c.dial_code} (${code})</option>\n`;
  });

  // Regex replacement for the phone block
  // We need to match from `<div className="flex gap-2">` to `</div>` just before `Email` or `Loại Menu`
  const regex = /<div className="flex gap-2">[\s\S]*?<input type="text" value={newPbPhone}[\s\S]*?<\/div>/;
  
  const newBlock = `<div className="flex gap-2">
                        <input 
                           type="text" 
                           list="phone-codes" 
                           value={newPbPhoneCode} 
                           onChange={e => setNewPbPhoneCode(e.target.value)} 
                           className="p-3 w-28 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-emerald-500 font-bold text-gray-700" 
                           placeholder="+84"
                        />
                        <datalist id="phone-codes">
${datalistOptions}                        </datalist>
                        <input type="text" value={newPbPhone} onChange={e => setNewPbPhone(e.target.value)} className="flex-1 p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-emerald-500 font-medium" placeholder="09..." />
                     </div>`;
                     
  content = content.replace(regex, newBlock);
  
  // Fix the insert payload logic
  const insertRegex = /customer_phone:\s*newPbPhoneCode\s*\+\s*newPbPhone,/;
  content = content.replace(insertRegex, 'customer_phone: (newPbPhoneCode || "").replace(/\\s+/g, "") + (newPbPhone || "").replace(/\\s+/g, ""),');
  
  fs.writeFileSync(file, content, 'utf8');
  console.log('Replaced with ' + data.length + ' countries successfully');
}

main().catch(e => console.error(e));


const fs = require("fs");
let content = fs.readFileSync("components/shared/ScheduleBoard/ScheduleBoard.tsx", "utf8");

// 1. Add new state for email and country code
content = content.replace(
    "const [newPbPhone, setNewPbPhone] = React.useState(\u0027\u0027);",
    "const [newPbPhone, setNewPbPhone] = React.useState(\u0027\u0027);\n  const [newPbPhoneCode, setNewPbPhoneCode] = React.useState(\u0027+84\u0027);\n  const [newPbEmail, setNewPbEmail] = React.useState(\u0027\u0027);"
);

// 2. Update insert query
content = content.replace(
    "customer_phone: newPbPhone,",
    "customer_phone: newPbPhoneCode + newPbPhone,\n        customer_email: newPbEmail,"
);

// 3. Clear email state on close
content = content.replace(
    "setNewPbName(\u0027\u0027); setNewPbPhone(\u0027\u0027); setNewPbGuests(1); setNewPbNotes(\u0027\u0027);",
    "setNewPbName(\u0027\u0027); setNewPbPhone(\u0027\u0027); setNewPbEmail(\u0027\u0027); setNewPbGuests(1); setNewPbNotes(\u0027\u0027);"
);

// 4. Update url params
content = content.replace(
    "if (pb.customer_phone) url.searchParams.set(\u0027phone\u0027, pb.customer_phone);",
    "if (pb.customer_phone) url.searchParams.set(\u0027phone\u0027, pb.customer_phone);\n     if (pb.customer_email) url.searchParams.set(\u0027email\u0027, pb.customer_email);"
);

// 5. Update UI Form
const oldFormPhone = `                     <input type="text" value={newPbPhone} onChange={e => setNewPbPhone(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-emerald-500 font-medium" placeholder="09..." />`;
const newFormPhone = `                     <div className="flex gap-2">
                        <select value={newPbPhoneCode} onChange={e => setNewPbPhoneCode(e.target.value)} className="p-3 w-28 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-emerald-500 font-bold text-gray-700">
                           <option value="+84">???? +84</option>
                           <option value="+82">???? +82</option>
                           <option value="+81">???? +81</option>
                           <option value="+86">???? +86</option>
                           <option value="+886">???? +886</option>
                           <option value="+1">???? +1</option>
                        </select>
                        <input type="text" value={newPbPhone} onChange={e => setNewPbPhone(e.target.value)} className="flex-1 p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-emerald-500 font-medium" placeholder="09..." />
                     </div>
                  </div>
                  <div>
                     <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Email (Tu? ch?n)</label>
                     <input type="email" value={newPbEmail} onChange={e => setNewPbEmail(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-emerald-500 font-medium" placeholder="example@email.com" />`;

content = content.replace(oldFormPhone, newFormPhone);

fs.writeFileSync("components/shared/ScheduleBoard/ScheduleBoard.tsx", content, "utf8");
console.log("Updated ScheduleBoard.tsx");


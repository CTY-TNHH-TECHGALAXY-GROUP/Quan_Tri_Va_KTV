const fs = require('fs');
const file = 'components/EmployeeDetailModal.tsx';
let content = fs.readFileSync(file, 'utf8');

const checkboxHtml = `
                  {isEditing ? (
                    <div className="space-y-3 mt-4 pt-4 border-t border-gray-100">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={editedEmployee.isActiveVipMenu || false} onChange={(e) => updateField('isActiveVipMenu', e.target.checked)} className="w-4 h-4 text-indigo-600 rounded" />
                        <span className="text-sm font-medium text-gray-700">Hiển thị trên VIP Menu</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={editedEmployee.isHomeSpa || false} onChange={(e) => updateField('isHomeSpa', e.target.checked)} className="w-4 h-4 text-indigo-600 rounded" />
                        <span className="text-sm font-medium text-gray-700">Đi Home Spa</span>
                      </label>
                    </div>
                  ) : (
                    <div className="space-y-3 mt-4 pt-4 border-t border-gray-100">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-500">VIP Menu:</span>
                        <span className="text-sm font-medium text-gray-900">{editedEmployee.isActiveVipMenu ? 'Có' : 'Không'}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-500">Home Spa:</span>
                        <span className="text-sm font-medium text-gray-900">{editedEmployee.isHomeSpa ? 'Có' : 'Không'}</span>
                      </div>
                    </div>
                  )}`;

const target = "isEditing={isEditing} onChange={(val) => updateField('weight', val)} />";
const parts = content.split(target);

if (parts.length > 1) {
  content = parts[0] + target + '\n' + checkboxHtml + parts[1];
  fs.writeFileSync(file, content, 'utf8');
  console.log('Success for ' + file);
} else {
  console.log('Target not found');
}

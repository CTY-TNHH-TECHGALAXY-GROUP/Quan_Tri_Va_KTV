const fs = require('fs');

function processFile(file) {
  let content = fs.readFileSync(file, 'utf8');
  
  // Add to formData state initialization
  content = content.replace(
    /weight: '',/g,
    "weight: '',\n        isActiveVipMenu: false,\n        isHomeSpa: false,"
  );

  // For EmployeeDetailModal, we also need to initialize state from the passed 'employee' prop
  if (file.includes('EmployeeDetailModal')) {
    content = content.replace(
      /weight: employee\.weight \|\| '',/g,
      "weight: employee.weight || '',\n        isActiveVipMenu: employee.isActiveVipMenu || false,\n        isHomeSpa: employee.isHomeSpa || false,"
    );
  }

  // Add checkbox UI after weight
  const checkboxHtml = `
                                  <div className="flex flex-col justify-end space-y-2">
                                      <label className="flex items-center gap-2 cursor-pointer">
                                          <input type="checkbox" name="isActiveVipMenu" checked={formData.isActiveVipMenu} onChange={(e) => setFormData(prev => ({ ...prev, isActiveVipMenu: e.target.checked }))} className="w-4 h-4 text-indigo-600 rounded" />
                                          <span className="text-sm font-medium text-gray-700">VIP Menu</span>
                                      </label>
                                      <label className="flex items-center gap-2 cursor-pointer">
                                          <input type="checkbox" name="isHomeSpa" checked={formData.isHomeSpa} onChange={(e) => setFormData(prev => ({ ...prev, isHomeSpa: e.target.checked }))} className="w-4 h-4 text-indigo-600 rounded" />
                                          <span className="text-sm font-medium text-gray-700">Home Spa</span>
                                      </label>
                                  </div>`;
  
  // Find weight input and append our checkboxes
  const parts = content.split('name="weight"');
  if (parts.length > 1) {
    const afterWeight = parts[1].split('</div>');
    content = parts[0] + 'name="weight"' + afterWeight[0] + '</div>' + checkboxHtml + afterWeight.slice(1).join('</div>');
    fs.writeFileSync(file, content, 'utf8');
    console.log('Success for ' + file);
  } else {
    console.log('Failed to find weight input in ' + file);
  }
}

processFile('components/AddEmployeeModal.tsx');
processFile('components/EmployeeDetailModal.tsx');

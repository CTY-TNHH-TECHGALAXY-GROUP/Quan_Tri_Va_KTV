import sys, re

content = open('app/ktv/attendance/Attendance.logic.ts', 'r', encoding='utf-8', errors='ignore').read()
content = re.sub(r'alert\(".*?th.*?c.*?ng!"\);', 'addToast("Cập nhật thành công!", "success");', content)
content = re.sub(r'alert\(err\.message \|\| ".*?"\);', 'addToast(err.message || "Có lỗi xảy ra", "error");', content)

open('app/ktv/attendance/Attendance.logic.ts', 'w', encoding='utf-8').write(content)

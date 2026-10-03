# Quy tắc xác định phạm vi công việc

Áp dụng cho mọi agent làm việc trong repository này, kể cả agent phụ.

1. Trước mỗi nhiệm vụ, xác định từ yêu cầu và ngữ cảnh **project/repository, nhánh hoặc worktree, vị trí mã hay luồng nghiệp vụ, và môi trường triển khai nếu có**. Kiểm tra `pwd`, `git rev-parse --show-toplevel`, `git branch --show-current` và `git status --short --branch` trước khi thay đổi file.
2. Giữ đúng project và nhánh đã được user xác nhận gần nhất cho nhiệm vụ đang tiếp diễn. Không lấy nhánh đang checkout làm căn cứ thay cho ngữ cảnh user. Yêu cầu “báo cáo thêm lỗi từ root” chỉ cho phép khảo sát và báo cáo; không biến lỗi tìm thêm thành phạm vi sửa của nhánh khác.
3. Nếu sau khi đọc ngữ cảnh vẫn có nhiều cách hiểu về **project, nhánh/worktree, lỗi cần sửa, vị trí file/luồng, hoặc môi trường deploy**, hỏi user chỉ rõ phần còn mơ hồ **trước khi sửa mã, tạo migration, commit, push hoặc deploy**. Có thể khảo sát chỉ đọc để đặt câu hỏi cụ thể. Không tự chọn một nhánh hoặc một nhóm lỗi theo suy đoán.
4. Khi đích đã rõ nhưng checkout đang ở nhánh khác, chuyển sang đúng worktree/nhánh trước khi sửa. Không tự mang diff, cherry-pick hay migration qua nhánh khác. Trước commit/push/deploy, đối chiếu lại nhánh, diff và môi trường với yêu cầu; báo rõ commit và nơi đã triển khai sau khi hoàn tất.
5. Khi giao việc cho agent phụ, ghi rõ project, nhánh/worktree, phạm vi file hoặc luồng và môi trường. Agent phụ phải tự kiểm tra lại; nếu thấy xung đột hoặc thiếu thông tin thì dừng thao tác ghi và hỏi lại.

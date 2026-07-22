import { createClient } from '@/lib/supabase/server';
import { Database } from '@/supabase_types';

type SupabaseClient = ReturnType<typeof createClient>;

export class SupportTaskService {
  /**
   * Khởi tạo task mới (Ad-hoc hoặc sinh tự động)
   */
  static async createTask(data: {
    room_id: string;
    name: string;
    task_type: 'FIXED' | 'AD-HOC';
    category_id?: string;
    assignee_id?: string;
    priority?: 'LOW' | 'NORMAL' | 'HIGH';
    due_at?: string;
  }) {
    const supabase = await createClient();
    
    const { data: newTask, error } = await supabase
      .from('Tasks')
      .insert({
        room_id: data.room_id,
        name: data.name,
        task_type: data.task_type,
        category_id: data.category_id,
        assignee_id: data.assignee_id,
        priority: data.priority || 'NORMAL',
        due_at: data.due_at,
        status: 'NOT_STARTED',
        inspection_status: 'NOT_REVIEWED'
      })
      .select()
      .single();

    if (error) {
      console.error('[SupportTaskService.createTask] Error:', error.message, error.code);
      throw new Error(`Không thể tạo công việc mới: ${error.message}`);
    }

    return newTask;
  }

  /**
   * Cập nhật trạng thái công việc (Dành cho Nhân viên)
   * Có kiểm tra logic bắt buộc đủ ảnh nếu task_type là FIXED và có template (có thể query sau)
   */
  static async updateTaskStatus(taskId: string, employeeId: string, newStatus: 'IN_PROGRESS' | 'COMPLETED' | 'PAUSED' | 'UNABLE_TO_COMPLETE') {
    const supabase = await createClient();

    // 1. Lấy thông tin task hiện tại
    const { data: task, error: fetchError } = await supabase
      .from('Tasks')
      .select('*, TaskTemplates(requires_photo, min_photo_count)')
      .eq('id', taskId)
      .single();

    if (fetchError || !task) {
      console.error('[SupportTaskService.updateTaskStatus] Task not found:', fetchError?.message);
      throw new Error('Công việc không tồn tại.');
    }

    // (Phân quyền): Chỉ assignee mới được đổi trạng thái
    if (task.assignee_id && task.assignee_id !== employeeId) {
      throw new Error('Bạn không có quyền cập nhật công việc này.');
    }

    // 2. Logic kiểm tra số ảnh tối thiểu nếu muốn COMPLETED
    if (newStatus === 'COMPLETED') {
      const requiresPhoto = task.TaskTemplates?.requires_photo ?? true;
      const minPhotoCount = task.TaskTemplates?.min_photo_count ?? 1;

      if (requiresPhoto) {
        const { count, error: countError } = await supabase
          .from('TaskPhotos')
          .select('*', { count: 'exact', head: true })
          .eq('task_id', taskId);

        if (countError) {
           console.error('[SupportTaskService.updateTaskStatus] Photo count error:', countError.message);
           throw new Error('Lỗi khi kiểm tra hình ảnh đính kèm.');
        }

        if (count === null || count < minPhotoCount) {
          throw new Error(`Chưa đủ hình ảnh minh chứng. Cần tối thiểu ${minPhotoCount} ảnh. Đã tải lên ${count || 0}.`);
        }
      }
    }

    // 3. Tiến hành cập nhật
    const updatePayload: any = { status: newStatus };
    
    // Nếu hoàn thành, tự động chuyển trạng thái nghiệm thu sang chờ duyệt
    if (newStatus === 'COMPLETED') {
      updatePayload.inspection_status = 'PENDING_REVIEW';
    }

    const { data: updatedTask, error: updateError } = await supabase
      .from('Tasks')
      .update(updatePayload)
      .eq('id', taskId)
      .select()
      .single();

    if (updateError) {
      console.error('[SupportTaskService.updateTaskStatus] Update error:', updateError.message, updateError.code);
      throw new Error(`Lỗi cập nhật: ${updateError.message}`);
    }

    // 4. Nếu là COMPLETED, ta sẽ "chốt" các ảnh draft (is_submitted = true)
    if (newStatus === 'COMPLETED') {
      await supabase
        .from('TaskPhotos')
        .update({ is_submitted: true })
        .eq('task_id', taskId)
        .eq('is_submitted', false);
    }

    return updatedTask;
  }

  /**
   * Nghiệm thu công việc (Dành cho Quản lý)
   */
  static async reviewTask(taskId: string, managerId: string, decision: 'PASSED' | 'REWORK_REQUIRED' | 'FAILED', note: string) {
    const supabase = await createClient();

    // 1. Lấy task để biết vòng nghiệm thu hiện tại
    const { data: task, error: fetchError } = await supabase
      .from('Tasks')
      .select('*')
      .eq('id', taskId)
      .single();

    if (fetchError || !task) {
      throw new Error('Công việc không tồn tại.');
    }

    if (task.inspection_status !== 'PENDING_REVIEW') {
      throw new Error('Công việc chưa sẵn sàng để nghiệm thu.');
    }

    const currentRound = task.current_review_round;

    // 2. Lưu lịch sử Review
    const { error: reviewError } = await supabase
      .from('TaskReviews')
      .insert({
        task_id: taskId,
        round_number: currentRound + 1,
        reviewer_id: managerId,
        decision,
        note
      });

    if (reviewError) {
      console.error('[SupportTaskService.reviewTask] Insert review error:', reviewError.message);
      throw new Error('Lỗi lưu lịch sử nghiệm thu.');
    }

    // 3. Cập nhật lại Task
    const updatePayload: any = {
      inspection_status: decision,
      current_review_round: currentRound + 1
    };

    // Nếu bắt làm lại, trạng thái của nhân viên lùi về IN_PROGRESS
    if (decision === 'REWORK_REQUIRED') {
      updatePayload.status = 'IN_PROGRESS';
    }

    const { data: updatedTask, error: updateError } = await supabase
      .from('Tasks')
      .update(updatePayload)
      .eq('id', taskId)
      .select()
      .single();

    if (updateError) {
       console.error('[SupportTaskService.reviewTask] Update task error:', updateError.message);
       throw new Error('Lỗi cập nhật trạng thái nghiệm thu.');
    }

    return updatedTask;
  }
}

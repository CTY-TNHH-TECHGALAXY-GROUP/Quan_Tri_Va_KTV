import { AppLayout } from '@/components/layout/AppLayout';
import { WebBookingBoard } from './WebBookingBoard';

export default function WebBookingPage() {
  return (
    <AppLayout title="Đơn Đặt Lịch Web Nội Bộ">
      <WebBookingBoard />
    </AppLayout>
  );
}

import { AppLayout } from '@/components/layout/AppLayout';
import { Payroll } from './Payroll';

export default function PayrollPage() {
  return (
    <AppLayout title="Chấm Công & Bảng Lương">
      <Payroll />
    </AppLayout>
  );
}


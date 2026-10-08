import { redirect } from 'next/navigation';

// Office P0: the old support dashboard read tables dropped in July (SupportTasks) and no longer worked.
// Staff land on "Việc của tôi" instead.
export default function SupportDashboardRedirect() {
  redirect('/support/tasks');
}

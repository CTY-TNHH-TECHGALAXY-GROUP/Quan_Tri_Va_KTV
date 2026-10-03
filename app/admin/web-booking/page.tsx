// Redirect to the operational web-booking page in reception group
import { redirect } from 'next/navigation';

export default function WebBookingAdminPage() {
  redirect('/reception/web-booking');
}

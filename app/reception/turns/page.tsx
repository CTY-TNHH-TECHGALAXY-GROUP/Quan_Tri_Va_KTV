'use client';

import { redirect } from 'next/navigation';

// Redirect to KTV Hub - turns management has been merged into ktv-hub page
export default function TurnsRedirectPage() {
  redirect('/reception/ktv-hub');
}

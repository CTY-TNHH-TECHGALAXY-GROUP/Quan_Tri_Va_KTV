import { useEffect, useState } from 'react';
import { promotionApi } from '@/lib/services/promotionApi';
import type { SpaContact } from '@/lib/types/promotion-client';

// One request per page load: the contact rarely changes and every card needs it.
let cached: Promise<SpaContact | null> | null = null;

/** Spa hotline / address / website for the e-voucher card (admin pages). */
export const useSpaContact = (): SpaContact | null => {
  const [contact, setContact] = useState<SpaContact | null>(null);
  useEffect(() => {
    cached ??= promotionApi.getSpaContact().then((r) => {
      if (!r.success) cached = null; // retry on the next card instead of caching the failure
      return r.success ? r.data : null;
    });
    let alive = true;
    cached.then((c) => alive && setContact(c));
    return () => {
      alive = false;
    };
  }, []);
  return contact;
};

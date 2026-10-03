import { useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import { promotionAccess } from './promotion.access';

/** Promotion permissions of the signed-in user (role.permissions = Users.permissions or role fallback). */
export const usePromotionAccess = () => {
  const { role } = useAuth();
  return useMemo(() => promotionAccess(role?.permissions), [role?.permissions]);
};

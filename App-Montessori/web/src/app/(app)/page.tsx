'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useScope } from '@/providers/ScopeProvider';
import { firstAccessiblePath } from '@/lib/screens';
import { SkeletonText } from '@/components/ui/Misc';

/** `/` -> trang đầu tiên người dùng được vào (Tổng quan toàn chuỗi cho chủ chuỗi). */
export default function HomeRedirect() {
  const router = useRouter();
  const { perms, campusId } = useScope();
  useEffect(() => {
    router.replace(firstAccessiblePath(perms, campusId));
  }, [router, perms, campusId]);
  return <SkeletonText lines={2} />;
}

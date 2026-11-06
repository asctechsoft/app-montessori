import { Suspense } from 'react';
import type { Metadata } from 'next';
import { W01Login } from '@/screens/W01Login';

export const metadata: Metadata = { title: 'Đăng nhập' };

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <W01Login />
    </Suspense>
  );
}

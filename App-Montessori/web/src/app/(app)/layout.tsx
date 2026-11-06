'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/providers/AuthProvider';
import { ScopeProvider } from '@/providers/ScopeProvider';
import { AppShell } from '@/components/layout/AppShell';
import { ScreenGuard } from '@/components/layout/ScreenGuard';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/Misc';
import { FormField, Input } from '@/components/ui/Fields';
import { Banner } from '@/components/ui/Banner';
import { useForm } from '@/lib/hooks/useForm';
import { callApi } from '@/lib/api';
import { LOGIN_PATH } from '@/lib/screens';

function FullScreen({ children }: { children: React.ReactNode }) {
  return <div className="fullscreen-msg">{children}</div>;
}

function Loading() {
  return (
    <FullScreen>
      <div style={{ width: 280 }} role="status" aria-label="Đang tải">
        <div className="stack">
          <Skeleton height={28} width="60%" />
          <Skeleton height={16} />
          <Skeleton height={16} width="80%" />
        </div>
      </div>
    </FullScreen>
  );
}

function CreateFirstOrg() {
  const { refresh, signOut } = useAuth();
  const form = useForm({ initial: { name: '' }, validate: (v) => (v.name.trim().length < 2 ? { name: 'Tên tổ chức tối thiểu 2 ký tự.' } : {}) });
  return (
    <FullScreen>
      <form className="auth-card" onSubmit={form.onSubmit(async (v, opId) => {
        await callApi('org.create', { opId, payload: { name: v.name.trim() } });
        await refresh();
      })}>
        <h2>Tài khoản chưa thuộc tổ chức nào</h2>
        <p className="text-secondary">Nếu bạn được mời, hãy đăng nhập bằng đúng email được mời. Hoặc tạo tổ chức mới để dùng thử.</p>
        {form.formError ? <Banner tone="error">{form.formError}</Banner> : null}
        <FormField name="name" label="Tên tổ chức mới" required {...form.field('name')}>
          <Input {...form.bind('name')} autoComplete="organization" />
        </FormField>
        <Button type="submit" loading={form.submitting}>Tạo tổ chức</Button>
        <Button variant="tertiary" onClick={() => void signOut()}>Đăng xuất</Button>
      </form>
    </FullScreen>
  );
}

function Gate({ children }: { children: ReactNode }) {
  const { status, orgs, error, retry, signOut, parentOnly } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (status === 'signedOut') {
      const next = pathname && pathname !== '/' ? `?next=${encodeURIComponent(pathname)}` : '';
      router.replace(`${LOGIN_PATH}${next}`);
    }
  }, [status, pathname, router]);

  if (!mounted || status === 'loading' || status === 'bootstrapping' || status === 'signedOut') return <Loading />;
  if (status === 'error') {
    return (
      <FullScreen>
        <div className="card" style={{ maxWidth: 520 }}>
          <ErrorState title="Không tải được thông tin tài khoản" message={error?.message} onRetry={() => void retry()} />
          <div style={{ textAlign: 'center' }}>
            <Button variant="tertiary" onClick={() => void signOut()}>Đăng xuất</Button>
          </div>
        </div>
      </FullScreen>
    );
  }
  if (parentOnly) {
    return (
      <FullScreen>
        <div className="card" style={{ maxWidth: 520 }}>
          <EmptyState icon="user" title="Tài khoản phụ huynh" description="Web quản trị dành cho nhân sự nhà trường. Phụ huynh vui lòng dùng ứng dụng di động." action={<Button variant="secondary" onClick={() => void signOut()}>Đăng xuất</Button>} />
        </div>
      </FullScreen>
    );
  }
  if (orgs.length === 0) return <CreateFirstOrg />;
  return (
    <ScopeProvider>
      <AppShell>
        <ScreenGuard>{children}</ScreenGuard>
      </AppShell>
    </ScopeProvider>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return <Gate>{children}</Gate>;
}

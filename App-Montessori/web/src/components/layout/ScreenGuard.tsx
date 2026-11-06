'use client';
import { useMemo, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useScope } from '@/providers/ScopeProvider';
import { checkAccess, firstAccessiblePath, matchScreen, type ScreenDef } from '@/lib/screens';
import { hasPerm } from '@/lib/permissions';
import { EmptyState, PageHeader } from '@/components/ui/Misc';
import { Button, LinkButton } from '@/components/ui/Button';
import { Select, FormField } from '@/components/ui/Fields';
import { useGuardedNavigate } from './nav';

export function NotFoundView() {
  const { perms, campusId } = useScope();
  return (
    <EmptyState
      icon="search"
      title="Không tìm thấy trang"
      description="Đường dẫn này không tồn tại hoặc đã được chuyển."
      action={<LinkButton href={firstAccessiblePath(perms, campusId)} variant="secondary">Về trang chính</LinkButton>}
    />
  );
}

/** 403: báo đúng phạm vi, có đường quay lại, KHÔNG hiển thị dữ liệu của cơ sở khác. */
export function Forbidden({ screen }: { screen: ScreenDef }) {
  const { perms, campusId, campus, campuses, selectCampus } = useScope();
  const router = useRouter();
  const where =
    screen.scope === 'org' ? 'ở phạm vi toàn tổ chức' : campusId && campusId !== 'all' ? `tại cơ sở ${campus?.name ?? campusId}` : 'ở phạm vi hiện tại';
  const elsewhere = useMemo(
    () => {
      const needed = Array.isArray(screen.perm) ? screen.perm : [];
      return screen.scope === 'campus' ? campuses.filter((c) => c.id !== campusId && needed.some((p) => hasPerm(perms, p, c.id))) : [];
    },
    [screen.scope, screen.perm, campuses, campusId, perms],
  );
  return (
    <div role="alert">
      <EmptyState
        icon="lock"
        title="Bạn chưa có quyền xem trang này"
        description={`Tài khoản của bạn chưa được cấp quyền cho «${screen.title}» ${where}. Nếu cần dùng, hãy liên hệ người quản trị tổ chức.`}
        action={
          <div className="row" style={{ justifyContent: 'center' }}>
            <Button variant="secondary" onClick={() => router.back()}>Quay lại</Button>
            <LinkButton href={firstAccessiblePath(perms, campusId)} variant="tertiary">Về trang chính</LinkButton>
            {elsewhere.slice(0, 3).map((c) => (
              <Button key={c.id} variant="tertiary" onClick={() => void selectCampus(c.id)}>Chuyển sang {c.name}</Button>
            ))}
          </div>
        }
      />
    </div>
  );
}

/** Màn cần một cơ sở cụ thể nhưng đang chọn "Tất cả cơ sở". */
export function NeedCampus({ screen }: { screen: ScreenDef }) {
  const { campuses, selectCampus } = useScope();
  const [pick, setPick] = useState('');
  const go = useGuardedNavigate();
  return (
    <div>
      <PageHeader title={screen.title} code={screen.code} />
      <div className="card stack" style={{ maxWidth: 480 }}>
        <p>Màn hình này làm việc theo từng cơ sở. Chọn cơ sở để tiếp tục.</p>
        <FormField name="need-campus" label="Cơ sở">
          <Select name="need-campus" value={pick} onValueChange={setPick} placeholder="Chọn cơ sở" options={campuses.map((c) => ({ value: c.id, label: c.name }))} />
        </FormField>
        <div className="row">
          <Button disabled={!pick} onClick={() => void selectCampus(pick)}>Làm việc tại cơ sở này</Button>
          <Button variant="tertiary" onClick={() => void go('/co-so')}>Xem danh sách cơ sở</Button>
        </div>
      </div>
    </div>
  );
}

/** Guard route: áp dụng cho mọi trang trong nhóm (app). Route không có trong screens.ts bị coi là không tồn tại. */
export function ScreenGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { perms, campusId } = useScope();
  if (pathname === '/') return <>{children}</>;
  const m = matchScreen(pathname);
  if (!m) return <NotFoundView />;
  const r = checkAccess(m.screen, perms, campusId);
  if (!r.ok) return r.reason === 'need_campus' ? <NeedCampus screen={m.screen} /> : <Forbidden screen={m.screen} />;
  return <>{children}</>;
}

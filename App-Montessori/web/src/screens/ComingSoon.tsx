import { PageHeader, EmptyState } from '@/components/ui/Misc';
import type { ScreenDef } from '@/lib/screens';
import { permissionLabel } from '@/lib/permissions';

/** Placeholder cho màn chưa làm: ghi rõ mã W## để không 404 và agent sau biết cần làm gì. */
export function ComingSoon({ screen }: { screen: ScreenDef }) {
  const perms = Array.isArray(screen.perm) ? screen.perm.map(permissionLabel).join(', ') : '—';
  return (
    <div>
      <PageHeader title={screen.title} code={screen.code} />
      <div className="card">
        <EmptyState
          icon="construction"
          title={`${screen.code} chưa được triển khai`}
          description={`Màn hình «${screen.title}» sẽ có ở giai đoạn sau. Đường dẫn ${screen.path}; quyền cần: ${perms}.`}
        />
      </div>
    </div>
  );
}

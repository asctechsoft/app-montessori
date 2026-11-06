'use client';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/providers/AuthProvider';
import { useScope } from '@/providers/ScopeProvider';
import { MENU_GROUPS, SCREENS, isMenuVisible, matchScreen } from '@/lib/screens';
import { SYSTEM_ROLE_LABELS } from '@/lib/permissions';
import { Icon } from '@/components/ui/Icon';
import { IconButton, Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { Select } from '@/components/ui/Fields';
import { Drawer } from '@/components/ui/Drawer';
import { EmptyState } from '@/components/ui/Misc';
import { GuardedLink } from './nav';

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { perms } = useScope();
  const pathname = usePathname();

  const groups = useMemo(() => {
    const visible = SCREENS.filter((s) => isMenuVisible(s, perms));
    return MENU_GROUPS.map((g) => ({ title: g, items: visible.filter((s) => s.group === g) })).filter((g) => g.items.length > 0);
  }, [perms]);

  // Mục menu đang sáng = đường dẫn menu dài nhất là tiền tố của pathname (trang chi tiết sáng mục cha).
  const activePath = useMemo(() => {
    const cands = SCREENS.filter((s) => s.menu && (pathname === s.path || pathname.startsWith(`${s.path}/`)));
    return cands.sort((a, b) => b.path.length - a.path.length)[0]?.path;
  }, [pathname]);

  return (
    <>
      {open ? <div className="scrim" onClick={onClose} aria-hidden="true" /> : null}
      <aside className="sidebar" data-open={open} aria-label="Menu chính">
        <div className="sidebar-brand">
          <span className="brand-mark" aria-hidden="true">M</span>
          <span>Mầm non</span>
        </div>
        <nav className="nav">
          {groups.length === 0 ? (
            <div className="nav-empty">Tài khoản của bạn chưa được cấp quyền vào chức năng nào. Liên hệ quản trị tổ chức.</div>
          ) : (
            groups.map((g) => (
              <div key={g.title}>
                <div className="nav-group-title">{g.title}</div>
                {g.items.map((s) => (
                  <GuardedLink key={s.code} href={s.path} className="nav-link" aria-current={s.path === activePath ? 'page' : undefined} onNavigate={onClose}>
                    {s.menuLabel ?? s.title}
                  </GuardedLink>
                ))}
              </div>
            ))
          )}
        </nav>
      </aside>
    </>
  );
}

function UserMenu() {
  const { user, signOut } = useAuth();
  const { org, roleId, roleOptions, selectRole } = useScope();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const name = org?.displayName || user?.displayName || user?.email || 'Tài khoản';
  return (
    <div className="popover-wrap" ref={ref}>
      <button type="button" className="user-btn" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Avatar name={name} size="sm" />
        <span className="hide-sm" style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        <Icon name="chevron-down" size={16} />
      </button>
      {open ? (
        <div className="popover" role="menu">
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <Avatar name={name} size="md" />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{name}</div>
              <div className="text-caption" style={{ overflowWrap: 'anywhere' }}>{user?.email}</div>
            </div>
          </div>
          {roleOptions.length > 1 ? (
            <div className="field">
              <label className="field-label" htmlFor="role-switch">Vai trò đang dùng</label>
              <Select
                name="role-switch"
                value={roleId}
                onValueChange={(v) => void selectRole(v)}
                options={[{ value: 'all', label: 'Tất cả vai trò' }, ...roleOptions.map((r) => ({ value: r.id, label: SYSTEM_ROLE_LABELS[r.id] ?? r.label }))]}
              />
              <span className="field-help">Chỉ thu hẹp giao diện theo vai trò; quyền thật do máy chủ kiểm tra.</span>
            </div>
          ) : roleOptions.length === 1 ? (
            <div className="text-small text-secondary">Vai trò: {roleOptions[0].label}</div>
          ) : null}
          <Button
            variant="secondary"
            icon="logout"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await signOut();
              } finally {
                setBusy(false);
              }
            }}
          >
            Đăng xuất
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const { org, orgs, campuses, campusId, canSelectAll, years, yearId, selectOrg, selectCampus, selectYear, canAnywhere } = useScope();
  const [bell, setBell] = useState(false);

  return (
    <header className="topbar">
      <span className="topbar-menu-btn">
        <IconButton icon="menu" label="Mở menu" onClick={onMenu} />
      </span>
      {orgs.length > 1 ? (
        <Select name="topbar-org" aria-label="Tổ chức" value={org?.orgId} onValueChange={(v) => void selectOrg(v)} options={orgs.map((o) => ({ value: o.orgId, label: o.name }))} />
      ) : (
        <span className="topbar-org" title={org?.name}>{org?.name}</span>
      )}
      <Select
        name="topbar-campus"
        aria-label="Cơ sở đang thao tác"
        value={campusId ?? ''}
        onValueChange={(v) => void selectCampus(v)}
        placeholder={campuses.length === 0 ? 'Chưa có cơ sở' : undefined}
        options={[
          ...(canSelectAll ? [{ value: 'all', label: 'Tất cả cơ sở' }] : []),
          ...campuses.map((c) => ({ value: c.id, label: c.name })),
        ]}
      />
      <Select
        name="topbar-year"
        aria-label="Năm học"
        value={yearId ?? ''}
        disabled={years.length === 0}
        onValueChange={(v) => void selectYear(v)}
        placeholder={years.length === 0 ? (campusId === 'all' ? 'Năm học: chọn cơ sở' : 'Chưa có năm học') : undefined}
        options={years.map((y) => ({ value: y.id, label: y.name }))}
      />
      <span className="topbar-spacer" />
      {canAnywhere('notify.read') ? (
        <GuardedLink href="/ket-noi/thong-bao" className="btn btn-icon btn-md" aria-label="Thông báo" title="Thông báo">
          <Icon name="bell" size={24} />
        </GuardedLink>
      ) : (
        <IconButton icon="bell" label="Thông báo" onClick={() => setBell(true)} />
      )}
      <UserMenu />
      <Drawer open={bell} title="Thông báo" onClose={() => setBell(false)}>
        <EmptyState icon="bell" title="Chưa có thông báo mới" description="Thông báo gửi tới bạn sẽ hiển thị tại đây." />
      </Drawer>
    </header>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  const current = matchScreen(pathname);
  return (
    <div className="shell">
      <Sidebar open={open} onClose={() => setOpen(false)} />
      <div className="main-col">
        <Topbar onMenu={() => setOpen(true)} />
        <main className="content" id="main" data-screen={current?.screen.code}>
          {children}
        </main>
      </div>
    </div>
  );
}

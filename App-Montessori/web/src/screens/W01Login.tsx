'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/providers/AuthProvider';
import { useForm } from '@/lib/hooks/useForm';
import { Button } from '@/components/ui/Button';
import { FormField, Input } from '@/components/ui/Fields';
import { Banner } from '@/components/ui/Banner';
import { Skeleton } from '@/components/ui/Misc';

type Mode = 'login' | 'forgot' | 'register';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function LoginForm({ onMode }: { onMode: (m: Mode) => void }) {
  const { signIn, notice, clearNotice } = useAuth();
  const form = useForm({
    initial: { email: '', password: '' },
    guard: false,
    validate: (v) => ({
      ...(!v.email.trim() ? { email: 'Nhập email.' } : !EMAIL_RE.test(v.email.trim()) ? { email: 'Email chưa đúng định dạng.' } : {}),
      ...(!v.password ? { password: 'Nhập mật khẩu.' } : {}),
    }),
  });
  return (
    <form className="stack" noValidate onSubmit={form.onSubmit(async (v) => { await signIn(v.email, v.password); })}>
      {notice ? <Banner tone="warning" title="Phiên đăng nhập đã kết thúc" action={<Button size="sm" variant="tertiary" onClick={clearNotice}>Đã hiểu</Button>}>{notice}</Banner> : null}
      {form.formError ? <Banner tone="error">{form.formError}</Banner> : null}
      <FormField name="email" label="Email" required {...form.field('email')}>
        <Input {...form.bind('email')} type="email" autoComplete="username" inputMode="email" />
      </FormField>
      <FormField name="password" label="Mật khẩu" required {...form.field('password')}>
        <Input {...form.bind('password')} type="password" autoComplete="current-password" />
      </FormField>
      <Button type="submit" size="lg" block loading={form.submitting}>Đăng nhập</Button>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <Button variant="tertiary" size="sm" onClick={() => onMode('forgot')}>Quên mật khẩu</Button>
        <Button variant="tertiary" size="sm" onClick={() => onMode('register')}>Đăng ký tổ chức mới</Button>
      </div>
    </form>
  );
}

function ForgotForm({ onMode }: { onMode: (m: Mode) => void }) {
  const { resetPassword } = useAuth();
  const [sent, setSent] = useState<string | null>(null);
  const form = useForm({
    initial: { email: '' },
    guard: false,
    validate: (v) => (!EMAIL_RE.test(v.email.trim()) ? { email: 'Nhập email đã đăng ký.' } : {}),
  });
  return (
    <form className="stack" noValidate onSubmit={form.onSubmit(async (v) => { await resetPassword(v.email); setSent(v.email.trim()); })}>
      <p className="text-secondary">Nhập email tài khoản. Chúng tôi sẽ gửi liên kết đặt lại mật khẩu.</p>
      {sent ? <Banner tone="success">Nếu {sent} đã đăng ký, hướng dẫn đặt lại mật khẩu đã được gửi. Kiểm tra cả thư rác.</Banner> : null}
      {form.formError ? <Banner tone="error">{form.formError}</Banner> : null}
      <FormField name="email" label="Email" required {...form.field('email')}>
        <Input {...form.bind('email')} type="email" autoComplete="username" inputMode="email" />
      </FormField>
      <Button type="submit" size="lg" block loading={form.submitting}>Gửi liên kết đặt lại</Button>
      <Button variant="tertiary" onClick={() => onMode('login')}>Quay lại đăng nhập</Button>
    </form>
  );
}

function RegisterForm({ onMode }: { onMode: (m: Mode) => void }) {
  const { registerOrg } = useAuth();
  const form = useForm({
    initial: { displayName: '', email: '', password: '', orgName: '', campusCode: '', campusName: '', campusAddress: '' },
    guard: false,
    validate: (v) => {
      const e: Record<string, string> = {};
      if (v.displayName.trim().length < 2) e.displayName = 'Nhập họ tên người quản trị.';
      if (!EMAIL_RE.test(v.email.trim())) e.email = 'Email chưa đúng định dạng.';
      if (v.password.length < 6) e.password = 'Mật khẩu tối thiểu 6 ký tự.';
      if (v.orgName.trim().length < 2) e.orgName = 'Tên tổ chức tối thiểu 2 ký tự.';
      const hasCampus = v.campusCode.trim() || v.campusName.trim();
      if (hasCampus && !/^[A-Za-z0-9_-]{2,20}$/.test(v.campusCode.trim())) e.campusCode = 'Mã 2–20 ký tự: chữ, số, gạch nối.';
      if (hasCampus && v.campusName.trim().length < 2) e.campusName = 'Nhập tên cơ sở.';
      return e;
    },
  });
  return (
    <form
      className="stack"
      noValidate
      onSubmit={form.onSubmit(async (v, opId) => {
        const hasCampus = v.campusCode.trim() && v.campusName.trim();
        await registerOrg(
          {
            displayName: v.displayName,
            email: v.email,
            password: v.password,
            orgName: v.orgName,
            campus: hasCampus ? { code: v.campusCode.trim(), name: v.campusName.trim(), address: v.campusAddress.trim() } : undefined,
          },
          opId,
        );
      })}
    >
      <Banner tone="info">Bản dùng thử: bạn trở thành chủ chuỗi của tổ chức mới và có toàn quyền quản trị.</Banner>
      {form.formError ? <Banner tone="error">{form.formError}</Banner> : null}
      <FormField name="displayName" label="Họ tên người quản trị" required {...form.field('displayName')}>
        <Input {...form.bind('displayName')} autoComplete="name" />
      </FormField>
      <FormField name="email" label="Email" required {...form.field('email')}>
        <Input {...form.bind('email')} type="email" autoComplete="username" inputMode="email" />
      </FormField>
      <FormField name="password" label="Mật khẩu" required helper="Tối thiểu 6 ký tự." {...form.field('password')}>
        <Input {...form.bind('password')} type="password" autoComplete="new-password" />
      </FormField>
      <FormField name="orgName" label="Tên tổ chức" required {...form.field('orgName')}>
        <Input {...form.bind('orgName')} autoComplete="organization" />
      </FormField>
      <div className="text-small text-secondary">Cơ sở đầu tiên (tùy chọn, có thể tạo sau)</div>
      <div className="grid-2">
        <FormField name="campusCode" label="Mã cơ sở" {...form.field('campusCode')}>
          <Input {...form.bind('campusCode')} placeholder="CG" />
        </FormField>
        <FormField name="campusName" label="Tên cơ sở" {...form.field('campusName')}>
          <Input {...form.bind('campusName')} />
        </FormField>
      </div>
      <FormField name="campusAddress" label="Địa chỉ cơ sở" {...form.field('campusAddress')}>
        <Input {...form.bind('campusAddress')} />
      </FormField>
      <Button type="submit" size="lg" block loading={form.submitting}>Tạo tổ chức và tài khoản</Button>
      <Button variant="tertiary" onClick={() => onMode('login')}>Đã có tài khoản? Đăng nhập</Button>
    </form>
  );
}

/** W01 — Đăng nhập web quản trị (ngoài khung ứng dụng). */
export function W01Login() {
  const { status } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>('login');

  useEffect(() => {
    if (status === 'ready') {
      const next = params.get('next');
      router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
    }
  }, [status, params, router]);

  const title = mode === 'login' ? 'Đăng nhập quản trị' : mode === 'forgot' ? 'Quên mật khẩu' : 'Đăng ký tổ chức mới';
  const busy = status === 'loading' || status === 'bootstrapping' || status === 'ready';

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <span className="brand-mark" aria-hidden="true">M</span>
          <div>
            <div className="page-head-code">W01</div>
            <h1 style={{ fontSize: 'var(--fs-h2)', lineHeight: 'var(--lh-h2)' }}>{title}</h1>
          </div>
        </div>
        {busy ? (
          <div role="status" aria-label="Đang đăng nhập" className="stack">
            <Skeleton height={52} />
            <Skeleton height={52} />
            <Skeleton height={56} />
            <span className="text-secondary text-small">Đang chuẩn bị không gian làm việc…</span>
          </div>
        ) : mode === 'login' ? (
          <LoginForm onMode={setMode} />
        ) : mode === 'forgot' ? (
          <ForgotForm onMode={setMode} />
        ) : (
          <RegisterForm onMode={setMode} />
        )}
      </div>
    </div>
  );
}

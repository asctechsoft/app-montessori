'use client';
import { usePathname } from 'next/navigation';
import { matchScreen } from '@/lib/screens';
import { SCREEN_COMPONENTS } from '@/screens/registry';
import { ComingSoon } from '@/screens/ComingSoon';
import { NotFoundView } from '@/components/layout/ScreenGuard';

/**
 * Bộ định tuyến màn hình: khớp pathname với src/lib/screens.ts rồi render component đã đăng ký ở src/screens/registry.tsx.
 * Màn chưa có component => ComingSoon (không 404). Quyền đã được ScreenGuard (layout) kiểm tra trước.
 */
export default function ScreenRouter() {
  const pathname = usePathname();
  const m = matchScreen(pathname);
  if (!m) return <NotFoundView />;
  const Screen = SCREEN_COMPONENTS[m.screen.code];
  if (!Screen) return <ComingSoon screen={m.screen} />;
  return <Screen screen={m.screen} params={m.params} />;
}

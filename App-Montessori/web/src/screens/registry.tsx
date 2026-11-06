import type { ComponentType } from 'react';
import type { ScreenDef } from '@/lib/screens';
import { W02Overview } from './W02Overview';
import { W03Campuses } from './W03Campuses';
import { W04CreateCampus } from './W04CreateCampus';
import { W06Roles } from './W06Roles';
import { W07Members } from './W07Members';
import { GROUP_A } from './groupA';
import { GROUP_B } from './groupB';
import { GROUP_C } from './groupC';

export interface ScreenProps {
  screen: ScreenDef;
  params: Record<string, string>;
}

/**
 * Đăng ký component cho từng mã màn hình. Mã chưa đăng ký => ComingSoon.
 * Thêm trang mới: tạo src/screens/Wxx<Ten>.tsx rồi thêm một dòng ở đây (xem web/README.md).
 * W01 (đăng nhập) nằm ngoài khung ứng dụng: src/app/dang-nhap/page.tsx.
 */
export const SCREEN_COMPONENTS: Partial<Record<string, ComponentType<ScreenProps>>> = {
  W02: W02Overview,
  W03: W03Campuses,
  W04: W04CreateCampus,
  W06: W06Roles,
  W07: W07Members,
  ...GROUP_A,
  ...GROUP_B,
  ...GROUP_C,
};

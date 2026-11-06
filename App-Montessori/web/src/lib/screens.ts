// Bảng mã màn hình W01–W48 <-> route <-> tiêu đề <-> quyền <-> nhóm menu.
// ĐÂY là nguồn duy nhất cho menu và guard route. Thêm/đổi route ở đây, không rải rác nơi khác.
import { hasPerm, hasPermAnywhere, type PermsByCampus } from './permissions';

export type ScreenScope =
  /** Cần quyền cấp tổ chức (khóa '*'). */
  | 'org'
  /** Cần quyền tại cơ sở đang thao tác. */
  | 'campus'
  /** Có quyền ở bất kỳ cơ sở nào; trang tự lọc dữ liệu theo quyền (rules chặn phía máy chủ). */
  | 'any';

export type MenuGroup =
  | 'Tổng quan' | 'Cơ sở' | 'Tuyển sinh' | 'Trẻ và lớp' | 'Điểm danh' | 'Chăm sóc' | 'Nhân sự' | 'Công và lương'
  | 'Học phí' | 'Thu tiền' | 'Thu chi' | 'Bếp và kho' | 'Tài sản' | 'Xe đưa đón' | 'Kết nối' | 'Phê duyệt' | 'Báo cáo' | 'Hệ thống';

export const MENU_GROUPS: MenuGroup[] = [
  'Tổng quan', 'Cơ sở', 'Tuyển sinh', 'Trẻ và lớp', 'Điểm danh', 'Chăm sóc', 'Nhân sự', 'Công và lương', 'Học phí',
  'Thu tiền', 'Thu chi', 'Bếp và kho', 'Tài sản', 'Xe đưa đón', 'Kết nối', 'Phê duyệt', 'Báo cáo', 'Hệ thống',
];

export interface ScreenDef {
  code: string; // W01..W48
  /** Đường dẫn, tham số dạng `:id`. */
  path: string;
  title: string;
  group: MenuGroup | null;
  /** Hiện trong menu (trang danh sách/chính). Trang chi tiết = false. */
  menu: boolean;
  /** Cần MỘT trong các quyền này. `null` = chỉ cần đăng nhập, `'public'` = không cần đăng nhập. */
  perm: string[] | null | 'public';
  scope: ScreenScope;
  /** Nhãn ngắn trong menu (mặc định = title). */
  menuLabel?: string;
}

const S = (
  code: string, path: string, title: string, group: MenuGroup | null, menu: boolean,
  perm: string[] | null | 'public', scope: ScreenScope, menuLabel?: string,
): ScreenDef => ({ code, path, title, group, menu, perm, scope, menuLabel });

export const SCREENS: ScreenDef[] = [
  S('W01', '/dang-nhap', 'Đăng nhập web quản trị', null, false, 'public', 'any'),
  S('W02', '/tong-quan', 'Tổng quan toàn chuỗi', 'Tổng quan', true, ['reports.read'], 'org', 'Toàn chuỗi'),
  S('W48', '/van-hanh', 'Tổng quan vận hành cơ sở', 'Tổng quan', true, ['campus.read'], 'campus', 'Vận hành cơ sở'),
  S('W03', '/co-so', 'Danh sách cơ sở', 'Cơ sở', true, ['campus.read'], 'any'),
  S('W04', '/co-so/moi', 'Tạo cơ sở mới', 'Cơ sở', false, ['campus.manage'], 'org'),
  S('W05', '/co-so/nam-hoc', 'Cấu hình năm học và lịch vận hành', 'Cơ sở', true, ['campus.manage'], 'campus', 'Năm học và lịch'),
  S('W08', '/tuyen-sinh', 'Danh sách tuyển sinh', 'Tuyển sinh', true, ['leads.read'], 'campus'),
  S('W09', '/tuyen-sinh/:id', 'Chi tiết tư vấn và duyệt nhập học', 'Tuyển sinh', false, ['leads.read'], 'campus'),
  S('W10', '/tre', 'Danh sách trẻ và phụ huynh', 'Trẻ và lớp', true, ['children.read'], 'campus', 'Trẻ và phụ huynh'),
  S('W11', '/tre/:id', 'Chi tiết hồ sơ trẻ', 'Trẻ và lớp', false, ['children.read'], 'campus'),
  S('W12', '/tre/moi', 'Thêm trẻ và liên kết phụ huynh', 'Trẻ và lớp', false, ['children.write'], 'campus'),
  S('W13', '/tre/:id/chuyen', 'Chuyển lớp hoặc cơ sở', 'Trẻ và lớp', false, ['children.transfer'], 'campus'),
  S('W14', '/lop', 'Danh sách lớp học', 'Trẻ và lớp', true, ['classes.read'], 'campus', 'Lớp học'),
  S('W15', '/lop/:id', 'Chi tiết lớp và phân công', 'Trẻ và lớp', false, ['classes.read'], 'campus'),
  S('W16', '/diem-danh', 'Điểm danh trẻ toàn cơ sở', 'Điểm danh', true, ['attendance.read'], 'campus', 'Điểm danh toàn cơ sở'),
  S('W17', '/diem-danh/ban-giao', 'Giám sát bàn giao cuối ngày', 'Điểm danh', true, ['attendance.read'], 'campus', 'Bàn giao cuối ngày'),
  S('W18', '/cham-soc/nhat-ky', 'Kiểm tra nhật ký chăm sóc', 'Chăm sóc', true, ['care.read'], 'campus', 'Nhật ký chăm sóc'),
  S('W19', '/cham-soc/suc-khoe', 'Sức khỏe và quản lý thuốc', 'Chăm sóc', true, ['medication.read', 'children.health.read'], 'campus', 'Sức khỏe và thuốc'),
  S('W20', '/cham-soc/su-co', 'Sự cố và xử lý', 'Chăm sóc', true, ['incident.read'], 'campus', 'Sự cố'),
  S('W21', '/nhan-su', 'Danh sách nhân sự', 'Nhân sự', true, ['staff.read'], 'campus'),
  S('W22', '/nhan-su/:id', 'Hồ sơ nhân viên và hợp đồng', 'Nhân sự', false, ['staff.read'], 'campus'),
  S('W23', '/nhan-su/lich-ca', 'Lập lịch ca làm việc', 'Nhân sự', true, ['roster.write', 'staff.read'], 'campus', 'Lịch ca làm việc'),
  S('W24', '/cong-luong/cham-cong', 'Bảng chấm công nhân viên', 'Công và lương', true, ['timekeeping.read'], 'campus', 'Chấm công'),
  S('W25', '/cong-luong/duyet-cong', 'Duyệt bổ sung và khóa công', 'Công và lương', true, ['timekeeping.approve', 'timekeeping.lock'], 'campus', 'Duyệt và khóa công'),
  S('W26', '/cong-luong/nghi-phep', 'Duyệt nghỉ phép và đổi ca', 'Công và lương', true, ['leave_staff.decide'], 'campus', 'Nghỉ phép và đổi ca'),
  S('W27', '/cong-luong/bang-luong', 'Bảng lương cơ sở', 'Công và lương', true, ['payroll.read'], 'campus', 'Bảng lương'),
  S('W28', '/cong-luong/bang-luong/:id', 'Chi tiết phiếu lương và chi trả', 'Công và lương', false, ['payroll.read'], 'campus'),
  S('W29', '/hoc-phi/bieu-phi', 'Biểu phí và dịch vụ', 'Học phí', true, ['fees.read'], 'campus'),
  S('W30', '/hoc-phi/ky-thu', 'Lập và phát hành kỳ thu', 'Học phí', true, ['billing.write', 'billing.approve'], 'campus', 'Kỳ thu'),
  S('W31', '/thu-tien/cong-no', 'Khoản phải thu và công nợ', 'Thu tiền', true, ['payments.read'], 'campus', 'Công nợ'),
  S('W32', '/thu-tien/cong-no/:childId', 'Chi tiết khoản thu của trẻ', 'Thu tiền', false, ['payments.read'], 'campus'),
  S('W33', '/thu-tien/thu', 'Thu tiền và phân bổ', 'Thu tiền', true, ['payments.write'], 'campus'),
  S('W34', '/thu-tien/doi-soat', 'Đối soát giao dịch ngân hàng', 'Thu tiền', true, ['payments.reconcile'], 'campus', 'Đối soát ngân hàng'),
  S('W35', '/thu-tien/hoan-dieu-chinh', 'Hoàn tiền và điều chỉnh chứng từ', 'Thu tiền', true, ['refunds.approve', 'payments.write'], 'campus', 'Hoàn tiền và điều chỉnh'),
  S('W36', '/thu-chi', 'Thu chi và quỹ cơ sở', 'Thu chi', true, ['expenses.read'], 'campus', 'Thu chi và quỹ'),
  S('W37', '/bep-kho/thuc-don', 'Thực đơn và chốt suất ăn', 'Bếp và kho', true, ['kitchen.read'], 'campus', 'Thực đơn và suất ăn'),
  S('W38', '/bep-kho/kho', 'Kho thực phẩm và vật tư', 'Bếp và kho', true, ['stock.read'], 'campus', 'Kho'),
  S('W39', '/tai-san', 'Tài sản và bảo trì', 'Tài sản', true, ['assets.read'], 'campus'),
  S('W40', '/xe-dua-don', 'Quản lý tuyến xe và chuyến đi', 'Xe đưa đón', true, ['transport.read'], 'campus', 'Tuyến xe và chuyến đi'),
  S('W41', '/ket-noi/thong-bao', 'Danh sách thông báo', 'Kết nối', true, ['notify.read'], 'campus', 'Thông báo'),
  S('W42', '/ket-noi/thong-bao/soan', 'Soạn và lên lịch thông báo', 'Kết nối', false, ['notify.send'], 'campus'),
  S('W43', '/ket-noi/trao-doi', 'Trao đổi và phản ánh phụ huynh', 'Kết nối', true, ['inbox.handle'], 'campus', 'Trao đổi phụ huynh'),
  S('W47', '/phe-duyet', 'Trung tâm phê duyệt', 'Phê duyệt', true, ['approvals.read'], 'any'),
  S('W44', '/bao-cao', 'Báo cáo quản trị', 'Báo cáo', true, ['reports.read'], 'any'),
  S('W06', '/he-thong/vai-tro', 'Vai trò và ma trận phân quyền', 'Hệ thống', true, ['members.read', 'roles.manage'], 'any', 'Vai trò và quyền'),
  S('W07', '/he-thong/tai-khoan', 'Quản lý tài khoản và lời mời', 'Hệ thống', true, ['members.read'], 'any', 'Tài khoản và lời mời'),
  S('W45', '/he-thong/nhat-ky', 'Nhật ký thao tác và truy cập', 'Hệ thống', true, ['audit.read'], 'any', 'Nhật ký thao tác'),
  S('W46', '/he-thong/nhap-sao-luu', 'Nhập dữ liệu và sao lưu', 'Hệ thống', true, ['import.write', 'backup.manage'], 'any', 'Nhập dữ liệu và sao lưu'),
];

export const SCREEN_BY_CODE: Record<string, ScreenDef> = Object.fromEntries(SCREENS.map((s) => [s.code, s]));

export const HOME_PATH = '/tong-quan';
export const LOGIN_PATH = '/dang-nhap';

function split(p: string): string[] {
  return p.split('/').filter(Boolean);
}

export interface ScreenMatch {
  screen: ScreenDef;
  params: Record<string, string>;
}

/** Khớp pathname với bảng màn hình. Đường dẫn tĩnh ưu tiên hơn đường dẫn có tham số. */
export function matchScreen(pathname: string): ScreenMatch | null {
  const segs = split(pathname.replace(/\/+$/, '') || '/');
  let best: (ScreenMatch & { dyn: number }) | null = null;
  for (const screen of SCREENS) {
    const pat = split(screen.path);
    if (pat.length !== segs.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    let dyn = 0;
    for (let i = 0; i < pat.length; i++) {
      if (pat[i].startsWith(':')) {
        params[pat[i].slice(1)] = decodeURIComponent(segs[i]);
        dyn++;
      } else if (pat[i] !== segs[i]) {
        ok = false;
        break;
      }
    }
    if (ok && (!best || dyn < best.dyn)) best = { screen, params, dyn };
  }
  return best ? { screen: best.screen, params: best.params } : null;
}

/** Dựng đường dẫn từ route có tham số: buildPath('/tre/:id', { id: 'abc' }). */
export function buildPath(path: string, params: Record<string, string> = {}): string {
  return path.replace(/:(\w+)/g, (_, k: string) => encodeURIComponent(params[k] ?? ''));
}

export type AccessResult =
  | { ok: true }
  | { ok: false; reason: 'no_permission' | 'need_campus' };

/** Dùng chung cho guard route. Quyết định hiển thị; máy chủ vẫn kiểm tra lại từng request. */
export function checkAccess(
  screen: ScreenDef,
  perms: PermsByCampus | undefined | null,
  campusId: string | 'all' | null,
): AccessResult {
  if (screen.perm === 'public' || screen.perm === null) return { ok: true };
  const list = screen.perm;
  if (screen.scope === 'org') return list.some((p) => hasPerm(perms, p, '*')) ? { ok: true } : { ok: false, reason: 'no_permission' };
  if (screen.scope === 'any') return list.some((p) => hasPermAnywhere(perms, p)) ? { ok: true } : { ok: false, reason: 'no_permission' };
  // campus
  if (!list.some((p) => hasPermAnywhere(perms, p))) return { ok: false, reason: 'no_permission' };
  if (!campusId || campusId === 'all') return { ok: false, reason: 'need_campus' };
  return list.some((p) => hasPerm(perms, p, campusId)) ? { ok: true } : { ok: false, reason: 'no_permission' };
}

/** Mục menu hiện khi người dùng có quyền ở đâu đó (để còn đổi cơ sở). */
export function isMenuVisible(screen: ScreenDef, perms: PermsByCampus | undefined | null): boolean {
  if (!screen.menu) return false;
  if (screen.perm === 'public' || screen.perm === null) return true;
  const list = screen.perm;
  if (screen.scope === 'org') return list.some((p) => hasPerm(perms, p, '*'));
  return list.some((p) => hasPermAnywhere(perms, p));
}

/** Trang đầu tiên người dùng được vào theo quyền (dùng cho "Về trang chính" và điều hướng sau đăng nhập). */
export function firstAccessiblePath(perms: PermsByCampus | undefined | null, campusId: string | 'all' | null): string {
  const order = [...SCREENS.filter((s) => s.menu)].sort((a, b) => MENU_GROUPS.indexOf(a.group as MenuGroup) - MENU_GROUPS.indexOf(b.group as MenuGroup));
  const ok = order.find((s) => checkAccess(s, perms, campusId).ok);
  if (ok) return ok.path;
  const visible = order.find((s) => isMenuVisible(s, perms));
  return visible?.path ?? '/khong-co-quyen';
}

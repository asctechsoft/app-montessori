// Source of truth for lib/xml_strings/*/strings.xml.
// Run: dart run tool/gen_strings.dart   then   dart run tool/check_strings.dart
//
// Each entry: 'key': ['English (fallback)', 'Tiếng Việt'].
// Placeholders: %1$s, %2$s ... (use `'key'.trParams({'args1': value})`).
// Add keys alphabetically within their group. Vietnamese status labels follow
// docs/CONTRACT.md §9 exactly.
import 'strings_parent.dart';
import 'strings_principal.dart';
import 'strings_teacher.dart';

const Map<String, List<String>> kStrings = {
  ...kStringsParent,
  ...kStringsTeacher,
  ...kStringsPrincipal,
  // ---- app / generic actions
  'splash_tagline': ['Preschool management', 'Quản lý trường mầm non'],
  'splash_init_failed': [
    "Couldn't start the app. Please try again.",
    'Không thể khởi động ứng dụng. Vui lòng thử lại.',
  ],
  'action_back': ['Back', 'Quay lại'],
  'action_cancel': ['Cancel', 'Hủy'],
  'action_clear_filters': ['Clear filters', 'Xóa bộ lọc'],
  'action_close': ['Close', 'Đóng'],
  'action_retry': ['Try again', 'Thử lại'],
  'state_loading': ['Loading', 'Đang tải'],
  'state_sending': ['Sending', 'Đang gửi'],
  'field_required': ['required', 'bắt buộc'],
  'password_show': ['Show password', 'Hiện mật khẩu'],
  'password_hide': ['Hide password', 'Ẩn mật khẩu'],
  'nav_badge_count': ['%1\$s new', '%1\$s mục mới'],
  'support_code': ['Support code: %1\$s', 'Mã hỗ trợ: %1\$s'],

  // ---- dates
  'date_today': ['Today', 'Hôm nay'],
  'date_yesterday': ['Yesterday', 'Hôm qua'],
  'weekday_1': ['Monday', 'Thứ Hai'],
  'weekday_2': ['Tuesday', 'Thứ Ba'],
  'weekday_3': ['Wednesday', 'Thứ Tư'],
  'weekday_4': ['Thursday', 'Thứ Năm'],
  'weekday_5': ['Friday', 'Thứ Sáu'],
  'weekday_6': ['Saturday', 'Thứ Bảy'],
  'weekday_7': ['Sunday', 'Chủ Nhật'],

  // ---- errors
  'error_generic': [
    'Something went wrong. Please try again.',
    'Đã xảy ra lỗi. Vui lòng thử lại.',
  ],
  'error_network': [
    'No connection to the server. Check your network and try again.',
    'Không kết nối được máy chủ. Kiểm tra mạng và thử lại.',
  ],
  'error_timeout': [
    'The server took too long to answer. Please try again.',
    'Máy chủ phản hồi quá lâu. Vui lòng thử lại.',
  ],
  'error_session_expired': [
    'Your session has expired. Please sign in again.',
    'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  ],
  'error_auth_invalid': [
    'Wrong email or password.',
    'Email hoặc mật khẩu không đúng.',
  ],
  'error_auth_disabled': [
    'This account has been disabled. Contact your school.',
    'Tài khoản đã bị khóa. Vui lòng liên hệ nhà trường.',
  ],
  'error_auth_too_many': [
    'Too many attempts. Please wait a few minutes and try again.',
    'Bạn thử quá nhiều lần. Vui lòng đợi vài phút rồi thử lại.',
  ],
  'error_required': ['This field is required.', 'Vui lòng nhập thông tin này.'],
  'error_email_invalid': ['Enter a valid email address.', 'Email không hợp lệ.'],
  'error_password_short': [
    'Password must have at least %1\$s characters.',
    'Mật khẩu cần ít nhất %1\$s ký tự.',
  ],
  'error_phone_invalid': [
    'Enter a valid phone number.',
    'Số điện thoại không hợp lệ.',
  ],
  'error_otp_invalid': [
    'The code is not correct. Check the 6 digits and try again.',
    'Mã xác thực chưa đúng. Kiểm tra lại 6 chữ số.',
  ],
  'error_date_range': [
    'The end date must not be before the start date.',
    'Ngày kết thúc phải từ ngày bắt đầu trở đi.',
  ],
  'error_load_title': ["Couldn't load data", 'Không tải được dữ liệu'],

  // ---- status views (DESIGN_SYSTEM §12)
  'empty_title': ['Nothing here yet', 'Chưa có dữ liệu'],
  'empty_message': [
    'When there is something to show, it will appear here.',
    'Khi có nội dung, thông tin sẽ hiển thị ở đây.',
  ],
  'no_results_title': ['No results', 'Không có kết quả'],
  'no_results_message': [
    'Try changing the search or filters.',
    'Thử đổi từ khóa hoặc bộ lọc.',
  ],
  'no_results_filters': [
    'Filters in use: %1\$s.',
    'Bộ lọc đang áp dụng: %1\$s.',
  ],
  'offline_stale_at': [
    'You are offline. Data saved at %1\$s.',
    'Đang ngoại tuyến. Dữ liệu lưu lúc %1\$s.',
  ],
  'offline_stale_unknown': [
    'You are offline. Showing saved data.',
    'Đang ngoại tuyến. Đang hiển thị dữ liệu đã lưu.',
  ],
  'offline_empty_title': ['You are offline', 'Không có kết nối mạng'],
  'offline_empty_message': [
    'Connect to Wi-Fi or mobile data, then try again. Nothing was saved on this device yet.',
    'Hãy kết nối Wi-Fi hoặc dữ liệu di động rồi thử lại. Chưa có dữ liệu nào được lưu trên máy.',
  ],
  'forbidden_title': [
    "You don't have access",
    'Bạn không có quyền xem nội dung này',
  ],
  'forbidden_message': [
    'Go back or contact your school manager if you need access.',
    'Hãy quay lại hoặc liên hệ quản lý nhà trường nếu cần được cấp quyền.',
  ],

  // ---- sync / offline queue
  'sync_device_time': ['Device time %1\$s', 'Giờ trên máy %1\$s'],
  'sync_offline': ['You are offline', 'Đang ngoại tuyến'],
  'sync_offline_pending': [
    'Offline - %1\$s actions not synced',
    'Ngoại tuyến - %1\$s thao tác chưa đồng bộ',
  ],
  'sync_pending_count': [
    '%1\$s actions not synced',
    '%1\$s thao tác chưa đồng bộ',
  ],
  'sync_sheet_title': ['Not synced yet', 'Chưa đồng bộ'],
  'sync_sheet_empty': [
    'Everything is synced.',
    'Mọi thao tác đã được đồng bộ.',
  ],
  'sync_retry_all': ['Sync now', 'Đồng bộ ngay'],
  'sync_discard': ['Discard', 'Bỏ thao tác'],

  // ---- status labels (CONTRACT §9)
  'status_unknown': ['Unknown', 'Không xác định'],
  'status_attendance_present': ['Present', 'Có mặt'],
  'status_attendance_absent_excused': ['Excused absence', 'Nghỉ có phép'],
  'status_attendance_absent_unexcused': ['Unexcused absence', 'Nghỉ không phép'],
  'status_attendance_no_class': ['No class', 'Ngày không học'],
  'status_attendance_unconfirmed': ['Unconfirmed', 'Chưa xác nhận'],
  'status_handover_not_received': ['Not received', 'Chưa nhận'],
  'status_handover_received': ['Received', 'Đã nhận'],
  'status_handover_picked_up': ['Picked up', 'Đã trả'],
  'status_payment_unpaid': ['Unpaid', 'Chưa thanh toán'],
  'status_payment_pending_reconciliation': [
    'Awaiting reconciliation',
    'Chờ đối soát',
  ],
  'status_payment_partially_paid': ['Partially paid', 'Đã thanh toán một phần'],
  'status_payment_paid': ['Paid', 'Đã thanh toán'],
  'status_payment_overdue': ['Overdue', 'Quá hạn'],
  'status_payment_cancelled': ['Cancelled', 'Đã hủy'],
  'status_approval_pending': ['Pending approval', 'Chờ duyệt'],
  'status_approval_approved': ['Approved', 'Đã duyệt'],
  'status_approval_rejected': ['Rejected', 'Từ chối'],
  'status_approval_cancelled': ['Cancelled', 'Đã hủy'],
  'status_campus_preparing': ['Preparing', 'Chuẩn bị'],
  'status_campus_active': ['Active', 'Đang hoạt động'],
  'status_campus_paused': ['Paused', 'Tạm ngừng'],
  'status_campus_closed': ['Closed', 'Đã đóng'],
  'status_sync_synced': ['Synced', 'Đã đồng bộ'],
  'status_sync_pending': ['Not synced', 'Chưa đồng bộ'],
  'status_sync_failed': ['Sending failed', 'Gửi không thành công'],

  // ---- scope (campus / class / child) and unsaved-changes guard
  'scope_campus': ['Campus', 'Cơ sở'],
  'scope_child': ['Child', 'Bé'],
  'scope_pick_campus': ['Choose campus', 'Chọn cơ sở'],
  'scope_unsaved_title': ['Discard unsaved changes?', 'Bỏ thay đổi chưa lưu?'],
  'scope_unsaved_message': [
    'Switching will discard what you have entered and load data for the new selection.',
    'Nếu chuyển, nội dung bạn đang nhập sẽ bị bỏ và dữ liệu của lựa chọn mới sẽ được tải lại.',
  ],
  'scope_unsaved_confirm': ['Discard and switch', 'Bỏ và chuyển'],
  'scope_unsaved_stay': ['Keep editing', 'Tiếp tục nhập'],

  // ---- sign-in
  'login_title': ['Welcome back', 'Chào mừng trở lại'],
  'login_subtitle': [
    'Sign in with the account your school gave you.',
    'Đăng nhập bằng tài khoản nhà trường đã cấp cho bạn.',
  ],
  'login_submit': ['Sign in', 'Đăng nhập'],
  'login_submitting': ['Signing in', 'Đang đăng nhập'],
  'login_forgot': ['Forgot password?', 'Quên mật khẩu?'],
  'login_with_phone': ['Sign in with phone number', 'Đăng nhập bằng số điện thoại'],
  'login_no_account_hint': [
    "No account yet? Ask your school to invite you with your email or phone number.",
    'Chưa có tài khoản? Hãy nhờ nhà trường mời bạn bằng email hoặc số điện thoại.',
  ],
  'login_error_network_title': ['No connection', 'Không có kết nối'],
  'field_email': ['Email', 'Email'],
  'field_password': ['Password', 'Mật khẩu'],
  'field_phone': ['Phone number', 'Số điện thoại'],
  'field_otp': ['Verification code', 'Mã xác thực'],
  'forgot_title': ['Reset password', 'Đặt lại mật khẩu'],
  'forgot_message': [
    'Enter your email. We will send you a link to choose a new password.',
    'Nhập email của bạn. Chúng tôi sẽ gửi liên kết để bạn đặt mật khẩu mới.',
  ],
  'forgot_submit': ['Send link', 'Gửi liên kết'],
  'forgot_sent_title': ['Check your email', 'Hãy kiểm tra email'],
  'forgot_sent_message': [
    'If this email has an account, a reset link has been sent.',
    'Nếu email này có tài khoản, liên kết đặt lại mật khẩu đã được gửi.',
  ],
  'forgot_back_to_login': ['Back to sign in', 'Quay lại đăng nhập'],
  'phone_title': ['Sign in with phone', 'Đăng nhập bằng số điện thoại'],
  'phone_message': [
    'Enter the phone number your school has on file. We will text you a code.',
    'Nhập số điện thoại nhà trường đã lưu. Chúng tôi sẽ gửi mã xác thực qua tin nhắn.',
  ],
  'phone_code_message': [
    'Enter the 6-digit code we sent to your phone.',
    'Nhập mã gồm 6 chữ số vừa gửi đến điện thoại của bạn.',
  ],
  'phone_send_code': ['Send code', 'Gửi mã'],
  'phone_confirm': ['Confirm code', 'Xác nhận mã'],
  'phone_resend': ['Send code again', 'Gửi lại mã'],

  // ---- roles and context picker
  'role_parent': ['Parent', 'Phụ huynh'],
  'role_teacher': ['Teacher', 'Giáo viên'],
  'role_principal': ['Principal', 'Hiệu trưởng'],
  'context_title': ['Choose role and campus', 'Chọn vai trò và cơ sở'],
  'context_message': [
    'Choose how you want to use the app now. You can switch later in Profile.',
    'Chọn cách bạn muốn dùng ứng dụng lúc này. Bạn có thể đổi lại trong mục Cá nhân.',
  ],
  'context_pick_campus': ['Choose a campus', 'Chọn cơ sở'],
  'context_empty_title': [
    'Your account is not linked to a school yet',
    'Tài khoản chưa được liên kết với nhà trường',
  ],
  'context_empty_message': [
    'Ask your school to invite you using this account\'s email or phone number, then try again.',
    'Hãy nhờ nhà trường mời bạn bằng email hoặc số điện thoại của tài khoản này, rồi thử lại.',
  ],

  // ---- bottom nav tabs
  'tab_home': ['Home', 'Trang chủ'],
  'tab_diary': ['Diary', 'Nhật ký'],
  'tab_tuition': ['Tuition', 'Học phí'],
  'tab_utilities': ['Utilities', 'Tiện ích'],
  'tab_profile': ['Profile', 'Cá nhân'],
  'tab_classroom': ['Classroom', 'Lớp học'],
  'tab_timeclock': ['My attendance', 'Công cá nhân'],
  'tab_overview': ['Overview', 'Tổng quan'],
  'tab_manage': ['Manage', 'Quản lý'],
  'tab_staff': ['Staff', 'Nhân sự'],
  'tab_approvals': ['Approvals', 'Phê duyệt'],

  // ---- placeholder screens (BUSINESS.txt §14 codes)
  'placeholder_title': ['Under construction', 'Đang được xây dựng'],
  'placeholder_message': [
    'This tab is a placeholder. The screens below will be built here.',
    'Tab này đang chờ phát triển. Các màn hình bên dưới sẽ được xây dựng tại đây.',
  ],
  'placeholder_scope_note': ['Scope: %1\$s', 'Phạm vi: %1\$s'],
  'screen_p01': ['Home by child', 'Trang chủ theo con'],
  'screen_p02': ['Diary and activities', 'Nhật ký và hoạt động'],
  'screen_p03': ['Leave requests and notes', 'Xin nghỉ và dặn dò'],
  'screen_p04': ['Authorised pick-up persons', 'Người đón'],
  'screen_p05': ['Tuition', 'Học phí'],
  'screen_p06': ['Health and profile', 'Sức khỏe và hồ sơ'],
  'screen_p07': ['Notifications and support', 'Thông báo và hỗ trợ'],
  'screen_t01': ['Today', 'Trang chủ hôm nay'],
  'screen_t02': ['Class and children (drop-off / pick-up)', 'Lớp và trẻ (nhận / trả trẻ)'],
  'screen_t03': ['Class diary', 'Nhật ký lớp'],
  'screen_t04': ['Medication and incidents', 'Thuốc và sự cố'],
  'screen_t05': ['Clock in / out', 'Chấm công'],
  'screen_t06': ['My timesheet and requests', 'Công cá nhân và đơn'],
  'screen_t07': ['Messages and account', 'Trao đổi và tài khoản'],
  'screen_h01': ['Overview', 'Tổng quan'],
  'screen_h02': ['Choose campus', 'Chọn cơ sở'],
  'screen_h03': ['Classes and children', 'Lớp và trẻ'],
  'screen_h04': ['Drop-off / pick-up monitoring', 'Theo dõi đón trả'],
  'screen_h05': ['Care and incidents', 'Chăm sóc và sự cố'],
  'screen_h06': ['Staff and shifts', 'Nhân sự và ca'],
  'screen_h07': ['Approvals', 'Phê duyệt'],
  'screen_h08': ['Approval detail', 'Chi tiết duyệt'],
  'screen_h09': ['Confirm decision', 'Xác nhận quyết định'],
  'screen_h10': ['Reports', 'Báo cáo'],

  // ---- profile
  'profile_section_account': ['Account', 'Tài khoản'],
  'profile_org': ['Organisation', 'Tổ chức'],
  'profile_campus': ['Campus', 'Cơ sở'],
  'profile_role': ['Role', 'Vai trò'],
  'profile_switch': ['Switch role or campus', 'Đổi vai trò hoặc cơ sở'],
  'profile_language': ['Language', 'Ngôn ngữ'],
  'profile_unsynced': ['Unsynced actions', 'Thao tác chưa đồng bộ'],
  'profile_unsynced_none': ['None', 'Không có'],
  'profile_catalog': ['Component catalog (debug)', 'Catalog component (debug)'],
  'profile_sign_out': ['Sign out', 'Đăng xuất'],
  'profile_version': ['Version %1\$s', 'Phiên bản %1\$s'],
  'signout_title': ['Sign out?', 'Đăng xuất?'],
  'signout_message': [
    'You will need to sign in again to use the app.',
    'Bạn cần đăng nhập lại để tiếp tục dùng ứng dụng.',
  ],
  'signout_message_pending': [
    '%1\$s actions are not synced yet. They stay on this device and are sent the next time you sign in with this account.',
    '%1\$s thao tác chưa đồng bộ. Chúng vẫn được giữ trên máy và sẽ gửi ở lần đăng nhập tiếp theo bằng tài khoản này.',
  ],
};

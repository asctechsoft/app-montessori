# Checklist triển khai design system

- [ ] Đọc DESIGN_SYSTEM.md và thống nhất framework mobile với đội phát triển.
- [ ] Import tokens.json; tạo adapter màu, text và kích thước theo nền tảng.
- [ ] Tạo AppText, AppIcon, AppSurface trước khi tạo widget nghiệp vụ.
- [ ] Tạo AppButton đủ biến thể và trạng thái; khóa gửi trùng khi loading.
- [ ] Tạo AppInput đủ label, helper, error, readOnly, disabled và validation.
- [ ] Tạo AppBadge, AppBanner, AppCard, Avatar và ListRow.
- [ ] Tạo ScreenScaffold, AppBar, BottomNav, BottomSheet và Dialog.
- [ ] Dựng catalog trạng thái để QA độc lập với dữ liệu thật.
- [ ] Ghép shell phụ huynh, giáo viên và hiệu trưởng dùng cùng token.
- [ ] Tạo ScopeSelector cho cơ sở, lớp và bé được cấp quyền.
- [ ] Tách trạng thái request, nghiệp vụ và đồng bộ.
- [ ] Nối API qua use case và repository, không gọi trong primitive UI.
- [ ] Kiểm tra quyền máy chủ; cache khóa theo scope; dọn khi đổi phiên.
- [ ] Kiểm tra hiển thị tiền, ngày giờ và dữ liệu mẫu xuyên màn hình.
- [ ] Kiểm tra chữ 100%, 150%, 200%; 320–430 và tablet; safe area và bàn phím.
- [ ] Kiểm tra screen reader, thứ tự focus và vùng chạm tối thiểu 48.
- [ ] Kiểm tra empty, no-results, loading, error, retry, offline và stale data.
- [ ] Chạy trên thiết bị thật và so với thông số trước khi duyệt phát hành.

Đây là checklist nền UI. Các tính năng API, thanh toán, chấm công và bàn giao cần kế hoạch triển khai nghiệp vụ riêng.

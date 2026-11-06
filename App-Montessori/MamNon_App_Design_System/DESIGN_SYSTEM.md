# Design system ứng dụng quản lý mầm non

Phiên bản 1.0.0 • Ngày 17 tháng 10 năm 2026 • Giao diện sáng

Bộ quy chuẩn dành cho app phụ huynh, giáo viên và hiệu trưởng của hệ thống trường mầm non nhiều cơ sở. Đây là đặc tả triển khai thống nhất từ các ảnh UI đã dựng. Các ảnh trước là bản tham khảo bố cục; thông số trong tài liệu và tokens.json là giá trị dùng để code, không đo khoảng cách hoặc lấy màu trực tiếp từ ảnh sinh tự động.

Gói gồm bảng mẫu HTML chạy offline, tài liệu Markdown, token JSON, bản TypeScript/CSS được xuất từ token, hợp đồng component và ví dụ lõi code không phụ thuộc framework. Phần code là nền tham khảo cho design system, chưa phải source app hoàn chỉnh, chưa có API hoặc xác thực thật. Công nghệ mobile chưa được chốt; cùng token có thể ánh xạ sang Flutter, React Native hoặc native Android/iOS.

## 1 Nguyên tắc thiết kế

- Giao diện dành cho người lớn thao tác trong ngày, không phải game cho trẻ. Tạo cảm giác gần gũi bằng xanh ngọc, khoảng trắng và hình ảnh hoạt động có kiểm soát.
- Mỗi màn chỉ có một hành động chính nổi bật. Dùng nhãn có động từ và đối tượng: Gửi đơn, Xác nhận nhận trẻ, Gửi đề nghị, Duyệt bổ sung.
- Luôn thấy ngữ cảnh đang thao tác: cơ sở, lớp hoặc bé. Đổi vai trò không được giữ nhầm dữ liệu của vai trò trước.
- Trạng thái nghiệp vụ phải được thể hiện bằng chữ và biểu tượng; màu chỉ hỗ trợ. Chờ đối soát không được tô như Đã thanh toán.
- Chữ và điều khiển phải co giãn theo cỡ chữ hệ thống. Khi thiếu chỗ, tăng chiều cao hoặc chuyển xếp dọc; không ép chữ bé hoặc cắt mất tên và số tiền quan trọng.
- Bản 1 chỉ quy định light mode. Không tự đảo màu để tạo dark mode; chế độ tối cần bộ semantic token và kiểm tra riêng.

## 2 Đơn vị và lưới bố cục

Đơn vị dưới đây là logical px, ánh xạ dp cho hình học Android và sp cho chữ, hoặc logical point theo hệ điều hành. Ảnh xuất 1080 px không có nghĩa nút phải rộng 1080 đơn vị trong code.

| Thành phần | Quy định |
| --- | --- |
| Khung thiết kế tham chiếu | Rộng 390; chiều cao nội dung được cuộn |
| Kích thước kiểm tra | 320, 360, 390, 430 và 600 |
| Lề trang | 24 mỗi bên; màn rộng dưới 360 dùng 16 |
| Khoảng cách theo lưới | 4, 8, 12, 16, 20, 24, 32, 40, 48, 64 |
| Khoảng các khối lớn | 24 |
| Khoảng giữa card trong danh sách | 12 |
| Padding card | 16; card tổng quan lớn có thể dùng 20 hoặc 24 |
| Khoảng label đến input | 8 |
| Khoảng input đến helper hoặc lỗi | 4 |
| Khoảng giữa hai field | 16 |
| Chiều rộng nội dung lớn nhất | 600, căn giữa trên tablet; màn danh sách chi tiết có thể cần bố cục riêng |
| Vùng chạm nhỏ nhất | 48 × 48 cho mọi thao tác |
| Safe area | Lấy inset thực tế từ hệ điều hành ở cả trên và dưới |

Nút cố định cuối màn nằm ngoài vùng cuộn và phía trên safe area, không đè bàn phím hoặc thanh điều hướng. Nội dung cuộn cần padding cuối bằng chiều cao vùng nút cộng inset thực tế. Không chèn một khoảng cố định theo ảnh chụp.

## 3 Màu cơ sở và semantic color

Màu brand #168579 giữ hướng xanh ngọc của bộ UI. Màu action #11776D đậm hơn dùng cho nền nút có chữ trắng. Màn hình gọi tên token theo vai trò sử dụng, không tự viết mã hex riêng.

| Token | Mã màu | Dùng cho |
| --- | --- | --- |
| brand | #168579 | Logo, nhấn mạnh, icon được chọn, đường chỉ tab |
| action | #11776D | Nút chính và chữ thao tác trên nền sáng |
| actionPressed | #0D5E56 | Nút chính khi nhấn |
| brandSoft | #E7F4F0 | Nền lựa chọn, thẻ ngữ cảnh, vùng chọn bé |
| background | #F7F9F8 | Nền màn hình |
| surface | #FFFFFF | Card, form, sheet, thanh điều hướng |
| surfaceMuted | #EFF4F2 | Vùng thông tin phụ, nhóm dữ liệu |
| textPrimary | #172D34 | Tiêu đề, nội dung chính |
| textSecondary | #52666E | Mô tả, label phụ |
| textTertiary | #667980 | Ngày giờ và nội dung hỗ trợ vẫn cần đọc |
| textOnAction | #FFFFFF | Chữ và icon trên nền action |
| borderSubtle | #DCE5E3 | Viền card trang trí, không dùng làm viền duy nhất để nhận biết input |
| borderControl | #738C88 | Viền input và điều khiển chưa focus |
| borderFocus | #168579 | Focus ring, lựa chọn có outline |
| success / successSoft | #287246 / #EAF5ED | Thành công, đã duyệt, đã nhận được xác nhận |
| warning / warningSoft | #916000 / #FFF4D9 | Chờ xử lý, cần chú ý; không phải lỗi nhập |
| error / errorSoft | #C13F36 / #FDEEEB | Lỗi, từ chối, thao tác nguy hiểm |
| info / infoSoft | #22669D / #EDF4FB | Hướng dẫn, thông tin trung lập |
| disabledFill | #E7ECEA | Nền control không tương tác |
| overlay | #172D348F | Lớp phủ phía sau modal hoặc sheet |

Cặp chữ thường cần tỷ lệ tương phản ít nhất 4.5:1; biên nhận biết control, focus và icon cần ít nhất 3:1 so với vùng kề. File validation.json ghi kết quả tính cho các cặp được sử dụng trong bộ này; chưa thay cho kiểm tra ứng dụng thật. Không dùng textTertiary để làm chữ trắng trên nền brand.

## 4 Background và bề mặt

| Vùng | Nền | Viền và chiều sâu |
| --- | --- | --- |
| Trang thông thường | background | Không ảnh nền sau nội dung dài |
| Trang đăng nhập | background; hình minh họa ở vùng riêng | Form vẫn đặt trên surface |
| Card nội dung | surface | borderSubtle 1, radius 16, không bóng mặc định |
| Thẻ bé hoặc lớp đang chọn | brandSoft | Viền brand 1–2 và dấu chọn |
| Header | surface hoặc background theo mẫu màn | Không gradient riêng từng phân hệ |
| Nút hành động nổi | action | Có thể dùng shadow floating |
| Modal và bottom sheet | surface | Overlay; radius góc trên 24 với sheet |
| Banner trạng thái | successSoft, warningSoft, errorSoft hoặc infoSoft | Icon và text cùng màu semantic đậm |

Không dùng gradient trong theme mặc định, nhằm đồng nhất màn hình và giữ chữ dễ đọc. Nếu dùng minh họa onboarding, để trong khung ảnh độc lập và giữ nút, label trên nền sáng thuần. Không dùng hiệu ứng kính mờ hoặc nền ảnh cho bảng công và học phí.

## 5 Text và typography

Dùng font hệ thống: iOS system và Android system; bản xem trước web dùng system-ui. Nếu về sau chọn font thương hiệu, cần kiểm tra đủ dấu tiếng Việt, chữ đậm và cơ chế fallback; file font không nằm trong gói này.

| Style | Size | Line height | Weight | Ví dụ |
| --- | --- | --- | --- | --- |
| display | 32 | 40 | 700 | Chào mừng trở lại |
| heading1 | 28 | 36 | 700 | Trang tổng quan |
| heading2 | 24 | 32 | 700 | Nhật ký của bé |
| heading3 | 20 | 28 | 600 | Hôm nay của Minh An |
| title | 18 | 26 | 600 | Tên card hoặc tên bé |
| body | 16 | 24 | 400 | Nội dung đọc, hướng dẫn |
| bodyStrong | 16 | 24 | 600 | Giá trị quan trọng trong dòng |
| bodySmall | 14 | 22 | 400 | Mô tả card, helper ngắn |
| label | 14 | 20 | 600 | Số điện thoại, Ngày nghỉ |
| button | 16 | 24 | 600 | Gửi đơn |
| caption | 12 | 18 | 400 | Ngày giờ phụ; không cho lỗi quan trọng |
| metric | 32 | 40 | 700 | 4.100.000đ hoặc 18 trẻ |

Weight dùng đúng font có sẵn, tránh giả đậm. Tracking mặc định 0. Tiêu đề không viết HOA toàn bộ, không dùng font quá tròn khiến số và dấu khó đọc. Số trong bảng và đồng hồ nên bật tabular numerals nếu nền tảng hỗ trợ.

Text dài: title cho tối đa 2 dòng ở card; màn chi tiết cho xuống dòng đầy đủ. Tên bé và số tiền không được cắt làm mất nhận diện; nếu hai cột quá chật thì chuyển xuống hàng. Body không truncate mặc định. Khi tăng cỡ chữ 200%, label và nút được tăng chiều cao, icon không đè chữ.

## 6 Button

| Biến thể | Nền | Chữ và icon | Viền | Mục đích |
| --- | --- | --- | --- | --- |
| Primary | action | textOnAction | Không | Hành động chính: Gửi đơn, Lưu, Tiếp tục |
| Secondary | surface | action | action 1 | Hành động phụ quan trọng: Xem trước |
| Tertiary | Trong suốt | action | Không | Hành động nhẹ: Xem tất cả |
| Destructive | error | Trắng | Không | Xác nhận hủy hoặc thu hồi sau khi đã xem tác động |
| Destructive outline | surface | error | error 1 | Từ chối hoặc Hủy bên cạnh nút duyệt |
| Icon button | Trong suốt; pressed dùng surfaceMuted | textSecondary hoặc action | Tùy ngữ cảnh | Quay lại, đóng, mở menu |

| Size | Chiều cao tối thiểu | Padding ngang | Chữ | Icon |
| --- | --- | --- | --- | --- |
| Small | 40, vùng chạm vẫn ít nhất 48 | 12 | label 14/20 | 16 |
| Medium | 48 | 16 | button 16/24 | 20 |
| Large | 56 | 20 | button 16/24 | 20–24 |

Bo góc nút 12. Khoảng icon và text 8. Full width cho CTA cuối form; nút inline theo nội dung nhưng không nhỏ hơn vùng chạm. Hai nút cạnh nhau cách 12; chiều rộng chia hợp lý, không để nhãn tiếng Việt xuống ba dòng. Với màn hẹp hoặc chữ lớn, xếp dọc.

### Trạng thái button

| State | Biểu hiện | Tương tác |
| --- | --- | --- |
| Default | Theo biến thể | Cho phép nếu quyền và dữ liệu hợp lệ |
| Pressed | Primary chuyển actionPressed; nút viền có nền brandSoft | Không đổi kích thước, không làm layout giật |
| Focused | Ring borderFocus 2, cách viền 2 | Giữ focus khi điều hướng bằng bàn phím hoặc switch |
| Loading | Spinner 20 thay icon; giữ label và chiều rộng; label có thể là Đang gửi | Chặn gửi lần hai; công bố trạng thái đang xử lý |
| Disabled | disabledFill và textDisabled; không giảm opacity toàn bộ | Không bấm; helper bên cạnh giải thích nếu cần |
| Error sau gửi | Nút về trạng thái có thể thử lại; lỗi ở form/banner | Giữ nội dung người dùng đã nhập |

Loading là trạng thái kỹ thuật, không phải Đang duyệt. Sau khi server tiếp nhận thành công, hiển thị đúng trạng thái nghiệp vụ rồi đóng spinner. Không báo Thành công khi request mới chỉ được xếp hàng trên thiết bị.

Ví dụ cặp nút: form xin nghỉ dùng Gửi đơn; duyệt dùng Từ chối và Duyệt; biểu mẫu có nháp dùng Lưu nháp và Xem trước. Nút Đăng bài đặt ở bước xem trước khi nội dung cần kiểm tra. Nút Hủy biểu mẫu không dùng nền đỏ đậm nếu chỉ quay lại mà không hủy chứng từ.

## 7 Input và form

Input có min-height 52, radius 12, padding ngang 16, chữ body 16/24. Viền borderControl 1, focus borderFocus 2, lỗi error 2. Textarea cao tối thiểu 120 và tăng theo nội dung. Label luôn ở ngoài input, không chỉ dùng placeholder.

| Loại | Hành vi |
| --- | --- |
| Text | Label, giá trị, helper; nút xóa có vùng chạm 48 nếu có |
| Số điện thoại | Bàn phím phù hợp; cho sửa mã quốc gia theo phạm vi triển khai; không tự làm mất số 0 |
| Mật khẩu | Mặc định ẩn; nút mắt có nhãn Hiện mật khẩu hoặc Ẩn mật khẩu |
| OTP | Hiển thị 6 ô nhưng xử lý như một trường có thể dán mã; không đọc rời từng ô gây khó nhập |
| Select | Có label, giá trị, chevron; chọn trong sheet có tìm kiếm khi danh sách dài |
| Date và time | Hiển thị dd/MM/yyyy và HH:mm; chọn theo giờ cơ sở; không dùng text input tùy ý nếu không có kiểm tra |
| Money | Giá trị VND nguyên đồng; tách dữ liệu số khỏi chuỗi hiển thị; có bàn phím số |
| Upload | Hiển thị định dạng, giới hạn thực tế từ server, tiến độ, lỗi, thử lại và gỡ tệp |
| Search | Icon tìm; nút xóa; kết quả theo cơ sở và quyền hiện tại |

State read-only khác disabled: read-only vẫn đọc và sao chép được; có label và giải thích nếu dữ liệu chỉ được cập nhật bằng yêu cầu. Field đang kiểm tra bất đồng bộ không khóa toàn form vô thời hạn.

Validation: kiểm tra bắt buộc khi rời field hoặc sau lần gửi đầu, không đỏ toàn trang ngay lúc mở. Lỗi hiển thị ngay dưới field bằng icon và text 14/22; focus hoặc cuộn đến lỗi đầu. Ví dụ Ngày kết thúc phải từ ngày bắt đầu trở đi. Khi gửi lỗi từ server, ánh xạ lỗi vào field; lỗi chung đặt thành banner ở trên CTA. Không xóa dữ liệu đã nhập khi mạng lỗi.

## 8 Checkbox radio switch và segmented control

Checkbox hiển thị 24 × 24, vùng chạm gồm cả label cao ít nhất 48. Radio tương tự; khoảng các lựa chọn 12–16. Chọn nhiều dùng checkbox, chọn một dùng radio. Dùng segmented control cho tối đa 3 lựa chọn ngắn như Cả ngày / Sáng / Chiều; nếu label dài thì chuyển thành danh sách radio.

Switch hiển thị khoảng 48 × 28, vùng chạm 48 × 48. Chỉ dùng cho cài đặt có hiệu lực rõ ràng. Thay đổi quyền giám hộ, chấp thuận ảnh hoặc quyền truy cập nhạy cảm cần bước xác nhận/lưu và không tự gửi ngay chỉ vì gạt switch. Không dùng switch thay nút Duyệt.

Các trạng thái selected, unselected, focused, disabled và error đều có nhãn truy cập. Đã chọn cần biểu tượng hoặc hình dạng, không chỉ thay màu nền.

## 9 Card list badge và banner

Card radius 16, padding 16, viền borderSubtle 1. Danh sách tên trẻ dùng avatar 40 hoặc 56, khoảng avatar–text 12, min-height dòng 64; có thể cao hơn khi có ghi chú. Chevron 20 chỉ thể hiện mở chi tiết, không dùng để thay nhãn của hành động nguy hiểm.

Card bấm toàn vùng không được chứa nút con có hành vi xung đột mà không phân tách vùng chạm. Nút Gọi và nút Trả trẻ không được dùng chung một sự kiện bấm toàn card.

Badge min-height 24, padding 4 × 8, radius pill; text label 12–14, icon 14–16 nếu có. Với chữ lớn, để badge tăng chiều cao. Banner padding 12–16, icon 20, khoảng icon–text 8–12; nội dung tối đa 2–3 câu ngắn, có action riêng khi cần.

| Trạng thái | Tone | Nhãn mẫu |
| --- | --- | --- |
| Có mặt hoặc Đã nhận | success | Bé đang ở trường |
| Đã trả có xác nhận | success hoặc info | Đã bàn giao lúc 16:45 |
| Xin nghỉ đang xử lý | warning | Chờ xác nhận |
| Thuốc chưa tiếp nhận | warning | Chờ tiếp nhận |
| Kỳ công còn lỗi | warning | Cần bổ sung lượt ra |
| Chưa thanh toán chưa đến hạn | info hoặc neutral | Chưa thanh toán, hạn 20/10 |
| Quá hạn thực tế | error | Quá hạn 3 ngày |
| Biên nhận chưa kiểm tra | warning | Chờ đối soát |
| Thanh toán đã xác nhận | success | Đã thanh toán |
| Ủy quyền hết hạn | error hoặc neutral kèm giải thích | Đã hết hiệu lực |
| Tác vụ chưa gửi do mất mạng | warning | Chưa đồng bộ |

Không dùng chấm xanh một mình cho phép đón trẻ. Cần cả người được phép, trẻ liên quan, khoảng hiệu lực và kết quả xác minh. Không coi màu xanh là thay thế kiểm tra quyền ở máy chủ.

## 10 Điều hướng và khung màn hình

| Vai trò | Bottom navigation 5 mục |
| --- | --- |
| Phụ huynh | Trang chủ, Nhật ký, Học phí, Tiện ích, Cá nhân |
| Giáo viên | Trang chủ, Lớp học, Nhật ký, Công cá nhân, Tiện ích |
| Hiệu trưởng | Tổng quan, Quản lý, Nhân sự, Phê duyệt, Cá nhân |

Bottom nav cao tối thiểu 64 chưa gồm safe area, icon 24, label 12/18. Mục active dùng action và nền brandSoft nhẹ hoặc chỉ báo; inactive dùng textSecondary. Badge số đọc được và có nhãn số lượng. Tên dài như Công cá nhân có thể 2 dòng, tăng chiều cao nav; không co toàn bộ chữ xuống dưới 12.

App bar cao tối thiểu 56 chưa gồm inset trên. Title 20/28 hoặc 18/26 theo độ dài; nút back có vùng chạm 48. Màn chi tiết có thể ẩn bottom nav để tập trung; back phải quay đúng danh sách và giữ bộ lọc nếu hợp lý. Sheet không tạo thêm một thanh nav mới.

Chọn bé dùng thẻ hoặc dropdown ngay đầu nội dung; chọn cơ sở của nhân sự luôn thấy trên header hoặc khối ngữ cảnh. Chỉ liệt kê bé, lớp, cơ sở được cấp quyền. Chuyển ngữ cảnh cần cảnh báo dữ liệu chưa lưu, xóa cache nhạy cảm của ngữ cảnh trước và tải lại dữ liệu theo quyền.

## 11 Sheet dialog toast và xác nhận

Bottom sheet: radius góc trên 24, padding 24 hoặc 16 ở màn hẹp, tay kéo 32 × 4 tùy nền tảng; tiêu đề 20/28. Nội dung dài cuộn trong sheet; CTA nằm trong vùng safe area. Danh sách ngắn có thể mở sheet vừa nội dung; form dài nên dùng màn riêng.

Dialog: chiều rộng tối đa 344 ở màn 390, margin ít nhất 24 khi có thể; padding 24, title 20/28, body 16/24. Có hành động quay lại rõ ràng, focus đi vào dialog và trở lại vị trí cũ khi đóng.

Toast/snackbar: báo nhẹ như Đã lưu nháp, không dùng làm nơi duy nhất báo lỗi chuyển tiền hoặc trẻ chưa bàn giao. Hiển thị khoảng 4 giây cho tin ngắn, lâu hơn hoặc chờ đóng với hành động; không tự đóng thông báo quan trọng trước khi người dùng đọc xong.

Xác nhận nhạy cảm phải nêu đối tượng và tác động: Xác nhận trả Nguyễn Minh An cho bà Trần Thị Hoa lúc 16:45?; Thu hồi quyền đón của người này từ bây giờ?; Hoàn 500.000đ từ chứng từ nào? Nếu thiếu dữ liệu kiểm tra, disable CTA và giải thích ngay tại màn.

## 12 Loading empty error offline và thành công

| Trạng thái màn | Quy định |
| --- | --- |
| Tải lần đầu | Skeleton theo layout dự kiến, không spinner toàn màn vô hạn |
| Đang làm mới | Giữ dữ liệu cũ, đánh dấu thời điểm cập nhật; không làm trắng màn |
| Không có dữ liệu | Icon nhẹ, câu giải thích và hành động phù hợp với quyền |
| Không có kết quả tìm | Hiển thị bộ lọc đang áp dụng và Xóa bộ lọc |
| Lỗi tải | Mô tả dễ hiểu, Thử lại, mã hỗ trợ nếu có; không lộ stack trace |
| Offline có cache | Banner Dữ liệu lưu lúc…; phân biệt dữ liệu cũ và bản ghi chờ gửi |
| Offline không cache | Màn hướng dẫn kết nối, không tạo chỉ số bằng 0 để thay dữ liệu thiếu |
| Gửi thành công | Chỉ hiện sau xác nhận server, kèm trạng thái nghiệp vụ thật |
| Không đủ quyền | Không lộ thông tin đối tượng; cho quay lại hoặc liên hệ quản lý |

Khi chấm công hoặc nhận trẻ lưu chờ đồng bộ, hiện rõ Chưa đồng bộ và thời gian thiết bị. Thanh toán, duyệt hoàn và trả trẻ cần quy trình kiểm tra trực tuyến hoặc dự phòng đã được trường xác nhận; UI không tự cho thao tác offline như thể đã hoàn tất.

## 13 Ảnh icon và chuyển động

Icon dùng một bộ nét đồng nhất, khung 24 và stroke khoảng 1.75; icon nhỏ 16–20. Bản đầu không đóng gói bộ icon bản quyền riêng; dev chọn một bộ có quyền sử dụng phù hợp và ánh xạ tên semantic: home, child, classroom, attendance, pickup, diary, meal, sleep, health, medicine, calendar, money, approve, settings.

Avatar: 32, 40, 56; màn hồ sơ có thể 80. Không có ảnh dùng initials hoặc silhouette phù hợp; không dùng ảnh một bé khác làm fallback. Ảnh album có tỷ lệ 4:3 hoặc 1:1 theo component; giữ object-fit cover và mở ảnh đầy đủ khi xem chi tiết. Ảnh trẻ và tài liệu không có URL công khai dài hạn, không ghi vào analytics.

Press feedback 100 ms; fade 150 ms; sheet và navigation 240 ms theo đường cong nền tảng. Không bounce cho tác vụ công nợ, duyệt hoặc bàn giao. Khi giảm chuyển động, bỏ hoạt ảnh trang trí và chuyển cảnh không cần thiết; vẫn giữ tín hiệu đang tải có thể nhận biết.

## 14 Mẫu màn hình theo nghiệp vụ

### Trang chủ phụ huynh

Thứ tự: chào và thông báo → chọn bé → tình trạng ở trường → tác vụ nhanh Xin nghỉ, Dặn dò, Đón thay, Học phí → nhật ký tóm tắt → khoản cần đóng và thông báo. Một phần tử có thể không có dữ liệu; không tự hiện Đã ăn hoặc Đã ngủ khi giáo viên chưa ghi.

### Nhận trả trẻ của giáo viên

Header cơ sở, lớp và ngày → bộ lọc trạng thái → danh sách → hồ sơ bàn giao → người đón hợp lệ → kiểm tra → nút xác nhận. Cảnh báo dị ứng chỉ hiển thị thông tin cần cho nhiệm vụ. Mọi thao tác có state đang gửi, đã xác nhận hoặc chờ đồng bộ.

### Công cá nhân

Ca và nơi làm → trạng thái vị trí nếu dùng → nút Chấm vào hoặc Chấm ra đúng bước → lịch sử lượt gốc → giải trình. Nếu đã chấm vào thì không vẫn hiện nút Chấm vào như hành động chính. Không hiển thị đủ công khi thiếu lượt ra.

### Học phí

Chọn con → tổng còn phải đóng → kỳ hiện tại và nợ cũ → chi tiết → phương thức → kết quả xác nhận hoặc chờ đối soát. Số tiền không bị tràn dòng hoặc cộng lặp. Nút Gửi biên nhận không được đổi thành Đã thanh toán ngay sau tải ảnh.

### Phê duyệt hiệu trưởng

Chọn cơ sở → danh sách chờ → chi tiết trước và sau → tác động → ý kiến → Từ chối hoặc Duyệt. Chỉ có quyền được cấp mới hiện CTA; máy chủ vẫn phải kiểm tra lại. Không dùng cùng một modal chung thiếu nội dung để duyệt công, hoàn tiền và bàn giao trẻ.

## 15 Codebase và core dùng chung

Chưa chốt framework hoặc phiên bản SDK trong gói này. Cấu trúc dưới đây là ranh giới trách nhiệm để dev ánh xạ vào dự án thực tế. Không coi ví dụ TypeScript là yêu cầu bắt buộc dùng React Native.

```text
app/
  bootstrap/               Khởi tạo môi trường và dependency
  navigation/              Route và chuyển vai trò
  composition/             Ghép repository, dịch vụ và màn hình
core/
  design_system/
    tokens/                Token gốc và adapter nền tảng
    theme/                 Ánh xạ semantic và scale chữ
    primitives/            AppText, AppIcon, AppSurface
    components/            Button, Input, Card, Badge, Sheet
    patterns/              ScreenScaffold, FormLayout, StatusView
  session/                 Phiên và thu hồi phiên
  scope/                   organization, campus, role, child, class
  permissions/             Kiểm tra khả năng thao tác trên UI
  network/                 Lỗi chuẩn, request id, retry policy
  storage/                 Cache có scope, dọn khi đổi phiên
  sync/                    Hàng đợi được phép, trạng thái đồng bộ
  formatting/              Tiền, ngày và giờ cơ sở
  observability/           Log đã loại dữ liệu nhạy cảm
features/
  auth/  children/  classrooms/  attendance/  handover/
  daily_care/  medication/  incidents/  timekeeping/
  leave/  payroll/  tuition/  payments/  messaging/
  approvals/  profile/
roles/
  parent/                  Shell và navigation phụ huynh
  teacher/                 Shell và navigation giáo viên
  principal/               Shell và navigation hiệu trưởng
catalog/                    Gallery component và trạng thái
```

Mỗi feature chia presentation, application, domain, data khi độ phức tạp cần: UI gọi use case; use case áp quy tắc; repository qua adapter gọi API. Component thiết kế không import repository, API hoặc session cụ thể. Màn hình không tự tạo style nút và mã màu nếu đã có component chung.

Có thể đóng gói app phụ huynh riêng với app nhân sự; giáo viên và hiệu trưởng dùng shell khác nhau trong app nhân sự. Nếu chọn một app nhiều vai trò thì vẫn giữ route, quyền và cache tách theo scope. Không nhân bản hai bộ token để làm hai app.

### Hợp đồng component

- AppText: style semantic, tone, text, scaling; không nhận fontSize tự do ở mọi màn.
- AppButton: variant, size, label, icon, loading, disabled, accessibilityLabel, onPress; không chứa logic gọi API trực tiếp.
- AppInput: label, value, helper, error, required, readOnly, disabled, inputMode và onChange.
- AppBadge: label và tone; không suy trạng thái chỉ từ màu hoặc một giá trị boolean chung.
- AppScreen: app bar, ngữ cảnh, body, footer, safe area, keyboard policy và state tải.
- ScopeSelector: danh sách đã được cấp quyền, giá trị hiện tại, xử lý dữ liệu chưa lưu và yêu cầu tải lại.
- ChildRow và ApprovalCard thuộc shared pattern nghiệp vụ, không làm phình primitive Card bằng hàng chục props đặc thù.

### Lõi trạng thái

Tách trạng thái request idle/loading/success/error khỏi trạng thái đơn draft/submitted/approved/rejected. Tách trạng thái thanh toán unpaid/pending_reconciliation/partially_paid/paid khỏi quyền người dùng. Khi component đang loading, chặn thao tác trùng ở UI; máy chủ cần idempotency riêng để xử lý request lặp thực sự.

Khóa cache gồm organization, campus, user, role và tài nguyên phù hợp; dữ liệu trẻ thêm child hoặc class scope. Đổi cơ sở hoặc đăng xuất không được hiện ảnh và nội dung cache của phiên trước trong lúc tải. Route guard trên máy chỉ hỗ trợ trải nghiệm, không thay phân quyền máy chủ.

Số tiền lưu số nguyên VND ở phạm vi đã kiểm tra an toàn; hàm ví dụ từ chối NaN và số thập phân. Quy tắc học phí, hoàn ăn, công và lương nằm trong domain/API, không nằm trong token hoặc component.

## 16 Quy tắc nội dung và dữ liệu mẫu

Dùng tiếng Việt thống nhất: Hiệu trưởng, Phụ huynh, Giáo viên, Cơ sở, Lớp, Xin nghỉ, Người đón, Chờ đối soát. Số tiền hiển thị 4.100.000 đ; ngày 15/10/2026; giờ 07:35, theo cơ sở. Không trộn ngày thiết bị với ngày công hoặc ngày học nếu khác múi giờ.

Fixture chung: Nguyễn Minh An, mã MN001, Mầm 1, Cầu Giấy; ngày sinh 12/05/2023; mẹ Nguyễn Thùy Linh; bố Nguyễn Văn Nam; cô Lan; hiệu trưởng cô Hương. Đây là dữ liệu mẫu, không phải hồ sơ thật. Không tự đổi lớp của cùng bé giữa các màn nếu chưa qua luồng chuyển lớp.

Ví dụ học phí: 3.000.000 + 770.000 + 200.000 − 300.000 − 70.000 = 3.600.000; nợ cũ 500.000; tổng 4.100.000 đ. Tên dòng 200.000 là Đón muộn, dòng −70.000 là Hoàn trừ tiền ăn kỳ trước. Hạn đóng 20/10/2026 thì ngày 15/10/2026 chưa được đánh dấu Quá hạn.

## 17 Tổ chức file thiết kế và triển khai

Trang thiết kế nên gồm Foundations, Components, Patterns, Parent, Teacher, Principal, States và Handoff. Tên component dùng nhóm và biến thể, ví dụ Button/Primary/Large/Default hoặc Input/Date/Error. Biến thể không tách thành component mới chỉ vì đổi label.

Thứ tự dev: nhập token → viết primitive → button/input/badge/card → scaffold/nav/sheet → dựng catalog trạng thái → ghép màn theo vai trò → nối dữ liệu và kiểm tra quyền → kiểm tra máy thật. Giữ phiên bản token 1.0.0; thay đổi tên hoặc ý nghĩa token cần migration, không tự sửa rải rác từng màn.

## 18 Checklist bàn giao

- Đúng token màu, type và spacing; không có mã hex riêng trong feature khi token đã tồn tại.
- Button đủ default, pressed, loading, disabled, focus; input đủ lỗi, read-only, disabled.
- Kiểm tra 320–430 và tablet; cỡ chữ 100%, 150%, 200%; không tràn tiếng Việt.
- Vùng chạm ít nhất 48; thứ tự đọc đúng; icon không nhãn có accessibility label.
- Trạng thái có text; không dùng màu là dấu hiệu duy nhất; contrast kiểm tra trên nền thật.
- Nút footer không đè nội dung, bàn phím hoặc safe area.
- Parent chỉ thấy con được liên kết; teacher theo lớp; principal theo cơ sở và quyền được cấp.
- Không báo thanh toán, nhận trẻ hoặc bàn giao hoàn tất khi mới lưu cục bộ.
- Có empty, no-results, error, retry, offline và stale data.
- Lỗi gửi giữ dữ liệu; request lặp không tạo trùng; cập nhật đồng thời cần đối chiếu.
- Dữ liệu mẫu và ví dụ tài chính đồng nhất; không phát sinh thông tin sức khỏe suy đoán.
- Kiểm tra trên thiết bị thật trước phát hành; preview HTML chỉ là bảng tham chiếu trực quan.

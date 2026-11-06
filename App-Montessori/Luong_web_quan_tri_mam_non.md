# Luồng sử dụng web quản trị trường mầm non nhiều cơ sở

Phiên bản bổ sung giao diện web ngày 15 tháng 10 năm 2026

Web là nơi thiết lập và quản trị dữ liệu chung cho app phụ huynh, giáo viên và hiệu trưởng. Bộ thiết kế gồm 48 màn hình chính, ký hiệu W01 đến W48. Các ảnh là thiết kế giao diện để duyệt sản phẩm; chức năng và dữ liệu mẫu cần được triển khai, kiểm thử trong phần mềm thực tế.

## 1 Phạm vi và điều hướng

Chủ chuỗi được xem tổng hợp và làm việc tại những cơ sở thuộc tổ chức của mình. Hiệu trưởng chỉ được truy cập cơ sở được giao. Nhân sự, kế toán, y tế, bếp và người phụ trách xe dùng cùng web nhưng chỉ thấy các chức năng đã được cấp quyền. Không tạo tài khoản dùng chung cho cả cơ sở.

Thanh trên cùng hiển thị cơ sở đang thao tác, năm học, thông báo và người đăng nhập. Khi đổi cơ sở, bộ lọc và dữ liệu phải tải lại; nếu còn biểu mẫu chưa lưu thì nhắc lưu hoặc bỏ thay đổi. Không lấy bộ chọn cơ sở trên giao diện làm căn cứ duy nhất để cấp quyền; máy chủ phải kiểm tra quyền cho từng yêu cầu.

Menu chính gồm Tổng quan, Cơ sở, Tuyển sinh, Trẻ và lớp, Điểm danh, Chăm sóc, Nhân sự, Công và lương, Học phí, Thu tiền, Thu chi, Bếp và kho, Tài sản, Xe đưa đón, Kết nối, Phê duyệt, Báo cáo và Hệ thống. Những mục không được cấp quyền sẽ bị ẩn và cũng không truy cập được bằng đường dẫn trực tiếp.

## 2 Đăng nhập và khởi tạo cơ sở

Luồng màn hình: W01 → W02 → W03 → W04 → W05 → W06 → W07 → W48.

1. Người dùng đăng nhập tài khoản cá nhân tại W01. Có xác minh bổ sung và khôi phục truy cập khi cần. Tài khoản bị khóa không thể tiếp tục dùng phiên cũ.
2. Chủ chuỗi vào W02 xem toàn chuỗi, sau đó mở W03 để xem danh sách cơ sở.
3. Tại W04, nhập mã, tên, địa chỉ, giờ địa phương, liên hệ và mời hiệu trưởng. Nếu sao chép từ cơ sở khác, chỉ chọn danh mục và cấu hình, không sao chép hồ sơ trẻ hoặc giao dịch.
4. W05 thiết lập năm học, ngày học, ngày nghỉ, giờ mở cửa và khung giờ đón trả. Ngoại lệ theo ngày được lưu riêng.
5. W06 cấp vai trò và quyền; W07 mời từng người dùng và gán phạm vi. Không cấp mặc định quyền duyệt tài chính chỉ vì người đó là hiệu trưởng.
6. Hoàn tất thiết lập, kích hoạt vận hành và mở W48 để kiểm tra tổng quan cơ sở.

Trạng thái cơ sở gồm Chuẩn bị, Đang hoạt động, Tạm ngừng và Đã đóng. Cơ sở có dữ liệu không được xóa cứng. Khi đóng phải giải quyết trẻ đang học, nhân sự, công nợ và đặt cọc còn lại.

## 3 Tuyển sinh và nhập học

Luồng màn hình: W08 → W09 → W12 → W10 → W11 → W14 → W15.

1. Nhân viên tuyển sinh tạo nhu cầu ở W08, ghi thông tin liên hệ, tuổi của bé, cơ sở quan tâm, nguồn tiếp nhận và lịch tư vấn.
2. Tại W09, ghi nội dung tư vấn, tham quan, học thử và giấy tờ. Chuyển trạng thái theo tiến trình; một khách quan tâm chưa được tính vào sĩ số đang học.
3. Khi đủ điều kiện, chọn lớp, ngày nhập học và biểu phí; kiểm tra sĩ số sau khi nhận trẻ. Nếu lớp đầy, đề xuất lớp khác hoặc gửi xin duyệt ngoại lệ theo chính sách.
4. W12 tạo hoặc hoàn thiện hồ sơ trẻ, liên kết người giám hộ và tách quyền nhận thông báo, xem học phí, đón trẻ. Kiểm tra trùng mã và hồ sơ trước khi lưu.
5. Gửi lời mời kích hoạt cho phụ huynh. Trường hợp số điện thoại đã có tài khoản thì thêm quan hệ với trẻ sau khi xác minh, không tạo tài khoản trùng.
6. W10 và W11 hiển thị trẻ đã nhập học. W14 và W15 cập nhật sĩ số, lớp và phân công giáo viên.

Liên thông app: phụ huynh thấy đúng con; giáo viên thấy trẻ trong lớp được giao kể từ ngày có hiệu lực. Tài khoản phụ huynh chưa kích hoạt không làm mất hồ sơ trẻ.

## 4 Quản lý lớp và chuyển cơ sở

Luồng màn hình: W14 → W15 → W10 → W11 → W13 → W47.

Tạo lớp tại W14, thiết lập phòng, khối tuổi, sức chứa và năm học. Tại W15, phân công giáo viên chính, phụ hoặc thay thế có ngày và giờ hiệu lực. Kiểm tra phân công chồng lấn trước khi công bố.

Để chuyển trẻ, mở W11 rồi W13. Chọn lớp hoặc cơ sở đến, ngày hiệu lực, kiểm tra chỗ trống và gửi phê duyệt. Chuyển cơ sở cần xác nhận của các bên được giao quyền. Hồ sơ trẻ giữ nguyên danh tính trong tổ chức; các đợt phân lớp là lịch sử riêng.

Công nợ cũ có quyết định xử lý riêng: cơ sở cũ tiếp tục thu hoặc chuyển theo hồ sơ được duyệt. Đặt cọc cũng có giao dịch điều chuyển, không tự coi đã thanh toán chỉ vì chuyển trẻ. Sau ngày chuyển, quyền nhập dữ liệu của giáo viên cũ kết thúc; báo cáo quá khứ vẫn truy được dữ liệu tại nơi phát sinh.

## 5 Điểm danh và bàn giao trẻ

Luồng màn hình: W16 → W17 → W11; yêu cầu sửa sai đi qua W47.

Giáo viên nhận trẻ trên app; W16 tổng hợp trạng thái theo ngày, lớp, giờ nhận và người thực hiện. Trạng thái điểm danh gồm Chưa xác nhận, Có mặt, Nghỉ có phép, Nghỉ không phép và Ngày không học. Đơn xin nghỉ không tự thay cho việc đối chiếu thực tế.

W17 theo dõi trẻ đã nhận, đã trả và còn ở trường. Quản lý mở từng trẻ để xem người đón được phép, thời hạn ủy quyền và người phụ trách lớp. Trẻ chưa trả cuối ngày phải được liên hệ và bàn giao theo quy trình.

Thao tác trả trẻ phải kiểm tra trẻ đang được nhà trường chăm sóc, người đón được phép và còn hiệu lực. Mã QR không thay thế toàn bộ xác minh người đón. Không cho trả một trẻ chưa được nhận nếu chưa xử lý bổ sung hợp lệ.

Sửa thời gian hoặc trạng thái đã chốt phải có lý do, giá trị trước và sau, người duyệt. Mất mạng cần hiển thị chưa đồng bộ; dữ liệu chưa được máy chủ xác nhận không được hiện như giao dịch đã hoàn thành.

## 6 Chăm sóc sức khỏe và sự cố

Luồng màn hình: W18 → W19 → W20 → W47 khi cần phê duyệt.

W18 theo dõi mức hoàn thành nhật ký từng trẻ, ăn uống, giấc ngủ, vệ sinh và nhận xét. Bản nháp chưa hiện trên app phụ huynh. Người có quyền kiểm tra phạm vi ảnh và nội dung trước khi xuất bản.

W19 tiếp nhận yêu cầu thuốc từ phụ huynh, kiểm tra hướng dẫn, ghi nhận nhận thuốc và phân công người thực hiện. Mỗi lần dùng có giờ thực tế, người ghi và kết quả; không suy đoán tên hoặc liều khi thiếu thông tin. Yêu cầu bị từ chối hoặc tạm dừng phải có lý do.

W20 quản lý sự cố với thời gian, diễn biến, xử lý ban đầu, người đã liên hệ, người phụ trách và kết quả. Tình huống khẩn cấp cần liên hệ trực tiếp theo quy trình của trường. Hồ sơ sự cố được giới hạn người xem, không đưa vào album lớp.

## 7 Nhân sự và chấm công

Luồng màn hình: W21 → W22 → W23 → app chấm công → W24 → W25 → W26 → khóa kỳ.

1. W21 và W22 tạo hồ sơ nhân viên, hợp đồng và phân công cơ sở, lớp, chức danh. Một người có thể được giao nhiều cơ sở theo thời hạn.
2. W23 lập ca, ngày nghỉ và người thay. Kiểm tra ca chồng lấn và thiếu giáo viên trước khi công bố cho app nhân viên.
3. Nhân viên chấm vào ra trên app hoặc nguồn tích hợp. W24 giữ lượt gốc, nguồn, thời gian và kết quả kiểm tra. Thiếu một lượt thì công chưa đủ dữ liệu, không tự tính đủ công.
4. Nhân viên gửi đề nghị bổ sung. W25 đối chiếu bản gốc với thời gian đề nghị, lý do và bằng chứng. Duyệt tạo điều chỉnh liên kết, không xóa lượt gốc.
5. W26 duyệt nghỉ phép và đổi ca, kiểm tra số dư phép, đồng ý của người nhận ca và bố trí thay thế.
6. Trước khi khóa kỳ, xử lý các lỗi công, cho nhân viên phản hồi và người có quyền xác nhận. Kỳ khóa giữ chính sách đã sử dụng.

Ca qua đêm thuộc ngày bắt đầu ca; thời gian chồng lấn không tính hai lần. Tăng ca cần phê duyệt theo chính sách. Mở lại kỳ khóa cần quyền riêng và lý do hoặc đưa chênh lệch sang kỳ điều chỉnh.

## 8 Lương và chi trả

Luồng màn hình: W24 và W25 đã chốt → W27 → W28 → app phiếu lương.

W27 lấy bảng công đã khóa, hợp đồng và các thành phần lương có hiệu lực. Nhân sự kiểm tra lương theo công, phụ cấp, thưởng, tạm ứng và khấu trừ rồi gửi duyệt. Người duyệt xem tổng và chi tiết từng nhân viên trong phạm vi được cấp quyền.

W28 phát hành phiếu cá nhân sau duyệt, ghi nhận các đợt chi trả và khóa kỳ. Đã duyệt, Đã phát hành và Đã thanh toán là các trạng thái khác nhau. Nhân viên chỉ xem phiếu của mình trên app. Công thức và các khoản cần áp dụng phải được đơn vị nhân sự, kế toán xác nhận trước khi tự động hóa.

## 9 Học phí công nợ và thanh toán

Luồng màn hình: W29 → W30 → W47 → W31 → W32 → W33 hoặc W34 → W35 khi có điều chỉnh.

1. W29 cấu hình biểu phí, gói học, dịch vụ, ưu đãi, quy tắc tính tiền ăn và ngày hiệu lực. Thay đổi tạo phiên bản, không làm đổi khoản thu lịch sử.
2. W30 chọn kỳ và trẻ, tính bản nháp, hiển thị kết quả từng trẻ cùng dòng lỗi. Khoản phải thu mới và nợ cũ được tách để không cộng hai lần.
3. Người có thẩm quyền duyệt và phát hành. Phụ huynh thấy thông báo trên app; W31 tổng hợp công nợ và W32 xem các dòng chi tiết.
4. W33 thu tiền mặt hoặc khoản đã được xác nhận, nhập số tiền và phân bổ vào từng khoản. Có thể đóng một phần; phần dư được quản lý thành số dư có theo chính sách.
5. W34 đối soát nguồn ngân hàng hoặc cổng thanh toán với khoản cần thu. Ảnh biên nhận chỉ là bằng chứng chờ kiểm tra. Giao dịch trùng nguồn và mã không được ghi thu lần hai.
6. Sai sót sau phát hành dùng chứng từ điều chỉnh hoặc hoàn tại W35. Phê duyệt hoàn khác với đã chi trả; lưu giao dịch tiền ra khi thực hiện.

Ví dụ: nợ cũ 500.000 đồng cộng phải thu mới 3.600.000 đồng bằng 4.100.000 đồng. Thu 2.000.000 đồng, phân bổ 500.000 vào nợ cũ và 1.500.000 vào kỳ mới thì còn nợ 2.100.000 đồng.

Tiền ăn cần phân biệt suất dự kiến, đã chốt cho bếp, đã sử dụng và đủ điều kiện tính tiền. Báo nghỉ không tự tạo hoàn tiền nếu không đáp ứng quy định thời điểm chốt. Mỗi suất chỉ được tính hoặc hoàn một lần theo kết quả cuối cùng.

## 10 Thu chi và vận hành cơ sở

W36: tạo đề nghị chi → đính kèm chứng từ → duyệt theo hạn mức → thanh toán → đối chiếu quỹ. Tiền thực thu, tiền thực chi, khoản phải thu và kết quả kinh doanh là các chỉ tiêu khác nhau; chênh lệch thu chi không mặc định là lợi nhuận.

W37: lập thực đơn → kiểm tra dị ứng và suất riêng → duyệt → công bố → chốt suất theo lớp → giao bếp → ghi nhận thực tế → điều chỉnh có lý do. Liên thông đơn nghỉ và tính tiền ăn nhưng không xóa dấu vết suất đã chốt.

W38: nhập kho theo lô, hạn dùng và đơn vị → xuất dùng → kiểm kê → duyệt chênh lệch. Chuyển kho có bên giao, trạng thái đang vận chuyển và bên nhận xác nhận. Cảnh báo lô hết hạn và tồn thấp.

W39: tạo tài sản → bàn giao → sử dụng → yêu cầu sửa → phân công → nghiệm thu → điều chuyển hoặc thanh lý. Mỗi bước giữ người chịu trách nhiệm và lịch sử.

W40: lập tuyến và danh sách đăng ký → phân xe, người phụ trách → ghi lên xe và xuống xe → bàn giao → đối chiếu số trẻ → kiểm tra xe sau chuyến → kết thúc. Không lấy điểm danh lớp thay việc kiểm soát trẻ trên xe.

## 11 Thông báo trao đổi và phản ánh

Luồng màn hình: W41 → W42 → duyệt nếu cần → gửi tới app → theo dõi xác nhận tại W41. W43 nhận và xử lý phản ánh.

Tại W42, chọn cơ sở, lớp hoặc nhóm người nhận, soạn nội dung, đính kèm, chọn gửi ngay hoặc lịch gửi và yêu cầu xác nhận. Xem trước phạm vi người nhận trước khi phát hành. Tách gửi thành công, đã xem và đã xác nhận.

W43 cho trao đổi gắn trẻ hoặc lớp, giao người xử lý, mức ưu tiên, hạn xử lý và kết quả. Quyền xem hội thoại đổi theo nhiệm vụ. Không hiển thị thông tin liên hệ của gia đình khác cho phụ huynh.

## 12 Phê duyệt báo cáo và quản trị dữ liệu

W47 là nơi tập trung các yêu cầu mà người đăng nhập có quyền xử lý. Từ đây mở chi tiết công, phép, kỳ thu hoặc tài chính để đối chiếu. Không cho duyệt hàng loạt mà không xem tác động; người không có quyền chỉ thấy trạng thái được phép hoặc không thấy yêu cầu.

W44 báo cáo theo cơ sở, thời gian, năm học và lớp. Có thể mở dữ liệu cấu thành chỉ số và xuất theo quyền. Báo cáo kỳ khóa lưu phiên bản; mở lại kỳ phải chỉ ra dữ liệu có thay đổi. Chủ chuỗi có góc nhìn toàn chuỗi; hiệu trưởng chỉ có phạm vi được giao.

W45 lưu ai thao tác, lúc nào, cơ sở nào, giá trị trước và sau, lý do và kết quả. Nhật ký không được sửa hoặc xóa bởi người dùng thường. Xuất hồ sơ và truy cập nhạy cảm cũng cần ghi nhận.

W46 nhập dữ liệu bằng mẫu, kiểm tra trước khi ghi và cho tải lỗi từng dòng. Sao lưu có lịch, kết quả và lần kiểm tra khôi phục; việc phục hồi phải được xem xét tác động và đúng thẩm quyền, không có nút phục hồi tùy tiện cho nhân viên cơ sở.

## 13 Trạng thái giao diện cần có khi lập trình

Mọi danh sách cần có Đang tải, Có dữ liệu, Chưa có dữ liệu, Không có kết quả lọc, Lỗi và Thử lại. Biểu mẫu cần kiểm tra trường bắt buộc, trùng mã, khoảng ngày, số tiền, quyền và xung đột phiên bản. Lưu thất bại phải giữ dữ liệu đã nhập để người dùng thử lại.

Thao tác phát hành, khóa kỳ, thu tiền, hoàn, chuyển cơ sở và thu hồi quyền phải có bước xem tác động trước khi xác nhận. Nút đang xử lý ngăn gửi trùng. Nếu có tác vụ hàng loạt, hiển thị tiến độ và kết quả từng bản ghi, không coi toàn bộ thành công chỉ vì tác vụ đã được tiếp nhận.

Không đủ quyền phải báo đúng phạm vi và có đường quay lại; không làm lộ bản ghi của cơ sở khác. Dữ liệu bị người khác sửa trong lúc mở cần tải lại hoặc đối chiếu, không ghi đè im lặng.

## 14 Danh mục 48 màn hình

Danh sách này dùng để đối chiếu với bộ ảnh và triển khai từng trang. Một trang có thể có thêm hộp thoại xác nhận, trạng thái trống hoặc lỗi khi đặc tả chi tiết.

| Mã | Màn hình |
| --- | --- |
| W01 | Đăng nhập web quản trị |
| W02 | Tổng quan toàn chuỗi |
| W03 | Danh sách cơ sở |
| W04 | Tạo cơ sở mới |
| W05 | Cấu hình năm học và lịch vận hành |
| W06 | Vai trò và ma trận phân quyền |
| W07 | Quản lý tài khoản và lời mời |
| W08 | Danh sách tuyển sinh |
| W09 | Chi tiết tư vấn và duyệt nhập học |
| W10 | Danh sách trẻ và phụ huynh |
| W11 | Chi tiết hồ sơ trẻ |
| W12 | Thêm trẻ và liên kết phụ huynh |
| W13 | Chuyển lớp hoặc cơ sở |
| W14 | Danh sách lớp học |
| W15 | Chi tiết lớp và phân công |
| W16 | Điểm danh trẻ toàn cơ sở |
| W17 | Giám sát bàn giao cuối ngày |
| W18 | Kiểm tra nhật ký chăm sóc |
| W19 | Sức khỏe và quản lý thuốc |
| W20 | Sự cố và xử lý |
| W21 | Danh sách nhân sự |
| W22 | Hồ sơ nhân viên và hợp đồng |
| W23 | Lập lịch ca làm việc |
| W24 | Bảng chấm công nhân viên |
| W25 | Duyệt bổ sung và khóa công |
| W26 | Duyệt nghỉ phép và đổi ca |
| W27 | Bảng lương cơ sở |
| W28 | Chi tiết phiếu lương và chi trả |
| W29 | Biểu phí và dịch vụ |
| W30 | Lập và phát hành kỳ thu |
| W31 | Khoản phải thu và công nợ |
| W32 | Chi tiết khoản thu của trẻ |
| W33 | Thu tiền và phân bổ |
| W34 | Đối soát giao dịch ngân hàng |
| W35 | Hoàn tiền và điều chỉnh chứng từ |
| W36 | Thu chi và quỹ cơ sở |
| W37 | Thực đơn và chốt suất ăn |
| W38 | Kho thực phẩm và vật tư |
| W39 | Tài sản và bảo trì |
| W40 | Quản lý tuyến xe và chuyến đi |
| W41 | Danh sách thông báo |
| W42 | Soạn và lên lịch thông báo |
| W43 | Trao đổi và phản ánh phụ huynh |
| W44 | Báo cáo quản trị |
| W45 | Nhật ký thao tác và truy cập |
| W46 | Nhập dữ liệu và sao lưu |
| W47 | Trung tâm phê duyệt |
| W48 | Tổng quan vận hành cơ sở |


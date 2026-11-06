# Bảo mật

- API key AI chỉ ở env backend; app/JS bundle/git không chứa. Log không in header Authorization hay body của provider.
- Mọi route dữ liệu: Bearer JWT (HS256, TTL ngắn) + owner scope; tài nguyên của người khác trả 404 (chống IDOR). Có e2e test.
- Refresh token lưu hash SHA-256, xoay vòng; dùng lại token cũ ⇒ thu hồi toàn bộ phiên.
- Guest auth theo `device_id` ngẫu nhiên (quyết định "tài khoản/guest" còn mở – xem bên dưới).
- Rate limit toàn cục + riêng cho auth/voice; quota AI trừ nguyên tử trong DB; upload giới hạn dung lượng/thời lượng, memory storage (không ghi audio xuống đĩa), MIME sniffing.
- Dữ liệu: transcript lưu theo `STORE_TRANSCRIPT`; audit log không chứa tên khách/transcript; export có TTL và chỉ chủ sở hữu tải; chống formula injection.
- Helmet, CORS mặc định tắt, Swagger mặc định tắt ở production.
- Production fail-fast nếu secret yếu/mẫu.

## Quyết định còn mở (owner chốt trước production)
Domain API; guest vs đăng nhập thật (cần device attestation nếu giữ guest); model STT/LLM theo benchmark; quota/cost cap; chính sách lưu transcript/audio; đồng bộ nhiều thiết bị; nhà cung cấp DB lâu dài; tài khoản store/kiếm tiền.

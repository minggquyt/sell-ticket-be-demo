# 📚 Documentation Index

## 📖 Getting Started

Đây là tài liệu hệ thống bán vé sự kiện (Sell Ticket System).

---

## 📂 Structure

```
docs/
├── README.md                    # Trang này
├── api/                         # API Documentation
│   ├── authentication.md        # Auth APIs (Register, Login)
│   ├── events.md                # Event APIs (List, Details)
│   ├── seat-booking.md          # Seat Booking APIs (Hold, Confirm, Release)
│   ├── orders-payment.md        # Order & Payment APIs (Legacy v1.2 reference)
│   └── admin.md                 # Admin APIs (Create/Delete Events)
├── payment/                     # 🆕 In-Site PayOS QR Checkout Docs
│   ├── IN_SITE_PAYOS_QR_CHECKOUT.md # Đặc tả chi tiết QR nội bộ, SSE & 120s+30s
│   └── PAYMENT_FLOW.md          # Sơ đồ vòng đời đơn hàng & luồng xử lý
├── refund/                      # Hoàn tiền thủ công VietQR
│   └── MANUAL_REFUND_VIETQR.md  # Quy trình & API hoàn tiền cho Admin/User
├── fixes/                       # Code Review Fixes (v1.3)
│   ├── README.md                # Index của fixes
│   ├── CODE_REVIEW_FIXES.md     # Chi tiết đầy đủ 10 phát hiện
│   ├── FIXES_SUMMARY.md         # Tóm tắt nhanh
│   └── COMMIT_MESSAGE.txt       # Git commit message
├── migrations/                  # Database Migrations
│   ├── README.md                # Migration guide
│   ├── add_performance_indexes.sql
│   ├── add_data_constraints.sql
│   ├── add_manual_refund_vietqr.sql
│   ├── add_order_checkout_url.sql
│   └── add_order_payment_info.sql
└── versions/                    # Version History
    └── version-1.md             # Version 1 (v1.1 & v1.2)
```

---

## 🔗 Quick Links

### Payment & Refund (🆕 In-Site PayOS QR Checkout)

| Topic | File | Description |
|-------|------|-------------|
| **In-Site QR Checkout** | [payment/IN_SITE_PAYOS_QR_CHECKOUT.md](./payment/IN_SITE_PAYOS_QR_CHECKOUT.md) | Kiến trúc đưa PayOS QR về web, DB `payment_info`, SSE, chống 429 & `120s+30s` |
| **Payment Flow** | [payment/PAYMENT_FLOW.md](./payment/PAYMENT_FLOW.md) | Sơ đồ trạng thái đơn hàng `WAITING`/`CONFIRMING`/trả muộn |
| **Manual Refund VietQR** | [refund/MANUAL_REFUND_VIETQR.md](./refund/MANUAL_REFUND_VIETQR.md) | Quy trình Admin hoàn tiền thủ công qua VietQR (`REFUND_PENDING` → `REFUNDED`) |

### API Documentation

| Topic | File | Description |
|-------|------|-------------|
| **Authentication** | [authentication.md](./api/authentication.md) | Đăng ký, đăng nhập, JWT token |
| **Events** | [events.md](./api/events.md) | Lấy danh sách sự kiện, xem chi tiết ghế/zone |
| **Seat Booking** | [seat-booking.md](./api/seat-booking.md) | Giữ ghế, xác nhận partial, hủy giữ chỗ |
| **Orders & Payment (Legacy)** | [orders-payment.md](./api/orders-payment.md) | Tham khảo API v1.2 (luồng mới xem mục Payment & Refund ở trên) |
| **Admin** | [admin.md](./api/admin.md) | Tạo/xóa sự kiện (ADMIN only) |

### Version History

| Version | File | Description |
|---------|------|-------------|
| **Version 1** | [version-1.md](./versions/version-1.md) | v1.1 (initial) & v1.2 (refactored) |

### Code Review & Fixes (🆕 v1.3)

| Topic | File | Description |
|-------|------|-------------|
| **Fixes Overview** | [fixes/README.md](./fixes/README.md) | Tổng quan các fixes từ code review |
| **Detailed Fixes** | [fixes/CODE_REVIEW_FIXES.md](./fixes/CODE_REVIEW_FIXES.md) | Chi tiết 10 phát hiện và giải pháp |
| **Quick Summary** | [fixes/FIXES_SUMMARY.md](./fixes/FIXES_SUMMARY.md) | Tóm tắt nhanh cho developers |
| **Database Migrations** | [migrations/README.md](./migrations/README.md) | Performance indexes & constraints |

---

## 🎯 API Overview

### Response envelope

JSON responses from `/api/*` use the same top-level structure:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Thành công.",
  "data": {}
}
```

`statusCode` matches the HTTP status. Endpoint-specific payloads are placed in
`data` (an empty collection is `[]`; responses without a payload use `null`).
Additional response fields are nested under `data`. HTML pages and the SSE log
stream are not JSON API responses.

### Public Endpoints (Không cần authentication)

```
GET  /api/events                 # Lấy danh sách sự kiện
GET  /api/events/:eventId        # Xem chi tiết sự kiện
GET  /api/payos-webhook          # Health check webhook
```

### Customer Endpoints (Cần JWT token)

```
POST /api/auth/register                 # Đăng ký
POST /api/auth/login                    # Đăng nhập
GET  /api/auth/me/bank                  # Lấy TK ngân hàng nhận hoàn tiền
PUT  /api/auth/me/bank                  # Cập nhật TK ngân hàng

GET  /api/seats/my-active-session       # Đồng bộ phiên giữ ghế/thanh toán còn hạn
POST /api/seats/reserve                 # Giữ ghế (30s)
POST /api/seats/confirm-partial-hold    # Xác nhận giữ partial
POST /api/seats/reserve-zone            # Giữ vé theo zone
POST /api/seats/start-checkout          # Khởi tạo đơn & lấy VietQR payload
POST /api/seats/release                 # Hủy giữ chỗ

GET  /api/orders/my-history             # Lịch sử đơn hàng
GET  /api/orders/:orderCode/payment     # Thông tin VietQR nội bộ (?sync=1 để đối soát)
GET  /api/orders/:orderCode/events      # SSE stream cập nhật trạng thái đơn realtime
GET  /api/orders/:orderCode/status      # Đồng bộ trạng thái đơn hàng
POST /api/orders/:orderCode/cancel      # Hủy đơn (khóa 409 ở pha CONFIRMING 120..150s)
```

### Admin Endpoints (Cần JWT token + ADMIN role)

```
POST   /api/admin/events                          # Tạo sự kiện
PUT    /api/admin/events/:eventId                 # Cập nhật sự kiện
DELETE /api/admin/events/:eventId                 # Xóa sự kiện
GET    /api/admin/refunds                         # Danh sách đơn chờ/đã hoàn tiền
POST   /api/admin/orders/:orderCode/confirm-refund # Xác nhận hoàn tiền VietQR
```

### Internal Endpoints (Webhook)

```
POST /api/payos-webhook          # PayOS webhook (HMAC SHA256 verification)
```

---

## 📊 Features

### Current Architecture (In-Site PayOS QR Checkout)

#### Authentication & Authorization
- ✅ Đăng ký tài khoản với validation
- ✅ Đăng nhập với JWT (expires: 1 day)
- ✅ Role-based access control (CUSTOMER, ADMIN)
- ✅ Password hashing (bcryptjs, salt rounds: 10)

#### Event Management
- ✅ Tạo sự kiện SEAT_BASED (ghế cụ thể: A1, A2...)
- ✅ Tạo sự kiện ZONE_BASED (khu vực: VIP, REGULAR...)
- ✅ Xem danh sách sự kiện (public)
- ✅ Xem chi tiết ghế/zone theo event
- ✅ Xóa sự kiện (admin)

#### Seat Booking
- ✅ Giữ ghế với concurrency control (FOR UPDATE SKIP LOCKED)
- ✅ Xử lý partial availability (một số ghế bị người khác chọn)
- ✅ Xác nhận giữ ghế một phần
- ✅ Giữ vé theo khu vực (zone-based)
- ✅ Hủy giữ chỗ
- ✅ Tự động giải phóng ghế hết hạn & đối soát cuối (background job 15s)
- ✅ Giới hạn 4 vé/user
- ✅ Thời gian giữ: 30 giây
- ✅ One active hold per user

#### Payment Integration
- ✅ Tích hợp PayOS QR nội bộ (`paymentInfo` lưu trong bảng `orders`)
- ✅ Thời gian quét QR `120s` + cửa sổ chờ webhook `30s` (`CONFIRMING`)
- ✅ Webhook HMAC SHA256 + SSE `/api/orders/:orderCode/events` cập nhật realtime
- ✅ Chống spam PayOS 429 bằng cooldown `10s`/đơn & gộp request trùng
- ✅ Thanh toán quá `120s` tự động chuyển `REFUND_PENDING` (hoàn tiền thủ công VietQR)
- ✅ Lịch sử đơn hàng (`GET /api/orders/my-history`)

#### Logging & Monitoring
- ✅ HTTP request logging
- ✅ Authentication logging
- ✅ Seat hold/release logging
- ✅ Payment logging
- ✅ Error logging
- ✅ Cron job logging
- ✅ Live log streaming (SSE)

---

## 🏗️ Architecture

### Layered Architecture

```
Routes → Middlewares → Controllers (Request/Response DTOs) → Services → Repositories → Database
```

### Tech Stack

- **Runtime**: Node.js v18+
- **Framework**: Express.js
- **Database**: PostgreSQL (with connection pooling)
- **Authentication**: JWT (jsonwebtoken)
- **Password**: bcryptjs
- **Payment**: PayOS
- **Logging**: Custom logger with SSE

### Design Patterns

- ✅ Repository Pattern
- ✅ Service Layer Pattern
- ✅ DTO Pattern for request validation and response mapping
- ✅ Middleware Chain
- ✅ Error Handling Pattern

---

## 🔒 Security

### Implemented

- ✅ JWT authentication
- ✅ Password hashing (bcryptjs)
- ✅ Role-based authorization
- ✅ Request validation in DTOs called by controllers before services
- ✅ SQL injection prevention (parameterized queries)
- ✅ CORS enabled

### Recommended (Not implemented yet)

- ⚠️ Rate limiting
- ⚠️ Request throttling
- ⚠️ IP whitelisting for admin
- ⚠️ HTTPS only in production
- ⚠️ Helmet.js security headers

---

## 📈 Performance

### Database Optimization

- ✅ Connection pooling (max 20 connections)
- ✅ Indexes on event_id, status, reserved_until
- ✅ `FOR UPDATE SKIP LOCKED` for concurrency
- ✅ Transaction management

### Concurrency

- ✅ Row-level locking for seat booking (`FOR UPDATE SKIP LOCKED`)
- ✅ Parallel request handling
- ℹ️ Throughput and response-time benchmarks are not currently documented

---

## 🧪 Testing

### Test Account

```json
// Customer
{
  "email": "test@example.com",
  "password": "test123"
}

// Admin (create manually in DB)
{
  "email": "admin@example.com",
  "password": "admin123",
  "role": "ADMIN"
}
```

### Postman Collection

Import từ các file API documentation hoặc tạo collection với base URL:
```
http://localhost:3000
```

---

## 📝 Constants & Limits

| Constant | Value | Location |
|----------|-------|----------|
| MAX_TICKETS_PER_USER | 4 | src/config/constants.js |
| SEAT_HOLD_DURATION_SECONDS | 30s | src/config/constants.js |
| PAYMENT_TIMEOUT_SECONDS | 120s | src/config/constants.js |
| PAYMENT_CONFIRM_WINDOW_SECONDS | 30s | src/config/constants.js |
| PAYOS_SYNC_COOLDOWN_MS | 10s | src/config/constants.js |
| SEAT_RELEASE_JOB_INTERVAL_MS | 15s | src/config/constants.js |
| SSE_HEARTBEAT_INTERVAL_MS | 15s | src/config/constants.js |
| SSE_ORDER_MAX_DURATION_MS | 180s | src/config/constants.js |
| JWT_EXPIRES_IN | 1 day | src/config/constants.js |
| BCRYPT_SALT_ROUNDS | 10 | src/config/constants.js |
| DB_CONNECTION_POOL | 20 | src/config/db.js |

---

## 🐛 Troubleshooting

### Common Issues

#### 1. PayOS không hoạt động
```
Error: The PAYOS_CLIENT_ID environment variable is missing
```
**Solution**: Thêm credentials vào `.env`:
```env
PAYOS_CLIENT_ID=...
PAYOS_API_KEY=...
PAYOS_CHECKSUM_KEY=...
```

#### 2. Database connection error
```
Error: connect ECONNREFUSED
```
**Solution**: Kiểm tra `DATABASE_URL` trong `.env` và PostgreSQL đang chạy

#### 3. JWT token invalid
```
Error: jwt malformed
```
**Solution**: 
- Token có thể đã hết hạn (1 ngày)
- Kiểm tra `JWT_SECRET` khớp với secret đã dùng để tạo token

#### 4. Ghế không giữ được
```
Error: USER_HAS_ACTIVE_HOLD
```
**Solution**: Hủy phiên giữ cũ bằng `/api/seats/release` hoặc đợi hết hạn 30s

---

## 📖 Additional Resources

### External Links

- [PayOS Documentation](https://payos.vn/docs)
- [PostgreSQL Docs](https://www.postgresql.org/docs/)
- [Express.js Guide](https://expressjs.com/)
- [JWT.io](https://jwt.io/)

### Internal Resources

- [Environment Setup](../.env.example)
- [Package Dependencies](../package.json)
- [Main Application](../app.js)

---

## 🤝 Contributing

### Code Style

- Sử dụng layered architecture
- Mỗi file có trách nhiệm rõ ràng
- Comments cho business logic phức tạp
- Error handling nhất quán

### Git Workflow

```bash
# 1. Create feature branch
git checkout -b feature/new-feature

# 2. Make changes and test
npm test

# 3. Commit with meaningful message
git commit -m "feat: add new feature"

# 4. Push and create PR
git push origin feature/new-feature
```

---

## 📞 Support

Nếu có câu hỏi hoặc cần hỗ trợ, vui lòng:

1. Đọc documentation này trước
2. Kiểm tra [Version History](./versions/version-1.md)
3. Xem [API Documentation](./api/)
4. Contact development team

---

**📅 Last Updated:** 2026-11-22  
**📖 Current Version:** 1.4  
**🔖 Documentation Version:** 1.1

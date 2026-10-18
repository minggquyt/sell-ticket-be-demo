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
│   ├── orders-payment.md        # Order & Payment APIs (Checkout, History, Webhook)
│   └── admin.md                 # Admin APIs (Create/Delete Events)
└── versions/                    # Version History
    └── version-1.md             # Version 1 (v1.1 & v1.2)
```

---

## 🔗 Quick Links

### API Documentation

| Topic | File | Description |
|-------|------|-------------|
| **Authentication** | [authentication.md](./api/authentication.md) | Đăng ký, đăng nhập, JWT token |
| **Events** | [events.md](./api/events.md) | Lấy danh sách sự kiện, xem chi tiết ghế/zone |
| **Seat Booking** | [seat-booking.md](./api/seat-booking.md) | Giữ ghế, xác nhận partial, hủy giữ chỗ |
| **Orders & Payment** | [orders-payment.md](./api/orders-payment.md) | Thanh toán, lịch sử đơn hàng, PayOS webhook |
| **Admin** | [admin.md](./api/admin.md) | Tạo/xóa sự kiện (ADMIN only) |

### Version History

| Version | File | Description |
|---------|------|-------------|
| **Version 1** | [version-1.md](./versions/version-1.md) | v1.1 (initial) & v1.2 (refactored) |

---

## 🎯 API Overview

### Public Endpoints (Không cần authentication)

```
GET  /api/events                 # Lấy danh sách sự kiện
GET  /api/events/:eventId        # Xem chi tiết sự kiện
GET  /api/payos-webhook          # Health check webhook
```

### Customer Endpoints (Cần JWT token)

```
POST /api/auth/register          # Đăng ký
POST /api/auth/login             # Đăng nhập

POST /api/seats/request-hold     # Giữ ghế
POST /api/seats/confirm-partial  # Xác nhận giữ partial
POST /api/seats/reserve-zone     # Giữ vé theo zone
POST /api/seats/release          # Hủy giữ chỗ

POST /api/orders/checkout        # Khởi tạo thanh toán
GET  /api/orders/my-orders       # Lịch sử đơn hàng
```

### Admin Endpoints (Cần JWT token + ADMIN role)

```
POST   /api/admin/events         # Tạo sự kiện
DELETE /api/admin/events/:id     # Xóa sự kiện
```

### Internal Endpoints (Webhook)

```
POST /payos-webhook              # PayOS webhook
POST /api/orders/webhook         # Test webhook (dev only)
```

---

## 📊 Features

### V1.2 (Current)

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
- ✅ Tự động giải phóng ghế hết hạn (background job 60s)
- ✅ Giới hạn 4 vé/user
- ✅ Thời gian giữ: 30 giây
- ✅ One active hold per user

#### Payment Integration
- ✅ Tích hợp PayOS payment gateway
- ✅ Tạo link thanh toán
- ✅ Webhook xử lý kết quả thanh toán
- ✅ Timeout thanh toán: 5 phút
- ✅ Lịch sử đơn hàng

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
| SEAT_HOLD_DURATION | 30s | src/config/constants.js |
| PAYMENT_TIMEOUT | 5 min | src/config/constants.js |
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

**📅 Last Updated:** 2024-10-18  
**📖 Current Version:** 1.2  
**🔖 Documentation Version:** 1.0

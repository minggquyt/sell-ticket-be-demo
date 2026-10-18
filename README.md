# 🎫 Sell Ticket System - Backend API

Hệ thống backend bán vé sự kiện với tính năng giữ chỗ thời gian thực, xử lý thanh toán và quản lý đồng thời cao.

[![Version](https://img.shields.io/badge/version-1.2-blue.svg)](./docs/versions/version-1.md)
[![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/postgresql-15+-blue.svg)](https://www.postgresql.org/)

---

## 🚀 Quick Start

```bash
# 1. Clone repository
git clone <repository-url>
cd sell-ticket-be-demo

# 2. Install dependencies
npm install

# 3. Setup environment
cp .env.example .env
# Edit .env với thông tin database và PayOS credentials

# 4. Run server
npm start
```

Server chạy tại: **http://localhost:3000**

---

## 📚 Documentation

### 📖 Full Documentation
Xem tài liệu đầy đủ tại: **[docs/README.md](./docs/README.md)**

### 🔗 Quick Links

| Tài liệu | Mô tả |
|----------|-------|
| **[API - Authentication](./docs/api/authentication.md)** | Đăng ký, đăng nhập, JWT token |
| **[API - Events](./docs/api/events.md)** | Quản lý sự kiện, xem ghế/zone |
| **[API - Seat Booking](./docs/api/seat-booking.md)** | Giữ ghế, partial booking, zone booking |
| **[API - Orders & Payment](./docs/api/orders-payment.md)** | Thanh toán, PayOS webhook, lịch sử |
| **[API - Admin](./docs/api/admin.md)** | Tạo/xóa sự kiện (ADMIN) |
| **[Version History](./docs/versions/version-1.md)** | v1.1 & v1.2 changes |

---

## 🏗️ Architecture

```
Routes → Middlewares → Controllers (Request/Response DTOs) → Services → Repositories → Database
```

### DTO Pattern (Data Transfer Objects)

**Request DTO**: Validate & Transform Input
```javascript
class RegisterRequestDTO {
  validate() { /* validation logic */ }
  toServiceInput() { /* transform to service format */ }
}
```

**Response DTO**: Format & Transform Output
```javascript
class RegisterResponseDTO {
  toJSON() { /* format response */ }
}
```

### Tech Stack
- **Runtime**: Node.js v18+
- **Framework**: Express.js
- **Database**: PostgreSQL (Supabase)
- **Auth**: JWT (jsonwebtoken)
- **Payment**: PayOS
- **Password**: bcryptjs
- **Pattern**: Repository + DTO Pattern

---

## 📁 Project Structure

```
sell-ticket-be-demo/
├── app.js                      # Main application
├── package.json
├── .env.example                # Environment template
├── docs/                       # 📚 Documentation
│   ├── README.md              # Documentation index
│   ├── api/                   # API docs by feature
│   │   ├── authentication.md
│   │   ├── events.md
│   │   ├── seat-booking.md
│   │   ├── orders-payment.md
│   │   └── admin.md
│   └── versions/              # Version history
│       └── version-1.md
└── src/
    ├── config/                # Configuration
    │   ├── constants.js       # Constants & limits
    │   ├── db.js             # Database connection
    │   └── payos.js          # PayOS config
    ├── controllers/           # HTTP handlers
    │   ├── auth.controller.js
    │   └── ticket.controller.js
    ├── dto/                   # Request validation and response mapping
    │   ├── admin.dto.js
    │   ├── auth.dto.js
    │   ├── event.dto.js
    │   ├── order.dto.js
    │   └── seat.dto.js
    ├── services/              # Business logic
    │   ├── auth.service.js
    │   └── ticket.service.js
    ├── repositories/          # Database queries
    │   ├── auth.repository.js
    │   └── ticket.repository.js
    ├── middlewares/           # Middlewares
    │   └── auth.middleware.js
    ├── routes/                # API routes
    │   ├── auth.route.js
    │   ├── events.route.js
    │   ├── seats.route.js
    │   ├── order.routes.js
    │   ├── admin.routes.js
    │   ├── index.route.js
    │   └── site.route.js
    ├── jobs/                  # Background jobs
    │   └── seat-release.job.js
    ├── seeds/                 # Database seed and cleanup scripts
    │   ├── seed.js
    │   └── delete.js
    └── utils/                 # Utilities
        └── logger.js
```

---

## ✨ Features

### V1.2 (Current)

- ✅ **Authentication**: JWT-based auth với password hashing (bcryptjs)
- ✅ **Role-based Access**: CUSTOMER & ADMIN roles
- ✅ **Event Management**: SEAT_BASED & ZONE_BASED events
- ✅ **Seat Booking**: 
  - Concurrency control với `FOR UPDATE SKIP LOCKED`
  - Partial availability handling
  - One active hold per user
  - Auto-release expired seats (30s)
  - Max 4 tickets per user
- ✅ **Payment**: PayOS integration, webhook handling
- ✅ **Logging**: Structured logging với live streaming (SSE)

---

## 🔒 Security

- ✅ JWT authentication (1 day expiration)
- ✅ Password hashing (bcryptjs, salt rounds: 10)
- ✅ Request validation in DTOs called by controllers before services
- ✅ Role-based authorization
- ✅ SQL injection prevention (parameterized queries)

---

## 📊 Performance

- **Database**: PostgreSQL connection pool (max 20 connections)
- **Seat booking**: Row-level locking with `FOR UPDATE SKIP LOCKED`
- **Benchmarks**: No throughput or response-time benchmark is currently documented

---

## 🔧 Configuration

### Environment Variables

```env
# Database
DATABASE_URL=postgresql://user:password@host:5432/database

# Authentication
JWT_SECRET=your-secret-key-change-this-in-production

# Payment Gateway
PAYOS_CLIENT_ID=your-payos-client-id
PAYOS_API_KEY=your-payos-api-key
PAYOS_CHECKSUM_KEY=your-payos-checksum-key

# Server
PORT=3000
NODE_ENV=development
```

### Constants

| Constant | Value | Editable |
|----------|-------|----------|
| MAX_TICKETS_PER_USER | 4 | `src/config/constants.js` |
| SEAT_HOLD_DURATION | 30s | `src/config/constants.js` |
| PAYMENT_TIMEOUT | 5 min | `src/config/constants.js` |
| JWT_EXPIRES_IN | 1 day | `src/config/constants.js` |

---

## 📝 Scripts

```bash
# Development
npm run dev          # Start server với Node.js
npm run nodemon      # Start với Nodemon (cần cài Nodemon riêng)

# Production
npm start            # Start server

# Database
npm run seed         # Seed sample data
npm run delete-db-data   # Clear all data
```

---

## 🧪 Testing

### Test Accounts

```json
// Customer Account
{
  "email": "test@example.com",
  "password": "test123"
}

// Admin Account (create manually in DB)
{
  "email": "admin@example.com",
  "password": "admin123",
  "role": "ADMIN"
}
```

### API Testing

```bash
# Register
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123"}'

# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123"}'

# Get Events
curl -X GET http://localhost:3000/api/events
```

---

## 🐛 Troubleshooting

### PayOS not working
```bash
# Add credentials to .env
PAYOS_CLIENT_ID=...
PAYOS_API_KEY=...
PAYOS_CHECKSUM_KEY=...
```

### Database connection error
```bash
# Check DATABASE_URL in .env
# Ensure PostgreSQL is running
```

### JWT token invalid
```bash
# Token may be expired (1 day)
# Check JWT_SECRET matches between sessions
```

Xem thêm: **[docs/README.md#troubleshooting](./docs/README.md#-troubleshooting)**

---

## 📖 API Overview

### Public Endpoints
- `GET /api/events` - List events
- `GET /api/events/:id` - Event details

### Customer Endpoints (JWT required)
- `POST /api/auth/register` - Register
- `POST /api/auth/login` - Login
- `POST /api/seats/request-hold` - Hold seats
- `POST /api/seats/confirm-partial` - Confirm partial
- `POST /api/seats/reserve-zone` - Zone booking
- `POST /api/seats/release` - Release seats
- `POST /api/orders/checkout` - Checkout
- `GET /api/orders/my-orders` - Order history

### Admin Endpoints (ADMIN role)
- `POST /api/admin/events` - Create event
- `DELETE /api/admin/events/:id` - Delete event

Xem chi tiết: **[docs/api/](./docs/api/)**

---

## 🤝 Contributing

1. Fork repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

---

## 📄 License

ISC

---

## 👥 Team

**Version 1.2** - Refactored with layered architecture

---

## 🔗 Links

- **Documentation**: [docs/README.md](./docs/README.md)
- **Version History**: [docs/versions/version-1.md](./docs/versions/version-1.md)
- **PayOS Docs**: https://payos.vn/docs

---

**🚀 Happy Coding!**

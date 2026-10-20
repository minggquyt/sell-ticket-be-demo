# 👑 Admin API

Base URL: `http://localhost:3000/api/admin`

⚠️ **Tất cả endpoints yêu cầu role ADMIN**

---

## 1. Tạo sự kiện mới

### Endpoint
```
POST /api/admin/events
```

### Authentication
✅ Required - JWT token with ADMIN role

### Headers
```http
Content-Type: application/json
Authorization: Bearer <admin-token>
```

### Request Body - SEAT_BASED Event

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| title | string | ✅ | Tên sự kiện |
| description | string | ❌ | Mô tả |
| location | string | ✅ | Địa điểm |
| start_time | datetime | ❌ | Thời gian bắt đầu (ISO 8601) |
| event_type | enum | ✅ | "SEAT_BASED" |
| seatConfig | object | ✅ | Cấu hình ghế |
| seatConfig.totalSeats | number | ✅ | Tổng số ghế |
| seatConfig.price | number | ✅ | Giá vé (VNĐ) |
| seatConfig.prefix | string | ✅ | Prefix số ghế (A, B, C...) |

#### Request Example - SEAT_BASED

```json
{
  "title": "Concert Rock Festival 2024",
  "description": "Đêm nhạc rock hoành tráng nhất năm",
  "location": "SVĐ Mỹ Đình, Hà Nội",
  "start_time": "2024-12-31T19:00:00Z",
  "event_type": "SEAT_BASED",
  "seatConfig": {
    "totalSeats": 100,
    "price": 500000,
    "prefix": "A"
  }
}
```

**Generated Seats:**
- A1, A2, A3, ..., A100
- Tất cả có zone_name = "STANDARD"
- Tất cả có price = 500000
- Tất cả có status = "AVAILABLE"

### Request Body - ZONE_BASED Event

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| title | string | ✅ | Tên sự kiện |
| description | string | ❌ | Mô tả |
| location | string | ✅ | Địa điểm |
| start_time | datetime | ❌ | Thời gian bắt đầu |
| event_type | enum | ✅ | "ZONE_BASED" |
| zoneConfigs | array | ✅ | Cấu hình các khu vực |
| zoneConfigs[].zoneName | string | ✅ | Tên khu vực (uppercase) |
| zoneConfigs[].count | number | ✅ | Số lượng ghế |
| zoneConfigs[].price | number | ✅ | Giá vé (VNĐ) |

#### Request Example - ZONE_BASED

```json
{
  "title": "Festival Music 2024",
  "description": "Lễ hội âm nhạc đa thể loại",
  "location": "Công viên Thống Nhất",
  "start_time": "2024-12-25T18:00:00Z",
  "event_type": "ZONE_BASED",
  "zoneConfigs": [
    {
      "zoneName": "VIP",
      "count": 50,
      "price": 500000
    },
    {
      "zoneName": "REGULAR",
      "count": 200,
      "price": 200000
    },
    {
      "zoneName": "STANDARD",
      "count": 500,
      "price": 100000
    }
  ]
}
```

**Generated Seats:**
- VIP-01, VIP-02, ..., VIP-50 (price: 500000)
- REGULAR-01, REGULAR-02, ..., REGULAR-200 (price: 200000)
- STANDARD-01, STANDARD-02, ..., STANDARD-500 (price: 100000)

### Validation Rules

#### title
- **Type**: String
- **Required**: Có
- **Max Length**: 255 characters

#### location
- **Type**: String
- **Required**: Có
- **Max Length**: 255 characters

#### start_time
- **Type**: ISO 8601 datetime string
- **Required**: Không (default: NOW())
- **Example**: "2024-12-31T19:00:00Z"

#### event_type
- **Type**: Enum
- **Required**: Có
- **Values**: "SEAT_BASED", "ZONE_BASED"

#### seatConfig.totalSeats
- **Type**: Number
- **Min**: 1
- **Default**: 12
- **Example**: 100

#### seatConfig.price
- **Type**: Number (VNĐ)
- **Min**: 0
- **Default**: 200000
- **Example**: 500000

#### seatConfig.prefix
- **Type**: String (1 character)
- **Default**: "S"
- **Example**: "A", "B", "C"

#### zoneConfigs[].count
- **Type**: Number
- **Min**: 1
- **Default**: 10

#### zoneConfigs[].price
- **Type**: Number (VNĐ)
- **Min**: 0
- **Default**: 200000

#### zoneConfigs[].zoneName
- **Type**: String (uppercase)
- **Example**: "VIP", "REGULAR", "STANDARD"
- **Auto Convert**: Tự động uppercase

### Response Success (200)

```json
{
  "success": true,
  "message": "Tạo sự kiện và cấu hình ghế thành công!",
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "title": "Concert Rock Festival 2024",
    "description": "Đêm nhạc rock hoành tráng nhất năm",
    "location": "SVĐ Mỹ Đình, Hà Nội",
    "start_time": "2024-12-31T19:00:00.000Z",
    "event_type": "SEAT_BASED",
    "created_at": "2024-10-18T12:00:00.000Z"
  }
}
```

#### Success Response Fields

| Field | Type | Description |
|-------|------|-------------|
| success | boolean | true |
| message | string | Thông báo thành công |
| data.id | uuid | ID sự kiện đã tạo |
| data.title | string | Tên sự kiện |
| data.description | string | Mô tả |
| data.location | string | Địa điểm |
| data.start_time | datetime | Thời gian bắt đầu |
| data.event_type | enum | Loại sự kiện |
| data.created_at | datetime | Thời gian tạo |

### Response Error Case 1: Forbidden (403)

```json
{
  "success": false,
  "message": "Yêu cầu quyền Quản trị viên (Admin)."
}
```

**Reason**: User không phải ADMIN

### Response Error Case 2: Unauthorized (401)

```json
{
  "success": false,
  "message": "Bạn chưa đăng nhập."
}
```

### Response Error Case 3: Bad Request (400)

```json
{
  "success": false,
  "message": "Database error message or validation error"
}
```

### cURL Example - SEAT_BASED

```bash
curl -X POST http://localhost:3000/api/admin/events \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin-token>" \
  -d '{
    "title": "Concert Rock Festival 2024",
    "description": "Đêm nhạc rock hoành tráng",
    "location": "SVĐ Mỹ Đình, Hà Nội",
    "start_time": "2024-12-31T19:00:00Z",
    "event_type": "SEAT_BASED",
    "seatConfig": {
      "totalSeats": 100,
      "price": 500000,
      "prefix": "A"
    }
  }'
```

### cURL Example - ZONE_BASED

```bash
curl -X POST http://localhost:3000/api/admin/events \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin-token>" \
  -d '{
    "title": "Festival Music 2024",
    "location": "Công viên Thống Nhất",
    "event_type": "ZONE_BASED",
    "zoneConfigs": [
      {"zoneName": "VIP", "count": 50, "price": 500000},
      {"zoneName": "REGULAR", "count": 200, "price": 200000}
    ]
  }'
```

---

## 2. Xóa sự kiện

### Endpoint
```
DELETE /api/admin/events/:eventId
```

### Authentication
✅ Required - JWT token with ADMIN role

### Headers
```http
Authorization: Bearer <admin-token>
```

### Path Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| eventId | uuid | ✅ | ID sự kiện cần xóa |

### Business Rules

⚠️ **Cascade Delete**:
- Xóa event → Tự động xóa tất cả seats liên quan
- Không kiểm tra có orders đang active hay không
- **Khuyến nghị**: Kiểm tra trước khi xóa

### Response Success (200)

```json
{
  "success": true,
  "message": "Đã xóa sự kiện thành công."
}
```

### Response Error Case 1: Forbidden (403)

```json
{
  "success": false,
  "message": "Yêu cầu quyền Quản trị viên (Admin)."
}
```

### Response Error Case 2: Bad Request (400)

```json
{
  "success": false,
  "message": "Invalid UUID format"
}
```

### cURL Example

```bash
curl -X DELETE http://localhost:3000/api/admin/events/550e8400-e29b-41d4-a716-446655440000 \
  -H "Authorization: Bearer <admin-token>"
```

---

## Authorization Flow

### Role Check

```javascript
// 1. verifyToken middleware (auth.middleware.js)
const decoded = jwt.verify(token, JWT_SECRET);
req.user = decoded;  // { id, email, role, fullName }

// 2. requireAdmin middleware (auth.middleware.js)
if (req.user && req.user.role === 'ADMIN') {
  next();  // Allow
} else {
  return res.status(403).json({ message: 'Yêu cầu quyền Quản trị viên' });
}
```

### Route Protection

```javascript
// admin.routes.js
const { verifyToken, requireAdmin } = require('../middlewares/auth.middleware');

router.post('/events', verifyToken, requireAdmin, adminController.createEvent);
router.delete('/events/:eventId', verifyToken, requireAdmin, adminController.deleteEvent);
```

---

## Admin Account

### Tạo Admin Account

⚠️ **Không có API tạo admin** - Phải tạo trực tiếp trong database

#### SQL Command

```sql
-- 1. Tạo user thường
INSERT INTO users (email, password, full_name, role)
VALUES ('admin@example.com', '$2a$10$hashedPasswordHere', 'Admin User', 'CUSTOMER')
RETURNING id;

-- 2. Upgrade to ADMIN
UPDATE users 
SET role = 'ADMIN' 
WHERE email = 'admin@example.com';
```

#### Hoặc seed script

```javascript
// src/seeds/create-admin.js
const bcrypt = require('bcryptjs');
const pool = require('../config/db');

async function createAdmin() {
  const email = 'admin@example.com';
  const password = 'admin123';
  const hashedPassword = await bcrypt.hash(password, 10);
  
  const result = await pool.query(`
    INSERT INTO users (email, password, full_name, role)
    VALUES ($1, $2, 'System Admin', 'ADMIN')
    ON CONFLICT (email) DO UPDATE SET role = 'ADMIN'
    RETURNING id, email, role;
  `, [email, hashedPassword]);
  
  console.log('✅ Admin created:', result.rows[0]);
}

createAdmin().then(() => process.exit(0));
```

### Login as Admin

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "admin123"
  }'
```

**Response:**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "email": "admin@example.com",
    "role": "ADMIN",
    "fullName": "System Admin"
  }
}
```

---

## Use Cases

### Case 1: Admin tạo event cho concert

```javascript
// 1. Admin login
const loginRes = await fetch('/api/auth/login', {
  method: 'POST',
  body: JSON.stringify({
    email: 'admin@example.com',
    password: 'admin123'
  })
});
const { token } = await loginRes.json();

// 2. Create event
const createRes = await fetch('/api/admin/events', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    title: 'Concert ABC',
    location: 'Hà Nội',
    event_type: 'SEAT_BASED',
    seatConfig: {
      totalSeats: 200,
      price: 500000,
      prefix: 'A'
    }
  })
});

const event = await createRes.json();
console.log('Created event:', event.data.id);
```

### Case 2: Admin xóa event cũ

```javascript
await fetch(`/api/admin/events/${eventId}`, {
  method: 'DELETE',
  headers: {
    'Authorization': `Bearer ${adminToken}`
  }
});
```

---

## Security

### Best Practices

1. **Never expose admin credentials in code**
   ```javascript
   // ❌ BAD
   const ADMIN_EMAIL = 'admin@example.com';
   const ADMIN_PASSWORD = 'admin123';
   
   // ✅ GOOD
   const adminEmail = process.env.ADMIN_EMAIL;
   const adminPassword = process.env.ADMIN_PASSWORD;
   ```

2. **Use strong passwords for admin accounts**
   - Min 12 characters
   - Uppercase + lowercase + numbers + symbols
   - Example: `Admin@2024!Secure`

3. **Limit admin endpoints to trusted IPs** (Production)
   ```javascript
   // middleware
   const allowedIPs = ['10.0.0.1', '192.168.1.1'];
   if (!allowedIPs.includes(req.ip)) {
     return res.status(403).json({ message: 'IP not allowed' });
   }
   ```

4. **Log all admin actions**
   ```javascript
   logger.admin('CREATE_EVENT', req.user.email, eventId);
   logger.admin('DELETE_EVENT', req.user.email, eventId);
   ```

---

## Future Enhancements

### Khuyến nghị (chưa implement)

1. **Update Event API**
   ```
   PATCH /api/admin/events/:eventId
   ```

2. **List All Orders API**
   ```
   GET /api/admin/orders?status=SUCCESS&page=1&limit=20
   ```

3. **Cancel Order API**
   ```
   POST /api/admin/orders/:orderId/cancel
   ```

4. **Analytics Dashboard API**
   ```
   GET /api/admin/analytics/revenue?startDate=2024-01-01&endDate=2024-12-31
   GET /api/admin/analytics/booking-rate?eventId=uuid
   ```

5. **Bulk Create Seats API**
   ```
   POST /api/admin/events/:eventId/seats/bulk
   ```

---

## Data Types & Constraints

### Events

| Field | Type | Constraints |
|-------|------|-------------|
| id | uuid | Primary Key, Auto |
| title | varchar(255) | NOT NULL |
| description | text | NULL |
| location | varchar(255) | NOT NULL |
| start_time | timestamp | NOT NULL, DEFAULT: NOW() |
| event_type | enum | 'SEAT_BASED', 'ZONE_BASED' |
| created_at | timestamp | DEFAULT: NOW() |

### Cascade Rules

```sql
-- Delete event → Auto delete seats
ALTER TABLE seats
ADD CONSTRAINT fk_event
FOREIGN KEY (event_id)
REFERENCES events(id)
ON DELETE CASCADE;
```

---

## Error Codes

| Code | HTTP | Message |
|------|------|---------|
| ADMIN_REQUIRED | 403 | Yêu cầu quyền Quản trị viên |
| INVALID_EVENT_TYPE | 400 | event_type phải là SEAT_BASED hoặc ZONE_BASED |
| INVALID_UUID | 400 | Invalid UUID format |
| DATABASE_ERROR | 400 | Database constraint violation |

---

**📅 Last Updated:** 2024-10-18  
**📖 Version:** 1.2

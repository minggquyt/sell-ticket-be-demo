# 🎪 Events API

Base URL: `http://localhost:3000/api/events`

---

## 1. Lấy danh sách sự kiện

### Endpoint
```
GET /api/events
```

### Authentication
❌ Không yêu cầu - Public endpoint

### Query Parameters
Không có

### Response Success (200)

```json
{
  "success": true,
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "title": "Concert Rock Festival 2024",
      "description": "Đêm nhạc rock hoành tráng nhất năm",
      "location": "SVĐ Mỹ Đình, Hà Nội",
      "start_time": "2024-12-31T19:00:00.000Z",
      "event_type": "SEAT_BASED",
      "created_at": "2024-01-01T00:00:00.000Z"
    },
    {
      "id": "660e8400-e29b-41d4-a716-446655440001",
      "title": "Festival Music 2024",
      "description": "Lễ hội âm nhạc đa thể loại",
      "location": "Công viên Thống Nhất",
      "start_time": "2024-12-25T18:00:00.000Z",
      "event_type": "ZONE_BASED",
      "created_at": "2024-01-02T00:00:00.000Z"
    }
  ]
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| success | boolean | Trạng thái thành công |
| data | array | Danh sách sự kiện |
| data[].id | uuid | ID sự kiện |
| data[].title | string | Tên sự kiện |
| data[].description | string | Mô tả |
| data[].location | string | Địa điểm |
| data[].start_time | datetime | Thời gian bắt đầu (ISO 8601) |
| data[].event_type | enum | SEAT_BASED hoặc ZONE_BASED |
| data[].created_at | datetime | Thời gian tạo |

#### Event Types

| Type | Description |
|------|-------------|
| SEAT_BASED | Đặt vé theo ghế cụ thể (A1, A2, B1...) |
| ZONE_BASED | Đặt vé theo khu vực (VIP, REGULAR...) |

### Response Error (500)

```json
{
  "success": false,
  "message": "Database connection error"
}
```

### cURL Example

```bash
curl -X GET http://localhost:3000/api/events
```

---

## 2. Lấy chi tiết sự kiện

### Endpoint
```
GET /api/events/:eventId
```

### Authentication
❌ Không yêu cầu - Public endpoint

### Path Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| eventId | uuid | ✅ | ID sự kiện |

### Query Parameters

| Field | Type | Required | Description | Values |
|-------|------|----------|-------------|--------|
| type | string | ❌ | Loại sự kiện | SEAT_BASED, ZONE_BASED |

### Response Success - SEAT_BASED (200)

**Request:**
```
GET /api/events/550e8400-e29b-41d4-a716-446655440000?type=SEAT_BASED
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "770e8400-e29b-41d4-a716-446655440010",
      "event_id": "550e8400-e29b-41d4-a716-446655440000",
      "seat_number": "A1",
      "zone_name": "VIP",
      "price": "500000",
      "status": "AVAILABLE",
      "reserved_by": null,
      "reserved_until": null,
      "current_order_id": null
    },
    {
      "id": "770e8400-e29b-41d4-a716-446655440011",
      "event_id": "550e8400-e29b-41d4-a716-446655440000",
      "seat_number": "A2",
      "zone_name": "VIP",
      "price": "500000",
      "status": "RESERVED",
      "reserved_by": "880e8400-e29b-41d4-a716-446655440020",
      "reserved_until": "2024-10-18T12:30:30.000Z",
      "current_order_id": null
    },
    {
      "id": "770e8400-e29b-41d4-a716-446655440012",
      "event_id": "550e8400-e29b-41d4-a716-446655440000",
      "seat_number": "A3",
      "zone_name": "VIP",
      "price": "500000",
      "status": "SOLD",
      "reserved_by": null,
      "reserved_until": null,
      "current_order_id": "990e8400-e29b-41d4-a716-446655440030"
    },
    {
      "id": "770e8400-e29b-41d4-a716-446655440013",
      "event_id": "550e8400-e29b-41d4-a716-446655440000",
      "seat_number": "B1",
      "zone_name": "REGULAR",
      "price": "200000",
      "status": "PAYMENT_PROCESSING",
      "reserved_by": "880e8400-e29b-41d4-a716-446655440021",
      "reserved_until": "2024-10-18T12:35:00.000Z",
      "current_order_id": "990e8400-e29b-41d4-a716-446655440031"
    }
  ]
}
```

#### Seat Status Values

| Status | Description | Can Book? |
|--------|-------------|-----------|
| AVAILABLE | Ghế trống, sẵn sàng | ✅ Có |
| RESERVED | Đang được giữ chỗ (30s) | ❌ Không |
| PAYMENT_PROCESSING | Đang chờ thanh toán (5 phút) | ❌ Không |
| SOLD | Đã bán | ❌ Không |

### Response Success - ZONE_BASED (200)

**Request:**
```
GET /api/events/660e8400-e29b-41d4-a716-446655440001?type=ZONE_BASED
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "zone_name": "VIP",
      "price": "500000",
      "available_count": "25",
      "total_count": "50"
    },
    {
      "zone_name": "REGULAR",
      "price": "200000",
      "available_count": "150",
      "total_count": "200"
    },
    {
      "zone_name": "STANDARD",
      "price": "100000",
      "available_count": "300",
      "total_count": "500"
    }
  ]
}
```

#### Zone Response Fields

| Field | Type | Description |
|-------|------|-------------|
| zone_name | string | Tên khu vực |
| price | string | Giá vé (VNĐ) |
| available_count | string | Số vé còn lại |
| total_count | string | Tổng số vé khu vực |

### Response Error (500)

```json
{
  "success": false,
  "message": "Invalid event ID format"
}
```

### cURL Examples

```bash
# Lấy danh sách ghế cụ thể
curl -X GET "http://localhost:3000/api/events/550e8400-e29b-41d4-a716-446655440000?type=SEAT_BASED"

# Lấy thông tin theo khu vực
curl -X GET "http://localhost:3000/api/events/660e8400-e29b-41d4-a716-446655440001?type=ZONE_BASED"
```

---

## Business Logic

### Ghế hết hạn tự động giải phóng
- **Background Job**: Chạy mỗi 60 giây
- **Logic**: `UPDATE seats SET status = 'AVAILABLE' WHERE reserved_until < NOW()`
- **Trước khi trả response**: Luôn giải phóng ghế hết hạn

### Real-time Updates
⚠️ **Chưa implement** - Khuyến nghị:
- WebSocket hoặc Server-Sent Events
- Push notification khi ghế thay đổi status

### Caching
⚠️ **Chưa implement** - Khuyến nghị:
- Cache danh sách events (TTL: 5 phút)
- Cache zone counts (TTL: 10 giây)
- Invalidate cache khi có booking mới

---

## Use Cases

### Case 1: Hiển thị danh sách sự kiện trên homepage
```
1. Frontend gọi GET /api/events
2. Nhận danh sách events
3. Render cards với title, location, start_time
```

### Case 2: Xem sơ đồ ghế (SEAT_BASED)
```
1. User click vào event
2. Frontend gọi GET /api/events/{eventId}?type=SEAT_BASED
3. Nhận danh sách tất cả ghế
4. Render sơ đồ ghế với màu sắc theo status:
   - AVAILABLE: Xanh lá
   - RESERVED: Vàng
   - PAYMENT_PROCESSING: Cam
   - SOLD: Xám
```

### Case 3: Chọn số lượng vé theo zone (ZONE_BASED)
```
1. User click vào event
2. Frontend gọi GET /api/events/{eventId}?type=ZONE_BASED
3. Nhận thông tin zones
4. Hiển thị dropdown/input cho mỗi zone:
   "VIP (500,000đ) - Còn 25/50 vé"
```

---

## Data Types & Constraints

### Event

| Field | Type | Constraints |
|-------|------|-------------|
| id | uuid | Primary Key, Auto-generated |
| title | varchar(255) | NOT NULL |
| description | text | NULL |
| location | varchar(255) | NOT NULL |
| start_time | timestamp | NOT NULL, >= NOW() |
| event_type | enum | 'SEAT_BASED', 'ZONE_BASED' |
| created_at | timestamp | Default: NOW() |

### Seat

| Field | Type | Constraints |
|-------|------|-------------|
| id | uuid | Primary Key, Auto-generated |
| event_id | uuid | Foreign Key → events(id), ON DELETE CASCADE |
| seat_number | varchar(50) | NOT NULL |
| zone_name | varchar(100) | NOT NULL |
| price | decimal(10,0) | NOT NULL, >= 0 |
| status | enum | 'AVAILABLE', 'RESERVED', 'PAYMENT_PROCESSING', 'SOLD' |
| reserved_by | uuid | NULL, Foreign Key → users(id) |
| reserved_until | timestamp | NULL |
| current_order_id | uuid | NULL, Foreign Key → orders(id) |

### Indexes

```sql
CREATE INDEX idx_seats_event_id ON seats(event_id);
CREATE INDEX idx_seats_status ON seats(status);
CREATE INDEX idx_seats_reserved_until ON seats(reserved_until);
CREATE INDEX idx_seats_zone_name ON seats(zone_name);
```

---

## Testing

### Test Data - SEAT_BASED Event
```json
{
  "title": "Concert Test Event",
  "description": "Test event for SEAT_BASED",
  "location": "Test Venue",
  "start_time": "2024-12-31T19:00:00Z",
  "event_type": "SEAT_BASED",
  "seatConfig": {
    "totalSeats": 12,
    "price": 100000,
    "prefix": "T"
  }
}
```

### Test Data - ZONE_BASED Event
```json
{
  "title": "Festival Test Event",
  "description": "Test event for ZONE_BASED",
  "location": "Test Park",
  "start_time": "2024-12-25T18:00:00Z",
  "event_type": "ZONE_BASED",
  "zoneConfigs": [
    {"zoneName": "VIP", "count": 10, "price": 500000},
    {"zoneName": "REGULAR", "count": 20, "price": 200000}
  ]
}
```

---

**📅 Last Updated:** 2024-10-18  
**📖 Version:** 1.2

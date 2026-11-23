# 🎪 Events API

Base URL: `http://localhost:3000/api/events`

---

## 1. Lấy danh sách sự kiện

### Endpoint
```http
GET /api/events
```

### Authentication / Headers
Public endpoint. Không yêu cầu header đặc biệt.

### Path / Query Parameters
Không có. Không có body.

### Response Success (200)
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Lấy danh sách sự kiện thành công.",
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "title": "Concert 2026",
      "description": "Mo ta su kien",
      "location": "Ha Noi",
      "start_time": "2026-12-31T12:00:00.000Z",
      "event_type": "SEAT_BASED",
      "created_at": "2026-11-23T00:00:00.000Z",
      "thumbnails": [],
      "category": "Am nhac",
      "city": "Ha Noi",
      "time": "19:00",
      "min_price": "200000",
      "max_price": "500000",
      "image": null,
      "banner": null,
      "organizer": "ABC",
      "highlights": null,
      "rules": null
    }
  ]
}
```

`category` và `city` là **tên** lấy qua JOIN, không phải UUID trong response.

### Response Error (500)
```json
{
  "success": false,
  "statusCode": 500,
  "message": "Database error",
  "data": null
}
```

---

## 2. Lấy ghế hoặc zone của sự kiện

### Endpoint
```http
GET /api/events/:eventId/details
```

> Route thực tế có hậu tố `/details`.

### Authentication / Headers
Public endpoint. Không yêu cầu header đặc biệt.

### Path Parameters
| Field | Type | Required | Description |
|---|---|---:|---|
| `eventId` | uuid | ✅ | ID trong bảng `events` |

### Query Parameters
| Field | Type | Required | Values | Behavior |
|---|---|---:|---|---|
| `type` | string | ❌ | `ZONE_BASED`, `SEAT_BASED` | Chỉ đúng `ZONE_BASED` mới trả zone; thiếu hoặc giá trị khác trả danh sách ghế |

### Request Body
Không có.

### Response Success — SEAT_BASED (200)
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Thành công.",
  "data": [
    {
      "id": "770e8400-e29b-41d4-a716-446655440010",
      "event_id": "550e8400-e29b-41d4-a716-446655440000",
      "seat_number": "A1",
      "zone_name": "STANDARD",
      "price": "200000",
      "status": "AVAILABLE",
      "reserved_by": null,
      "reserved_until": null,
      "current_order_code": null
    }
  ]
}
```

### Response Success — ZONE_BASED (200)
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Thành công.",
  "data": [
    {
      "zone_name": "VIP",
      "price": "500000",
      "available_count": "25",
      "total_count": "50"
    }
  ]
}
```

Nếu event/ghế/zone không tồn tại, repository hiện trả mảng rỗng với HTTP `200`.

### Response Error (500)
Lỗi UUID/DB được controller hiện tại trả `500`:

```json
{
  "success": false,
  "statusCode": 500,
  "message": "invalid input syntax for type uuid",
  "data": null
}
```

---

## Giá trị trạng thái

### Event type
- `SEAT_BASED`: chọn ghế cụ thể.
- `ZONE_BASED`: chọn số lượng theo khu vực.

### Seat status
- `AVAILABLE`: có thể giữ.
- `RESERVED`: đang giữ 30 giây.
- `PAYMENT_PROCESSING`: đang thanh toán.
- `SOLD`: đã bán.

### Schema liên quan
- `events.category` → `categories.id`; API trả `category_name` dưới field `category`.
- `events.city` → `cities.id`; API trả `city_name` dưới field `city`.
- `seats.current_order_code` → `orders.order_code` (bigint), không phải UUID/order id.

**Last Updated:** 2026-11-23

**Version:** Current backend contract

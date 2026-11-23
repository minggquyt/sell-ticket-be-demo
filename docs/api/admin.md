# 👑 Admin API

Base URL: `http://localhost:3000/api/admin`

Tất cả endpoint yêu cầu:

```http
Authorization: Bearer <admin-token>
```

- Thiếu/token invalid: HTTP `401` với `AUTH_REQUIRED`, `TOKEN_EXPIRED` hoặc `TOKEN_INVALID`.
- User không có role `ADMIN`: HTTP `403`, `data.code = FORBIDDEN`.
- Endpoint có body JSON cần `Content-Type: application/json`.

---

## 1. Lấy toàn bộ vé/order cho trang admin

### Endpoint
```http
GET /api/admin/tickets
```

### Path / Query / Body
Không có.

### Response Success (200)
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Thành công.",
  "data": [
    {
      "id": "tk_100000001",
      "orderCode": 100000001,
      "ticketCode": "#100000001",
      "eventId": "event-uuid",
      "eventTitle": "Concert 2026",
      "customerName": "Nguyen Van A",
      "customerEmail": "user@example.com",
      "seatNumber": "A1, A2",
      "ticketType": "Ghế: A1, A2",
      "purchaseDate": "23/11/2026 21:00:00",
      "price": 400000,
      "status": "paid",
      "orderStatus": "SUCCESS"
    }
  ]
}
```

Mapped `status`: `paid`, `cancelled`, `refund_pending`, `refunded`, `processing`.

### Response Error
`500` khi truy vấn/mapping thất bại, ngoài lỗi auth chung.

---

## 2. Lấy danh sách hoàn tiền

### Endpoint
```http
GET /api/admin/refunds
```

### Path / Query / Body
Không có.

### Response Success (200)
Response là mảng cùng `OrderHistoryItemDTO` của lịch sử order, có thêm:

- `refundBank`: ngân hàng hiện tại của khách hoặc `null`.
- `refundBankError`: lý do admin báo sai tài khoản hoặc `null`.
- `refundSnapshot`: snapshot hoàn tiền đã đóng băng hoặc `null`.
- `customerName`, `customerEmail` khi có.

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Thành công.",
  "data": [
    {
      "refundBank": {
        "bankBin": "970436",
        "bankShortName": "Vietcombank",
        "bankName": "Vietcombank",
        "bankLogo": null,
        "bankAccountNo": "1234567890",
        "bankAccountName": "NGUYEN VAN A"
      },
      "refundBankError": null,
      "refundSnapshot": null,
      "orderCode": 100000001,
      "totalAmount": "400000",
      "status": "REFUND_PENDING",
      "phase": "FINAL",
      "items": []
    }
  ]
}
```

### Response Error
`500` khi truy vấn thất bại.

---

## 3. Xác nhận đã hoàn tiền

### Endpoint
```http
POST /api/admin/orders/:orderCode/confirm-refund
```

### Path Parameters
| Field | Type | Required |
|---|---|---:|
| `orderCode` | bigint | ✅ |

### Query Parameters
Không có.

### Request Body
| Field | Type | Required | Constraint |
|---|---|---:|---|
| `bankBin` | string | ✅ | Controller cắt tối đa 6 ký tự |
| `bankAccountNo` | string | ✅ | Tối đa 25 ký tự |
| `bankAccountName` | string | ✅ | Tối đa 100 ký tự |
| `note` | string | ❌ | Tối đa 255 ký tự |

```json
{
  "bankBin": "970436",
  "bankAccountNo": "1234567890",
  "bankAccountName": "NGUYEN VAN A",
  "note": "Da chuyen khoan"
}
```

### Response Success (200)
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Đã xác nhận hoàn tiền cho đơn #100000001 thành công.",
  "data": {
    "orderCode": 100000001,
    "status": "REFUNDED",
    "refundSnapshot": {
      "bankBin": "970436",
      "bankAccountNo": "1234567890",
      "bankAccountName": "NGUYEN VAN A"
    }
  }
}
```

### Response Error (400)
Thiếu bank fields; orderCode invalid; order không còn `REFUND_PENDING`; đang có `refund_bank_error`; hoặc thông tin không khớp dữ liệu ngân hàng hiện tại.

---

## 4. Báo sai thông tin ngân hàng hoàn tiền

### Endpoint
```http
POST /api/admin/orders/:orderCode/refund-bank-error
```

### Path Parameters
`orderCode`: bigint.

### Query Parameters
Không có.

### Request Body
| Field | Type | Required | Validation |
|---|---|---:|---|
| `reason` | string | ✅ | Sau trim dài tối thiểu 3, tối đa 255 ký tự |

```json
{ "reason": "Tên chủ tài khoản không khớp" }
```

### Response Success (200)
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Đã báo sai thông tin TK cho đơn #100000001.",
  "data": {
    "orderCode": 100000001,
    "refundBankError": "Tên chủ tài khoản không khớp"
  }
}
```

### Response Error (400)
Reason invalid, orderCode invalid hoặc không tìm thấy order `REFUND_PENDING`.

---

## 5. Tạo sự kiện

### Endpoint
```http
POST /api/admin/events
```

### Path / Query Parameters
Không có.

### Request Body chung
| Field | Type | Required | Description |
|---|---|---:|---|
| `title` | string | ✅ | Tên sự kiện |
| `description` | string | ❌ | Mô tả |
| `location` | string | ✅ | Địa điểm |
| `start_time` | ISO datetime | ❌ | Mặc định thời điểm hiện tại |
| `event_type` | enum | ✅ | `SEAT_BASED` hoặc `ZONE_BASED` |
| `category` | uuid | ❌ | FK `categories.id` |
| `city` | uuid | ❌ | FK `cities.id` |
| `time` | string | ❌ | Chuỗi hiển thị thời gian |
| `min_price`, `max_price` | number | ❌ | Giá hiển thị |
| `image`, `banner` | string | ❌ | URL/text |
| `organizer` | string | ❌ | Đơn vị tổ chức |
| `highlights`, `rules` | JSON | ❌ | Lưu jsonb |
| `thumbnails` | string[] | ❌ | Danh sách ảnh |

### SEAT_BASED config
| Field | Required | Validation/behavior |
|---|---:|---|
| `seatConfig.totalSeats` | ✅ | > 0; dùng để suy ra `seatsPerRow` nếu field này thiếu |
| `seatConfig.price` | ✅ | DTO chấp nhận >= 0; service dùng default 200000 nếu giá là 0/falsy |
| `seatConfig.rowsCount` | ❌ | Default 1 |
| `seatConfig.seatsPerRow` | ❌ | Default `ceil(totalSeats / rowsCount)` |

```json
{
  "title": "Concert 2026",
  "location": "Ha Noi",
  "start_time": "2026-12-31T12:00:00.000Z",
  "event_type": "SEAT_BASED",
  "category": "category-uuid",
  "city": "city-uuid",
  "seatConfig": { "totalSeats": 100, "rowsCount": 10, "seatsPerRow": 10, "price": 500000 }
}
```

### ZONE_BASED config
`zoneConfigs` là mảng bắt buộc, mỗi phần tử cần `zoneName`, `count > 0`, `price >= 0`.

```json
{
  "title": "Festival 2026",
  "location": "Ho Chi Minh City",
  "event_type": "ZONE_BASED",
  "zoneConfigs": [
    { "zoneName": "VIP", "count": 50, "price": 500000 },
    { "zoneName": "REGULAR", "count": 200, "price": 200000 }
  ]
}
```

### Response Success (200)
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Tạo sự kiện và cấu hình ghế thành công!",
  "data": {
    "id": "event-uuid",
    "title": "Concert 2026",
    "description": null,
    "location": "Ha Noi",
    "start_time": "2026-12-31T12:00:00.000Z",
    "event_type": "SEAT_BASED",
    "created_at": "2026-11-23T14:00:00.000Z",
    "thumbnails": [],
    "category": null,
    "city": null,
    "time": null,
    "min_price": "0",
    "max_price": "0",
    "image": null,
    "banner": null,
    "organizer": null,
    "highlights": null,
    "rules": null
  }
}
```

### Response Error (400)
DTO validation, FK category/city invalid hoặc lỗi DB.

---

## 6. Cập nhật sự kiện

### Endpoint
```http
PUT /api/admin/events/:eventId
```

### Path Parameters
| Field | Type | Required |
|---|---|---:|
| `eventId` | uuid | ✅ |

### Query Parameters
Không có.

### Request Body
Body hỗ trợ các field event và config giống API tạo. Controller **không chạy `CreateEventRequestDTO`** cho update, vì vậy client nên gửi đầy đủ các field cần giữ; repository chỉ update field có giá trị khác `undefined`.

- Nếu chưa có ghế held/sold: config mới có thể xóa và tạo lại inventory.
- Nếu đã có ghế held/sold: không tạo lại inventory; chỉ cập nhật giá ghế `AVAILABLE` theo config phù hợp.

### Response Success (200)
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Cập nhật sự kiện thành công!",
  "data": {
    "id": "event-uuid",
    "title": "Concert updated",
    "event_type": "SEAT_BASED"
  }
}
```

Response `data` đầy đủ cùng `EventResponseDTO` như API tạo.

### Response Error (400)
Event không tồn tại, UUID/FK invalid hoặc lỗi DB.

---

## 7. Xóa sự kiện

### Endpoint
```http
DELETE /api/admin/events/:eventId
```

### Path Parameters
`eventId`: uuid.

### Query / Body
Không có.

### Response Success (200)
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Đã xóa sự kiện thành công.",
  "data": null
}
```

### Response Error (400)
UUID invalid, event không xóa được hoặc lỗi FK/DB. Schema được cung cấp không khai báo `ON DELETE CASCADE`, vì vậy event có seat/order liên quan có thể bị PostgreSQL từ chối xóa.

---

## Error Authorization dùng chung

```json
{
  "success": false,
  "statusCode": 403,
  "message": "Yêu cầu quyền Quản trị viên (Admin).",
  "data": { "code": "FORBIDDEN" }
}
```

**Last Updated:** 2026-11-23

**Version:** Current backend contract

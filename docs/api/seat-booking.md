# 💺 Seat Booking API

Base URL: `http://localhost:3000/api/seats`

Tất cả endpoint trong file này yêu cầu:

```http
Authorization: Bearer <token>
```

Endpoint có body JSON yêu cầu thêm `Content-Type: application/json`.

---

## 1. Lấy phiên giữ vé/thanh toán đang hoạt động

### Endpoint
```http
GET /api/seats/my-active-session
```

### Headers
```http
Authorization: Bearer <token>
```

### Path / Query Parameters
Không có. Không có body.

### Response Success — không có phiên (200)
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Thành công.",
  "data": null
}
```

### Response Success — đang giữ ghế (200)
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Thành công.",
  "data": {
    "step": "RESERVED",
    "eventId": "event-uuid",
    "eventTitle": "Concert 2026",
    "eventType": "SEAT_BASED",
    "orderCode": null,
    "checkoutUrl": null,
    "totalAmount": 400000,
    "reservedUntil": "2026-11-23T14:00:30.000Z",
    "serverTime": "2026-11-23T14:00:00.000Z",
    "seats": [
      { "id": "seat-uuid", "seat_number": "A1", "zone_name": "STANDARD", "price": 200000 }
    ]
  }
}
```

### Response Success — đang thanh toán (200)
`step` là `PAYMENT_PROCESSING`; response có thêm `expiresAt`, `confirmUntil`, `phase` (`WAITING` hoặc `CONFIRMING`) và `orderCode`.

### Response Errors
- `401`: `AUTH_REQUIRED`, `TOKEN_EXPIRED`, `TOKEN_INVALID`.
- `500`: không thể tải/đối soát session.

---

## 2. Giữ ghế cụ thể

### Endpoint
```http
POST /api/seats/reserve
```

### Authorization
Ngoài JWT, role phải là `CUSTOMER`; role khác nhận `403 FORBIDDEN`.

### Headers
```http
Authorization: Bearer <token>
Content-Type: application/json
```

### Path / Query Parameters
Không có.

### Request Body
| Field | Type | Required | Validation |
|---|---|---:|---|
| `seatIds` | array | ✅ | 1–4 phần tử; DTO không tự kiểm tra UUID từng phần tử |

```json
{ "seatIds": ["seat-uuid-1", "seat-uuid-2"] }
```

### Response — giữ đủ (200)
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Đã giữ chỗ thành công.",
  "data": {
    "code": "FULLY_RESERVED",
    "seatIds": ["seat-uuid-1", "seat-uuid-2"],
    "reserved_until": "2026-11-23T14:00:30.000Z",
    "serverTime": "2026-11-23T14:00:00.000Z",
    "seats": [
      {
        "id": "seat-uuid-1",
        "seat_number": "A1",
        "status": "RESERVED",
        "reserved_until": "2026-11-23T14:00:30.000Z",
        "zone_name": "STANDARD",
        "price": "200000"
      }
    ]
  }
}
```

### Response — chỉ còn một phần (200)
Lưu ý HTTP vẫn `200`, nhưng `success=false`.

```json
{
  "success": false,
  "statusCode": 200,
  "message": "Một số ghế bạn chọn vừa có người khác giữ.",
  "data": {
    "code": "PARTIAL_AVAILABILITY",
    "unavailableSeats": ["A1"],
    "availableSeats": [{ "id": "seat-uuid-2", "seat_number": "A2" }],
    "availableSeatIds": ["seat-uuid-2"]
  }
}
```

### Response Errors
| HTTP | Case |
|---|---|
| 400 | DTO invalid; `USER_HAS_ACTIVE_HOLD`; `ALL_SEATS_TAKEN` |
| 401 | JWT missing/expired/invalid |
| 403 | User không phải `CUSTOMER` |
| 500 | Lỗi hệ thống/DB khi giữ ghế |

Lỗi nghiệp vụ có `data.code`, ví dụ:
```json
{
  "success": false,
  "statusCode": 400,
  "message": "Bạn đang có một phiên giữ vé chưa hoàn tất.",
  "data": { "code": "USER_HAS_ACTIVE_HOLD" }
}
```

---

## 3. Xác nhận giữ phần ghế còn lại

### Endpoint
```http
POST /api/seats/confirm-partial-hold
```

### Headers
```http
Authorization: Bearer <token>
Content-Type: application/json
```

### Path / Query Parameters
Không có.

### Request Body
| Field | Type | Required | Validation |
|---|---|---:|---|
| `confirmSeatIds` | array | ✅ | Mảng không rỗng |

```json
{ "confirmSeatIds": ["seat-uuid-2"] }
```

### Response Success (200)
Cùng shape với giữ đủ, `data.code = PARTIAL_RESERVED_SUCCESS`.

### Response Errors
- `400`: body invalid, `USER_HAS_ACTIVE_HOLD`, `PARTIAL_HOLD_EXPIRED`.
- `401`: lỗi JWT.
- `500`: lỗi hệ thống.

---

## 4. Giữ vé theo zone

### Endpoint
```http
POST /api/seats/reserve-zone
```

### Headers
```http
Authorization: Bearer <token>
Content-Type: application/json
```

### Path / Query Parameters
Không có.

### Request Body
| Field | Type | Required | Validation |
|---|---|---:|---|
| `eventId` | uuid | ✅ | Event cần giữ vé |
| `zones` | array | ✅ | Không rỗng; tổng quantity tối đa 4 |
| `zones[].zoneName` hoặc `zone_name` | string | ✅ | Tên zone |
| `zones[].quantity` | number | ✅ | Lớn hơn 0 |

```json
{
  "eventId": "event-uuid",
  "zones": [
    { "zoneName": "VIP", "quantity": 2 },
    { "zoneName": "REGULAR", "quantity": 1 }
  ]
}
```

### Response Success (200)
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Đã giữ thành công tổng cộng 3 vé!",
  "data": {
    "seats": [
      {
        "id": "seat-uuid",
        "seat_number": "VIP-01",
        "status": "RESERVED",
        "reserved_until": "2026-11-23T14:00:30.000Z",
        "zone_name": "VIP",
        "price": "500000"
      }
    ],
    "seatIds": ["seat-uuid"],
    "reserved_until": "2026-11-23T14:00:30.000Z",
    "serverTime": "2026-11-23T14:00:00.000Z",
    "totalTickets": 3
  }
}
```

### Response Errors
- `400`: dữ liệu zone invalid, tổng > 4, thiếu inventory hoặc user có active hold.
- `401`: lỗi JWT.

---

## 5. Bắt đầu checkout PayOS QR

### Endpoint
```http
POST /api/seats/start-checkout
```

### Headers
```http
Authorization: Bearer <token>
Content-Type: application/json
```

### Path / Query Parameters
Không có.

### Request Body
| Field | Type | Required | Description |
|---|---|---:|---|
| `seatIds` | array | ✅ | Mảng ghế đang được chính user giữ |
| `returnUrl` | string | ❌ | PayOS redirect; DTO hiện không validate URL |
| `cancelUrl` | string | ❌ | PayOS redirect; DTO hiện không validate URL |

```json
{
  "seatIds": ["seat-uuid-1"],
  "returnUrl": "https://frontend.example/checkout",
  "cancelUrl": "https://frontend.example/checkout"
}
```

### Response Success (200)
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Khởi tạo thanh toán thành công!",
  "data": {
    "orderCode": 100000001,
    "totalAmount": 200000,
    "expiresAt": "2026-11-23T14:02:00.000Z",
    "confirmUntil": "2026-11-23T14:02:30.000Z",
    "paymentTimeout": "2026-11-23T14:02:00.000Z",
    "expiredAt": 1795442520,
    "serverTime": "2026-11-23T14:00:00.000Z",
    "paymentInfo": {
      "paymentLinkId": "payos-id",
      "bin": "970422",
      "accountNumber": "123456",
      "accountName": "PAYOS",
      "amount": 200000,
      "description": "VE SU KIEN 100000001",
      "qrCode": "000201...",
      "currency": "VND"
    }
  }
}
```

### Response Errors
- `400`: body invalid; ghế không tồn tại, không thuộc user, không còn `RESERVED`, hết hạn; PayOS lỗi.
- `401`: lỗi JWT.

---

## 6. Nhả ghế hoặc hủy theo order

### Endpoint
```http
POST /api/seats/release
```

### Headers
```http
Authorization: Bearer <token>
Content-Type: application/json
```

### Path / Query Parameters
Không có.

### Request Body
Phải có ít nhất một trong hai:

| Field | Type | Required | Description |
|---|---|---:|---|
| `seatIds` | array | Điều kiện | Nhả các ghế `RESERVED` thuộc user; mảng rỗng sẽ nhả toàn bộ hold hiện tại |
| `orderCode` | bigint/number/string số | Điều kiện | Hủy order thay vì nhả hold thường |

```json
{ "seatIds": ["seat-uuid-1"] }
```

hoặc:
```json
{ "orderCode": 100000001 }
```

### Response Success (200)
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Đã hủy giữ chỗ thành công.",
  "data": [
    {
      "id": "seat-uuid-1",
      "seat_number": "A1",
      "current_order_code": null
    }
  ]
}
```

### Response Errors
- `400`: thiếu cả hai field hoặc orderCode invalid.
- `404`: order không tồn tại/không thuộc user.
- `409`: order không còn hủy được hoặc đang ở pha `CONFIRMING`.
- `401`: lỗi JWT.

---

## Error xác thực dùng chung

```json
{
  "success": false,
  "statusCode": 401,
  "message": "Bạn chưa đăng nhập.",
  "data": { "code": "AUTH_REQUIRED" }
}
```

**Last Updated:** 2026-11-23

**Version:** Current backend contract

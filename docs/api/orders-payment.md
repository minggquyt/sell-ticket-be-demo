# 💳 Orders & Payment API

Base URL: `http://localhost:3000/api/orders`

> Luồng hiện hành dùng QR tại website: giữ ghế → `POST /api/seats/start-checkout` → theo dõi order bằng REST/SSE. Không có route `/api/orders/checkout` hoặc `/api/orders/my-orders` trong backend hiện tại.

---

## 1. Lấy lịch sử đơn hàng

### Endpoint
```http
GET /api/orders/my-history
```

### Headers
```http
Authorization: Bearer <token>
```

### Path / Query Parameters
Không có. Không có body.

### Response Success (200)
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Thành công.",
  "data": [
    {
      "refundBank": null,
      "refundBankError": null,
      "refundSnapshot": null,
      "orderCode": 100000001,
      "totalAmount": "400000",
      "status": "SUCCESS",
      "expiresAt": "2026-11-23T14:02:00.000Z",
      "confirmUntil": "2026-11-23T14:02:30.000Z",
      "phase": "FINAL",
      "checkoutUrl": null,
      "createdAt": "2026-11-23T14:00:00.000Z",
      "eventId": "event-uuid",
      "eventTitle": "Concert 2026",
      "eventType": "SEAT_BASED",
      "eventStartTime": "2026-12-31T12:00:00.000Z",
      "location": "Ha Noi",
      "items": [
        { "seatId": "seat-uuid", "seatNumber": "A1", "zoneName": "STANDARD", "price": 200000 }
      ]
    }
  ]
}
```

`checkoutUrl` chỉ có thể xuất hiện khi status còn `PAYMENT_PROCESSING`. Với dữ liệu admin, item có thể không có `seatId`.

### Response Errors
- `401`: lỗi JWT.
- `500`: lỗi DB.

---

## 2. Lấy QR/thông tin thanh toán của order

### Endpoint
```http
GET /api/orders/:orderCode/payment
```

### Headers
```http
Authorization: Bearer <token>
```

### Path Parameters
| Field | Type | Required | Description |
|---|---|---:|---|
| `orderCode` | bigint | ✅ | Primary key bảng `orders`, số nguyên dương |

### Query Parameters
| Field | Type | Required | Description |
|---|---|---:|---|
| `sync` | string | ❌ | `1` hoặc `true` để thử đối soát PayOS; có cooldown 10 giây/order |

### Request Body
Không có.

### Response Success (200)
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Thành công.",
  "data": {
    "orderCode": 100000001,
    "status": "PAYMENT_PROCESSING",
    "phase": "WAITING",
    "totalAmount": 200000,
    "expiresAt": "2026-11-23T14:02:00.000Z",
    "confirmUntil": "2026-11-23T14:02:30.000Z",
    "serverTime": "2026-11-23T14:00:00.000Z",
    "createdAt": "2026-11-23T14:00:00.000Z",
    "paymentInfo": {
      "paymentLinkId": "payos-id",
      "bin": "970422",
      "accountNumber": "123456",
      "accountName": "PAYOS",
      "amount": 200000,
      "description": "VE SU KIEN 100000001",
      "qrCode": "000201...",
      "currency": "VND"
    },
    "eventId": "event-uuid",
    "eventTitle": "Concert 2026",
    "eventType": "SEAT_BASED",
    "eventStartTime": "2026-12-31T12:00:00.000Z",
    "location": "Ha Noi",
    "items": [
      { "seatId": "seat-uuid", "seatNumber": "A1", "zoneName": "STANDARD", "price": 200000 }
    ]
  }
}
```

`paymentInfo` chỉ được trả khi status là `PAYMENT_PROCESSING`; status cuối trả `null`.

### Response Errors
- `400`: orderCode không hợp lệ.
- `404`: order không tồn tại hoặc không thuộc user.
- `401`: lỗi JWT.

---

## 3. SSE trạng thái order realtime

### Endpoint
```http
GET /api/orders/:orderCode/events
```

### Headers
```http
Authorization: Bearer <token>
Accept: text/event-stream
```

> Native browser `EventSource` không cho tự đặt `Authorization`; frontend cần fetch-stream/polyfill hoặc cơ chế proxy phù hợp.

### Path Parameters
`orderCode`: bigint số nguyên dương.

### Query / Body
Không có.

### Response Success (200 — `text/event-stream`)
Headers response:

```http
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

Initial event:
```text
event: init
data: {"type":"INIT","orderCode":100000001,"status":"PAYMENT_PROCESSING","phase":"WAITING","serverTime":"2026-11-23T14:00:00.000Z","order":{...}}
```

Status event:
```text
event: order_status
data: {"type":"STATUS_CHANGED","orderCode":100000001,"status":"SUCCESS","phase":"FINAL","serverTime":"2026-11-23T14:01:00.000Z","order":{...}}
```

Heartbeat: `: heartbeat`. Kết nối tự đóng khi status kết thúc hoặc sau tối đa 180 giây. Tối đa 5 connection/order.

### Response Errors trước khi mở stream
JSON `400`, `404`, `401` giống endpoint payment.

---

## 4. Đồng bộ trạng thái order

### Endpoint
```http
GET /api/orders/:orderCode/status
```

### Headers
```http
Authorization: Bearer <token>
```

### Path Parameters
`orderCode`: bigint số nguyên dương.

### Query / Body
Không có. Endpoint tự thử sync PayOS với cooldown.

### Response Success (200)
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Thành công.",
  "data": {
    "orderCode": 100000001,
    "status": "SUCCESS",
    "phase": "FINAL",
    "checkoutUrl": null,
    "totalAmount": 200000,
    "expiresAt": "2026-11-23T14:02:00.000Z",
    "confirmUntil": "2026-11-23T14:02:30.000Z",
    "serverTime": "2026-11-23T14:01:00.000Z",
    "createdAt": "2026-11-23T14:00:00.000Z",
    "eventId": "event-uuid",
    "eventTitle": "Concert 2026",
    "eventType": "SEAT_BASED",
    "eventStartTime": "2026-12-31T12:00:00.000Z",
    "location": "Ha Noi",
    "items": []
  }
}
```

### Response Errors
- `400`: orderCode invalid.
- `404`: không tồn tại/không thuộc user.
- `401`: lỗi JWT.

---

## 5. Hủy order

### Endpoint
```http
POST /api/orders/:orderCode/cancel
```

### Headers
```http
Authorization: Bearer <token>
```

### Path Parameters
`orderCode`: bigint số nguyên dương.

### Query / Body
Không có.

### Response Success (200)
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Đã hủy đơn hàng thành công.",
  "data": {
    "orderCode": 100000001,
    "status": "CANCELLED",
    "releasedSeats": [
      { "id": "seat-uuid", "seat_number": "A1", "current_order_code": null }
    ]
  }
}
```

### Response Errors
| HTTP | Case |
|---|---|
| 400 | orderCode invalid |
| 404 | order không tồn tại/không thuộc user |
| 409 | status không phải `PAYMENT_PROCESSING` |
| 409 | đã qua `expiresAt`, đang pha xác nhận ngân hàng |
| 401 | lỗi JWT |

---

## 6. PayOS webhook

### Endpoint
```http
POST /api/payos-webhook
```

### Authentication / Headers
Không dùng JWT. PayOS signature được verify bằng checksum key.

```http
Content-Type: application/json
```

### Path / Query Parameters
Không có.

### Request Body
Payload chuẩn từ PayOS, tối thiểu gồm `code`, `success`, `data` và `signature`:

```json
{
  "code": "00",
  "success": true,
  "data": {
    "orderCode": 100000001,
    "amount": 200000,
    "code": "00",
    "transactionDateTime": "2026-11-23 21:01:00"
  },
  "signature": "<hmac>"
}
```

### Response — luôn HTTP 200
Success:
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Đã nhận và xử lý webhook thành công",
  "data": null
}
```

Signature invalid/test ping:
```json
{
  "success": false,
  "statusCode": 200,
  "message": "Chữ ký webhook không hợp lệ hoặc là ping test",
  "data": null
}
```

Internal processing error cũng trả `200`, `success=false` để acknowledge webhook.

---

## 7. Health check PayOS webhook

### Endpoint
```http
GET /api/payos-webhook
```

Public; không params/body.

### Response Success (200)
```json
{
  "success": true,
  "statusCode": 200,
  "message": "PayOS Webhook endpoint is active and running!",
  "data": null
}
```

---

## Trạng thái và thời gian

- Order: `PAYMENT_PROCESSING`, `SUCCESS`, `FAILED`, `CANCELLED`, `EXPIRED`, `REFUND_PENDING`, `REFUNDED`.
- `WAITING`: trước `expiresAt` (120 giây quét QR).
- `CONFIRMING`: từ `expiresAt` đến `confirmUntil` (+30 giây chờ webhook).
- `FINAL`: trạng thái kết thúc.
- Thanh toán đến muộn/có tiền sau cancel có thể chuyển `REFUND_PENDING`.

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

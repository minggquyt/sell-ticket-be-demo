# 💳 Orders & Payment API

Base URL: `http://localhost:3000/api/orders`

---

## 1. Khởi tạo thanh toán (Checkout)

### Endpoint
```
POST /api/orders/checkout
```

### Authentication
✅ Required - JWT token

### Headers
```http
Content-Type: application/json
Authorization: Bearer <token>
```

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| seatIds | array[uuid] | ✅ | Danh sách ID ghế đã giữ |
| returnUrl | string | ❌ | URL redirect khi thanh toán thành công |
| cancelUrl | string | ❌ | URL redirect khi hủy thanh toán |

### Validation Rules

#### seatIds
- **Type**: Array of UUID
- **Required**: Có
- **Not Empty**: Ít nhất 1 ghế

#### returnUrl, cancelUrl
- **Type**: String (URL)
- **Required**: Không (có default)
- **Default returnUrl**: `http://127.0.0.1:5500/index.html?status=success&order_id={orderId}`
- **Default cancelUrl**: `http://127.0.0.1:5500/index.html?status=cancel&order_id={orderId}`
- Backend luôn thêm hoặc thay `order_id` bằng UUID của order vào URL do client truyền.

### Business Rules

1. **Seat Validation**:
   - Ghế phải ở trạng thái `RESERVED`
   - Ghế phải được giữ bởi chính user này
   - Ghế chưa hết hạn giữ (reserved_until > now)

2. **Order Creation**:
   - Tạo order với status `PAYMENT_PROCESSING`
   - Timeout: 5 phút (PAYMENT_TIMEOUT_MINUTES)
   - Tạo orderCode unique (8 digits)

3. **Seat Status Update**:
   - `RESERVED` → `PAYMENT_PROCESSING`
   - Gia hạn `reserved_until` thêm 5 phút
   - Gắn `current_order_id`

4. **PayOS Integration**:
   - Tạo payment link từ PayOS
   - Description: `VE SU KIEN {orderCode}` (max 25 chars)
   - Amount: Tổng giá tất cả ghế

### Request Example

```json
{
  "seatIds": [
    "770e8400-e29b-41d4-a716-446655440010",
    "770e8400-e29b-41d4-a716-446655440011"
  ],
  "returnUrl": "https://yoursite.com/payment?status=success",
  "cancelUrl": "https://yoursite.com/payment?status=cancel"
}
```

PayOS sẽ điều hướng về các URL trên với `order_id` được backend thêm vào query string.

### Response Success (200)

```json
{
  "success": true,
  "message": "Khởi tạo thanh toán PayOS thành công!",
  "data": {
    "orderId": "bb0e8400-e29b-41d4-a716-446655440100",
    "orderCode": 12345678,
    "checkoutUrl": "https://pay.payos.vn/web/uuid-here",
    "totalAmount": 1000000,
    "paymentTimeout": "2024-10-18T12:35:00.000Z"
  }
}
```

#### Success Response Fields

| Field | Type | Description |
|-------|------|-------------|
| success | boolean | true |
| message | string | Thông báo |
| data.orderId | uuid | ID đơn hàng trong hệ thống |
| data.orderCode | number | Mã đơn hàng (8 digits) |
| data.checkoutUrl | string | Link thanh toán PayOS |
| data.totalAmount | number | Tổng tiền (VNĐ) |
| data.paymentTimeout | datetime | Thời điểm hết hạn thanh toán |

### Response Error Case 1: Ghế không hợp lệ (400)

```json
{
  "success": false,
  "message": "Ghế A1 không hợp lệ hoặc đã hết hạn giữ chỗ."
}
```

**Reasons**:
- Ghế không phải `RESERVED`
- Ghế không thuộc user này
- Ghế đã hết hạn giữ

### Response Error Case 2: Lỗi PayOS (400)

```json
{
  "success": false,
  "message": "Không thể tạo liên kết thanh toán PayOS: Credentials not configured"
}
```

### Response Error Case 3: Unauthorized (401)

```json
{
  "success": false,
  "message": "Bạn chưa đăng nhập."
}
```

### cURL Example

```bash
curl -X POST http://localhost:3000/api/orders/checkout \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "seatIds": [
      "770e8400-e29b-41d4-a716-446655440010",
      "770e8400-e29b-41d4-a716-446655440011"
    ],
    "returnUrl": "https://yoursite.com/success",
    "cancelUrl": "https://yoursite.com/cancel"
  }'
```

### Frontend Flow

```javascript
// 1. User clicks "Thanh toán"
const response = await fetch('/api/orders/checkout', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    seatIds: selectedSeats,
    returnUrl: window.location.origin + '/payment-success',
    cancelUrl: window.location.origin + '/payment-cancel'
  })
});

const data = await response.json();

// 2. Redirect to PayOS
if (data.success) {
  window.location.href = data.data.checkoutUrl;
}
```

---

## 2. Lấy lịch sử đơn hàng

### Endpoint
```
GET /api/orders/my-history
```

### Authentication
✅ Required - JWT token

### Headers
```http
Authorization: Bearer <token>
```

### Query Parameters
Không có

### Response Success (200)

```json
{
  "success": true,
  "data": [
    {
      "order_id": "bb0e8400-e29b-41d4-a716-446655440100",
      "total_amount": "1000000",
      "order_status": "SUCCESS",
      "created_at": "2024-10-18T12:00:00.000Z",
      "event_title": "Concert Rock Festival 2024",
      "event_type": "SEAT_BASED",
      "location": "SVĐ Mỹ Đình, Hà Nội",
      "items": [
        {
          "seat_number": "A1",
          "zone_name": "VIP",
          "price": "500000"
        },
        {
          "seat_number": "A2",
          "zone_name": "VIP",
          "price": "500000"
        }
      ]
    },
    {
      "order_id": "bb0e8400-e29b-41d4-a716-446655440101",
      "total_amount": "600000",
      "order_status": "FAILED",
      "created_at": "2024-10-17T10:00:00.000Z",
      "event_title": "Festival Music 2024",
      "event_type": "ZONE_BASED",
      "location": "Công viên Thống Nhất",
      "items": [
        {
          "seat_number": "VIP-15",
          "zone_name": "VIP",
          "price": "300000"
        },
        {
          "seat_number": "REGULAR-20",
          "zone_name": "REGULAR",
          "price": "150000"
        },
        {
          "seat_number": "REGULAR-21",
          "zone_name": "REGULAR",
          "price": "150000"
        }
      ]
    }
  ]
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| success | boolean | true |
| data | array | Danh sách đơn hàng |
| data[].order_id | uuid | ID đơn hàng |
| data[].total_amount | string | Tổng tiền |
| data[].order_status | enum | Trạng thái đơn |
| data[].created_at | datetime | Thời gian tạo |
| data[].event_title | string | Tên sự kiện |
| data[].event_type | enum | Loại sự kiện |
| data[].location | string | Địa điểm |
| data[].items | array | Chi tiết vé |
| data[].items[].seat_number | string | Số ghế |
| data[].items[].zone_name | string | Khu vực |
| data[].items[].price | string | Giá vé |

#### Order Status Values

| Status | Description | Color |
|--------|-------------|-------|
| PAYMENT_PROCESSING | Đang chờ thanh toán | 🟡 Yellow |
| SUCCESS | Thanh toán thành công | 🟢 Green |
| FAILED | Thanh toán thất bại | 🔴 Red |
| CANCELLED | Đã hủy | ⚫ Gray |

### Response Error (401)

```json
{
  "success": false,
  "message": "Bạn chưa đăng nhập."
}
```

### Response Error (500)

```json
{
  "success": false,
  "message": "Database error message"
}
```

### cURL Example

```bash
curl -X GET http://localhost:3000/api/orders/my-history \
  -H "Authorization: Bearer <token>"
```

---

## Xem hóa đơn/chi tiết đơn hàng

### Endpoint

```http
GET /api/orders/:orderId/invoice
```

`orderId` là UUID của đơn hàng trong hệ thống (cột `orders.id`), không phải `order_code`.

### Authentication

✅ Required - JWT token. Người dùng chỉ xem được đơn hàng của chính mình.

### Response Success (200)

```json
{
  "success": true,
  "data": {
    "orderId": "bb0e8400-e29b-41d4-a716-446655440100",
    "orderCode": 12345678,
    "orderStatus": "SUCCESS",
    "totalAmount": "1000000",
    "expiresAt": "2026-10-20T08:30:00.000Z",
    "createdAt": "2026-10-20T08:25:00.000Z",
    "customer": {
      "fullName": "Nguyen Van A",
      "email": "user@example.com"
    },
    "items": [
      {
        "eventId": "550e8400-e29b-41d4-a716-446655440000",
        "eventTitle": "Concert",
        "eventType": "SEAT_BASED",
        "location": "Nhà hát",
        "startTime": "2026-10-25T12:00:00.000Z",
        "seatNumber": "A1",
        "zoneName": "VIP",
        "price": "500000"
      }
    ]
  }
}
```

Chi tiết được tổng hợp từ `orders`, `users`, `order_items`, `seats` và `events` theo [schema hệ thống](../database/schema.md). Endpoint trả `404` nếu order không tồn tại hoặc không thuộc người dùng đang đăng nhập; `400` nếu `orderId` không đúng định dạng UUID.

> Schema hiện không có bảng invoice hoặc payment transaction riêng. Endpoint này trả về thông tin đơn hàng dạng hóa đơn/biên nhận để hiển thị; không thay thế hóa đơn điện tử hoặc chứng từ thuế.

### cURL Example

```bash
curl http://localhost:3000/api/orders/bb0e8400-e29b-41d4-a716-446655440100/invoice \
  -H "Authorization: Bearer <jwt>"
```

---

## 3. PayOS Webhook (Internal)

### Endpoint
```
POST /payos-webhook
```

⚠️ **Endpoint này KHÔNG nên gọi thủ công!**  
Đây là webhook được PayOS gọi tự động sau khi thanh toán.

### Authentication
❌ Không yêu cầu - Public webhook endpoint

### Headers
```http
Content-Type: application/json
```

### Request Body (From PayOS)

```json
{
  "code": "00",
  "data": {
    "orderCode": 12345678,
    "amount": 1000000,
    "description": "VE SU KIEN 12345678",
    "accountNumber": "1234567890",
    "reference": "FT123456",
    "transactionDateTime": "2024-10-18T12:30:00+07:00",
    "currency": "VND",
    "paymentLinkId": "uuid",
    "counterAccountBankId": "",
    "counterAccountBankName": "",
    "counterAccountName": "NGUYEN VAN A",
    "counterAccountNumber": "0987654321",
    "virtualAccountName": "",
    "virtualAccountNumber": ""
  },
  "signature": "signature_here"
}
```

#### Request Body Fields

| Field | Type | Description |
|-------|------|-------------|
| code | string | Mã kết quả: "00" = success |
| data.orderCode | number | Mã đơn hàng (8 digits) |
| data.amount | number | Số tiền thanh toán |
| signature | string | Chữ ký xác thực (optional) |

### Response (Always 200)

```json
{
  "success": true,
  "message": "Đã nhận webhook thành công"
}
```

⚠️ **Luôn trả về 200** để PayOS không retry

### Business Logic

#### Case 1: code = "00" (Success)
1. Tìm order theo orderCode
2. Cập nhật order status → `SUCCESS`
3. Cập nhật seats:
   - status → `SOLD`
   - reserved_by → NULL
   - reserved_until → NULL
   - current_order_id → NULL
4. Log thành công

#### Case 2: code != "00" (Failed/Cancelled)
1. Tìm order theo orderCode
2. Cập nhật order status → `FAILED`
3. Cập nhật seats:
   - status → `AVAILABLE`
   - reserved_by → NULL
   - reserved_until → NULL
   - current_order_id → NULL
4. Log thất bại

#### Case 3: Order không tồn tại
- Log warning: "Ping test từ PayOS"
- Return 200 (OK)

### PayOS Code Values

| Code | Meaning |
|------|---------|
| 00 | Giao dịch thành công |
| 01 | Giao dịch thất bại |
| 02 | Giao dịch bị hủy |

### Idempotency

- Nếu order đã ở trạng thái `SUCCESS`, webhook tiếp theo sẽ bị ignore
- Tránh xử lý trùng lặp

### Security

- ✅ Signature verification (optional, có thể bỏ qua nếu không verify được)
- ✅ Order code validation
- ✅ Idempotency check

### Testing Webhook (Development)

#### Test Endpoint
```
POST /api/orders/webhook
```

**Body:**
```json
{
  "orderCode": 12345678,
  "success": true
}
```

hoặc

```json
{
  "orderId": "bb0e8400-e29b-41d4-a716-446655440100",
  "success": false
}
```

---

## 4. Health Check - PayOS Webhook

### Endpoint
```
GET /api/payos-webhook
```

### Authentication
❌ Không yêu cầu

### Response

```json
{
  "success": true,
  "message": "PayOS Webhook endpoint is active and running!"
}
```

### Use Case
PayOS có thể gọi endpoint này để kiểm tra webhook có hoạt động không.

---

## Payment Flow

```
[User] → Select Seats → Reserve Seats
  ↓
[User] → Click "Thanh toán"
  ↓
[Frontend] → POST /api/orders/checkout
  ↓
[Backend] → Create Order (PAYMENT_PROCESSING)
  ↓
[Backend] → Update Seats (PAYMENT_PROCESSING)
  ↓
[Backend] → PayOS API → Create payment link
  ↓
[Backend] → Return checkoutUrl
  ↓
[Frontend] → Redirect to PayOS
  ↓
[User] → Enter payment info on PayOS
  ↓
[PayOS] → Process payment
  ↓
  ├─ Success → POST /payos-webhook (code=00)
  │   ↓
  │   [Backend] → Order: SUCCESS, Seats: SOLD
  │   ↓
  │   [PayOS] → Redirect to returnUrl
  │
  └─ Failed → POST /payos-webhook (code!=00)
      ↓
      [Backend] → Order: FAILED, Seats: AVAILABLE
      ↓
      [PayOS] → Redirect to cancelUrl
```

---

## Data Types & Constraints

### Order

| Field | Type | Constraints |
|-------|------|-------------|
| id | uuid | Primary Key, Auto |
| user_id | uuid | Foreign Key → users(id), NOT NULL |
| total_amount | decimal(10,0) | NOT NULL, >= 0 |
| status | enum | 'PAYMENT_PROCESSING', 'SUCCESS', 'FAILED', 'CANCELLED' |
| expires_at | timestamp | NOT NULL |
| order_code | bigint | Unique, 8 digits |
| created_at | timestamp | Default: NOW() |

### Order Items

| Field | Type | Constraints |
|-------|------|-------------|
| id | uuid | Primary Key, Auto |
| order_id | uuid | Foreign Key → orders(id), NOT NULL |
| seat_id | uuid | Foreign Key → seats(id), NOT NULL |
| price | decimal(10,0) | NOT NULL, >= 0 |

### Indexes

```sql
CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_order_code ON orders(order_code);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_order_items_order_id ON order_items(order_id);
```

---

## Error Handling

### PayOS Errors

| Error | Reason | Solution |
|-------|--------|----------|
| Credentials not configured | Thiếu PAYOS_CLIENT_ID, PAYOS_API_KEY, PAYOS_CHECKSUM_KEY | Kiểm tra .env |
| Invalid amount | Amount <= 0 hoặc quá lớn | Kiểm tra seat prices |
| Network timeout | PayOS API không phản hồi | Retry hoặc thông báo user |

### Order Errors

| Error | Reason | Solution |
|-------|--------|----------|
| Ghế không hợp lệ | Ghế không RESERVED hoặc hết hạn | Giữ lại ghế trước |
| Order không tìm thấy | orderCode không tồn tại | Kiểm tra orderCode |

---

## Constants

| Constant | Value | Description |
|----------|-------|-------------|
| PAYMENT_TIMEOUT_MINUTES | 5 | Thời gian chờ thanh toán |
| ORDER_CODE_LENGTH | 8 | Độ dài order code |

---

**📅 Last Updated:** 2024-10-18  
**📖 Version:** 1.2

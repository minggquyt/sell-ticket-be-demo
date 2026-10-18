# 💺 Seat Booking API

Base URL: `http://localhost:3000/api/seats`

---

## 1. Giữ ghế (Request Hold)

### Endpoint
```
POST /api/seats/request-hold
```

### Authentication
✅ Required - JWT token in header

### Headers
```http
Content-Type: application/json
Authorization: Bearer <token>
```

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| seatIds | array[uuid] | ✅ | Danh sách ID ghế muốn giữ |

### Validation Rules

#### seatIds
- **Type**: Array of UUID strings
- **Required**: Có
- **Not Empty**: Phải có ít nhất 1 phần tử
- **Max Length**: 4 phần tử (MAX_TICKETS_PER_USER)
- **Format**: Mỗi phần tử phải là UUID hợp lệ

### Business Rules

1. **One Active Hold Per User**: User chỉ được giữ 1 phiên tại 1 thời điểm
2. **Hold Duration**: 30 giây (SEAT_HOLD_DURATION_SECONDS)
3. **Auto Release**: Sau 30s tự động giải phóng nếu không thanh toán
4. **Concurrency**: Sử dụng `FOR UPDATE SKIP LOCKED` để xử lý đồng thời

### Request Example

```json
{
  "seatIds": [
    "770e8400-e29b-41d4-a716-446655440010",
    "770e8400-e29b-41d4-a716-446655440011",
    "770e8400-e29b-41d4-a716-446655440012"
  ]
}
```

### Response Case 1: Full Reserved (200)

**Scenario**: Tất cả ghế đều available, giữ thành công 100%

```json
{
  "success": true,
  "code": "FULLY_RESERVED",
  "message": "Đã giữ chỗ thành công.",
  "data": {
    "seatIds": [
      "770e8400-e29b-41d4-a716-446655440010",
      "770e8400-e29b-41d4-a716-446655440011",
      "770e8400-e29b-41d4-a716-446655440012"
    ],
    "reserved_until": "2024-10-18T12:30:30.000Z",
    "seats": [
      {
        "id": "770e8400-e29b-41d4-a716-446655440010",
        "seat_number": "A1",
        "status": "RESERVED",
        "reserved_until": "2024-10-18T12:30:30.000Z"
      },
      {
        "id": "770e8400-e29b-41d4-a716-446655440011",
        "seat_number": "A2",
        "status": "RESERVED",
        "reserved_until": "2024-10-18T12:30:30.000Z"
      },
      {
        "id": "770e8400-e29b-41d4-a716-446655440012",
        "seat_number": "A3",
        "status": "RESERVED",
        "reserved_until": "2024-10-18T12:30:30.000Z"
      }
    ]
  }
}
```

#### Success Response Fields

| Field | Type | Description |
|-------|------|-------------|
| success | boolean | true |
| code | string | FULLY_RESERVED |
| message | string | Thông báo |
| data.seatIds | array[uuid] | Danh sách ID ghế đã giữ |
| data.reserved_until | datetime | Thời điểm hết hạn giữ chỗ |
| data.seats | array | Chi tiết từng ghế |
| data.seats[].id | uuid | ID ghế |
| data.seats[].seat_number | string | Số ghế |
| data.seats[].status | string | RESERVED |
| data.seats[].reserved_until | datetime | Hết hạn |

### Response Case 2: Partial Availability (200)

**Scenario**: Một số ghế đã bị người khác giữ, server trả về ghế còn lại

```json
{
  "success": false,
  "code": "PARTIAL_AVAILABILITY",
  "message": "Một số ghế bạn chọn vừa có người khác giữ.",
  "unavailableSeats": ["A1", "A2"],
  "availableSeats": [
    {
      "id": "770e8400-e29b-41d4-a716-446655440012",
      "seat_number": "A3"
    }
  ],
  "availableSeatIds": [
    "770e8400-e29b-41d4-a716-446655440012"
  ]
}
```

#### Partial Response Fields

| Field | Type | Description |
|-------|------|-------------|
| success | boolean | false (partial = không giữ được hết) |
| code | string | PARTIAL_AVAILABILITY |
| message | string | Thông báo |
| unavailableSeats | array[string] | Danh sách seat_number không khả dụng |
| availableSeats | array | Ghế còn lại có thể giữ |
| availableSeats[].id | uuid | ID ghế |
| availableSeats[].seat_number | string | Số ghế |
| availableSeatIds | array[uuid] | ID ghế available (dùng cho confirm-partial) |

**Frontend Flow:**
1. Nhận response PARTIAL_AVAILABILITY
2. Hiển thị cho user: "Ghế A1, A2 đã được người khác chọn. Bạn có muốn giữ ghế A3?"
3. Nếu user đồng ý → Gọi `/api/seats/confirm-partial` với `availableSeatIds`

### Response Case 3: All Seats Taken (400)

**Scenario**: Tất cả ghế đã bị người khác giữ

```json
{
  "success": false,
  "code": "ALL_SEATS_TAKEN",
  "message": "Tất cả các ghế bạn chọn đều đã bị người khác giữ."
}
```

### Response Case 4: User Has Active Hold (400)

**Scenario**: User đang giữ ghế khác, chưa thanh toán hoặc hủy

```json
{
  "success": false,
  "code": "USER_HAS_ACTIVE_HOLD",
  "message": "Bạn đang có một phiên giữ vé chưa hoàn tất."
}
```

**Resolution**: User phải hủy phiên cũ (release) hoặc đợi hết hạn (30s)

### Response Case 5: Exceeded Max Seats (400)

**Scenario**: Chọn quá 4 ghế

```json
{
  "success": false,
  "code": "EXCEEDED_MAX_SEATS",
  "message": "Bạn chỉ được chọn tối đa 4 ghế cho mỗi tài khoản."
}
```

### Response Case 6: Invalid Request (400)

```json
{
  "success": false,
  "message": "Danh sách seatIds không hợp lệ."
}
```

### Response Case 7: Unauthorized (401)

```json
{
  "success": false,
  "message": "Bạn chưa đăng nhập."
}
```

### cURL Example

```bash
curl -X POST http://localhost:3000/api/seats/request-hold \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -d '{
    "seatIds": [
      "770e8400-e29b-41d4-a716-446655440010",
      "770e8400-e29b-41d4-a716-446655440011"
    ]
  }'
```

---

## 2. Xác nhận giữ ghế một phần (Confirm Partial)

### Endpoint
```
POST /api/seats/confirm-partial
```

### Authentication
✅ Required

### Headers
```http
Content-Type: application/json
Authorization: Bearer <token>
```

### Use Case
Sau khi nhận response `PARTIAL_AVAILABILITY` từ `request-hold`, user quyết định giữ các ghế còn lại.

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| confirmSeatIds | array[uuid] | ✅ | Danh sách ID ghế từ availableSeatIds |

### Request Example

```json
{
  "confirmSeatIds": [
    "770e8400-e29b-41d4-a716-446655440012"
  ]
}
```

### Response Success (200)

```json
{
  "success": true,
  "code": "PARTIAL_RESERVED_SUCCESS",
  "message": "Đã xác nhận giữ các ghế còn lại thành công.",
  "data": {
    "seatIds": [
      "770e8400-e29b-41d4-a716-446655440012"
    ],
    "reserved_until": "2024-10-18T12:31:00.000Z",
    "seats": [
      {
        "id": "770e8400-e29b-41d4-a716-446655440012",
        "seat_number": "A3",
        "status": "RESERVED",
        "reserved_until": "2024-10-18T12:31:00.000Z"
      }
    ]
  }
}
```

### Response Error Case 1: Ghế đã bị giữ (400)

**Scenario**: Trong lúc user suy nghĩ, ghế còn lại cũng bị người khác chọn

```json
{
  "success": false,
  "code": "PARTIAL_HOLD_EXPIRED",
  "message": "Rất tiếc! Trong lúc bạn suy nghĩ, các ghế còn lại cũng đã được người khác giữ mất."
}
```

### Response Error Case 2: User Has Active Hold (400)

```json
{
  "success": false,
  "code": "USER_HAS_ACTIVE_HOLD",
  "message": "Bạn đang có một phiên giữ vé chưa hoàn tất."
}
```

### cURL Example

```bash
curl -X POST http://localhost:3000/api/seats/confirm-partial \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "confirmSeatIds": ["770e8400-e29b-41d4-a716-446655440012"]
  }'
```

---

## 3. Giữ vé theo khu vực (Reserve Zone)

### Endpoint
```
POST /api/seats/reserve-zone
```

### Authentication
✅ Required

### Headers
```http
Content-Type: application/json
Authorization: Bearer <token>
```

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| eventId | uuid | ✅ | ID sự kiện |
| zones | array | ✅ | Danh sách khu vực và số lượng |
| zones[].zoneName | string | ✅ | Tên khu vực (uppercase) |
| zones[].quantity | number | ✅ | Số lượng vé |

### Validation Rules

#### zones
- **Type**: Array
- **Required**: Có
- **Not Empty**: Ít nhất 1 zone
- **Total Quantity**: Tổng quantity của tất cả zones <= 4

#### zones[].zoneName
- **Type**: String
- **Required**: Có
- **Format**: Uppercase (VIP, REGULAR, STANDARD)

#### zones[].quantity
- **Type**: Number
- **Required**: Có
- **Min**: 1
- **Example**: 2

### Request Example

```json
{
  "eventId": "660e8400-e29b-41d4-a716-446655440001",
  "zones": [
    {
      "zoneName": "VIP",
      "quantity": 2
    },
    {
      "zoneName": "REGULAR",
      "quantity": 1
    }
  ]
}
```

### Response Success (200)

```json
{
  "success": true,
  "message": "Đã giữ thành công tổng cộng 3 vé!",
  "data": {
    "seats": [
      {
        "id": "aa0e8400-e29b-41d4-a716-446655440050",
        "seat_number": "VIP-01",
        "zone_name": "VIP",
        "price": "500000",
        "status": "RESERVED",
        "reserved_until": "2024-10-18T12:30:30.000Z"
      },
      {
        "id": "aa0e8400-e29b-41d4-a716-446655440051",
        "seat_number": "VIP-02",
        "zone_name": "VIP",
        "price": "500000",
        "status": "RESERVED",
        "reserved_until": "2024-10-18T12:30:30.000Z"
      },
      {
        "id": "aa0e8400-e29b-41d4-a716-446655440060",
        "seat_number": "REGULAR-15",
        "zone_name": "REGULAR",
        "price": "200000",
        "status": "RESERVED",
        "reserved_until": "2024-10-18T12:30:30.000Z"
      }
    ],
    "seatIds": [
      "aa0e8400-e29b-41d4-a716-446655440050",
      "aa0e8400-e29b-41d4-a716-446655440051",
      "aa0e8400-e29b-41d4-a716-446655440060"
    ],
    "reserved_until": "2024-10-18T12:30:30.000Z",
    "totalTickets": 3
  }
}
```

### Response Error Case 1: Không đủ vé (400)

```json
{
  "success": false,
  "message": "Số lượng vé khả dụng không đủ hoặc bạn đang có một phiên giữ vé chưa hoàn tất."
}
```

### Response Error Case 2: Vượt quá giới hạn (400)

```json
{
  "success": false,
  "message": "Tổng số vé các khu vực cộng lại không được vượt quá 4 vé."
}
```

**Example**: VIP=2, REGULAR=3 → Total=5 > 4 ❌

### Response Error Case 3: Dữ liệu không hợp lệ (400)

```json
{
  "success": false,
  "message": "Dữ liệu chọn khu vực không hợp lệ."
}
```

### cURL Example

```bash
curl -X POST http://localhost:3000/api/seats/reserve-zone \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "eventId": "660e8400-e29b-41d4-a716-446655440001",
    "zones": [
      {"zoneName": "VIP", "quantity": 2},
      {"zoneName": "REGULAR", "quantity": 1}
    ]
  }'
```

---

## 4. Hủy giữ chỗ (Release Seats)

### Endpoint
```
POST /api/seats/release
```

### Authentication
✅ Required

### Headers
```http
Content-Type: application/json
Authorization: Bearer <token>
```

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| seatIds | array[uuid] | ✅ | Danh sách ID ghế muốn hủy |

### Business Rules
- Chỉ hủy được ghế do chính user đó giữ
- Ghế phải ở trạng thái `RESERVED` hoặc `PAYMENT_PROCESSING`
- Nếu ghế gắn với order, order sẽ được cập nhật thành `CANCELLED`

### Request Example

```json
{
  "seatIds": [
    "770e8400-e29b-41d4-a716-446655440010",
    "770e8400-e29b-41d4-a716-446655440011"
  ]
}
```

### Response Success (200)

```json
{
  "success": true,
  "message": "Đã hủy giữ chỗ thành công.",
  "data": [
    {
      "id": "770e8400-e29b-41d4-a716-446655440010",
      "seat_number": "A1",
      "current_order_id": null
    },
    {
      "id": "770e8400-e29b-41d4-a716-446655440011",
      "seat_number": "A2",
      "current_order_id": null
    }
  ]
}
```

### Response Error (400)

```json
{
  "success": false,
  "message": "Danh sách seatIds không hợp lệ."
}
```

### cURL Example

```bash
curl -X POST http://localhost:3000/api/seats/release \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "seatIds": [
      "770e8400-e29b-41d4-a716-446655440010",
      "770e8400-e29b-41d4-a716-446655440011"
    ]
  }'
```

---

## Concurrency Control

### FOR UPDATE SKIP LOCKED

```sql
SELECT id, seat_number, price, zone_name
FROM seats
WHERE id = ANY($1::uuid[])
  AND status = 'AVAILABLE'
ORDER BY id ASC
FOR UPDATE SKIP LOCKED;
```

**Lợi ích:**
- ✅ Tránh deadlock
- ✅ Không chặn request khác
- ✅ Xử lý được hàng ngàn requests đồng thời
- ✅ Trả về ngay những ghế lock được, bỏ qua ghế đang locked

### Transaction Flow

```
1. BEGIN TRANSACTION
2. Check user has active hold? → Reject if yes
3. Try to lock requested seats (SKIP LOCKED)
4. If locked all seats → UPDATE → COMMIT
5. If locked partial → ROLLBACK → Return partial info
6. If locked zero → ROLLBACK → Return all taken
```

### Performance

- **Average response time**: < 50ms
- **P99**: < 200ms
- **Concurrent requests**: Hỗ trợ 1000+ req/s
- **Database**: PostgreSQL connection pool (max 20)

---

## Flow Diagrams

### Seat Booking Flow

```
[User] → Select Seats
  ↓
[Frontend] → POST /api/seats/request-hold
  ↓
[Backend] → Check active hold
  ↓ No active hold
[Backend] → Lock seats (FOR UPDATE SKIP LOCKED)
  ↓
  ├─ Locked ALL → UPDATE + COMMIT → Return SUCCESS
  ├─ Locked PARTIAL → ROLLBACK → Return PARTIAL_AVAILABILITY
  └─ Locked ZERO → ROLLBACK → Return ALL_SEATS_TAKEN
```

### Partial Availability Flow

```
[Backend] → Return PARTIAL_AVAILABILITY
  ↓
[Frontend] → Show dialog: "A1, A2 taken. Keep A3?"
  ↓
  ├─ User clicks "Yes" → POST /api/seats/confirm-partial
  │   ↓
  │   [Backend] → Try to reserve A3
  │   ↓
  │   ├─ Still available → SUCCESS
  │   └─ Already taken → PARTIAL_HOLD_EXPIRED
  │
  └─ User clicks "No" → Go back to seat selection
```

---

## Error Codes Reference

| Code | HTTP | Message |
|------|------|---------|
| FULLY_RESERVED | 200 | Đã giữ chỗ thành công |
| PARTIAL_AVAILABILITY | 200 | Một số ghế bạn chọn vừa có người khác giữ |
| PARTIAL_RESERVED_SUCCESS | 200 | Đã xác nhận giữ các ghế còn lại thành công |
| USER_HAS_ACTIVE_HOLD | 400 | Bạn đang có một phiên giữ vé chưa hoàn tất |
| ALL_SEATS_TAKEN | 400 | Tất cả các ghế bạn chọn đều đã bị người khác giữ |
| EXCEEDED_MAX_SEATS | 400 | Bạn chỉ được chọn tối đa 4 ghế |
| PARTIAL_HOLD_EXPIRED | 400 | Các ghế còn lại cũng đã được người khác giữ mất |

---

**📅 Last Updated:** 2024-10-18  
**📖 Version:** 1.2

# 🔐 Authentication & Profile API

Base URL: `http://localhost:3000/api/auth`

> Tài liệu này phản ánh implementation hiện tại trong `auth.route.js`, `auth.controller.js` và `auth.dto.js`.

---

## Quy ước chung

JSON response luôn được middleware chuẩn hóa:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Thành công.",
  "data": null
}
```

Các endpoint cần đăng nhập dùng header:

```http
Authorization: Bearer <token>
```

Lỗi xác thực dùng chung:

| HTTP | `data.code` | Trường hợp |
|---|---|---|
| 401 | `AUTH_REQUIRED` | Thiếu/sai định dạng Bearer token |
| 401 | `TOKEN_EXPIRED` | JWT hết hạn |
| 401 | `TOKEN_INVALID` | JWT sai chữ ký hoặc không hợp lệ |

---

## 1. Đăng ký tài khoản

### Endpoint
```http
POST /api/auth/register
```

### Headers
```http
Content-Type: application/json
```

### Path / Query Parameters
Không có.

### Request Body

| Field | Type | Required | Validation |
|---|---|---:|---|
| `email` | string | ✅ | Email hợp lệ, duy nhất |
| `password` | string | ✅ | Tối thiểu 6 ký tự |
| `fullName` | string | ❌ | Mặc định là phần trước `@` của email |
| `phone` | string | ✅ | Đúng 10–11 chữ số |

```json
{
  "email": "user@example.com",
  "password": "password123",
  "fullName": "Nguyen Van A",
  "phone": "0901234567"
}
```

API chỉ tạo đăng ký chờ và gửi Email OTP; chưa tạo row trong `users`.

### Response Success (202)
```json
{
  "success": true,
  "statusCode": 202,
  "message": "Mã OTP đã được gửi đến email của bạn.",
  "data": {
    "registrationId": "550e8400-e29b-41d4-a716-446655440000",
    "expiresIn": 300,
    "resendAfter": 60
  }
}
```

### Response Errors

- Validation không hợp lệ trả `400`.
- Email đã là user trả `409 EMAIL_ALREADY_EXISTS`.
- Email đang có đăng ký chờ trả `409 REGISTRATION_PENDING` kèm session hiện tại để frontend tiếp tục xác minh hoặc hủy.
- Email provider lỗi trả `503 EMAIL_DELIVERY_UNAVAILABLE`, nhưng pending registration vẫn tồn tại và response vẫn trả `registrationId` để frontend có thể resend.

```json
{
  "success": false,
  "statusCode": 409,
  "message": "Email này đã được sử dụng.",
  "data": { "code": "EMAIL_ALREADY_EXISTS" }
}
```

Ví dụ resume registration đang chờ:

```json
{
  "success": false,
  "statusCode": 409,
  "message": "Email này đang có yêu cầu đăng ký chờ xác minh.",
  "data": {
    "code": "REGISTRATION_PENDING",
    "registrationId": "550e8400-e29b-41d4-a716-446655440000",
    "expiresIn": 620,
    "resendAfter": 35
  }
}
```

`expiresIn` và `resendAfter` là số giây còn lại tại thời điểm response. Frontend không được gọi register lặp; hãy chuyển sang màn OTP với `registrationId` này.

Ví dụ gửi email lần đầu thất bại:

```json
{
  "success": false,
  "statusCode": 503,
  "message": "Chưa thể gửi email OTP. Vui lòng thử gửi lại sau.",
  "data": {
    "code": "EMAIL_DELIVERY_UNAVAILABLE",
    "registrationId": "550e8400-e29b-41d4-a716-446655440000",
    "expiresIn": 900,
    "resendAfter": 60
  }
}
```

---

## 2. Xác minh Email OTP và hoàn tất đăng ký

### Endpoint
```http
POST /api/auth/register/verify
```

### Headers
```http
Content-Type: application/json
```

### Request Body
```json
{
  "registrationId": "550e8400-e29b-41d4-a716-446655440000",
  "otp": "048291"
}
```

`otp` bắt buộc là string gồm đúng 6 chữ số. Khi thành công, backend mới tạo user với role `CUSTOMER`.

### Response Success (201)
```json
{
  "success": true,
  "statusCode": 201,
  "message": "Đăng ký tài khoản thành công!",
  "data": {
    "id": "user-uuid",
    "email": "user@example.com",
    "fullName": "Nguyen Van A",
    "role": "CUSTOMER",
    "phone": "0901234567"
  }
}
```

### Response Errors
- `400 INVALID_OTP`, `REGISTRATION_INVALID`, `OTP_UNAVAILABLE`.
- `409 REGISTRATION_COMPLETED`, `EMAIL_ALREADY_EXISTS`.
- `410 OTP_EXPIRED`, `REGISTRATION_EXPIRED`.
- `429 OTP_LOCKED` sau 5 lần nhập sai.

---

## 3. Gửi lại Email OTP

### Endpoint
```http
POST /api/auth/register/resend
```

### Headers / Body
```http
Content-Type: application/json
```

```json
{ "registrationId": "550e8400-e29b-41d4-a716-446655440000" }
```

### Response Success (202)
```json
{
  "success": true,
  "statusCode": 202,
  "message": "Mã OTP mới đã được gửi.",
  "data": { "expiresIn": 300, "resendAfter": 60 }
}
```

OTP trước bị revoke. Cooldown mặc định 60 giây; tối đa 3 lần resend ngoài lần gửi ban đầu.

### Response Errors
- `400 REGISTRATION_INVALID`.
- `410 REGISTRATION_EXPIRED`.
- `429 RESEND_COOLDOWN` kèm header `Retry-After`.
- `429 RESEND_LIMIT_REACHED`.
- `503 EMAIL_DELIVERY_UNAVAILABLE`.

---

## 4. Hủy đăng ký đang chờ

Chỉ gọi API này khi người dùng xác nhận **Hủy và đăng ký lại**. Không tự động hủy khi người dùng chỉ bấm Back, refresh hoặc đóng tab.

### Endpoint

```http
POST /api/auth/register/cancel
Content-Type: application/json
```

### Request Body

```json
{ "registrationId": "550e8400-e29b-41d4-a716-446655440000" }
```

### Response Success (200)

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Đã hủy yêu cầu đăng ký.",
  "data": { "cancelled": true }
}
```

API idempotent: registration không tồn tại, đã hủy, đã hết hạn hoặc đã hoàn tất vẫn trả cùng response thành công và không làm thay đổi user. Khi đang `PENDING`, backend chuyển registration thành `CANCELLED` và revoke OTP active. Sau đó frontend xóa pending state và cho phép nhập lại form.

Cancel không xóa hoặc reset rate-limit. Register, verify, resend và cancel đều có bucket theo IP và theo email/registration để hạn chế spam.

### Response Errors

- `400 VALIDATION_ERROR`: `registrationId` không phải UUID hợp lệ.
- `429 RATE_LIMITED`: thao tác quá nhanh, có header `Retry-After`.

---

## 5. Đăng nhập

### Endpoint
```http
POST /api/auth/login
```

### Headers
```http
Content-Type: application/json
```

### Path / Query Parameters
Không có.

### Request Body

| Field | Type | Required |
|---|---|---:|
| `email` | string | ✅ |
| `password` | string | ✅ |

```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

### Response Success (200)
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Đăng nhập thành công!",
  "data": {
    "token": "<jwt>",
    "user": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "user@example.com",
      "fullName": "Nguyen Van A",
      "role": "CUSTOMER",
      "phone": "0901234567"
    },
    "serverTime": "2026-11-23T14:00:00.000Z"
  }
}
```

### Response Error (400)
- Thiếu email/password.
- Email không tồn tại hoặc mật khẩu sai: `Email hoặc mật khẩu không đúng.`

---

## 6. Lấy hồ sơ cá nhân

### Endpoint
```http
GET /api/auth/me
```

### Authentication / Headers
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
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "user@example.com",
    "fullName": "Nguyen Van A",
    "role": "CUSTOMER",
    "phone": "0901234567"
  }
}
```

### Response Errors
- `401`: lỗi xác thực dùng chung.
- `400`: không tìm thấy tài khoản/lỗi truy vấn.

---

## 7. Cập nhật số điện thoại

### Endpoint
```http
PUT /api/auth/me
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
| `phone` | string | ✅ | Bắt đầu bằng `0` hoặc `+84`, sau đó 9–10 chữ số; khoảng trắng được loại bỏ |

```json
{ "phone": "0901234567" }
```

### Response Success (200)
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Đã cập nhật số điện thoại.",
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "user@example.com",
    "fullName": "Nguyen Van A",
    "role": "CUSTOMER",
    "phone": "0901234567"
  }
}
```

### Response Errors
- `400`: thiếu/sai định dạng phone hoặc không tìm thấy user.
- `401`: lỗi xác thực dùng chung.

---

## 8. Lấy tài khoản ngân hàng hoàn tiền

### Endpoint
```http
GET /api/auth/me/bank
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
  "data": {
    "fullName": "Nguyen Van A",
    "email": "user@example.com",
    "bank": {
      "bankBin": "970436",
      "bankShortName": "Vietcombank",
      "bankName": "Ngan hang TMCP Ngoai thuong Viet Nam",
      "bankLogo": "https://example.com/vcb.png",
      "bankAccountNo": "1234567890",
      "bankAccountName": "NGUYEN VAN A"
    },
    "bankError": null
  }
}
```

`data.bank` là `null` nếu chưa cấu hình. `bankError` là lỗi ngân hàng gần nhất do admin đánh dấu trên đơn `REFUND_PENDING`.

### Response Errors
- `400`: không tìm thấy tài khoản/lỗi truy vấn.
- `401`: lỗi xác thực dùng chung.

---

## 9. Cập nhật tài khoản ngân hàng hoàn tiền

### Endpoint
```http
PUT /api/auth/me/bank
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
| `bankBin` | string | ✅ | Đúng 6 chữ số, phù hợp constraint DB |
| `bankShortName` | string | ✅ | Tối đa 100 ký tự |
| `bankName` | string | ❌ | Tối đa 255 ký tự |
| `bankLogo` | string | ❌ | HTTPS URL, tối đa 500 ký tự |
| `bankAccountNo` | string | ✅ | Chữ/số, 6–25 ký tự |
| `bankAccountName` | string | ✅ | 2–100 ký tự; server chuyển thành in hoa không dấu |

```json
{
  "bankBin": "970436",
  "bankShortName": "Vietcombank",
  "bankName": "Ngan hang TMCP Ngoai thuong Viet Nam",
  "bankLogo": "https://example.com/vcb.png",
  "bankAccountNo": "1234567890",
  "bankAccountName": "Nguyễn Văn A"
}
```

### Response Success (200)
Cùng shape với `GET /api/auth/me/bank`, message `Đã lưu thông tin ngân hàng.`.

### Response Errors
- `400`: dữ liệu không hợp lệ.
- `400`: ngân hàng đang bị báo sai nhưng client gửi lại nguyên BIN/STK/tên chủ tài khoản.
- `401`: lỗi xác thực dùng chung.

---

## Error envelope dùng chung

```json
{
  "success": false,
  "statusCode": 401,
  "message": "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
  "data": { "code": "TOKEN_EXPIRED" }
}
```

**Last Updated:** 2026-11-23

**Version:** Current backend contract

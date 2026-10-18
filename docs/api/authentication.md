# 🔐 Authentication API

Base URL: `http://localhost:3000/api/auth`

---

## 1. Đăng ký tài khoản

### Endpoint
```
POST /api/auth/register
```

### Headers
```http
Content-Type: application/json
```

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| email | string | ✅ | Email đăng ký |
| password | string | ✅ | Mật khẩu |
| fullName | string | ❌ | Tên đầy đủ |

### Validation Rules

#### email
- **Required**: Có
- **Format**: Regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`
- **Example**: `user@example.com`
- **Error**: "Email không đúng định dạng."

#### password
- **Required**: Có
- **Min Length**: 6 ký tự
- **Error**: "Mật khẩu phải có ít nhất 6 ký tự."

#### fullName
- **Required**: Không
- **Default**: Lấy phần trước @ của email
- **Example**: `email = user@example.com` → `fullName = user`

### Request Example

```json
{
  "email": "user@example.com",
  "password": "password123",
  "fullName": "Nguyen Van A"
}
```

### Response Success (200)

```json
{
  "success": true,
  "message": "Đăng ký tài khoản thành công!",
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "user@example.com",
    "full_name": "Nguyen Van A",
    "role": "CUSTOMER"
  }
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| success | boolean | Trạng thái thành công |
| message | string | Thông báo |
| data.id | uuid | ID người dùng |
| data.email | string | Email |
| data.full_name | string | Tên đầy đủ |
| data.role | enum | Role: CUSTOMER, ADMIN |

### Response Error Cases

#### Case 1: Email đã tồn tại (400)
```json
{
  "success": false,
  "message": "Email này đã được sử dụng."
}
```

#### Case 2: Thiếu thông tin (400)
```json
{
  "success": false,
  "message": "Vui lòng nhập đủ email và mật khẩu."
}
```

#### Case 3: Email không đúng định dạng (400)
```json
{
  "success": false,
  "message": "Email không đúng định dạng."
}
```

#### Case 4: Password quá ngắn (400)
```json
{
  "success": false,
  "message": "Mật khẩu phải có ít nhất 6 ký tự."
}
```

### cURL Example

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123",
    "fullName": "Nguyen Van A"
  }'
```

---

## 2. Đăng nhập

### Endpoint
```
POST /api/auth/login
```

### Headers
```http
Content-Type: application/json
```

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| email | string | ✅ | Email đăng nhập |
| password | string | ✅ | Mật khẩu |

### Validation Rules

#### email
- **Required**: Có
- **Error**: "Vui lòng nhập đủ email và mật khẩu."

#### password
- **Required**: Có
- **Error**: "Vui lòng nhập đủ email và mật khẩu."

### Request Example

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
  "message": "Đăng nhập thành công!",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjU1MGU4NDAwLWUyOWItNDFkNC1hNzE2LTQ0NjY1NTQ0MDAwMCIsImVtYWlsIjoidXNlckBleGFtcGxlLmNvbSIsInJvbGUiOiJDVVNUT01FUiIsImZ1bGxOYW1lIjoiTmd1eWVuIFZhbiBBIiwiaWF0IjoxNzAzMDAwMDAwLCJleHAiOjE3MDMwODY0MDB9.signature_here",
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "user@example.com",
    "role": "CUSTOMER",
    "fullName": "Nguyen Van A"
  }
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| success | boolean | Trạng thái thành công |
| message | string | Thông báo |
| token | string | JWT token (expires in 1 day) |
| user.id | uuid | ID người dùng |
| user.email | string | Email |
| user.role | enum | CUSTOMER hoặc ADMIN |
| user.fullName | string | Tên đầy đủ |

#### JWT Token Structure

```json
{
  "id": "uuid",
  "email": "user@example.com",
  "role": "CUSTOMER",
  "fullName": "Nguyen Van A",
  "iat": 1703000000,
  "exp": 1703086400
}
```

- **Algorithm**: HS256
- **Expiration**: 1 day (86400 seconds)
- **Secret**: Từ `JWT_SECRET` trong .env

### Response Error Cases

#### Case 1: Email không tồn tại (400)
```json
{
  "success": false,
  "message": "Email hoặc mật khẩu không đúng."
}
```

#### Case 2: Mật khẩu sai (400)
```json
{
  "success": false,
  "message": "Email hoặc mật khẩu không đúng."
}
```

#### Case 3: Thiếu thông tin (400)
```json
{
  "success": false,
  "message": "Vui lòng nhập đủ email và mật khẩu."
}
```

### cURL Example

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123"
  }'
```

### Sử dụng Token

Sau khi đăng nhập thành công, sử dụng token trong header của các request tiếp theo:

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Example:**
```bash
curl -X GET http://localhost:3000/api/orders/my-orders \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

## Business Logic

### Password Security
- **Hashing**: bcrypt với salt rounds = 10
- **Storage**: Chỉ lưu password hash, không bao giờ lưu plaintext
- **Comparison**: Sử dụng `bcrypt.compare()` để so sánh

### JWT Token
- **Algorithm**: HS256
- **Expiration**: 1 ngày
- **Secret**: Lưu trong environment variable `JWT_SECRET`
- **Payload**: id, email, role, fullName

### Rate Limiting
⚠️ **Chưa implement** - Khuyến nghị thêm rate limiting cho production:
- Max 5 login attempts trong 15 phút
- Lockout account sau 10 failed attempts

### CORS
⚠️ Hiện tại cho phép tất cả origins - Cấu hình lại cho production

---

## Error Codes

| Code | Message | Meaning |
|------|---------|---------|
| 400 | Vui lòng nhập đủ email và mật khẩu | Missing required fields |
| 400 | Email không đúng định dạng | Invalid email format |
| 400 | Mật khẩu phải có ít nhất 6 ký tự | Password too short |
| 400 | Email này đã được sử dụng | Email already exists |
| 400 | Email hoặc mật khẩu không đúng | Invalid credentials |
| 500 | Internal server error | Server error |

---

## Testing

### Test Account (Development)
```json
{
  "email": "test@example.com",
  "password": "test123"
}
```

### Postman Collection
```json
{
  "info": {
    "name": "Authentication API",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [
    {
      "name": "Register",
      "request": {
        "method": "POST",
        "header": [{"key": "Content-Type", "value": "application/json"}],
        "url": "{{baseUrl}}/api/auth/register",
        "body": {
          "mode": "raw",
          "raw": "{\n  \"email\": \"user@example.com\",\n  \"password\": \"password123\",\n  \"fullName\": \"Nguyen Van A\"\n}"
        }
      }
    },
    {
      "name": "Login",
      "request": {
        "method": "POST",
        "header": [{"key": "Content-Type", "value": "application/json"}],
        "url": "{{baseUrl}}/api/auth/login",
        "body": {
          "mode": "raw",
          "raw": "{\n  \"email\": \"user@example.com\",\n  \"password\": \"password123\"\n}"
        }
      }
    }
  ]
}
```

---

**📅 Last Updated:** 2024-10-18  
**📖 Version:** 1.2

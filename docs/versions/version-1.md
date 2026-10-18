# Version 1 - Sell Ticket System

## V1.1 - Initial Release (Trước Refactor)

### Tổng quan
Phiên bản ban đầu với cấu trúc đơn giản, chưa phân tách rõ ràng các tầng.

### Cấu trúc dự án

```
src/
├── config/
│   ├── db.js                    # Database connection
│   └── payos.js                 # PayOS config
├── controllers/
│   ├── auth.controller.js       # Authentication + DB queries + validation
│   └── ticket.controller.js     # Ticket management
├── middlewares/
│   └── auth.middleware.js       # JWT verification + export JWT_SECRET
├── routes/
│   ├── auth.route.js
│   ├── events.route.js
│   ├── seats.route.js
│   ├── order.routes.js
│   ├── admin.routes.js
│   └── index.route.js
├── services/
│   └── ticket.service.js        # Business logic + DB queries
└── utils/
    └── logger.js
```

### Vấn đề chính

#### 1. Controller gánh quá nhiều trách nhiệm
**auth.controller.js (66 dòng):**
- ❌ Validate input trong controller
- ❌ Truy vấn database trực tiếp (`pool.query`)
- ❌ Hash password trong controller (`bcrypt.hash`)
- ❌ So sánh password trong controller (`bcrypt.compare`)
- ❌ Tạo JWT token trong controller (`jwt.sign`)
- ❌ Kiểm tra email tồn tại (business logic)

```javascript
// Ví dụ auth.controller.js v1.1
exports.register = async (req, res) => {
  const { email, password, fullName } = req.body;
  
  // Validate trong controller
  if (!email || !password) {
    return res.status(400).json({ ... });
  }

  // Truy vấn DB trực tiếp
  const check = await pool.query('SELECT id FROM users WHERE email = $1;', [email]);
  if (check.rows.length > 0) {
    return res.status(400).json({ ... });
  }

  // Hash password trong controller
  const hashedPassword = await bcrypt.hash(password, 10);
  
  // Insert DB trực tiếp
  const result = await pool.query(`INSERT INTO users ...`, [...]);
  
  return res.json({ success: true, data: result.rows[0] });
};
```

#### 2. Hardcode values
```javascript
// Magic numbers trong code
const MAX_TICKETS = 4;  // Hardcode trong controller
await bcrypt.hash(password, 10);  // Magic number
new Date(Date.now() + 30 * 1000);  // Magic number
expiresIn: '1d'  // Hardcode trong controller
```

#### 3. Export JWT_SECRET từ middleware
```javascript
// auth.middleware.js
const JWT_SECRET = process.env.JWT_SECRET;
module.exports = { verifyToken, JWT_SECRET };  // ❌ Export secret

// auth.controller.js
const { JWT_SECRET } = require('../middlewares/auth.middleware');  // ❌ Import từ middleware
```

#### 4. Không có validation layer
```javascript
// auth.route.js
router.post('/register', authController.register);  // ❌ Không có validator
router.post('/login', authController.login);        // ❌ Không có validator
```

#### 5. Background job trong app.js
```javascript
// app.js (70+ dòng)
setInterval(async () => {
  // Giải phóng ghế hết hạn
  const releaseQuery = `UPDATE seats ...`;
  const res = await pool.query(releaseQuery);
  // ...
}, 60 * 1000);
```

### Features

#### Authentication
- ✅ Đăng ký tài khoản
- ✅ Đăng nhập với JWT
- ✅ Middleware xác thực
- ✅ Role-based authorization (ADMIN/CUSTOMER)

#### Event Management
- ✅ Tạo sự kiện (SEAT_BASED / ZONE_BASED)
- ✅ Lấy danh sách sự kiện
- ✅ Xem chi tiết ghế/zone
- ✅ Xóa sự kiện (Admin)

#### Seat Booking
- ✅ Giữ ghế theo danh sách (SEAT_BASED)
- ✅ Giữ vé theo khu vực (ZONE_BASED)
- ✅ Xử lý partial availability
- ✅ Hủy giữ chỗ
- ✅ Tự động giải phóng ghế hết hạn (60s)

#### Payment
- ✅ Tích hợp PayOS
- ✅ Tạo link thanh toán
- ✅ Webhook xử lý kết quả
- ✅ Lịch sử đơn hàng

#### Logging
- ✅ HTTP request logging
- ✅ Authentication logging
- ✅ Seat hold/release logging
- ✅ Payment logging
- ✅ Error logging
- ✅ Cron job logging
- ✅ Live log streaming (SSE)

### Metrics

| Metric | Value |
|--------|-------|
| Total Files | ~20 |
| Controllers LOC (auth) | 66 |
| Layers | 3 (Routes → Controllers → DB) |
| Hardcoded Values | 5+ |
| Test Coverage | 0% |

---

## V1.2 - Refactored (18h00-18/10/2026)

### Tổng quan
Phiên bản đã refactor với kiến trúc phân tầng rõ ràng, áp dụng Repository Pattern và Separation of Concerns.

### Cấu trúc dự án

```
src/
├── config/
│   ├── constants.js             ✨ MỚI - Centralized constants
│   ├── db.js
│   └── payos.js                 ♻️ Improved error handling
│
├── controllers/
│   ├── auth.controller.js       ♻️ Điều phối DTO và auth service
│   └── ticket.controller.js     ♻️ Sử dụng constants
│
├── dto/                         ✨ MỚI - Request validation & response mapping
│   ├── admin.dto.js
│   ├── auth.dto.js
│   ├── event.dto.js
│   ├── order.dto.js
│   └── seat.dto.js
│
├── services/
│   ├── auth.service.js          ✨ MỚI - Business logic
│   └── ticket.service.js        ♻️ Sử dụng repository
│
├── repositories/                ✨ MỚI - Database layer
│   ├── auth.repository.js
│   └── ticket.repository.js
│
├── middlewares/
│   └── auth.middleware.js       ♻️ Không export JWT_SECRET
│
├── routes/
│   ├── auth.route.js            ♻️ Chuyển validation vào DTO trong controller
│   ├── events.route.js
│   ├── seats.route.js
│   ├── order.routes.js
│   ├── admin.routes.js
│   ├── index.route.js
│   └── site.route.js
│
├── jobs/                        ✨ MỚI - Background jobs
│   └── seat-release.job.js
│
├── seeds/
│   ├── seed.js
│   └── delete.js
│
└── utils/
    └── logger.js
```

### Cải tiến chính

#### 1. ✨ DTO Pattern - Request & Response

**DTO (Data Transfer Object)** xử lý cả 2 chiều:

**A. Request DTO** - Validate và transform input từ client:

```javascript
// src/dto/auth.dto.js
class RegisterRequestDTO {
  constructor(body) {
    this.email = body.email;
    this.password = body.password;
    this.fullName = body.fullName;
  }

  validate() {
    const errors = [];
    
    // Validate email
    if (!this.email) {
      errors.push('Email là bắt buộc.');
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(this.email)) {
        errors.push('Email không đúng định dạng.');
      }
    }
    
    // Validate password
    if (!this.password) {
      errors.push('Mật khẩu là bắt buộc.');
    } else if (this.password.length < 6) {
      errors.push('Mật khẩu phải có ít nhất 6 ký tự.');
    }

    if (!this.fullName && this.email) {
      this.fullName = this.email.split('@')[0];
    }
    
    return { isValid: errors.length === 0, errors };
  }

  toServiceInput() {
    return {
      email: this.email,
      password: this.password,
      fullName: this.fullName
    };
  }
}
```

**B. Response DTO** - Format và transform output cho client:

```javascript
// src/dto/auth.dto.js
class RegisterResponseDTO {
  constructor(user) {
    this.success = true;
    this.message = 'Đăng ký tài khoản thành công!';
    this.data = new UserResponseDTO(user).toJSON();
  }

  toJSON() {
    return {
      success: this.success,
      message: this.message,
      data: this.data
    };
  }
}

class UserResponseDTO {
  constructor(user) {
    this.id = user.id;
    this.email = user.email;
    this.fullName = user.full_name || user.fullName;
    this.role = user.role;
  }

  toJSON() {
    return {
      id: this.id,
      email: this.email,
      fullName: this.fullName,
      role: this.role
    };
  }
}
```

#### 2. ♻️ Controller với DTO Pattern

```javascript
// src/controllers/auth.controller.js
const {
  RegisterRequestDTO,
  RegisterResponseDTO,
  ErrorResponseDTO
} = require('../dto/auth.dto');

exports.register = async (req, res) => {
  try {
    // Request DTO: Validate input
    const requestDto = new RegisterRequestDTO(req.body);
    const validation = requestDto.validate();
    
    if (!validation.isValid) {
      const errorDto = new ErrorResponseDTO(validation.errors.join(' '));
      return res.status(400).json(errorDto.toJSON());
    }
    
    // Call service
    const { email, password, fullName } = requestDto.toServiceInput();
    const user = await authService.register(email, password, fullName);
    
    // Response DTO: Format output
    const responseDto = new RegisterResponseDTO(user);
    return res.json(responseDto.toJSON());
  } catch (err) {
    const errorDto = new ErrorResponseDTO(err.message);
    return res.status(400).json(errorDto.toJSON());
  }
};
```

**Lợi ích của DTO Pattern (2-way):**

| Aspect | Before (No DTO) | After (With DTO) |
|--------|----------------|------------------|
| **Input Validation** | ❌ Scattered trong controller | ✅ Centralized trong RequestDTO |
| **Response Format** | ❌ Manual JSON construction | ✅ Consistent với ResponseDTO |
| **Field Transformation** | ❌ DB field names exposed | ✅ Transform snake_case → camelCase |
| **Security** | ❌ Có thể expose password hash | ✅ DTO filter sensitive data |
| **Testability** | ❌ Phải test cả controller | ✅ Test DTO riêng biệt |
| **Type Safety** | ❌ No type hints | ⚠️ DTO documents the data shape; JavaScript does not enforce it at compile time |
| **Code Reusability** | ❌ Duplicate validation logic | ✅ Reuse DTO across endpoints |
| **API Contract** | ❌ Implicit từ code | ✅ Explicit từ DTO class |

**Cụ thể:**
1. **Request DTO (Input):**
   - ✅ Validate format và các ràng buộc input cơ bản
   - ✅ Transform input cho service layer
   - ✅ Provide default values
   - ✅ Provide default values where needed (for example, `fullName` from the email prefix)

2. **Response DTO (Output):**
   - ✅ Format output nhất quán
   - ✅ Transform DB fields (snake_case → camelCase)
   - ✅ Chỉ trả về field công khai, không trả password hash hoặc dữ liệu nội bộ
   - ✅ Add computed fields nếu cần
   - ✅ Nested DTOs cho complex objects

#### 3. ✨ Tạo Constants Layer
```javascript
// src/config/constants.js
module.exports = {
  JWT_SECRET: process.env.JWT_SECRET || 'your-secret-key-here',
  JWT_EXPIRES_IN: '1d',
  BCRYPT_SALT_ROUNDS: 10,
  SEAT_HOLD_DURATION_SECONDS: 30,
  PAYMENT_TIMEOUT_MINUTES: 5,
  MAX_TICKETS_PER_USER: 4,
};
```

#### 4. ✨ Tạo Service Layer (Authentication)
```javascript
// src/services/auth.service.js
class AuthService {
  async register(email, password, fullName) {
    // Check email exists
    const emailExists = await authRepository.checkEmailExists(email);
    if (emailExists) throw new Error('Email này đã được sử dụng.');

    // Hash password
    const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

    // Create user
    const user = await authRepository.createUser(email, hashedPassword, fullName);
    
    return user;
  }

  async login(email, password) {
    const user = await authRepository.findUserByEmail(email);
    if (!user) throw new Error('Email hoặc mật khẩu không đúng.');

    const isPasswordMatch = await bcrypt.compare(password, user.password);
    if (!isPasswordMatch) throw new Error('Email hoặc mật khẩu không đúng.');

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        fullName: user.full_name
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    return { token, user };
  }
}
```

#### 5. ✨ Tạo Repository Layer
```javascript
// src/repositories/auth.repository.js
class AuthRepository {
  async findUserByEmail(email) {
    const result = await pool.query('SELECT * FROM users WHERE email = $1;', [email]);
    return result.rows[0] || null;
  }

  async checkEmailExists(email) {
    const result = await pool.query('SELECT id FROM users WHERE email = $1;', [email]);
    return result.rows.length > 0;
  }

  async createUser(email, hashedPassword, fullName) {
    const result = await pool.query(
      `INSERT INTO users (email, password, full_name, role)
       VALUES ($1, $2, $3, 'CUSTOMER')
       RETURNING id, email, full_name, role;`,
      [email, hashedPassword, fullName]
    );
    return result.rows[0];
  }
}
```

#### 6. ✨ Tách Background Jobs
```javascript
// src/jobs/seat-release.job.js
function startSeatReleaseJob() {
  setInterval(async () => {
    try {
      const releaseQuery = `UPDATE seats ...`;
      const res = await pool.query(releaseQuery);
      if (res.rows.length > 0) {
        logger.cron(`Đã tự động giải phóng ${res.rows.length} ghế hết hạn`);
      }
    } catch (err) {
      logger.error('CRON_AUTO_RELEASE', err.message);
    }
  }, 60 * 1000);
}
```

### Kiến trúc phân tầng mới

```
┌─────────────────┐
│     Client      │  HTTP Request
└────────┬────────┘
         │
┌────────▼────────┐
│     Routes      │  Định nghĩa endpoint
└────────┬────────┘
         │
┌────────▼────────┐
│  Middlewares    │  Authentication & Authorization
└────────┬────────┘
         │
┌────────▼────────────────────┐
│     Controllers              │
│  ┌──────────────────────┐   │
│  │   Request DTO        │   │  Validate & Transform Input
│  │   - validate()       │   │
│  │   - toServiceInput() │   │
│  └──────────┬───────────┘   │
│             │                │
│  ┌──────────▼───────────┐   │
│  │   Call Service       │   │  Business Logic
│  └──────────┬───────────┘   │
│             │                │
│  ┌──────────▼───────────┐   │
│  │   Response DTO       │   │  Format Output
│  │   - toJSON()         │   │
│  └──────────────────────┘   │
└────────┬────────────────────┘
         │
┌────────▼────────┐
│   Services      │  Business logic
└────────┬────────┘
         │
┌────────▼────────┐
│  Repositories   │  Database queries
└────────┬────────┘
         │
┌────────▼────────┐
│    Database     │
└─────────────────┘
```

### So sánh Flow: Before vs After

**Before (V1.1):**
```
Request → Route → Controller (validate + logic + format) → DB → Response
```

**After (V1.2) - DTO Pattern (2-way):**
```
Request → Route → Controller
                     ↓
              [Request DTO]
              - validate()
              - transform input
                     ↓
                  Service
                     ↓
                 Repository
                     ↓
                  Database
                     ↓
              [Response DTO]
              - format output
              - normalize data
                     ↓
                  Response
```

### DTO Pattern - Chi tiết Implementation

#### Cấu trúc DTO cho từng feature:

```
src/dto/
├── auth.dto.js          # Authentication DTOs
│   ├── RegisterRequestDTO
│   ├── LoginRequestDTO
│   ├── UserResponseDTO
│   ├── RegisterResponseDTO
│   ├── LoginResponseDTO
│   └── ErrorResponseDTO
│
├── event.dto.js         # Event DTOs
│   ├── EventResponseDTO
│   ├── EventListResponseDTO
│   ├── SeatDetailDTO
│   ├── ZoneDetailDTO
│   ├── EventSeatsResponseDTO
│   └── EventZonesResponseDTO
│
├── seat.dto.js          # Seat booking DTOs
│   ├── RequestSeatHoldDTO
│   ├── ConfirmPartialHoldDTO
│   ├── ReserveZoneDTO
│   ├── ReleaseSeatDTO
│   ├── SeatResponseDTO
│   ├── SeatHoldSuccessResponseDTO
│   ├── PartialAvailabilityResponseDTO
│   ├── SeatHoldErrorResponseDTO
│   ├── ReserveZoneSuccessResponseDTO
│   ├── ReleaseSeatsResponseDTO
│   └── ErrorResponseDTO
│
├── order.dto.js         # Order & Payment DTOs
│   ├── CheckoutRequestDTO
│   ├── CheckoutResponseDTO
│   ├── OrderHistoryResponseDTO
│   ├── OrderHistoryItemDTO
│   ├── OrderItemDTO
│   └── ErrorResponseDTO
│
└── admin.dto.js         # Admin DTOs
    ├── CreateEventRequestDTO
    ├── CreateEventResponseDTO
    ├── DeleteEventResponseDTO
    └── ErrorResponseDTO
```

#### Example: Complete DTO Flow cho Registration

**1. Request DTO - Input Validation:**

```javascript
// src/dto/auth.dto.js
class RegisterRequestDTO {
  constructor(body) {
    this.email = body.email;
    this.password = body.password;
    this.fullName = body.fullName;
  }

  validate() {
    const errors = [];
    
    if (!this.email) {
      errors.push('Email là bắt buộc.');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email)) {
      errors.push('Email không đúng định dạng.');
    }
    
    if (!this.password) {
      errors.push('Mật khẩu là bắt buộc.');
    } else if (this.password.length < 6) {
      errors.push('Mật khẩu phải có ít nhất 6 ký tự.');
    }

    if (!this.fullName && this.email) {
      this.fullName = this.email.split('@')[0];
    }
    
    return { 
      isValid: errors.length === 0, 
      errors 
    };
  }

  toServiceInput() {
    return {
      email: this.email,
      password: this.password,
      fullName: this.fullName
    };
  }
}
```

**2. Response DTO - Output Formatting:**

```javascript
class RegisterResponseDTO {
  constructor(user) {
    this.success = true;
    this.message = 'Đăng ký tài khoản thành công!';
    this.data = new UserResponseDTO(user).toJSON();
  }

  toJSON() {
    return {
      success: this.success,
      message: this.message,
      data: this.data
    };
  }
}

class UserResponseDTO {
  constructor(user) {
    // Transform database field names to camelCase
    this.id = user.id;
    this.email = user.email;
    this.fullName = user.full_name || user.fullName;
    this.role = user.role;
  }

  toJSON() {
    return {
      id: this.id,
      email: this.email,
      fullName: this.fullName,
      role: this.role
      // Không expose password hash
    };
  }
}
```

**3. Controller sử dụng DTO:**

```javascript
// src/controllers/auth.controller.js (V1.2)
const {
  RegisterRequestDTO,
  RegisterResponseDTO,
  ErrorResponseDTO
} = require('../dto/auth.dto');

exports.register = async (req, res) => {
  try {
    // 1. Request DTO: Validate input
    const requestDto = new RegisterRequestDTO(req.body);
    const validation = requestDto.validate();
    
    if (!validation.isValid) {
      const errorDto = new ErrorResponseDTO(validation.errors.join(' '));
      return res.status(400).json(errorDto.toJSON());
    }
    
    // 2. Transform và call service
    const { email, password, fullName } = requestDto.toServiceInput();
    const user = await authService.register(email, password, fullName);
    
    // 3. Response DTO: Format output
    const responseDto = new RegisterResponseDTO(user);
    return res.json(responseDto.toJSON());
    
  } catch (err) {
    const errorDto = new ErrorResponseDTO(err.message);
    return res.status(400).json(errorDto.toJSON());
  }
};
```

**So sánh với V1.1 Controller:**

```javascript
// V1.1 - NO DTO (66 LOC, messy)
exports.register = async (req, res) => {
  const { email, password, fullName } = req.body;
  
  // ❌ Manual validation trong controller
  if (!email || !password) {
    return res.status(400).json({ 
      success: false, 
      message: 'Thiếu thông tin' 
    });
  }

  try {
    // ❌ DB query trong controller
    const check = await pool.query(
      'SELECT id FROM users WHERE email = $1;',
      [email]
    );
    
    if (check.rows.length > 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email đã tồn tại' 
      });
    }

    // ❌ Hash password trong controller
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // ❌ Insert DB trong controller
    const result = await pool.query(
      `INSERT INTO users (email, password, full_name, role)
       VALUES ($1, $2, $3, 'CUSTOMER')
       RETURNING id, email, full_name, role;`,
      [email, hashedPassword, fullName || email.split('@')[0]]
    );

    // ❌ Manual response format
    return res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
};

// V1.2 - WITH DTO (40 LOC, clean)
exports.register = async (req, res) => {
  try {
    // ✅ DTO handles validation
    const requestDto = new RegisterRequestDTO(req.body);
    const validation = requestDto.validate();
    
    if (!validation.isValid) {
      const errorDto = new ErrorResponseDTO(validation.errors.join(' '));
      return res.status(400).json(errorDto.toJSON());
    }
    
    // ✅ Service handles business logic
    const { email, password, fullName } = requestDto.toServiceInput();
    const user = await authService.register(email, password, fullName);
    
    // ✅ DTO handles response format
    const responseDto = new RegisterResponseDTO(user);
    return res.json(responseDto.toJSON());
    
  } catch (err) {
    const errorDto = new ErrorResponseDTO(err.message);
    return res.status(400).json(errorDto.toJSON());
  }
};
```

#### DTO đang được dùng ở đâu?

| Feature | Request DTO | Response DTO | Điểm sử dụng |
|---------|-------------|--------------|--------------|
| Authentication | `RegisterRequestDTO`, `LoginRequestDTO` | `RegisterResponseDTO`, `LoginResponseDTO`, `UserResponseDTO` | Đăng ký và đăng nhập |
| Admin / Event | `CreateEventRequestDTO` | `CreateEventResponseDTO`, `DeleteEventResponseDTO` | Tạo và xóa sự kiện |
| Event browsing | — | `EventListResponseDTO`, `EventSeatsResponseDTO`, `EventZonesResponseDTO` | Danh sách sự kiện và chi tiết ghế/zone |
| Seat booking | `RequestSeatHoldDTO`, `ConfirmPartialHoldDTO`, `ReserveZoneDTO`, `ReleaseSeatDTO` | Các DTO giữ chỗ, một phần, đặt zone và hủy giữ chỗ | Các thao tác booking |
| Order / Payment | `CheckoutRequestDTO` | `CheckoutResponseDTO`, `OrderHistoryResponseDTO` | Checkout và lịch sử đơn hàng |

Mỗi feature định nghĩa `ErrorResponseDTO` riêng để controller trả lỗi theo format của feature. Các endpoint chỉ đọc dữ liệu (ví dụ danh sách sự kiện, lịch sử đơn hàng) không cần Request DTO nếu không có body cần validate; chúng vẫn dùng Response DTO để định dạng dữ liệu trả về.

#### Luồng xử lý Request và Response

1. Controller tạo Request DTO từ `req.body`.
2. Controller gọi `validate()`. DTO trả về `{ isValid, errors }`; nếu không hợp lệ, controller ghép lỗi và trả response lỗi với HTTP 400.
3. Khi hợp lệ, controller lấy dữ liệu qua `toServiceInput()` rồi truyền cho service. Service vẫn chịu trách nhiệm xử lý nghiệp vụ; DTO không truy vấn database.
4. Controller nhận kết quả từ service và tạo Response DTO phù hợp.
5. `toJSON()` tạo object công khai gửi cho client qua `res.json()`.

Không phải Request DTO nào cũng có cùng quy tắc: ví dụ đăng ký kiểm tra định dạng email và độ dài mật khẩu, giữ ghế kiểm tra `seatIds` là mảng không rỗng và giới hạn tối đa 4 ghế, còn checkout chỉ kiểm tra `seatIds` là mảng không rỗng. DTO không thay thế xác thực người dùng, phân quyền, kiểm tra trạng thái dữ liệu trong database hay validation nghiệp vụ ở service.

#### Ví dụ dữ liệu qua DTO đăng ký

Request body gửi lên:

```json
{
  "email": "linh@example.com",
  "password": "secret123"
}
```

`RegisterRequestDTO.validate()` kiểm tra email và mật khẩu, đồng thời đặt `fullName` mặc định thành `linh`. `toServiceInput()` chuyển dữ liệu đã kiểm tra sang service:

```json
{
  "email": "linh@example.com",
  "password": "secret123",
  "fullName": "linh"
}
```

Sau khi service tạo user, `RegisterResponseDTO` dùng `UserResponseDTO` để chỉ đưa các field công khai vào response:

```json
{
  "success": true,
  "message": "Đăng ký tài khoản thành công!",
  "data": {
    "id": 12,
    "email": "linh@example.com",
    "fullName": "linh",
    "role": "CUSTOMER"
  }
}
```

`password` không được đưa vào response. Các key như `full_name` từ database được biểu diễn thành `fullName` ở API boundary; danh sách field cụ thể được quyết định bởi Response DTO chứ không trả trực tiếp toàn bộ row database.

#### Quy ước và giới hạn

- DTO trong dự án là các JavaScript class, không cung cấp compile-time type checking như TypeScript.
- `validate()` hiện thực hiện các kiểm tra được viết rõ trong từng DTO; không nên hiểu rằng mọi field con, kiểu dữ liệu hoặc quy tắc nghiệp vụ đều đã được kiểm tra.
- Chỉ gọi `toServiceInput()` sau khi `validate()` thành công; các DTO không tự chặn việc gọi sai thứ tự.
- Response DTO giúp kiểm soát field và format, nhưng không tự đảm bảo mọi endpoint có cùng HTTP status hoặc cùng envelope. Ví dụ partial availability được biểu diễn bằng `success: false` và `code: "PARTIAL_AVAILABILITY"` nhưng controller vẫn trả HTTP 200 để client xử lý như một kết quả nghiệp vụ.

### So sánh kiến trúc

| Aspect | V1.1 | V1.2 |
|--------|------|------|
| Request validation | Rải rác trong controller | Tập trung trong Request DTO, được controller gọi |
| Response mapping | Tạo response thủ công | Response DTO kiểm soát field và format |
| Database access | Gắn với controller/service | Tách query vào repository |
| Configuration | Giá trị cấu hình rải rác | Một số giá trị dùng chung gom vào constants |
| Type checking | JavaScript không kiểm tra kiểu lúc biên dịch | Không thay đổi; DTO là JavaScript class |
| Separation of concerns | Trách nhiệm trộn lẫn | Tách rõ hơn giữa DTO, controller, service và repository |
| Testability | Khó kiểm thử riêng từng phần | Có thể kiểm thử từng lớp riêng; test suite chưa được cấu hình |
| Maintainability | Khó bảo trì | Trách nhiệm từng lớp rõ hơn |

### Features có trong V1.2

#### Authentication
- ✅ Đăng ký tài khoản (với validation mạnh hơn)
- ✅ Đăng nhập với JWT
- ✅ Middleware xác thực
- ✅ Role-based authorization

#### Event Management
- ✅ Tạo sự kiện (SEAT_BASED / ZONE_BASED)
- ✅ Lấy danh sách sự kiện
- ✅ Xem chi tiết ghế/zone
- ✅ Xóa sự kiện (Admin)

#### Seat Booking
- ✅ Giữ ghế theo danh sách
- ✅ Giữ vé theo khu vực
- ✅ Xử lý partial availability
- ✅ Xác nhận giữ chỗ một phần
- ✅ Hủy giữ chỗ
- ✅ Tự động giải phóng ghế hết hạn

#### Payment
- ✅ Tích hợp PayOS
- ✅ Tạo link thanh toán
- ✅ Webhook xử lý kết quả
- ✅ Lịch sử đơn hàng

#### Logging
- ✅ HTTP request logging
- ✅ Authentication logging
- ✅ Seat hold/release logging
- ✅ Payment logging
- ✅ Error logging
- ✅ Cron job logging
- ✅ Live log streaming

### File Changes Summary

#### ✨ Tạo mới
1. `src/config/constants.js` - Centralized configuration
2. `src/dto/*.dto.js` - Request validation and response mapping
3. `src/services/auth.service.js` - Auth business logic
4. `src/repositories/auth.repository.js` - Auth DB queries
5. `src/repositories/ticket.repository.js` - Ticket DB queries
6. `src/jobs/seat-release.job.js` - Background job
7. `.env.example` - Environment template
8. `docs/api/*.md` - API documentation
9. `docs/versions/version-1.md` - Version history

#### ♻️ Refactor (6 files)
1. `src/controllers/auth.controller.js` - Điều phối Request DTO, auth service và Response DTO
2. `src/controllers/ticket.controller.js` - Sử dụng constants
3. `src/services/ticket.service.js` - Sử dụng repository
4. `src/middlewares/auth.middleware.js` - Không export JWT_SECRET
5. `src/routes/auth.route.js` - Validation được xử lý bởi Request DTO trong controller
6. `app.js` - Clean code, tách background job

### Lợi ích

#### 1. Code Quality
- ✅ Clean code, dễ đọc
- ✅ Single Responsibility Principle
- ✅ DRY (Don't Repeat Yourself)
- ✅ Separation of Concerns

#### 2. Maintainability
- ✅ Dễ tìm và sửa lỗi
- ✅ Dễ thêm tính năng mới
- ✅ Dễ refactor từng phần
- ✅ Code reusability cao

#### 3. Testability
- ✅ Service layer test độc lập
- ✅ Repository có thể mock
- ✅ Controller test dễ dàng
- ✅ Unit test từng layer

#### 4. Security
- ✅ Input validation bằng Request DTO trong controller trước khi gọi service
- ✅ Password hashing trong service
- ✅ JWT secret không bị expose
- ✅ Business logic an toàn

#### 5. Performance
- ✅ Không ảnh hưởng hiệu năng
- ✅ Transaction logic giữ nguyên
- ✅ Row-level locking với `FOR UPDATE SKIP LOCKED` vẫn hoạt động
- ✅ Connection pooling không đổi

### Tương thích API

- ✅ Các endpoint hiện có vẫn được cung cấp.
- ✅ Database schema không thay đổi trong lần refactor này.
- ⚠️ Response DTOs định nghĩa field và casing trả về; không khẳng định response format hoàn toàn giống V1.1. Client nên đối chiếu với tài liệu API.
- ✅ DTO validation được thêm ở controller trước khi gọi service; các kiểm tra và lỗi validation có thể khác cách triển khai cũ.

### Migration

**Triển khai:**
1. Pull code mới
2. Chạy `npm install` (không có dependency mới)
3. Restart server
4. ✅ Done!

### Best Practices Applied

1. ✅ **Layered Architecture** - 6 tầng rõ ràng
2. ✅ **Repository Pattern** - Tách database layer
3. ✅ **Service Layer Pattern** - Business logic riêng biệt
4. ✅ **DTO Pattern** - Request/Response DTO cho validation và response mapping
5. ✅ **Configuration Management** - Centralized constants
6. ✅ **Input Validation** - Validate request bằng DTO trong controller trước khi gọi service
7. ✅ **Error Handling** - Consistent error flow
8. ✅ **Structured Logging** - Category-based logging

### Next Steps (Khuyến nghị)

#### High Priority
1. **Unit Tests** - Thêm test coverage cho services & repositories
2. **Integration Tests** - Test API endpoints end-to-end
3. **Rate Limiting** - Protect endpoints khỏi abuse

#### Medium Priority
4. **API Documentation** - Swagger/OpenAPI integration
5. **Monitoring** - APM (Application Performance Monitoring)
6. **Caching** - Redis cache cho frequent queries

#### Low Priority
7. **CI/CD** - Automated testing & deployment
8. **Docker** - Containerization
9. **Load Testing** - Performance benchmarking

---

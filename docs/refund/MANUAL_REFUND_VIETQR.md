# Hoàn tiền thủ công qua VietQR (Phiên bản 0đ chi phí)

**Tính năng:** Cập nhật thông tin Ngân hàng của User & Luồng Hoàn tiền thủ công bằng VietQR cho Admin  
**Phiên bản:** 0đ (100% miễn phí, không cần API key, không tích hợp dịch vụ trả phí)  
**Ngày:** 2026-11-10

---

## 🎯 Tổng quan

Khi đơn hàng đã thanh toán nhưng bị hủy hoặc hết hạn (trạng thái `REFUND_PENDING`), Admin cần hoàn tiền thủ công cho khách. Giải pháp này:

- **100% miễn phí**: Sử dụng Public API của VietQR (`api.vietqr.io/v2/banks`) và ảnh QR (`img.vietqr.io`) — không cần đăng ký API key, không giới hạn request.
- **Đơn giản**: User điền TK ngân hàng ở Trang Hồ sơ (không bắt buộc, tự nguyện). Admin quét QR bằng App Ngân hàng trên điện thoại để chuyển khoản, sau đó bấm "Xác nhận đã hoàn tiền" trên Dashboard.
- **An toàn**: Snapshot bằng chứng đối soát được đóng băng vào DB khi Admin xác nhận. Nếu TK không hợp lệ, Admin báo lỗi để User sửa lại.

---

## 📐 Kiến trúc & Luồng hoạt động

### 1. Phía User (Trang Hồ sơ — `/profile#bank`)

#### 1.1 Form nhập thông tin ngân hàng
- **Vị trí duy nhất:** Trang Hồ sơ User (`/profile`), không có Modal form riêng lẻ ở nơi khác.
- **Các trường (Optional — không bắt buộc khi đăng ký):**
  - **Ngân hàng**: Combobox/Autocomplete lấy danh sách từ `GET https://api.vietqr.io/v2/banks` (Public API, miễn phí). Hiển thị Logo + Tên viết tắt + Tên đầy đủ. Bắt buộc chọn từ danh sách, không cho tự gõ text tự do.
  - **Số tài khoản**: Tự động xóa khoảng trắng, chỉ cho `[A-Za-z0-9]{6,25}`.
  - **Tên chủ tài khoản**: Tự động chuyển thành **CHỮ IN HOA KHÔNG DẤU** ngay khi User nhập (hàm `toBankAccountName` ở `src/utils/format.js`). Có dòng nhắc kiểm tra khớp với tên trên App Ngân hàng.

#### 1.2 Validate chống sai sót
- **FE**: Combobox ngân hàng + regex STK + auto-uppercase tên chủ TK.
- **BE**: DTO `UpdateBankRequestDTO` (`src/dto/auth.dto.js`) + DB constraint (`chk_bank_bin_format`, `chk_bank_account_no_format`).
- **DB**: Tất cả cột `NULLABLE` (không ảnh hưởng luồng/dữ liệu cũ).

#### 1.3 Điều hướng & Xử lý khi chưa có STK hoặc bị Admin báo "Sai thông tin TK"
- **Tại Trang Lịch sử đặt vé (`/my-tickets`)**: Nếu User có đơn `REFUND_PENDING` mà:
  - Chưa có TK → Hiển thị thông báo + nút "Vào Hồ sơ cập nhật TK ngân hàng" (điều hướng sang `/profile#bank`).
  - Bị Admin báo sai TK (`refund_bank_error` != NULL) → Hiển thị lý do lỗi + nút "Vào Hồ sơ sửa lại ngay".
- **Tại Trang Hồ sơ (`/profile#bank`)**: Nếu đang bị đánh dấu "Sai TT TK", hiển thị alert màu đỏ kèm lý do lỗi.
- **Cơ chế gỡ cờ lỗi chặt chẽ**: Chỉ khi User **thực sự thay đổi ít nhất 1 trong 3 trường** (Ngân hàng, STK, hoặc Tên chủ TK) so với dữ liệu cũ và bấm Lưu, BE mới gỡ `refund_bank_error` (1 câu SQL duy nhất với CTE — `src/repositories/auth.repository.js::updateBankAndClearErrors`).

---

### 2. Phía Admin (Trang Quản lý Hoàn tiền — `/admin` tab "Refunds")

#### 2.1 Bảng danh sách Quản lý Hoàn tiền (`AdminRefundsTab.jsx`)
Hiển thị trạng thái TK ngân hàng của khách trên từng đơn:

1. **Chưa có TT Ngân hàng** (`refundBank == null`):  
   Nhãn "Chờ khách cập nhật TK", disable nút hoàn tiền.

2. **Đã có TT Ngân hàng** (`refundBank != null && refundBankError == null`):  
   Hiển thị tóm tắt `Tên NH - STK`, nút **"Quét QR Hoàn tiền"** mở Modal.

3. **Sai TT Ngân hàng** (`refundBankError != null`):  
   Nhãn cảnh báo màu đỏ (kèm lý do lỗi), chờ khách vào Hồ sơ sửa lại.

4. **Đã hoàn tiền** (`status = 'REFUNDED'`):  
   Cho phép bấm xem lại Snapshot đối soát (`refund_snapshot`).

#### 2.2 Modal "Quét QR Hoàn tiền & Đối soát" (`RefundQrModal.jsx`)
- **Ảnh mã VietQR** (Public API miễn phí):
  ```
  https://img.vietqr.io/image/<BIN>-<STK>-compact2.png
    ?amount=<AMOUNT>
    &addInfo=HOAN TIEN <Mã đơn>
    &accountName=<ACCOUNT_NAME>
  ```
  Tự động gắn sẵn: BIN ngân hàng + STK khách + Số tiền hoàn + Nội dung CK.

- **Thông tin đối chiếu** (ngay cạnh QR):
  - Tên ngân hàng (logo + tên viết tắt).
  - Số tài khoản (nút copy).
  - **Tên chủ tài khoản do khách khai báo** (highlight màu vàng) + dòng nhắc Admin đối chiếu với tên hiện trên điện thoại khi quét QR.

- **Ô nhập** (tùy chọn): Mã giao dịch / Ghi chú đối soát (lưu vào Snapshot).

- **2 Nút xử lý:**
  1. **Báo sai thông tin TK**: Khi quét QR thấy STK không tồn tại hoặc Tên không khớp → Chọn/nhập lý do lỗi → Đơn chuyển sang trạng thái "Sai TT TK" (`refund_bank_error` = lý do), báo cho User vào Hồ sơ sửa lại.
  2. **Xác nhận đã hoàn tiền**: Chuyển `status` → `REFUNDED`, đồng thời **đóng băng Snapshot bằng chứng đối soát** vào `refund_snapshot` (jsonb):
     ```json
     {
       "bankBin": "970436",
       "bankShortName": "Vietcombank",
       "bankName": "Ngân hàng TMCP Ngoại Thương",
       "bankAccountNo": "0123456789",
       "bankAccountName": "NGUYEN VAN A",
       "amount": 500000,
       "note": "FT26110923456789",
       "refundedBy": "admin@example.com",
       "refundedAt": "2026-11-10T06:00:00Z"
     }
     ```
     **Chặn race condition**: SQL UPDATE chỉ thành công khi TK hiện tại của khách TRÙNG với TK Admin vừa quét QR (3 cột: `bank_bin`, `bank_account_no`, `bank_account_name`) → Nếu khách đổi TK giữa lúc Admin đang mở Modal, BE từ chối và báo lỗi "Vui lòng tải lại danh sách và quét lại QR".

---

## 🗄️ Database Schema

**Migration file:** `docs/migrations/add_manual_refund_vietqr.sql`

### Bảng `users` (thêm 6 cột NULLABLE)
```sql
ALTER TABLE public.users
  ADD COLUMN bank_bin varchar(6),              -- BIN ngân hàng (6 chữ số)
  ADD COLUMN bank_short_name varchar(100),     -- Tên viết tắt (VCB, MB, ...)
  ADD COLUMN bank_name varchar(255),           -- Tên đầy đủ
  ADD COLUMN bank_logo text,                   -- URL logo từ VietQR
  ADD COLUMN bank_account_no varchar(25),      -- Số tài khoản
  ADD COLUMN bank_account_name varchar(100);   -- Tên chủ TK (IN HOA KHÔNG DẤU)
```

### Bảng `orders` (thêm 2 cột NULLABLE)
```sql
ALTER TABLE public.orders
  ADD COLUMN refund_bank_error varchar(255),  -- Lý do Admin báo sai TK (NULL = không lỗi)
  ADD COLUMN refund_snapshot jsonb;           -- Snapshot đối soát khi đã hoàn tiền
```

### Constraints (lưới an toàn tầng DB)
```sql
ALTER TABLE public.users
  ADD CONSTRAINT chk_bank_bin_format CHECK (bank_bin ~ '^\d{6}$'),
  ADD CONSTRAINT chk_bank_account_no_format CHECK (bank_account_no ~ '^[A-Za-z0-9]{6,25}$');
```

---

## 🔌 API Endpoints

### User: Hồ sơ ngân hàng (`src/routes/auth.route.js`)

#### `GET /api/auth/me/bank` (Auth required)
Lấy thông tin TK ngân hàng + cờ lỗi (nếu có) của user đang đăng nhập.

**Response:**
```json
{
  "success": true,
  "data": {
    "fullName": "Nguyễn Văn A",
    "email": "user@example.com",
    "bank": {
      "bankBin": "970436",
      "bankShortName": "Vietcombank",
      "bankName": "Ngân hàng TMCP Ngoại Thương",
      "bankLogo": "https://api.vietqr.io/img/VCB.png",
      "bankAccountNo": "0123456789",
      "bankAccountName": "NGUYEN VAN A"
    },
    "bankError": null  // hoặc "Số tài khoản không tồn tại"
  }
}
```

#### `PUT /api/auth/me/bank` (Auth required)
Cập nhật TK ngân hàng. Nếu đang bị báo sai TK (`bankError != null`) nhưng không sửa gì (3 trường không thay đổi), BE từ chối và báo "Vui lòng chỉnh sửa...".

**Request:**
```json
{
  "bankBin": "970436",
  "bankShortName": "Vietcombank",
  "bankName": "Ngân hàng TMCP Ngoại Thương",
  "bankLogo": "https://api.vietqr.io/img/VCB.png",
  "bankAccountNo": "0123456789",
  "bankAccountName": "NGUYEN VAN A"
}
```

**Response:** Giống `GET /api/auth/me/bank` (trả về profile đã cập nhật).

---

### Admin: Hoàn tiền (`src/routes/admin.routes.js`)

#### `GET /api/admin/refunds` (Admin only)
Lấy danh sách đơn `REFUND_PENDING` / `REFUNDED`. Response bổ sung thêm:
```json
{
  "refundBank": {
    "bankBin": "970436",
    "bankShortName": "Vietcombank",
    "bankName": "...",
    "bankLogo": "...",
    "bankAccountNo": "0123456789",
    "bankAccountName": "NGUYEN VAN A"
  },
  "refundBankError": null,  // hoặc "Số tài khoản không tồn tại"
  "refundSnapshot": null    // hoặc snapshot khi đã hoàn tiền
}
```

#### `POST /api/admin/orders/:orderCode/confirm-refund` (Admin only)
Xác nhận đã hoàn tiền thủ công (quét QR xong). Đóng băng Snapshot đối soát.

**Request:**
```json
{
  "bankBin": "970436",
  "bankAccountNo": "0123456789",
  "bankAccountName": "NGUYEN VAN A",
  "note": "FT26110923456789"  // tùy chọn
}
```

**Logic BE (`src/repositories/ticket.repository.js::confirmOrderRefund`):**
- SQL UPDATE chỉ thành công khi:
  - `status = 'REFUND_PENDING'`
  - `refund_bank_error IS NULL`
  - TK của khách (`users.bank_bin`, `bank_account_no`, `bank_account_name`) TRÙNG với payload Admin gửi lên.
- Nếu không trùng → trả 0 rows → BE báo lỗi "Không thể xác nhận... Vui lòng tải lại danh sách và quét lại QR."

**Response:**
```json
{
  "success": true,
  "message": "Đã xác nhận hoàn tiền cho đơn #100000123 thành công.",
  "data": {
    "orderCode": 100000123,
    "status": "REFUNDED",
    "refundSnapshot": { ... }
  }
}
```

#### `POST /api/admin/orders/:orderCode/refund-bank-error` (Admin only)
Báo sai thông tin TK ngân hàng của khách (quét QR thấy STK không tồn tại / Tên không khớp).

**Request:**
```json
{
  "reason": "Số tài khoản không tồn tại"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Đã báo sai thông tin TK cho đơn #100000123.",
  "data": {
    "orderCode": 100000123,
    "refundBankError": "Số tài khoản không tồn tại"
  }
}
```

---

## 💡 Đề xuất nâng cấp trong tương lai (Các giải pháp có tính phí khi mở rộng quy mô)

### Giải pháp 1: Bank Account Lookup API (Tra cứu & Xác thực Tên chủ TK)
**Mục đích:** Tự động điền và xác thực Tên chủ tài khoản ngay khi User nhập Số tài khoản, giảm thiểu lỗi "Tên không khớp".

**Nhà cung cấp:**
- **NAPAS** (Công ty CP Thanh toán Quốc gia Việt Nam): API tra cứu chính thức, độ chính xác cao, có tính phí theo lượt tra cứu (~500 – 1,000 VND/lượt).
- **VietQR Pro**: Gói trả phí của VietQR, có API Bank Account Lookup.
- **Casso / PayOS / 9Pay**: Fintech platform có API tra cứu chủ TK (tích hợp thêm các dịch vụ khác như thanh toán, đối soát giao dịch).

**Chi phí ước tính:** ~500 – 1,500 VND/lượt tra cứu (phụ thuộc nhà cung cấp và gói dịch vụ).

**Luồng nâng cấp:**
1. User chọn Ngân hàng và nhập STK ở Trang Hồ sơ.
2. FE gọi API BE → BE gọi Bank Account Lookup API (với BIN + STK) → Nhận về Tên chủ TK thật.
3. FE tự động điền Tên chủ TK vào ô input (readonly hoặc chỉ cho sửa khi cần).
4. Admin không cần đối chiếu thủ công nữa → Giảm thiểu lỗi "Sai TT TK".

**Khi nào cần:** Khi số lượng đơn hoàn tiền > 50 đơn/tháng, tỷ lệ lỗi TK > 10%.

---

### Giải pháp 2: Payout API (Chi hộ tự động) hoặc Webhook biến động số dư (Out)
**Mục đích:** Tự động chuyển tiền hoàn / tự động đối soát trạng thái hoàn tiền, không cần Admin quét QR thủ công.

**Nhà cung cấp:**
- **PayOS Payout API**: Tự động chuyển khoản chi hộ từ TK doanh nghiệp sang TK khách hàng. Phí giao dịch ~1,500 – 3,000 VND/lần.
- **Casso**: Webhook biến động số dư (In/Out) tự động đối soát khi Admin chuyển khoản thủ công qua App Ngân hàng. Phí ~100,000 – 300,000 VND/tháng (flat fee, unlimited webhook).
- **9Pay / Momo / ZaloPay**: Payout API tương tự PayOS.

**Chi phí ước tính:**
- **Payout API:** ~1,500 – 3,000 VND/giao dịch hoàn tiền.
- **Webhook biến động số dư:** ~100,000 – 300,000 VND/tháng (flat fee).

**Luồng nâng cấp:**
- **Payout API:**
  1. Admin bấm "Xác nhận hoàn tiền" → BE gọi Payout API (BIN, STK, Số tiền, Nội dung CK).
  2. Payout API tự động chuyển khoản từ TK DN sang TK khách.
  3. Nhận callback/webhook từ Payout API → BE cập nhật `status = 'REFUNDED'`, lưu Snapshot (thêm `payoutTransactionId`).
- **Webhook biến động số dư:**
  1. Admin vẫn quét QR thủ công bằng App Ngân hàng để chuyển khoản.
  2. Webhook biến động số dư (Out) từ Casso/VietQR Pro gửi về BE: STK nhận, Số tiền, Nội dung CK, Thời gian.
  3. BE parse nội dung CK (regex `HOAN TIEN (\d+)`), match với `order_code` → Tự động cập nhật `status = 'REFUNDED'`, lưu Snapshot.

**Khi nào cần:**
- Số lượng đơn hoàn tiền > 100 đơn/tháng.
- Cần giảm thiểu thao tác thủ công của Admin.
- Có ngân sách cho Payout API fee (1,500 – 3,000 VND/đơn) hoặc flat fee Webhook (100k – 300k VND/tháng).

---

## ✅ Checklist triển khai

- [x] **BE: Database Migration** (`docs/migrations/add_manual_refund_vietqr.sql`)
  - [x] `users`: 6 cột bank (NULLABLE)
  - [x] `orders`: 2 cột refund (NULLABLE)
  - [x] Constraints: `chk_bank_bin_format`, `chk_bank_account_no_format`
- [x] **BE: Auth Repository** (`src/repositories/auth.repository.js`)
  - [x] `getBankProfile(userId)`: Đọc TK ngân hàng + cờ lỗi mới nhất từ đơn chờ hoàn tiền
  - [x] `updateBankAndClearErrors(userId, bank)`: 1 transaction lưu TK + gỡ cờ lỗi nếu thực sự thay đổi
- [x] **BE: Auth Service** (`src/services/auth.service.js`)
  - [x] `getBankProfile(userId)`
  - [x] `updateBank(userId, input)`: Validate unchanged khi có `bankError`
- [x] **BE: Auth Controller & Routes** (`src/controllers/auth.controller.js`, `src/routes/auth.route.js`)
  - [x] `GET /api/auth/me/bank`
  - [x] `PUT /api/auth/me/bank`
- [x] **BE: DTO** (`src/dto/auth.dto.js`)
  - [x] `UpdateBankRequestDTO`: Validate BIN, STK, Tên chủ TK (auto-uppercase không dấu)
  - [x] `BankProfileDTO`: Response format
  - [x] `toBankAccountName(value)`: Helper chuẩn hóa tên
- [x] **BE: Ticket Repository** (`src/repositories/ticket.repository.js`)
  - [x] `getUserOrderHistory`: Thêm cột `refund_bank_error`, `refund_snapshot`, `bank_short_name`, `bank_account_no`
  - [x] `getRefundOrdersForAdmin`: Thêm 7 cột bank từ `users`
  - [x] `confirmOrderRefund(orderCode, { bankBin, bankAccountNo, bankAccountName, note, refundedBy })`: SQL UPDATE chặn race condition
  - [x] `markRefundBankError(orderCode, reason)`
- [x] **BE: Ticket Service** (`src/services/ticket.service.js`)
  - [x] `confirmOrderRefund(orderCode, input)`: Validate + gọi repo + log
  - [x] `markRefundBankError(orderCode, reason)`: Validate + gọi repo + log
- [x] **BE: Ticket Controller & Routes** (`src/controllers/ticket.controller.js`, `src/routes/admin.routes.js`)
  - [x] `POST /api/admin/orders/:orderCode/confirm-refund`
  - [x] `POST /api/admin/orders/:orderCode/refund-bank-error`
- [x] **BE: DTO** (`src/dto/order.dto.js`)
  - [x] `OrderHistoryItemDTO`: Thêm `refundBank`, `refundBankError`, `refundSnapshot`
- [x] **FE: Shared Utils** (`src/utils/format.js`)
  - [x] `stripAccents(val)`: Bỏ dấu tiếng Việt
  - [x] `toBankAccountName(val)`: CHỮ IN HOA KHÔNG DẤU
- [x] **FE: Service** (`src/services/eventService.js`)
  - [x] `fetchMyBank(token)`
  - [x] `updateMyBank(bank, token)`
  - [x] `fetchVietQrBanks()`: Public API VietQR
  - [x] `buildVietQrUrl({ bankBin, bankAccountNo, bankAccountName }, amount, addInfo)`
  - [x] `confirmOrderRefundOnBackend(orderCode, payload, token)`
  - [x] `markRefundBankErrorOnBackend(orderCode, reason, token)`
- [x] **FE: ProfilePage** (`src/pages/ProfilePage.jsx`, `ProfilePage.css`)
  - [x] Form nhập TK ngân hàng (Combobox ngân hàng từ VietQR, STK, Tên chủ TK)
  - [x] Hiển thị alert cờ lỗi `bankError` (nếu có)
  - [x] Validate không cho lưu khi chưa sửa gì mà đang bị lỗi
  - [x] Auto-scroll tới `#bank` khi điều hướng từ đơn hoàn tiền
- [x] **FE: OrderHistoryPage** (`src/pages/OrderHistoryPage.jsx`, `OrderHistoryPage.css`)
  - [x] Hiển thị trạng thái hoàn tiền chi tiết (chưa có TK / sai TK / đã có TK / đã hoàn tiền)
  - [x] Nút điều hướng "Vào Hồ sơ cập nhật TK" / "Vào Hồ sơ sửa lại ngay" (prop `onGoToBankProfile`)
  - [x] Hiển thị Snapshot đối soát khi `status = 'REFUNDED'`
- [x] **FE: Navbar** (`src/components/Navbar.jsx`)
  - [x] Menu "Hồ sơ & Ngân hàng" trong dropdown User
  - [x] Import icon `Landmark`
- [x] **FE: App.jsx**
  - [x] Route `/profile` → `<ProfilePage />`
  - [x] Hàm `navigateTo('profile')` → `navigate('/profile#bank')`
  - [x] Prop `onGoToBankProfile` xuống `OrderHistoryPage`
- [x] **FE: RefundQrModal** (`src/components/RefundQrModal.jsx`, `RefundQrModal.css`)
  - [x] Hiển thị ảnh QR từ `img.vietqr.io`
  - [x] Thông tin đối chiếu (Ngân hàng, STK, Tên chủ TK)
  - [x] Ô nhập "Mã giao dịch / Ghi chú đối soát"
  - [x] Nút "Báo sai thông tin TK" → Form nhập lý do → gọi `onMarkError(reason)`
  - [x] Nút "Xác nhận đã hoàn tiền" → gọi `onConfirm({ bankBin, bankAccountNo, bankAccountName, note })`
- [x] **FE: AdminRefundsTab** (`src/components/AdminRefundsTab.jsx`, `AdminTicketsTab.css`)
  - [x] Hiển thị trạng thái TK ngân hàng (chưa có / sai / đã có / đã hoàn)
  - [x] Nút "Quét QR hoàn tiền" mở Modal (chỉ khi `refundState = 'ready'`)
  - [x] CSS `.atk-bank-status` (ok / warn / error)
- [x] **FE: AdminPage** (`src/pages/AdminPage.jsx`)
  - [x] Import `markRefundBankErrorOnBackend`
  - [x] `handleMarkBankError(orderCode, reason)`
  - [x] Prop `onMarkBankError` xuống `AdminRefundsTab`
- [x] **Docs:** File này (`docs/refund/MANUAL_REFUND_VIETQR.md`)

---

## 📝 Notes & Best Practices

1. **Tất cả cột DB đều NULLABLE** → Không breaking change, không ảnh hưởng luồng cũ.
2. **BE validation chặt chẽ:** DTO + Repository + DB constraint (3 lớp).
3. **FE auto-uppercase tên chủ TK ngay khi gõ** → UX mượt, giảm lỗi.
4. **Chặn race condition:** SQL UPDATE chỉ thành công khi TK hiện tại TRÙNG với TK Admin quét QR.
5. **Snapshot bằng chứng đối soát:** Đóng băng vào `refund_snapshot` (jsonb) khi hoàn tiền → Audit trail đầy đủ.
6. **Public API VietQR 100% miễn phí:** Không giới hạn request, không cần API key, không tính phí.

---

**Liên hệ:** Nếu cần nâng cấp lên Payout API / Bank Account Lookup API, vui lòng tham khảo mục **"Đề xuất nâng cấp"** phía trên.

# Code Review Fixes - Version 1.3

**Date**: 2026-11-03  
**Review**: 10 phát hiện từ đợt code review

---

## 📋 Tổng quan các fixes

### ✅ ĐÃ FIX HOÀN TOÀN

#### 1. [CRITICAL] Race condition khi 2+ người checkout cùng ghế
- **File**: `src/services/ticket.service.js`
- **Fix**: Tách riêng 3 điều kiện kiểm tra trong checkout:
  - `reserved_by !== userId` → Không thuộc quyền sở hữu
  - `status !== 'RESERVED'` → Đã được thanh toán
  - `reserved_until <= now` → Hết hạn giữ chỗ
- **Kết quả**: Transaction lock + ownership verification ngăn race condition

#### 2. [CRITICAL] JWT_SECRET mặc định yếu
- **File**: `src/config/constants.js`
- **Fix**: Throw error nếu `JWT_SECRET` không được set trong `.env`
- **Message**: `❌ SECURITY ERROR: JWT_SECRET không được cấu hình trong .env`
- **Kết quả**: Hệ thống không khởi động nếu thiếu JWT_SECRET

#### 3. [HIGH] PayOS webhook signature verification
- **File**: `src/controllers/ticket.controller.js`
- **Trạng thái**: ✅ ĐÃ CÓ SẴN từ trước (line 247: `payos.webhooks.verify()`)
- **Cải thiện**: Thêm log chi tiết khi verify fail

#### 4. [HIGH] Catch block trống bỏ qua lỗi
- **Files**: `src/utils/logger.js`, `src/jobs/seat-release.job.js`, `src/services/ticket.service.js`
- **Fix**: Thay thế `catch { }` bằng `catch (err) { logger.error(...) }`
- **Kết quả**: Tất cả lỗi đều được log với stack trace đầy đủ

#### 5. [HIGH] MAX_TICKETS_PER_USER chỉ validate frontend
- **Files**: 
  - `src/services/ticket.service.js` - Thêm check database
  - `src/repositories/ticket.repository.js` - Thêm `countSuccessfulTicketsByUser()`
- **Fix**: Kiểm tra tổng số vé SUCCESS trong database trước khi checkout
- **Query**: 
  ```sql
  SELECT COUNT(*) FROM order_items oi
  INNER JOIN orders o ON oi.order_code = o.order_code
  WHERE o.user_id = $1 AND o.status = 'SUCCESS'
  ```
- **Kết quả**: User không thể bypass giới hạn 4 vé

#### 6. [MEDIUM] SSE clients memory leak
- **File**: `src/utils/logger.js`
- **Fix**: 
  - Đổi `Set` → `Map<client, timestamp>`
  - Cleanup connections timeout > 60s trong `broadcast()`
  - Thêm `client.end()` cho dead connections
- **Constants**: `SSE_CLIENT_TIMEOUT_MS = 60000`

#### 7. [MEDIUM] releaseExpiredSeats() performance
- **File**: `migrations/add_performance_indexes.sql`
- **Fix**: Tạo indexes cho các query thường xuyên
- **Apply**: `psql $DATABASE_URL -f migrations/add_performance_indexes.sql`

#### 9. [LOW] Magic numbers trong code
- **File**: `src/config/constants.js`
- **Fix**: Di chuyển tất cả magic numbers vào constants
- **Updated files**: `app.js`, `src/jobs/seat-release.job.js`, `src/utils/logger.js`

---

### 📝 CẦN THỰC HIỆN THỦ CÔNG

#### 8. [MEDIUM] phone/citizenId không có NOT NULL constraint
- **File**: `migrations/add_data_constraints.sql`
- **Apply**: `psql $DATABASE_URL -f migrations/add_data_constraints.sql`

#### 10. [LOW] Missing transaction/trace IDs
- **Trạng thái**: KHÔNG FIX (nice-to-have)
- **Lý do**: Yêu cầu thay đổi architecture lớn

---

## 🚀 Cách kiểm tra

### Test JWT_SECRET validation
```bash
npm start  # Without JWT_SECRET in .env
# Expected: Error and exit
```

### Apply migrations
```bash
psql $DATABASE_URL -f migrations/add_performance_indexes.sql
psql $DATABASE_URL -f migrations/add_data_constraints.sql
```

---

## 📊 Summary

**Total**: 9/10 fixes implemented, 2 SQL migrations created


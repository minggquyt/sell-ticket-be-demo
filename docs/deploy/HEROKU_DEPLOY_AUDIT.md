# Kiểm toán Kiến trúc & Hướng dẫn Triển khai Backend lên Heroku (`sell-ticket-be-bcn`)

**Phạm vi:** Backend `sell-ticket-be-demo/` (Node.js CommonJS, Express 5.2.1 — không thêm thư viện ngoài, không thay đổi Database Schema)  
**URL Production Heroku:** `https://sell-ticket-be-bcn-bcc127d1b2cd.herokuapp.com/`  
**Nhánh làm việc:** `fix/heroku-be-deploy-audit`  
**Cập nhật:** 2026-11-24  
**Kiểm thử:** `node --check` PASS · `10/10` script `test/*.check.js` PASS (bao gồm `test/deploy-readiness.check.js`)

---

## 1. Tổng quan các điểm đã chuẩn hóa (P0 → P2)

### 1.1. Core Runtime, Heroku Manifest & PostgreSQL Pool
- **Heroku manifest ([Procfile](../../Procfile), [package.json](../../package.json)):**
  - Tạo `Procfile` với `web: node app.js`.
  - Cập nhật `"main": "app.js"` và `"engines": { "node": "22.x" }` trong `package.json` (giữ nguyên `dependencies` khớp `package-lock.json` để Heroku chạy `npm ci` ổn định).
- **Cấu hình mặc định & Guard ([src/config/constants.js](../../src/config/constants.js), [.env.example](../../.env.example)):**
  - Đổi mặc định `EMAIL_PROVIDER` từ `'resend'` sang `'gmail'` (khớp `EmailService` chỉ hỗ trợ `'gmail'`/`'console'`).
  - Bổ sung `DB_POOL_MAX` (mặc định `15`), `CORS_ORIGINS`, `ENABLE_LIVE_LOGS` (mặc định `false` khi `NODE_ENV=production`, `true` khi dev), và `LOGS_ACCESS_TOKEN`.
- **PostgreSQL Pool an toàn ([src/config/db.js](../../src/config/db.js)):**
  - Cấu hình `max` từ `DB_POOL_MAX` (mặc định `15`), `idleTimeoutMillis: 30000`, `connectionTimeoutMillis: 10000`, `keepAlive: true`, giữ `ssl: { rejectUnauthorized: false }` tương thích Supabase IPv4 Pooler (`:6543`).
  - Đăng ký `pool.on('error', ...)` log lỗi idle socket thay vì làm crash dyno Heroku (`H10`).
- **PayOS Fail-Closed Guard ([src/config/payos.js](../../src/config/payos.js)):**
  - Nhánh thiếu credentials bổ sung đủ mock `paymentRequests.get()` và `paymentRequests.cancel()`.
  - `webhooks.verify()` **fail-closed** (ném lỗi từ chối webhook) khi `NODE_ENV === 'production'` và thiếu credentials.

### 1.2. Tầng Repository, Service & Controller
- **Sửa lỗi multi-statement SQL ([src/repositories/auth.repository.js](../../src/repositories/auth.repository.js)):**
  - Viết lại `markRegistrationExpired(registrationId, dbClient)` thành 1 câu lệnh CTE duy nhất (`WITH expired AS (...) UPDATE ...`), tránh lỗi PostgreSQL `42601` khi chạy parameterized query qua Supavisor `:6543`.
- **Bulk Insert ghế chống Heroku H12 30s timeout ([src/repositories/ticket.repository.js](../../src/repositories/ticket.repository.js), [src/services/ticket.service.js](../../src/services/ticket.service.js)):**
  - Thêm `createSeatsBulk(seats, dbClient)` sử dụng `INSERT INTO seats (...) SELECT ... FROM UNNEST($1::uuid[], $2::text[], $3::text[], $4::numeric[])` để chèn toàn bộ ghế trong đúng **1 round-trip SQL**.
  - Cập nhật `createEventWithConfig` và `updateEventWithConfig` dùng `_buildEventSeats` + `createSeatsBulk` thay cho vòng lặp `createSeat` tuần tự.
- **Che PII & chuẩn hóa múi giờ Việt Nam ([src/services/auth.service.js](../../src/services/auth.service.js), [src/controllers/ticket.controller.js](../../src/controllers/ticket.controller.js)):**
  - Che số tài khoản ngân hàng khi log `UPDATE_BANK` (chỉ giữ 4 số cuối `***XXXX`).
  - Ép `timeZone: 'Asia/Ho_Chi_Minh'` cho `purchaseDate` trong `getAdminTickets` để không bị lệch 7 tiếng trên dyno Heroku (UTC).

### 1.3. Bảo mật HTTP/CORS, Live Logs, Bộ nhớ & Graceful Shutdown
- **Express & CORS ([app.js](../../app.js)):**
  - Thêm `app.set('trust proxy', 1)` để `req.ip` đọc đúng IP client qua Heroku Router (`X-Forwarded-For`), và `app.disable('x-powered-by')`.
  - Cấu hình `cors` với `exposedHeaders: ['Retry-After']` (để Frontend đọc được countdown rate-limit/OTP), `methods` và `allowedHeaders` tường minh, cùng allowlist dựng từ `CORS_ORIGINS` + `FRONTEND_ORIGIN` (tương thích ngược `*` khi chưa đặt biến môi trường).
- **Bảo vệ Live Logs & sửa SSE ([app.js](../../app.js), [public/logs.html](../../public/logs.html), [src/utils/logger.js](../../src/utils/logger.js)):**
  - Bảo vệ `/logs`, `/logs.html` (đặt trước `express.static`), và `/api/logs/stream` bằng `requireLogsAccess`: trả `404` khi `ENABLE_LIVE_LOGS=false`; nếu đặt `LOGS_ACCESS_TOKEN` thì đối chiếu an toàn bằng `crypto.timingSafeEqual` qua `?token=...` hoặc header `x-logs-token` (sai trả `403`).
  - Sửa `/api/logs/stream`: bỏ `Access-Control-Allow-Origin: *` cứng, thêm `X-Accel-Buffering: no`, `res.flushHeaders?.()`, bọc `try/catch` cho heartbeat và gọi `logger.touchSSEClient(res)`, gắn cleanup trên cả `req.on('close')` và `res.on('close')`.
  - Định dạng `getTimestamp()` của `logger.js` theo múi giờ `'Asia/Ho_Chi_Minh'` độc lập với `TZ` của hệ điều hành.
  - Sửa `public/logs.html` bỏ link Render cũ, hiển thị động `window.location.origin` và tự nối `?token=...` vào `EventSource` nếu có.
- **Chống rò rỉ bộ nhớ OTP Rate Limit ([src/middlewares/otp-rate-limit.middleware.js](../../src/middlewares/otp-rate-limit.middleware.js)):**
  - Tự động dọn dẹp các bucket đã hết hạn (`resetAt <= now`) khi `buckets.size >= 1000` mà vẫn giữ nguyên contract `429` + `Retry-After` + `data.code = 'RATE_LIMITED'`.
- **Healthcheck & Graceful Shutdown ([app.js](../../app.js), [src/utils/payment-events.js](../../src/utils/payment-events.js), [src/jobs/seat-release.job.js](../../src/jobs/seat-release.job.js)):**
  - Thêm `GET /api/health` kiểm tra DB (`SELECT 1` với timeout 3s).
  - Bổ sung `PaymentEventHub.closeAll()`, `logger.closeAllSSEClients()`, và hàm dừng trả về từ `startSeatReleaseJob()` (`timer.unref?.()`).
  - Xử lý `SIGTERM` / `SIGINT` tuần tự: dừng cron job → đóng toàn bộ SSE client → `server.close()` → `await pool.end()`, kèm timer bảo vệ `25_000ms` (`.unref()`) tránh Heroku `R12 Exit timeout`.

---

## 2. Hợp đồng Healthcheck (`GET /api/health`)

Endpoint đi qua `apiResponseMiddleware`:

- **DB sẵn sàng (`200 OK`):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "OK",
  "data": {
    "status": "ok",
    "db": "up",
    "uptimeSeconds": 120,
    "serverTime": "2026-11-24T08:15:00.000Z"
  }
}
```
- **DB mất kết nối / timeout (`503 Service Unavailable`):**
```json
{
  "success": false,
  "statusCode": 503,
  "message": "Database unavailable.",
  "data": {
    "status": "degraded",
    "db": "down",
    "serverTime": "2026-11-24T08:15:03.000Z"
  }
}
```

---

## 3. Biến môi trường & Cấu hình Heroku Config Vars

| Biến môi trường | Bắt buộc trên Heroku | Giá trị khuyến nghị / Mặc định | Ghi chú vận hành |
| :--- | :---: | :--- | :--- |
| `NODE_ENV` | Có | `production` | Bật guard PayOS fail-closed, chặn `EMAIL_PROVIDER=console`, mặc định tắt `/logs`. |
| `DATABASE_URL` | Có | `postgresql://...@aws-0-ap-southeast-1.pooler.supabase.com:6543/...` | Dùng Supabase IPv4 Pooler (`:6543`) tương thích Heroku dyno. |
| `DB_POOL_MAX` | Tùy chọn | `15` | Giới hạn số kết nối `pg.Pool` trên 1 dyno. |
| `JWT_SECRET` | Có | Chuỗi random ≥ 32 byte | Khóa ký/xác thực JWT. |
| `JWT_EXPIRES_IN` | Tùy chọn | `1d` | Thời hạn JWT. |
| `OTP_HMAC_SECRET` | Có | Chuỗi random khác `JWT_SECRET` | Hash mã OTP đăng ký. |
| `EMAIL_PROVIDER` | Có | `gmail` | Mặc định code là `'gmail'`. |
| `EMAIL_FROM`, `GMAIL_USER`, `GMAIL_APP_PASSWORD` | Có | Thông tin Gmail App Password | Gửi OTP đăng ký qua SMTP. |
| `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY` | Có | Credentials từ PayOS Merchant | Tạo QR VietQR & xác thực chữ ký HMAC webhook. |
| `FRONTEND_ORIGIN` | **Bắt buộc** | `https://<domain-fe-production>` (không `/` cuối) | Tạo `returnUrl`/`cancelUrl` PayOS và tự động vào CORS allowlist. |
| `CORS_ORIGINS` | Khuyến nghị | `https://<domain-fe-production>,http://localhost:5173` | Danh sách origin được phép gọi API cross-origin; trống sẽ fallback `*`. |
| `ENABLE_LIVE_LOGS` | Tùy chọn | `false` | Đặt `true` chỉ khi cần debug `/logs`; mặc định `false` ở `production`. |
| `LOGS_ACCESS_TOKEN` | Khuyến nghị nếu bật logs | Chuỗi bí mật bất kỳ | Yêu cầu `?token=...` hoặc header `x-logs-token` khi mở `/logs` & `/api/logs/stream`. |
| `TZ` | Khuyến nghị | `Asia/Ho_Chi_Minh` | Đồng bộ giờ hệ thống dyno về Việt Nam. |

> **Lưu ý Dyno:** Sử dụng gói **Basic trở lên** với đúng **`web=1`** (tránh gói Eco ngủ sau 30 phút làm gián đoạn `seat-release.job.js`, và chưa scale `web>=2` khi chưa có Redis Pub/Sub cho SSE & rate limit in-memory).

---

## 4. Kiểm thử & Checklist Vận hành Sau Deploy

### 4.1. Chạy bộ kiểm tra không cần DB ở local
```powershell
cd sell-ticket-be-demo
npm ci
node --check app.js
Get-ChildItem test\*.check.js | ForEach-Object { node $_.FullName }
```
*Ghi chú:* [test/test-100-users.js](../../test/test-100-users.js) hỗ trợ biến môi trường `BASE_URL` (mặc định `http://localhost:3000/api`).

### 4.2. Checklist vận hành sau khi deploy
1. Cấu hình đủ **Heroku Config Vars** trên app `sell-ticket-be-bcn`.
2. Trên **PayOS Merchant Dashboard**, đổi Webhook URL sang `https://sell-ticket-be-bcn-bcc127d1b2cd.herokuapp.com/api/payos-webhook` và xác nhận kết nối.
3. Smoke test sau deploy:
   - `GET /api/health` → `200 OK`, `data.db === "up"`, không còn header `X-Powered-By`.
   - `OPTIONS /api/auth/register` kèm `Origin` FE → có `Access-Control-Expose-Headers: Retry-After`.
   - `GET /logs` → `404` khi `ENABLE_LIVE_LOGS=false`.

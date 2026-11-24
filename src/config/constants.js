require('dotenv').config();

// FIX #2: JWT_SECRET bắt buộc phải có trong .env
if (!process.env.JWT_SECRET) {
  throw new Error('❌ SECURITY ERROR: JWT_SECRET không được cấu hình trong .env. Hệ thống không thể khởi động an toàn.');
}

if (!process.env.OTP_HMAC_SECRET) {
  throw new Error('❌ SECURITY ERROR: OTP_HMAC_SECRET không được cấu hình trong .env.');
}

const positiveInt = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

module.exports = {
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '1d',
  BCRYPT_SALT_ROUNDS: 10,
  OTP_HMAC_SECRET: process.env.OTP_HMAC_SECRET,
  OTP_TTL_SECONDS: positiveInt(process.env.OTP_TTL_SECONDS, 300),
  REGISTRATION_TTL_SECONDS: positiveInt(process.env.REGISTRATION_TTL_SECONDS, 900),
  OTP_RESEND_COOLDOWN_SECONDS: positiveInt(process.env.OTP_RESEND_COOLDOWN_SECONDS, 60),
  OTP_MAX_ATTEMPTS: positiveInt(process.env.OTP_MAX_ATTEMPTS, 5),
  OTP_MAX_RESENDS: positiveInt(process.env.OTP_MAX_RESENDS, 3),
  EMAIL_PROVIDER: String(process.env.EMAIL_PROVIDER || 'gmail').toLowerCase(),
  EMAIL_FROM: process.env.EMAIL_FROM || '',
  GMAIL_USER: process.env.GMAIL_USER || '',
  GMAIL_APP_PASSWORD: process.env.GMAIL_APP_PASSWORD || '',
  DB_POOL_MAX: positiveInt(process.env.DB_POOL_MAX, 15),
  CORS_ORIGINS: process.env.CORS_ORIGINS || '',
  ENABLE_LIVE_LOGS:
    process.env.ENABLE_LIVE_LOGS !== undefined
      ? process.env.ENABLE_LIVE_LOGS === 'true'
      : process.env.NODE_ENV !== 'production',
  LOGS_ACCESS_TOKEN: process.env.LOGS_ACCESS_TOKEN || '',
  
  // FIX #9: Magic numbers -> Named constants
  SEAT_HOLD_DURATION_SECONDS: 30,
  SEAT_HOLD_CHECKOUT_GRACE_SECONDS: 5,
  PAYMENT_TIMEOUT_SECONDS: 120,
  PAYMENT_CONFIRM_WINDOW_SECONDS: 30,
  PAYOS_SYNC_COOLDOWN_MS: 10 * 1000,
  MAX_TICKETS_PER_USER: 4,
  
  // Cron job & Background tasks
  SEAT_RELEASE_JOB_INTERVAL_MS: 15 * 1000, // 15 seconds
  SSE_HEARTBEAT_INTERVAL_MS: 15 * 1000, // 15 seconds
  SSE_CLIENT_TIMEOUT_MS: 60 * 1000, // 60 seconds
  SSE_ORDER_MAX_DURATION_MS: 180 * 1000, // 180 seconds (120s + 30s + 30s buffer)
  
  // Logging
  MAX_RECENT_LOGS: 200,
};

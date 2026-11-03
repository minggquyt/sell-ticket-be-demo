require('dotenv').config();

// FIX #2: JWT_SECRET bắt buộc phải có trong .env
if (!process.env.JWT_SECRET) {
  throw new Error('❌ SECURITY ERROR: JWT_SECRET không được cấu hình trong .env. Hệ thống không thể khởi động an toàn.');
}

module.exports = {
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: '1d',
  BCRYPT_SALT_ROUNDS: 10,
  
  // FIX #9: Magic numbers -> Named constants
  SEAT_HOLD_DURATION_SECONDS: 30,
  PAYMENT_TIMEOUT_SECONDS: 120,
  PAYMENT_GRACE_SECONDS: 30,
  MAX_TICKETS_PER_USER: 4,
  
  // Cron job & Background tasks
  SEAT_RELEASE_JOB_INTERVAL_MS: 15 * 1000, // 15 seconds
  SSE_HEARTBEAT_INTERVAL_MS: 15 * 1000, // 15 seconds
  SSE_CLIENT_TIMEOUT_MS: 60 * 1000, // 60 seconds
  
  // Logging
  MAX_RECENT_LOGS: 200,
};

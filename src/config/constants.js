require('dotenv').config();

module.exports = {
  JWT_SECRET: process.env.JWT_SECRET || 'your-secret-key-here',
  JWT_EXPIRES_IN: '1d',
  BCRYPT_SALT_ROUNDS: 10,
  SEAT_HOLD_DURATION_SECONDS: 30,
  PAYMENT_TIMEOUT_MINUTES: 0.5,
  MAX_TICKETS_PER_USER: 4,
};

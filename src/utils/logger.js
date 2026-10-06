// src/utils/logger.js
// Bộ logging chuẩn cho hệ thống bán vé & thanh toán

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m'
};

function getTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const padMs = (n) => String(n).padStart(3, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${padMs(d.getMilliseconds())}`;
}

const logger = {
  http(method, path, status, durationMs, userInfo = '') {
    const time = getTimestamp();
    const statusColor = status >= 500 ? colors.red : status >= 400 ? colors.yellow : colors.green;
    const userTag = userInfo ? ` | User: ${userInfo}` : '';
    console.log(
      `${colors.gray}[${time}]${colors.reset} ${colors.cyan}[HTTP]${colors.reset} ${colors.bright}${method}${colors.reset} ${path} -> ${statusColor}${status}${colors.reset} (${durationMs}ms)${userTag}`
    );
  },

  auth(action, email, success, message = '') {
    const time = getTimestamp();
    const icon = success ? '✅' : '❌';
    const tagColor = success ? colors.green : colors.red;
    console.log(
      `${colors.gray}[${time}]${colors.reset} ${tagColor}[AUTH_${action}]${colors.reset} ${icon} Email: ${colors.bright}${email}${colors.reset} - ${message}`
    );
  },

  hold(action, details) {
    const time = getTimestamp();
    const icon = action === 'SUCCESS' ? '🎟️' : action === 'CONFLICT' ? '⚠️' : 'ℹ️';
    const tagColor = action === 'SUCCESS' ? colors.green : action === 'CONFLICT' ? colors.yellow : colors.blue;
    console.log(
      `${colors.gray}[${time}]${colors.reset} ${tagColor}[HOLD_${action}]${colors.reset} ${icon} ${details}`
    );
  },

  release(details) {
    const time = getTimestamp();
    console.log(
      `${colors.gray}[${time}]${colors.reset} ${colors.magenta}[SEAT_RELEASE]${colors.reset} 🔓 ${details}`
    );
  },

  payment(action, details) {
    const time = getTimestamp();
    const icon = action === 'SUCCESS' ? '💰' : action === 'START' ? '💳' : action === 'CANCEL' ? '🛑' : '🔔';
    const tagColor = action === 'SUCCESS' ? colors.green : action === 'START' ? colors.cyan : colors.yellow;
    console.log(
      `${colors.gray}[${time}]${colors.reset} ${tagColor}[PAYMENT_${action}]${colors.reset} ${icon} ${details}`
    );
  },

  cron(details) {
    const time = getTimestamp();
    console.log(
      `${colors.gray}[${time}]${colors.reset} ${colors.gray}[AUTO_CRON]${colors.reset} ⏱️ ${details}`
    );
  },

  error(moduleName, message, err = null) {
    const time = getTimestamp();
    console.error(
      `${colors.gray}[${time}]${colors.reset} ${colors.red}[ERROR] [${moduleName}]${colors.reset} 🚨 ${message}`,
      err ? (err.stack || err) : ''
    );
  }
};

module.exports = logger;


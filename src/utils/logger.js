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

const recentLogs = [];
const MAX_RECENT_LOGS = 200;
const sseClients = new Set();
let logCounter = 0;

function broadcast(logEntry) {
  recentLogs.push(logEntry);
  if (recentLogs.length > MAX_RECENT_LOGS) {
    recentLogs.shift();
  }

  const payload = `data: ${JSON.stringify({ type: 'LOG', log: logEntry })}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (err) {
      sseClients.delete(client);
    }
  }
}

const logger = {
  addSSEClient(res) {
    sseClients.add(res);
  },

  removeSSEClient(res) {
    sseClients.delete(res);
  },

  getRecentLogs() {
    return recentLogs;
  },

  http(method, path, status, durationMs, userInfo = '') {
    const time = getTimestamp();
    const statusColor = status >= 500 ? colors.red : status >= 400 ? colors.yellow : colors.green;
    const userTag = userInfo ? ` | User: ${userInfo}` : '';
    console.log(
      `${colors.gray}[${time}]${colors.reset} ${colors.cyan}[HTTP]${colors.reset} ${colors.bright}${method}${colors.reset} ${path} -> ${statusColor}${status}${colors.reset} (${durationMs}ms)${userTag}`
    );

    broadcast({
      id: ++logCounter,
      time,
      category: 'HTTP',
      subAction: method,
      status,
      durationMs,
      userInfo,
      message: `${method} ${path} -> ${status} (${durationMs}ms)${userTag}`,
      raw: `[${time}] [HTTP] ${method} ${path} -> ${status} (${durationMs}ms)${userTag}`
    });
  },

  auth(action, email, success, message = '') {
    const time = getTimestamp();
    const icon = success ? '✅' : '❌';
    const tagColor = success ? colors.green : colors.red;
    console.log(
      `${colors.gray}[${time}]${colors.reset} ${tagColor}[AUTH_${action}]${colors.reset} ${icon} Email: ${colors.bright}${email}${colors.reset} - ${message}`
    );

    broadcast({
      id: ++logCounter,
      time,
      category: 'AUTH',
      subAction: action,
      success,
      email,
      message: `${icon} Email: ${email} - ${message}`,
      raw: `[${time}] [AUTH_${action}] ${icon} Email: ${email} - ${message}`
    });
  },

  hold(action, details) {
    const time = getTimestamp();
    const icon = action === 'SUCCESS' ? '🎟️' : action === 'CONFLICT' ? '⚠️' : 'ℹ️';
    const tagColor = action === 'SUCCESS' ? colors.green : action === 'CONFLICT' ? colors.yellow : colors.blue;
    console.log(
      `${colors.gray}[${time}]${colors.reset} ${tagColor}[HOLD_${action}]${colors.reset} ${icon} ${details}`
    );

    broadcast({
      id: ++logCounter,
      time,
      category: 'HOLD',
      subAction: action,
      message: `${icon} ${details}`,
      raw: `[${time}] [HOLD_${action}] ${icon} ${details}`
    });
  },

  release(details) {
    const time = getTimestamp();
    console.log(
      `${colors.gray}[${time}]${colors.reset} ${colors.magenta}[SEAT_RELEASE]${colors.reset} 🔓 ${details}`
    );

    broadcast({
      id: ++logCounter,
      time,
      category: 'RELEASE',
      subAction: 'RELEASE',
      message: `🔓 ${details}`,
      raw: `[${time}] [SEAT_RELEASE] 🔓 ${details}`
    });
  },

  payment(action, details) {
    const time = getTimestamp();
    const icon = action === 'SUCCESS' ? '💰' : action === 'START' ? '💳' : action === 'CANCEL' ? '🛑' : '🔔';
    const tagColor = action === 'SUCCESS' ? colors.green : action === 'START' ? colors.cyan : colors.yellow;
    console.log(
      `${colors.gray}[${time}]${colors.reset} ${tagColor}[PAYMENT_${action}]${colors.reset} ${icon} ${details}`
    );

    broadcast({
      id: ++logCounter,
      time,
      category: 'PAYMENT',
      subAction: action,
      message: `${icon} ${details}`,
      raw: `[${time}] [PAYMENT_${action}] ${icon} ${details}`
    });
  },

  cron(details) {
    const time = getTimestamp();
    console.log(
      `${colors.gray}[${time}]${colors.reset} ${colors.gray}[AUTO_CRON]${colors.reset} ⏱️ ${details}`
    );

    broadcast({
      id: ++logCounter,
      time,
      category: 'CRON',
      subAction: 'AUTO_RELEASE',
      message: `⏱️ ${details}`,
      raw: `[${time}] [AUTO_CRON] ⏱️ ${details}`
    });
  },

  error(moduleName, message, err = null) {
    const time = getTimestamp();
    console.error(
      `${colors.gray}[${time}]${colors.reset} ${colors.red}[ERROR] [${moduleName}]${colors.reset} 🚨 ${message}`,
      err ? (err.stack || err) : ''
    );

    broadcast({
      id: ++logCounter,
      time,
      category: 'ERROR',
      subAction: moduleName,
      message: `🚨 [${moduleName}] ${message} ${err ? (err.message || '') : ''}`,
      raw: `[${time}] [ERROR] [${moduleName}] 🚨 ${message}`
    });
  }
};

module.exports = logger;


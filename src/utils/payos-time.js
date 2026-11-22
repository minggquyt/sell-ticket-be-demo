const DEFAULT_CONFIRM_WINDOW_SECONDS = 30;
const VN_LOCAL_DATETIME_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/;

/**
 * Parse chuỗi thời gian giao dịch PayOS về Date hợp lệ (hoặc null nếu không hợp lệ).
 * PayOS thường trả "YYYY-MM-DD HH:mm:ss" theo giờ Việt Nam (+07:00) không kèm offset.
 */
function parseStrictPayOSTransactionTime(raw) {
  if (raw === null || raw === undefined) return null;

  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : new Date(raw.getTime());
  }

  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const d = raw < 1e12 ? new Date(raw * 1000) : new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    const normalized = VN_LOCAL_DATETIME_RE.test(trimmed)
      ? `${trimmed.replace(' ', 'T')}+07:00`
      : trimmed;
    const d = new Date(normalized);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  return null;
}

/**
 * Chuẩn hóa transactionDateTime từ PayOS về Date (fallback now nếu thiếu/sai định dạng).
 */
function parsePayOSTransactionTime(raw) {
  return parseStrictPayOSTransactionTime(raw) || new Date();
}

/**
 * Lấy thời điểm thanh toán muộn nhất trong mảng transactions của PayOS.
 */
function extractLatestPaidAt(transactions) {
  if (!Array.isArray(transactions) || transactions.length === 0) {
    return null;
  }

  let latest = null;
  for (const tx of transactions) {
    if (!tx) continue;
    const parsed = parseStrictPayOSTransactionTime(tx.transactionDateTime);
    if (!parsed) continue;
    if (!latest || parsed.getTime() > latest.getTime()) {
      latest = parsed;
    }
  }
  return latest;
}

/**
 * Kiểm tra nghiêm ngặt paidAt <= expiresAt (quá 1ms cũng trả false).
 */
function isPaidWithinDeadline(paidAt, expiresAt) {
  if (!expiresAt) return true;
  const paidDate = paidAt instanceof Date ? paidAt : parsePayOSTransactionTime(paidAt);
  const expDate = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);

  if (Number.isNaN(paidDate.getTime()) || Number.isNaN(expDate.getTime())) {
    return false;
  }

  return paidDate.getTime() <= expDate.getTime();
}

/**
 * Tính các mốc thời gian và pha checkout chuẩn cho một đơn hàng.
 * - WAITING: đang trong 120s quét QR
 * - CONFIRMING: quá 120s nhưng còn trong cửa sổ 30s chờ webhook (120..150s)
 * - FINAL: trạng thái kết thúc
 */
function computeOrderTiming(
  expiresAt,
  status = 'PAYMENT_PROCESSING',
  now = new Date(),
  confirmWindowSeconds = DEFAULT_CONFIRM_WINDOW_SECONDS,
) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowMs = Number.isNaN(nowDate.getTime()) ? Date.now() : nowDate.getTime();

  const expDate = expiresAt ? new Date(expiresAt) : null;
  const expiresMs = expDate && !Number.isNaN(expDate.getTime()) ? expDate.getTime() : null;
  const confirmUntilMs =
    expiresMs !== null ? expiresMs + Number(confirmWindowSeconds || DEFAULT_CONFIRM_WINDOW_SECONDS) * 1000 : null;

  const isPastExpiresAt = expiresMs !== null && nowMs >= expiresMs;
  const isPastConfirmUntil = confirmUntilMs !== null && nowMs >= confirmUntilMs;
  const normalizedStatus = status || 'PAYMENT_PROCESSING';

  let phase = 'FINAL';
  if (normalizedStatus === 'PAYMENT_PROCESSING') {
    phase = isPastExpiresAt ? 'CONFIRMING' : 'WAITING';
  }

  return {
    expiresAt: expiresMs !== null ? new Date(expiresMs).toISOString() : null,
    confirmUntil: confirmUntilMs !== null ? new Date(confirmUntilMs).toISOString() : null,
    serverTime: new Date(nowMs).toISOString(),
    phase,
    isPastExpiresAt,
    isPastConfirmUntil,
  };
}

module.exports = {
  DEFAULT_CONFIRM_WINDOW_SECONDS,
  parsePayOSTransactionTime,
  extractLatestPaidAt,
  isPaidWithinDeadline,
  computeOrderTiming,
};

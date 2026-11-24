let SSE_HEARTBEAT_INTERVAL_MS = 15 * 1000;
let SSE_ORDER_MAX_DURATION_MS = 180 * 1000;

try {
  const constants = require('../config/constants');
  if (Number.isFinite(constants.SSE_HEARTBEAT_INTERVAL_MS)) {
    SSE_HEARTBEAT_INTERVAL_MS = constants.SSE_HEARTBEAT_INTERVAL_MS;
  }
  if (Number.isFinite(constants.SSE_ORDER_MAX_DURATION_MS)) {
    SSE_ORDER_MAX_DURATION_MS = constants.SSE_ORDER_MAX_DURATION_MS;
  }
} catch {
  // Cho phép test unit không cần nạp .env / JWT_SECRET
}

const MAX_CONNECTIONS_PER_ORDER = 5;

function formatSseFrame(eventName, payload) {
  return `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function safeWrite(res, chunk) {
  if (!res || res.writableEnded || res.destroyed) return false;
  try {
    res.write(chunk);
    return true;
  } catch {
    return false;
  }
}

function safeEnd(res) {
  if (!res || res.writableEnded || res.destroyed) return;
  try {
    res.end();
  } catch {
    // Bỏ qua lỗi khi socket đã đóng trước đó
  }
}

/**
 * Hub Pub/Sub trong bộ nhớ cho các kết nối SSE theo dõi trạng thái từng đơn hàng.
 */
class PaymentEventHub {
  constructor(options = {}) {
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? SSE_HEARTBEAT_INTERVAL_MS;
    this.maxDurationMs = options.maxDurationMs ?? SSE_ORDER_MAX_DURATION_MS;
    this.maxConnectionsPerOrder = options.maxConnectionsPerOrder ?? MAX_CONNECTIONS_PER_ORDER;
    this.subscribersByOrder = new Map();
  }

  subscribe(orderCode, res, initialPayload) {
    const numericCode = Number(orderCode);
    if (!Number.isInteger(numericCode) || numericCode <= 0 || !res) {
      return () => {};
    }

    const wroteInit = safeWrite(res, formatSseFrame('init', initialPayload));
    if (!wroteInit) {
      safeEnd(res);
      return () => {};
    }

    const initialStatus = initialPayload?.status;
    if (initialStatus && initialStatus !== 'PAYMENT_PROCESSING') {
      safeEnd(res);
      return () => {};
    }

    let set = this.subscribersByOrder.get(numericCode);
    if (!set) {
      set = new Set();
      this.subscribersByOrder.set(numericCode, set);
    }

    // Giới hạn tối đa số kết nối đồng thời trên mỗi đơn để tránh rò rỉ tài nguyên
    while (set.size >= this.maxConnectionsPerOrder) {
      const oldest = set.values().next().value;
      if (!oldest) break;
      oldest.cleanup();
      safeEnd(oldest.res);
    }

    const entry = {
      res,
      heartbeatTimer: null,
      maxDurationTimer: null,
      cleaned: false,
      cleanup: () => {},
    };

    const cleanup = () => {
      if (entry.cleaned) return;
      entry.cleaned = true;
      if (entry.heartbeatTimer) {
        clearInterval(entry.heartbeatTimer);
        entry.heartbeatTimer = null;
      }
      if (entry.maxDurationTimer) {
        clearTimeout(entry.maxDurationTimer);
        entry.maxDurationTimer = null;
      }
      const currentSet = this.subscribersByOrder.get(numericCode);
      if (currentSet) {
        currentSet.delete(entry);
        if (currentSet.size === 0) {
          this.subscribersByOrder.delete(numericCode);
        }
      }
    };

    entry.cleanup = cleanup;

    entry.heartbeatTimer = setInterval(() => {
      if (!safeWrite(res, ': heartbeat\n\n')) {
        cleanup();
        safeEnd(res);
      }
    }, this.heartbeatIntervalMs);
    entry.heartbeatTimer.unref?.();

    entry.maxDurationTimer = setTimeout(() => {
      cleanup();
      safeEnd(res);
    }, this.maxDurationMs);
    entry.maxDurationTimer.unref?.();

    set.add(entry);
    return cleanup;
  }

  emitOrderUpdate(orderCode, payload) {
    const numericCode = Number(orderCode);
    const set = this.subscribersByOrder.get(numericCode);
    if (!set || set.size === 0) return 0;

    const frame = formatSseFrame('order_status', payload);
    const isTerminal = Boolean(payload?.status && payload.status !== 'PAYMENT_PROCESSING');
    const entries = [...set];
    let delivered = 0;

    for (const entry of entries) {
      const ok = safeWrite(entry.res, frame);
      if (!ok) {
        entry.cleanup();
        safeEnd(entry.res);
        continue;
      }
      delivered += 1;
      if (isTerminal) {
        entry.cleanup();
        safeEnd(entry.res);
      }
    }

    return delivered;
  }

  getSubscriberCount(orderCode) {
    return this.subscribersByOrder.get(Number(orderCode))?.size || 0;
  }

  closeAll() {
    for (const set of this.subscribersByOrder.values()) {
      for (const entry of [...set]) {
        entry.cleanup();
        safeEnd(entry.res);
      }
    }
    this.subscribersByOrder.clear();
  }
}

const paymentEvents = new PaymentEventHub();
paymentEvents.PaymentEventHub = PaymentEventHub;
paymentEvents.MAX_CONNECTIONS_PER_ORDER = MAX_CONNECTIONS_PER_ORDER;
paymentEvents.formatSseFrame = formatSseFrame;

module.exports = paymentEvents;

const { computeOrderTiming } = require('../utils/payos-time');

// ============ REQUEST DTOs ============

class CheckoutRequestDTO {
  constructor(body = {}) {
    this.seatIds = body.seatIds;
    this.returnUrl = body.returnUrl;
    this.cancelUrl = body.cancelUrl;
  }

  validate() {
    const errors = [];

    if (!this.seatIds) {
      errors.push('seatIds là bắt buộc.');
    } else if (!Array.isArray(this.seatIds)) {
      errors.push('seatIds phải là mảng.');
    } else if (this.seatIds.length === 0) {
      errors.push('seatIds không được rỗng.');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  toServiceInput() {
    return {
      seatIds: this.seatIds,
      returnUrl: this.returnUrl,
      cancelUrl: this.cancelUrl,
    };
  }
}

// ============ RESPONSE DTOs ============

class CheckoutResponseDTO {
  constructor(result) {
    this.success = true;
    this.message = 'Khởi tạo thanh toán thành công!';
    const timing = computeOrderTiming(
      result.expiresAt || result.paymentTimeout,
      'PAYMENT_PROCESSING',
    );
    this.data = {
      orderCode: Number(result.orderCode),
      totalAmount: Number(result.totalAmount),
      expiresAt: result.expiresAt || timing.expiresAt,
      confirmUntil: result.confirmUntil || timing.confirmUntil,
      paymentTimeout: result.paymentTimeout || result.expiresAt || timing.expiresAt,
      expiredAt: result.expiredAt,
      serverTime: result.serverTime || timing.serverTime,
      paymentInfo: result.paymentInfo || null,
    };
  }

  toJSON() {
    return {
      success: this.success,
      message: this.message,
      data: this.data
    };
  }
}

class OrderItemDTO {
  constructor(item) {
    this.seatId = item.seat_id;
    this.seatNumber = item.seat_number;
    this.zoneName = item.zone_name;
    this.price = Number(item.price);
  }

  toJSON() {
    return {
      ...(this.seatId ? { seatId: this.seatId } : {}),
      seatNumber: this.seatNumber,
      zoneName: this.zoneName,
      price: this.price
    };
  }
}

class OrderPaymentResponseDTO {
  constructor(order, now = new Date()) {
    const status = order.order_status || order.status;
    const timing = computeOrderTiming(order.expires_at, status, now);

    this.success = true;
    this.data = {
      orderCode: Number(order.order_code),
      status,
      phase: timing.phase,
      totalAmount: Number(order.total_amount),
      expiresAt: timing.expiresAt,
      confirmUntil: timing.confirmUntil,
      serverTime: timing.serverTime,
      createdAt: order.created_at || null,
      paymentInfo: status === 'PAYMENT_PROCESSING' ? (order.payment_info || null) : null,
      eventId: order.event_id || null,
      eventTitle: order.event_title || null,
      eventType: order.event_type || null,
      eventStartTime: order.event_start_time || null,
      location: order.location || null,
      items: (order.items || []).map((item) => new OrderItemDTO(item).toJSON()),
    };
  }

  toJSON() {
    return {
      success: this.success,
      data: this.data,
    };
  }
}

class OrderHistoryItemDTO {
  constructor(order, now = new Date()) {
    this.orderCode = Number(order.order_code);
    this.totalAmount = order.total_amount;
    this.status = order.order_status || order.status;
    const timing = computeOrderTiming(order.expires_at, this.status, now);
    this.expiresAt = order.expires_at || timing.expiresAt || null;
    this.confirmUntil = timing.confirmUntil;
    this.phase = timing.phase;
    this.checkoutUrl = this.status === 'PAYMENT_PROCESSING' ? (order.checkout_url || null) : null;
    this.createdAt = order.created_at;
    this.eventId = order.event_id || null;
    this.eventTitle = order.event_title;
    this.eventType = order.event_type;
    this.eventStartTime = order.event_start_time || null;
    this.location = order.location;
    this.customerName = order.customer_name || null;
    this.customerEmail = order.customer_email || null;
    this.items = (order.items || []).map(item => new OrderItemDTO(item).toJSON());
    // Hoàn tiền thủ công VietQR: TT ngân hàng hiện tại của khách, cờ "Sai TK", snapshot đã hoàn
    this.refundBank = order.bank_account_no
      ? {
          bankBin: order.bank_bin || null,
          bankShortName: order.bank_short_name || null,
          bankName: order.bank_name || null,
          bankLogo: order.bank_logo || null,
          bankAccountNo: order.bank_account_no,
          bankAccountName: order.bank_account_name || null,
        }
      : null;
    this.refundBankError = order.refund_bank_error || null;
    this.refundSnapshot = order.refund_snapshot || null;
  }

  toJSON() {
    return {
      refundBank: this.refundBank,
      refundBankError: this.refundBankError,
      refundSnapshot: this.refundSnapshot,
      orderCode: this.orderCode,
      totalAmount: this.totalAmount,
      status: this.status,
      expiresAt: this.expiresAt,
      confirmUntil: this.confirmUntil,
      phase: this.phase,
      checkoutUrl: this.checkoutUrl,
      createdAt: this.createdAt,
      eventId: this.eventId,
      eventTitle: this.eventTitle,
      eventType: this.eventType,
      eventStartTime: this.eventStartTime,
      location: this.location,
      ...(this.customerName ? { customerName: this.customerName } : {}),
      ...(this.customerEmail ? { customerEmail: this.customerEmail } : {}),
      items: this.items
    };
  }
}

class OrderHistoryResponseDTO {
  constructor(orders) {
    this.success = true;
    this.data = orders.map(order => new OrderHistoryItemDTO(order).toJSON());
  }

  toJSON() {
    return {
      success: this.success,
      data: this.data
    };
  }
}

class OrderStatusResponseDTO {
  constructor(order, now = new Date()) {
    const status = order.order_status || order.status;
    const timing = computeOrderTiming(order.expires_at, status, now);

    this.success = true;
    this.data = {
      orderCode: Number(order.order_code),
      status,
      phase: timing.phase,
      checkoutUrl: status === 'PAYMENT_PROCESSING' ? (order.checkout_url || null) : null,
      totalAmount: Number(order.total_amount),
      expiresAt: timing.expiresAt || order.expires_at,
      confirmUntil: timing.confirmUntil,
      serverTime: timing.serverTime,
      createdAt: order.created_at,
      eventId: order.event_id,
      eventTitle: order.event_title,
      eventType: order.event_type,
      eventStartTime: order.event_start_time || null,
      location: order.location,
      items: (order.items || []).map(item => new OrderItemDTO(item).toJSON())
    };
  }

  toJSON() {
    return {
      success: this.success,
      data: this.data
    };
  }
}

class ErrorResponseDTO {
  constructor(message) {
    this.success = false;
    this.message = message;
  }

  toJSON() {
    return {
      success: this.success,
      message: this.message
    };
  }
}

module.exports = {
  // Request DTOs
  CheckoutRequestDTO,
  // Response DTOs
  CheckoutResponseDTO,
  OrderPaymentResponseDTO,
  OrderHistoryResponseDTO,
  OrderHistoryItemDTO,
  OrderStatusResponseDTO,
  OrderItemDTO,
  ErrorResponseDTO
};

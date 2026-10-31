// ============ REQUEST DTOs ============

class CheckoutRequestDTO {
  constructor(body = {}) {
    this.seatIds = body.seatIds;
    this.returnUrl = body.returnUrl;
    this.cancelUrl = body.cancelUrl;
    this.phone = body.phone;
    this.citizenId = body.citizenId;
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

    const normalizedPhone = this.phone !== undefined && this.phone !== null ? String(this.phone).trim() : '';
    const normalizedCitizenId = this.citizenId !== undefined && this.citizenId !== null ? String(this.citizenId).trim() : '';

    if (!normalizedPhone) {
      errors.push('phone là bắt buộc.');
    } else if (!/^(0|\+84)\d{9,10}$/.test(normalizedPhone.replace(/\s+/g, ''))) {
      errors.push('phone không hợp lệ. Ví dụ: 0901234567 hoặc +84901234567.');
    }

    if (!normalizedCitizenId) {
      errors.push('citizenId là bắt buộc.');
    } else if (!/^\d{12}$/.test(normalizedCitizenId)) {
      errors.push('citizenId phải là 12 chữ số CCCD hợp lệ.');
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
      phone: this.phone !== undefined && this.phone !== null ? String(this.phone).trim() : '',
      citizenId: this.citizenId !== undefined && this.citizenId !== null ? String(this.citizenId).trim() : ''
    };
  }
}

// ============ RESPONSE DTOs ============

class CheckoutResponseDTO {
  constructor(result) {
    this.success = true;
    this.message = 'Khởi tạo thanh toán PayOS thành công!';
    this.data = {
      orderCode: Number(result.orderCode),
      checkoutUrl: result.checkoutUrl,
      totalAmount: result.totalAmount,
      paymentTimeout: result.paymentTimeout,
      expiredAt: result.expiredAt
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

class OrderHistoryItemDTO {
  constructor(order) {
    this.orderCode = Number(order.order_code);
    this.totalAmount = order.total_amount;
    this.status = order.order_status || order.status;
    this.createdAt = order.created_at;
    this.eventId = order.event_id || null;
    this.eventTitle = order.event_title;
    this.eventType = order.event_type;
    this.location = order.location;
    this.customerName = order.customer_name || null;
    this.customerEmail = order.customer_email || null;
    this.customerPhone = order.phone || order.customer_phone || null;
    this.customerCitizenId = order.citizen_id || order.citizenId || null;
    this.items = (order.items || []).map(item => new OrderItemDTO(item).toJSON());
  }

  toJSON() {
    return {
      orderCode: this.orderCode,
      totalAmount: this.totalAmount,
      status: this.status,
      createdAt: this.createdAt,
      eventId: this.eventId,
      eventTitle: this.eventTitle,
      eventType: this.eventType,
      location: this.location,
      ...(this.customerName ? { customerName: this.customerName } : {}),
      ...(this.customerEmail ? { customerEmail: this.customerEmail } : {}),
      ...(this.customerPhone ? { customerPhone: this.customerPhone, phone: this.customerPhone } : {}),
      ...(this.customerCitizenId ? { customerCitizenId: this.customerCitizenId, citizenId: this.customerCitizenId } : {}),
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
  constructor(order) {
    this.success = true;
    this.data = {
      orderCode: Number(order.order_code),
      status: order.order_status,
      totalAmount: Number(order.total_amount),
      expiresAt: order.expires_at,
      createdAt: order.created_at,
      eventId: order.event_id,
      eventTitle: order.event_title,
      eventType: order.event_type,
      location: order.location,
      ...(order.phone || order.customer_phone ? { customerPhone: order.phone || order.customer_phone, phone: order.phone || order.customer_phone } : {}),
      ...(order.citizen_id || order.citizenId ? { customerCitizenId: order.citizen_id || order.citizenId, citizenId: order.citizen_id || order.citizenId } : {}),
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
  OrderHistoryResponseDTO,
  OrderHistoryItemDTO,
  OrderStatusResponseDTO,
  OrderItemDTO,
  ErrorResponseDTO
};

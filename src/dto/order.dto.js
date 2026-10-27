// ============ REQUEST DTOs ============

class CheckoutRequestDTO {
  constructor(body) {
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
      cancelUrl: this.cancelUrl
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

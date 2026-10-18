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
      orderId: result.orderId,
      orderCode: result.orderCode,
      checkoutUrl: result.checkoutUrl,
      totalAmount: result.totalAmount,
      paymentTimeout: result.paymentTimeout
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
    this.seatNumber = item.seat_number;
    this.zoneName = item.zone_name;
    this.price = item.price;
  }

  toJSON() {
    return {
      seatNumber: this.seatNumber,
      zoneName: this.zoneName,
      price: this.price
    };
  }
}

class OrderHistoryItemDTO {
  constructor(order) {
    this.orderId = order.order_id;
    this.totalAmount = order.total_amount;
    this.orderStatus = order.order_status;
    this.createdAt = order.created_at;
    this.eventTitle = order.event_title;
    this.eventType = order.event_type;
    this.location = order.location;
    this.items = order.items.map(item => new OrderItemDTO(item).toJSON());
  }

  toJSON() {
    return {
      orderId: this.orderId,
      totalAmount: this.totalAmount,
      orderStatus: this.orderStatus,
      createdAt: this.createdAt,
      eventTitle: this.eventTitle,
      eventType: this.eventType,
      location: this.location,
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
  OrderItemDTO,
  ErrorResponseDTO
};

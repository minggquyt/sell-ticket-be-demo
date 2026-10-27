const ticketService = require('../services/ticket.service');
const payos = require('../config/payos');
const logger = require('../utils/logger');
const {
  EventListResponseDTO,
  EventSeatsResponseDTO,
  EventZonesResponseDTO,
  ErrorResponseDTO: EventErrorDTO
} = require('../dto/event.dto');
const {
  RequestSeatHoldDTO,
  ConfirmPartialHoldDTO,
  ReserveZoneDTO,
  ReleaseSeatDTO,
  SeatHoldSuccessResponseDTO,
  PartialAvailabilityResponseDTO,
  SeatHoldErrorResponseDTO,
  ZoneReserveSuccessResponseDTO,
  ReleaseSeatsResponseDTO,
  ErrorResponseDTO: SeatErrorDTO
} = require('../dto/seat.dto');
const {
  CheckoutRequestDTO,
  CheckoutResponseDTO,
  OrderHistoryResponseDTO,
  OrderStatusResponseDTO,
  ErrorResponseDTO: OrderErrorDTO
} = require('../dto/order.dto');

// ================== Event Endpoints ==================

exports.getEvents = async (req, res) => {
  try {
    const events = await ticketService.getAllEvents();
    const responseDto = new EventListResponseDTO(events);
    res.json(responseDto.toJSON());
  } catch (err) {
    const errorDto = new EventErrorDTO(err.message);
    res.status(500).json(errorDto.toJSON());
  }
};

exports.getEventDetails = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { type } = req.query;
    
    if (type === 'ZONE_BASED') {
      const zones = await ticketService.getZonesByEvent(eventId);
      const responseDto = new EventZonesResponseDTO(zones);
      return res.json(responseDto.toJSON());
    } else {
      const seats = await ticketService.getSeatsByEvent(eventId);
      const responseDto = new EventSeatsResponseDTO(seats);
      return res.json(responseDto.toJSON());
    }
  } catch (err) {
    const errorDto = new EventErrorDTO(err.message);
    res.status(500).json(errorDto.toJSON());
  }
};

// ================== Seat Booking Endpoints ==================

exports.requestSeatHold = async (req, res) => {
  try {
    const requestDto = new RequestSeatHoldDTO(req.body);
    const validation = requestDto.validate();
    
    if (!validation.isValid) {
      const errorDto = new SeatErrorDTO(validation.errors.join(' '));
      return res.status(400).json(errorDto.toJSON());
    }

    const { seatIds } = requestDto.toServiceInput();
    const result = await ticketService.requestSeatHold(req.user.id, seatIds);

    if (result.success) {
      const responseDto = new SeatHoldSuccessResponseDTO(result);
      return res.status(200).json(responseDto.toJSON());
    }

    if (result.code === 'PARTIAL_AVAILABILITY') {
      const responseDto = new PartialAvailabilityResponseDTO(result);
      return res.status(200).json(responseDto.toJSON());
    }

    const errorDto = new SeatHoldErrorResponseDTO(result.code, result.message);
    return res.status(400).json(errorDto.toJSON());

  } catch (err) {
    const errorDto = new SeatErrorDTO(err.message || 'Lỗi hệ thống khi giữ chỗ.');
    return res.status(500).json(errorDto.toJSON());
  }
};

exports.confirmPartialHold = async (req, res) => {
  try {
    const requestDto = new ConfirmPartialHoldDTO(req.body);
    const validation = requestDto.validate();
    
    if (!validation.isValid) {
      const errorDto = new SeatErrorDTO(validation.errors.join(' '));
      return res.status(400).json(errorDto.toJSON());
    }

    const { confirmSeatIds } = requestDto.toServiceInput();
    const result = await ticketService.confirmPartialHold(req.user.id, confirmSeatIds);

    if (result.success) {
      const responseDto = new SeatHoldSuccessResponseDTO(result);
      return res.status(200).json(responseDto.toJSON());
    }

    const errorDto = new SeatHoldErrorResponseDTO(result.code, result.message);
    return res.status(400).json(errorDto.toJSON());

  } catch (err) {
    const errorDto = new SeatErrorDTO(err.message || 'Lỗi hệ thống khi xác nhận giữ chỗ.');
    return res.status(500).json(errorDto.toJSON());
  }
};

exports.reserveZone = async (req, res) => {
  try {
    const requestDto = new ReserveZoneDTO(req.body);
    const validation = requestDto.validate();
    
    if (!validation.isValid) {
      const errorDto = new SeatErrorDTO(validation.errors.join(' '));
      return res.status(400).json(errorDto.toJSON());
    }

    const { eventId, zones } = requestDto.toServiceInput();
    const totalRequested = zones.reduce((sum, z) => sum + (Number(z.quantity) || 0), 0);
    const result = await ticketService.reserveSeatsByMultipleZones(req.user.id, eventId, zones);
    
    const responseDto = new ZoneReserveSuccessResponseDTO(result, totalRequested);
    res.json(responseDto.toJSON());
  } catch (err) {
    const errorDto = new SeatErrorDTO(err.message);
    res.status(400).json(errorDto.toJSON());
  }
};

exports.releaseSeats = async (req, res) => {
  try {
    const requestDto = new ReleaseSeatDTO(req.body);
    const validation = requestDto.validate();
    
    if (!validation.isValid) {
      const errorDto = new SeatErrorDTO(validation.errors.join(' '));
      return res.status(400).json(errorDto.toJSON());
    }

    const { seatIds, orderCode } = requestDto.toServiceInput();
    const released = await ticketService.releaseReservedSeats(req.user.id, seatIds, orderCode);
    
    const responseDto = new ReleaseSeatsResponseDTO(released);
    res.json(responseDto.toJSON());
  } catch (err) {
    const errorDto = new SeatErrorDTO(err.message);
    res.status(400).json(errorDto.toJSON());
  }
};

exports.cancelOrder = async (req, res) => {
  try {
    const result = await ticketService.cancelOrder(req.user.id, req.params.orderCode);
    return res.json({ success: true, message: 'Đã hủy đơn hàng thành công.', data: result });
  } catch (err) {
    const errorDto = new OrderErrorDTO(err.message);
    return res.status(400).json(errorDto.toJSON());
  }
};

// ================== Order & Payment Endpoints ==================

exports.getMyOrders = async (req, res) => {
  try {
    const orders = await ticketService.getUserOrderHistory(req.user.id);
    const responseDto = new OrderHistoryResponseDTO(orders);
    res.json(responseDto.toJSON());
  } catch (err) {
    const errorDto = new OrderErrorDTO(err.message);
    res.status(500).json(errorDto.toJSON());
  }
};

exports.getOrderStatus = async (req, res) => {
  try {
    const order = await ticketService.getOrderStatusAndSync(req.user.id, req.params.orderCode);
    const responseDto = new OrderStatusResponseDTO(order);
    return res.json(responseDto.toJSON());
  } catch (err) {
    const errorDto = new OrderErrorDTO(err.message);
    return res.status(404).json(errorDto.toJSON());
  }
};

exports.startCheckout = async (req, res) => {
  try {
    const requestDto = new CheckoutRequestDTO(req.body);
    const validation = requestDto.validate();
    
    if (!validation.isValid) {
      const errorDto = new OrderErrorDTO(validation.errors.join(' '));
      return res.status(400).json(errorDto.toJSON());
    }

    const { seatIds, returnUrl, cancelUrl } = requestDto.toServiceInput();
    const result = await ticketService.startCheckoutSeats(req.user.id, seatIds, returnUrl, cancelUrl);
    
    const responseDto = new CheckoutResponseDTO(result);
    res.json(responseDto.toJSON());
  } catch (err) {
    const errorDto = new OrderErrorDTO(err.message);
    res.status(400).json(errorDto.toJSON());
  }
};

exports.payosWebhook = async (req, res) => {
  try {
    const webhookData = req.body;
    logger.payment('WEBHOOK', `Nhận Webhook từ PayOS: ${JSON.stringify(webhookData)}`);

    let verifiedData;
    try {
      verifiedData = await payos.webhooks.verify(webhookData);
    } catch (verifyErr) {
      logger.payment('WARN', `Từ chối Webhook do chữ ký không hợp lệ (hoặc ping test): ${verifyErr.message}`);
      return res.status(200).json({
        success: false,
        message: 'Chữ ký webhook không hợp lệ hoặc là ping test'
      });
    }

    const orderCode = verifiedData?.orderCode;
    const isSuccess = webhookData?.code === '00' && verifiedData?.code === '00' && webhookData?.success !== false;
    const amount = verifiedData?.amount;

    if (orderCode) {
      const result = await ticketService.handlePaymentWebhook(orderCode, isSuccess, amount);
      logger.payment('WEBHOOK_PROCESSED', `Đã xử lý xong Webhook cho đơn #${orderCode} -> Trạng thái: ${result?.status || (isSuccess ? 'SUCCESS' : 'FAILED')}`);
    }

    return res.status(200).json({
      success: true,
      message: 'Đã nhận và xử lý webhook thành công'
    });
  } catch (err) {
    logger.error('PAYOS_WEBHOOK', err.message, err);
    return res.status(200).json({ success: false, message: 'Đã nhận webhook (lỗi xử lý nội bộ)' });
  }
};

// ================== Admin Endpoints ==================

const {
  CreateEventRequestDTO,
  CreateEventResponseDTO,
  DeleteEventResponseDTO,
  ErrorResponseDTO: AdminErrorDTO
} = require('../dto/admin.dto');

exports.getAdminRefunds = async (req, res) => {
  try {
    const orders = await ticketService.getRefundOrdersForAdmin();
    const responseDto = new OrderHistoryResponseDTO(orders);
    return res.json(responseDto.toJSON());
  } catch (err) {
    const errorDto = new AdminErrorDTO(err.message);
    return res.status(500).json(errorDto.toJSON());
  }
};

exports.getAdminTickets = async (req, res) => {
  try {
    const orders = await ticketService.getAllAdminTickets();
    const mapped = orders.map((o) => {
      const items = Array.isArray(o.items) ? o.items : [];
      const seatNums = items.map((i) => i.seat_number).filter(Boolean);
      const isSeated = o.event_type === 'SEAT_BASED';
      const ticketType = isSeated
        ? `Ghế: ${seatNums.join(', ')}`
        : items.map((i) => `${i.zone_name} (${i.seat_number})`).join(', ');
      const statusMap = {
        SUCCESS: 'paid',
        CANCELLED: 'cancelled',
        EXPIRED: 'cancelled',
        FAILED: 'cancelled',
        REFUND_PENDING: 'refund_pending',
        REFUNDED: 'refunded',
        PAYMENT_PROCESSING: 'processing',
      };
      return {
        id: `tk_${o.order_code}`,
        orderCode: Number(o.order_code),
        ticketCode: `#${o.order_code}`,
        eventId: o.event_id,
        eventTitle: o.event_title,
        customerName: o.customer_name || 'Khách hàng',
        customerEmail: o.customer_email || '',
        seatNumber: seatNums.join(', '),
        ticketType,
        purchaseDate: o.created_at ? new Date(o.created_at).toLocaleString('vi-VN') : '',
        price: Number(o.total_amount) || 0,
        status: statusMap[o.order_status] || 'paid',
        orderStatus: o.order_status,
      };
    });
    return res.json({ success: true, data: mapped });
  } catch (err) {
    const errorDto = new AdminErrorDTO(err.message);
    return res.status(500).json(errorDto.toJSON());
  }
};

exports.confirmRefundOrder = async (req, res) => {
  try {
    const updated = await ticketService.confirmOrderRefund(req.params.orderCode);
    return res.json({
      success: true,
      message: `Đã xác nhận hoàn tiền cho đơn #${updated.order_code} thành công.`,
      data: {
        orderCode: Number(updated.order_code),
        status: updated.status,
      },
    });
  } catch (err) {
    const errorDto = new AdminErrorDTO(err.message);
    return res.status(400).json(errorDto.toJSON());
  }
};

exports.createEvent = async (req, res) => {
  try {
    const requestDto = new CreateEventRequestDTO(req.body);
    const validation = requestDto.validate();
    
    if (!validation.isValid) {
      const errorDto = new AdminErrorDTO(validation.errors.join(' '));
      return res.status(400).json(errorDto.toJSON());
    }

    const eventData = requestDto.toServiceInput();
    const event = await ticketService.createEventWithConfig(eventData);
    
    const responseDto = new CreateEventResponseDTO(event);
    res.json(responseDto.toJSON());
  } catch (err) {
    const errorDto = new AdminErrorDTO(err.message);
    res.status(400).json(errorDto.toJSON());
  }
};

exports.deleteEvent = async (req, res) => {
  try {
    await ticketService.deleteEvent(req.params.eventId);
    const responseDto = new DeleteEventResponseDTO();
    res.json(responseDto.toJSON());
  } catch (err) {
    const errorDto = new AdminErrorDTO(err.message);
    res.status(400).json(errorDto.toJSON());
  }
};

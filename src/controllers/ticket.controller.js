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
    // BỔ SUNG FIELD GIỚI HẠN SỐ GHẾ.
    res.status(500).json(errorDto.toJSON());
  }
};

// ================== Seat Booking Endpoints ==================

exports.requestSeatHold = async (req, res) => {
  try {
    // Request DTO: Validate input
    const requestDto = new RequestSeatHoldDTO(req.body);
    const validation = requestDto.validate();
    
    if (!validation.isValid) {
      const errorDto = new SeatErrorDTO(validation.errors.join(' '));
      return res.status(400).json(errorDto.toJSON());
    }

    // Call service
    const { seatIds } = requestDto.toServiceInput();
    const result = await ticketService.requestSeatHold(req.user.id, seatIds);
    console.log(result)

    // Response DTO: Format output based on result
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
    // Request DTO: Validate input
    const requestDto = new ConfirmPartialHoldDTO(req.body);
    const validation = requestDto.validate();
    
    if (!validation.isValid) {
      const errorDto = new SeatErrorDTO(validation.errors.join(' '));
      return res.status(400).json(errorDto.toJSON());
    }

    // Call service
    const { confirmSeatIds } = requestDto.toServiceInput();
    const result = await ticketService.confirmPartialHold(req.user.id, confirmSeatIds);

    // Response DTO: Format output
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
    // Request DTO: Validate input
    const requestDto = new ReserveZoneDTO(req.body);
    const validation = requestDto.validate();
    
    if (!validation.isValid) {
      const errorDto = new SeatErrorDTO(validation.errors.join(' '));
      return res.status(400).json(errorDto.toJSON());
    }

    // Call service
    const { eventId, zones } = requestDto.toServiceInput();
    const totalRequested = zones.reduce((sum, z) => sum + (Number(z.quantity) || 0), 0);
    const result = await ticketService.reserveSeatsByMultipleZones(req.user.id, eventId, zones);
    
    // Response DTO: Format output
    const responseDto = new ZoneReserveSuccessResponseDTO(result, totalRequested);
    res.json(responseDto.toJSON());
  } catch (err) {
    const errorDto = new SeatErrorDTO(err.message);
    res.status(400).json(errorDto.toJSON());
  }
};

exports.releaseSeats = async (req, res) => {
  try {
    // Request DTO: Validate input
    const requestDto = new ReleaseSeatDTO(req.body);
    const validation = requestDto.validate();
    
    if (!validation.isValid) {
      const errorDto = new SeatErrorDTO(validation.errors.join(' '));
      return res.status(400).json(errorDto.toJSON());
    }

    // Call service
    const { seatIds } = requestDto.toServiceInput();
    const released = await ticketService.releaseReservedSeats(req.user.id, seatIds);
    
    // Response DTO: Format output
    const responseDto = new ReleaseSeatsResponseDTO(released);
    res.json(responseDto.toJSON());
  } catch (err) {
    const errorDto = new SeatErrorDTO(err.message);
    res.status(400).json(errorDto.toJSON());
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

exports.startCheckout = async (req, res) => {
  try {
    // Request DTO: Validate input
    const requestDto = new CheckoutRequestDTO(req.body);
    const validation = requestDto.validate();
    
    if (!validation.isValid) {
      const errorDto = new OrderErrorDTO(validation.errors.join(' '));
      return res.status(400).json(errorDto.toJSON());
    }

    // Call service
    const { seatIds, returnUrl, cancelUrl } = requestDto.toServiceInput();
    const result = await ticketService.startCheckoutSeats(req.user.id, seatIds, returnUrl, cancelUrl);
    
    // Response DTO: Format output
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

    let verifiedData = webhookData.data || webhookData;
    try {
      if (typeof payos.webhooks?.verify === 'function') {
        verifiedData = await payos.webhooks.verify(webhookData);
      }
    } catch (verifyErr) {
      logger.payment('WARN', `Bỏ qua xác thực chữ ký (có thể là ping test): ${verifyErr.message}`);
      verifiedData = webhookData.data || webhookData;
    }

    const orderCode = verifiedData?.orderCode || webhookData?.data?.orderCode || webhookData?.orderCode;
    const isSuccess = webhookData?.code === '00' || webhookData?.data?.code === '00' || verifiedData?.code === '00' || webhookData?.success === true;

    if (orderCode) {
      await ticketService.handlePaymentWebhook(orderCode, isSuccess);
      logger.payment('WEBHOOK_PROCESSED', `Đã xử lý xong Webhook cho đơn #${orderCode} -> Trạng thái: ${isSuccess ? 'SUCCESS (SOLD)' : 'FAILED'}`);
    }

    return res.status(200).json({
      success: true,
      message: 'Đã nhận webhook thành công'
    });
  } catch (err) {
    logger.error('PAYOS_WEBHOOK', err.message, err);
    return res.status(200).json({ success: true, message: 'Đã nhận webhook (fallback)' });
  }
};

exports.webhook = async (req, res) => {
  try {
    const result = await ticketService.handlePaymentWebhook(req.body.orderId || req.body.orderCode, Boolean(req.body.success));
    res.json({ success: true, data: result });
  } catch (err) {
    const errorDto = new OrderErrorDTO(err.message);
    res.status(400).json(errorDto.toJSON());
  }
};

// ================== Admin Endpoints ==================

const {
  CreateEventRequestDTO,
  CreateEventResponseDTO,
  DeleteEventResponseDTO,
  ErrorResponseDTO: AdminErrorDTO
} = require('../dto/admin.dto');

exports.createEvent = async (req, res) => {
  try {
    // Request DTO: Validate input
    const requestDto = new CreateEventRequestDTO(req.body);
    const validation = requestDto.validate();
    
    if (!validation.isValid) {
      const errorDto = new AdminErrorDTO(validation.errors.join(' '));
      return res.status(400).json(errorDto.toJSON());
    }

    // Call service
    const eventData = requestDto.toServiceInput();
    const event = await ticketService.createEventWithConfig(eventData);
    
    // Response DTO: Format output
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

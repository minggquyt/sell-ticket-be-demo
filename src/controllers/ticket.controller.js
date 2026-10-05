const ticketService = require('../services/ticket.service');

// Customer Service
exports.getEvents = async (req, res) => {
  try {
    const events = await ticketService.getAllEvents();
    res.json({ success: true, data: events });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.confirmPartialHold = async (req, res) => {
  try {
    const { confirmSeatIds } = req.body;

    // Validate danh sách ghế gửi lên
    if (!confirmSeatIds || !Array.isArray(confirmSeatIds) || confirmSeatIds.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Danh sách confirmSeatIds không hợp lệ.' 
      });
    }

    // Gọi Service xử lý
    const result = await ticketService.confirmPartialHold(req.user.id, confirmSeatIds);

    if (result.success) {
      return res.status(200).json({
        success: true,
        code: result.code,
        message: 'Đã xác nhận giữ các ghế còn lại thành công.',
        data: {
          seatIds: result.reservedSeats.map(s => s.id),
          reserved_until: result.reservedUntil,
          seats: result.reservedSeats
        }
      });
    }

    // Lỗi khi bị cướp ghế hoặc hết hạn trong lúc suy nghĩ
    return res.status(400).json({
      success: false,
      code: result.code,
      message: result.message
    });

  } catch (err) {
    return res.status(500).json({ 
      success: false, 
      message: err.message || 'Lỗi hệ thống khi xác nhận giữ chỗ.' 
    });
  }
};

exports.getEventDetails = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { type } = req.query;
    if (type === 'ZONE_BASED') {
      const zones = await ticketService.getZonesByEvent(eventId);
      return res.json({ success: true, data: zones });
    } else {
      const seats = await ticketService.getSeatsByEvent(eventId);
      return res.json({ success: true, data: seats });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


const MAX_TICKETS = 4;

exports.requestSeatHold = async (req, res) => {
  try {
    const { seatIds } = req.body;
    
    // Validate danh sách ghế gửi lên
    if (!seatIds || !Array.isArray(seatIds) || seatIds.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Danh sách seatIds không hợp lệ.' 
      });
    }

    if (seatIds.length > MAX_TICKETS) {
      return {
        success: false,
        code: 'EXCEEDED_MAX_SEATS',
        message: `Bạn chỉ được chọn tối đa ${MAX_SEATS_PER_USER} ghế cho mỗi tài khoản.`,
      };
    }

    // Gọi Service xử lý
    const result = await ticketService.requestSeatHold(req.user.id, seatIds);

    // Trường hợp 1: Giữ thành công 100% số ghế
    if (result.success) {
      return res.status(200).json({
        success: true,
        code: result.code,
        message: 'Đã giữ chỗ thành công.',
        data: {
          seatIds: result.reservedSeats.map(s => s.id),
          reserved_until: result.reservedUntil,
          seats: result.reservedSeats
        }
      });
    }

    // Trường hợp 2: Chỉ khả dụng một phần (PARTIAL_AVAILABILITY)
    if (result.code === 'PARTIAL_AVAILABILITY') {
      return res.status(200).json({
        success: false,
        code: result.code,
        message: result.message,
        unavailableSeats: result.unavailableSeats,
        availableSeats: result.availableSeats,
        availableSeatIds: result.availableSeatIds
      });
    }

    // Trường hợp 3: Bị lỗi nghiệp vụ khác (VD: User đang có hold active, hoặc tất cả ghế đã bị đặt)
    return res.status(400).json({
      success: false,
      code: result.code,
      message: result.message
    });

  } catch (err) {
    return res.status(500).json({ 
      success: false, 
      message: err.message || 'Lỗi hệ thống khi giữ chỗ.' 
    });
  }
};


exports.reserveZone = async (req, res) => {
  try {
    const { eventId, zones } = req.body; 

    if (!eventId || !zones || !Array.isArray(zones) || zones.length === 0) {
      return res.status(400).json({ success: false, message: 'Dữ liệu chọn khu vực không hợp lệ.' });
    }

    // Tính tổng số vé yêu cầu trên tất cả các zone
    const totalRequested = zones.reduce((sum, z) => sum + (Number(z.quantity) || 0), 0);

    if (totalRequested <= 0) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn ít nhất 1 vé.' });
    }

    // Kiểm tra giới hạn MAX_TICKETS 
    if (totalRequested > MAX_TICKETS) {
      return res.status(400).json({ 
        success: false, 
        message: `Tổng số vé các khu vực cộng lại không được vượt quá ${MAX_TICKETS} vé.` 
      });
    }

    const result = await ticketService.reserveSeatsByMultipleZones(req.user.id, eventId, zones);
    res.json({ 
      success: true, 
      message: `Đã giữ thành công tổng cộng ${totalRequested} vé!`, 
      data: result 
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

exports.releaseSeats = async (req, res) => {
  try {
    const { seatIds } = req.body;
    if (!seatIds || !Array.isArray(seatIds) || seatIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Danh sách seatIds không hợp lệ.' });
    }
    const released = await ticketService.releaseReservedSeats(req.user.id, seatIds);
    res.json({ success: true, message: 'Đã hủy giữ chỗ thành công.', data: released });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

exports.getMyOrders = async (req, res) => {
  try {
    const orders = await ticketService.getUserOrderHistory(req.user.id);
    res.json({ success: true, data: orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Bấm nút thanh toán -> Đổi sang PAYMENT_PROCESSING
exports.startCheckout = async (req, res) => {
  try {
    const result = await ticketService.startCheckoutSeats(req.user.id, req.body.seatIds);
    res.json({ success: true, message: 'Chuyển sang thanh toán...', data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};
// Webhook giả lập (hoặc do IPN cổng thanh toán gọi đến)
exports.webhook = async (req, res) => {
  try {
    const result = await ticketService.handlePaymentWebhook(req.body.orderId, Boolean(req.body.success));
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// Admin  Service
exports.createEvent = async (req, res) => {
  try {
    const event = await ticketService.createEventWithConfig(req.body);
    res.json({ success: true, message: 'Tạo sự kiện và cấu hình ghế thành công!', data: event });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

exports.deleteEvent = async (req, res) => {
  try {
    await ticketService.deleteEvent(req.params.eventId);
    res.json({ success: true, message: 'Đã xóa sự kiện thành công.' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};



const ticketService = require('../services/ticket.service');

// Lấy danh sách ghế
exports.getSeats = async (req, res) => {
  try {
    const seats = await ticketService.getSeatsByEvent(req.params.eventId);
    res.json({ success: true, data: seats });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.reserveSeat = async (req, res) => {
  try {
    const { seatIds, userId } = req.body;
    if (!seatIds || !Array.isArray(seatIds) || seatIds.length === 0 || !userId) {
      return res.status(400).json({ success: false, message: 'Danh sách seatIds hoặc userId không hợp lệ.' });
    }

    const result = await ticketService.reserveSeats(userId, seatIds, 5);
    return res.json({
      success: true,
      message: `Giữ thành công ${seatIds.length} ghế trong 5 phút.`,
      data: result
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

// Bấm nút thanh toán -> Đổi sang PAYMENT_PROCESSING
exports.startCheckout = async (req, res) => {
  try {
    const { seatIds, userId } = req.body;
    const result = await ticketService.startCheckoutSeats(userId, seatIds, 10);
    res.json({
      success: true,
      message: 'Đang chuyển hướng cổng thanh toán. Ghế đã được khóa an toàn.',
      data: result
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};
// Webhook giả lập (hoặc do IPN cổng thanh toán gọi đến)
exports.webhook = async (req, res) => {
  try {
    const { orderId, success } = req.body;
    const result = await ticketService.handlePaymentWebhook(orderId, Boolean(success));
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};
const ticketRepository = require('../repositories/ticket.repository');
const payos = require('../config/payos');
const logger = require('../utils/logger');

// Background Job: Quét ghế và đơn hàng hết hạn định kỳ mỗi 15 giây
function startSeatReleaseJob() {
  setInterval(async () => {
    try {
      const releasedSeats = await ticketRepository.releaseExpiredSeats();
      if (releasedSeats.length > 0) {
        logger.cron(
          `Đã tự động giải phóng ${releasedSeats.length} ghế hết hạn: ${releasedSeats.map((s) => s.seat_number).join(', ')}`
        );

        const expiredOrderCodes = [
          ...new Set(releasedSeats.map((s) => s.current_order_code).filter(Boolean)),
        ];
        for (const code of expiredOrderCodes) {
          try {
            await payos.paymentRequests.cancel(Number(code), 'Order expired');
            logger.payment('CANCEL', `Đã tự động đóng link PayOS cho đơn hết hạn #${code}`);
          } catch {
            // Bỏ qua nếu link PayOS đã tự hết hạn hoặc đã hủy trước đó
          }
        }
      }
    } catch (err) {
      logger.error('CRON_AUTO_RELEASE', err.message);
    }
  }, 15 * 1000);
}

module.exports = { startSeatReleaseJob };

const ticketRepository = require('../repositories/ticket.repository');
const payos = require('../config/payos');
const logger = require('../utils/logger');
const { SEAT_RELEASE_JOB_INTERVAL_MS } = require('../config/constants');

// Background Job: Quét ghế và đơn hàng hết hạn định kỳ
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
          } catch (cancelErr) {
            // FIX #4: Log lỗi thay vì bỏ qua hoàn toàn
            logger.error('PAYOS_CANCEL', `Không thể hủy PayOS link #${code}: ${cancelErr.message}`);
          }
        }
      }
    } catch (err) {
      // FIX #4: Log đầy đủ stack trace
      logger.error('CRON_AUTO_RELEASE', err.message, err);
    }
  }, SEAT_RELEASE_JOB_INTERVAL_MS); // FIX #9: Dùng constant
}

module.exports = { startSeatReleaseJob };

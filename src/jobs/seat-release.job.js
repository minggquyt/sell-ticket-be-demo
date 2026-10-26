const ticketRepository = require('../repositories/ticket.repository');
const logger = require('../utils/logger');

// Background Job: Quét ghế và đơn hàng hết hạn định kỳ mỗi 60 giây
function startSeatReleaseJob() {
  setInterval(async () => {
    try {
      const releasedSeats = await ticketRepository.releaseExpiredSeats();
      if (releasedSeats.length > 0) {
        logger.cron(
          `Đã tự động giải phóng ${releasedSeats.length} ghế hết hạn: ${releasedSeats.map((s) => s.seat_number).join(', ')}`
        );
      }
    } catch (err) {
      logger.error('CRON_AUTO_RELEASE', err.message);
    }
  }, 60 * 1000);
}

module.exports = { startSeatReleaseJob };

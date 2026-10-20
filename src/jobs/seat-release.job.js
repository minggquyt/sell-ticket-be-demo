const pool = require('../config/db');
const logger = require('../utils/logger');

// Background Job: Quét ghế hết hạn định kỳ mỗi 60 giây
function startSeatReleaseJob() {
  setInterval(async () => {
    try {
      const releaseQuery = `
        UPDATE seats 
        SET status = 'AVAILABLE', reserved_by = NULL, reserved_until = NULL, current_order_id = NULL 
        WHERE status IN ('RESERVED', 'PAYMENT_PROCESSING') AND reserved_until < NOW()
        RETURNING id, seat_number;
      `;
      const res = await pool.query(releaseQuery);
      if (res.rows.length > 0) {
        logger.cron(
          `Đã tự động giải phóng ${res.rows.length} ghế hết hạn: ${res.rows.map((s) => s.seat_number).join(', ')}`
        );
      }
    } catch (err) {
      logger.error('CRON_AUTO_RELEASE', err.message);
    }
  }, 60 * 1000);
}

module.exports = { startSeatReleaseJob };

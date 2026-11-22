const ticketRepository = require('../repositories/ticket.repository');
const ticketService = require('../services/ticket.service');
const payos = require('../config/payos');
const logger = require('../utils/logger');
const {
  SEAT_RELEASE_JOB_INTERVAL_MS,
  PAYMENT_CONFIRM_WINDOW_SECONDS,
} = require('../config/constants');

// Background Job: Quét ghế và đơn hàng hết hạn định kỳ
function startSeatReleaseJob() {
  let isRunning = false;

  setInterval(async () => {
    if (isRunning) return;
    isRunning = true;

    try {
      // 1. Đối soát lần cuối các đơn PAYMENT_PROCESSING đã quá confirmUntil (150s) trước khi nhả ghế
      await ticketService.reconcileExpiredProcessingOrders();

      // 2. Nhả ghế quá hạn và chuyển các đơn quá confirmUntil sang EXPIRED
      const { releasedSeats, expiredOrderCodes } = await ticketRepository.releaseExpiredSeats(
        PAYMENT_CONFIRM_WINDOW_SECONDS,
      );

      if (releasedSeats.length > 0) {
        logger.cron(
          `Đã tự động giải phóng ${releasedSeats.length} ghế hết hạn: ${releasedSeats.map((s) => s.seat_number).join(', ')}`,
        );
      }

      const uniqueExpiredOrderCodes = [
        ...new Set([
          ...expiredOrderCodes,
          ...releasedSeats.map((s) => Number(s.current_order_code)).filter((c) => Number.isInteger(c) && c > 0),
        ]),
      ];

      // Only cancel PayOS links and emit SSE for orders that actually expired (expiredOrderCodes)
      // plus any released seats whose order transitioned.
      const orderCodesToEmit = new Set(expiredOrderCodes);
      for (const code of uniqueExpiredOrderCodes) {
        if (!orderCodesToEmit.has(code)) {
          // Check if the order is now EXPIRED before cancelling PayOS link (in case seat belonged to a non-expired or already-handled order)
          const ord = await ticketRepository.getOrderWithItemsByCode(code);
          if (!ord || ord.order_status !== 'EXPIRED') {
            continue;
          }
          orderCodesToEmit.add(code);
        }

        try {
          await payos.paymentRequests.cancel(Number(code), 'Order expired');
          logger.payment('CANCEL', `Đã tự động đóng link PayOS cho đơn hết hạn #${code}`);
        } catch (cancelErr) {
          logger.error('PAYOS_CANCEL', `Không thể hủy PayOS link #${code}: ${cancelErr.message}`);
        }

        await ticketService.emitOrderStatusSnapshot(code);
      }
    } catch (err) {
      logger.error('CRON_AUTO_RELEASE', err.message, err);
    } finally {
      isRunning = false;
    }
  }, SEAT_RELEASE_JOB_INTERVAL_MS);
}

module.exports = { startSeatReleaseJob };

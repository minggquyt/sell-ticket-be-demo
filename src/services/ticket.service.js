const payos = require('../config/payos');
const ticketRepository = require('../repositories/ticket.repository');
const logger = require('../utils/logger');
const {
  SEAT_HOLD_DURATION_SECONDS,
  PAYMENT_TIMEOUT_SECONDS,
  PAYMENT_CONFIRM_WINDOW_SECONDS,
  PAYOS_SYNC_COOLDOWN_MS,
  MAX_TICKETS_PER_USER,
} = require('../config/constants');
const {
  parsePayOSTransactionTime,
  extractLatestPaidAt,
  isPaidWithinDeadline,
  computeOrderTiming,
} = require('../utils/payos-time');
const paymentEvents = require('../utils/payment-events');

class TicketService {
  constructor() {
    this.payosSyncLastAt = new Map();
    this.payosSyncInFlight = new Map();
  }

  createHttpError(statusCode, message) {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
  }

  buildOrderPaymentPayload(order, now = new Date()) {
    if (!order) return null;
    const status = order.order_status || order.status;
    const timing = computeOrderTiming(
      order.expires_at,
      status,
      now,
      PAYMENT_CONFIRM_WINDOW_SECONDS,
    );
    const items = Array.isArray(order.items)
      ? order.items.map((item) => ({
          ...(item.seat_id ? { seatId: item.seat_id } : {}),
          seatNumber: item.seat_number,
          zoneName: item.zone_name,
          price: Number(item.price),
        }))
      : [];

    return {
      orderCode: Number(order.order_code),
      status,
      phase: timing.phase,
      totalAmount: Number(order.total_amount),
      expiresAt: timing.expiresAt,
      confirmUntil: timing.confirmUntil,
      serverTime: timing.serverTime,
      createdAt: order.created_at || null,
      paymentInfo: status === 'PAYMENT_PROCESSING' ? (order.payment_info || null) : null,
      eventId: order.event_id || null,
      eventTitle: order.event_title || null,
      eventType: order.event_type || null,
      eventStartTime: order.event_start_time || null,
      location: order.location || null,
      items,
    };
  }

  async emitOrderStatusSnapshot(orderCode) {
    try {
      const numericCode = Number(orderCode);
      if (!Number.isInteger(numericCode) || numericCode <= 0) return;

      const freshOrder = await ticketRepository.getOrderWithItemsByCode(numericCode);
      if (!freshOrder) return;

      const orderPayload = this.buildOrderPaymentPayload(freshOrder);
      paymentEvents.emitOrderUpdate(numericCode, {
        type: 'STATUS_CHANGED',
        orderCode: orderPayload.orderCode,
        status: orderPayload.status,
        phase: orderPayload.phase,
        serverTime: orderPayload.serverTime,
        order: orderPayload,
      });
    } catch (err) {
      logger.error('SSE_EMIT_ORDER', `Không thể phát sự kiện SSE cho đơn #${orderCode}: ${err.message}`, err);
    }
  }

  async releaseExpiredSeatsAndNotify() {
    const { releasedSeats, expiredOrderCodes } = await ticketRepository.releaseExpiredSeats(
      PAYMENT_CONFIRM_WINDOW_SECONDS,
    );
    if (Array.isArray(expiredOrderCodes) && expiredOrderCodes.length > 0) {
      for (const code of expiredOrderCodes) {
        await this.emitOrderStatusSnapshot(code);
      }
    }
    return { releasedSeats, expiredOrderCodes };
  }

  // ==================== Customer Functions ====================
  async getUserOrderHistory(userId) {
    return await ticketRepository.getUserOrderHistory(userId);
  }

  async getAllEvents() {
    return await ticketRepository.getAllEvents();
  }

  async getSeatsByEvent(eventId) {
    await this.releaseExpiredSeatsAndNotify();
    return await ticketRepository.getSeatsByEvent(eventId);
  }

  async getZonesByEvent(eventId) {
    await this.releaseExpiredSeatsAndNotify();
    return await ticketRepository.getZonesByEvent(eventId);
  }

  // ==================== Seat Hold Functions ====================
  async requestSeatHold(userId, requestedSeatIds) {
    const client = await ticketRepository.beginTransaction();
    try {
      // 1. Kiểm tra Active Hold trước khi mở Transaction
      const hasActiveHold = await ticketRepository.checkActiveHold(userId);
      if (hasActiveHold) {
        logger.hold('CONFLICT', `User ${userId} bị chặn vì đang có phiên giữ vé chưa hoàn tất`);
        await ticketRepository.rollbackTransaction(client);
        return {
          success: false,
          code: 'USER_HAS_ACTIVE_HOLD',
          message: 'Bạn đang có một phiên giữ vé chưa hoàn tất.',
        };
      }

      // 2. Thử Lock các ghế khả dụng trong mảng truyền vào (Chạy cực nhanh < 5ms)
      const availableSeats = await ticketRepository.lockAvailableSeats(requestedSeatIds, client);
      const availableIds = availableSeats.map((s) => s.id);

      // TRƯỜNG HỢP A: Không có ghế nào còn trống
      if (availableSeats.length === 0) {
        await ticketRepository.rollbackTransaction(client);
        logger.hold('CONFLICT', `User ${userId} - Toàn bộ ${requestedSeatIds.length} ghế yêu cầu đều đã bị người khác chọn`);
        return {
          success: false,
          code: 'ALL_SEATS_TAKEN',
          message: 'Tất cả các ghế bạn chọn đều đã bị người khác giữ.',
        };
      }

      // TRƯỜNG HỢP B: Đủ 100% số ghế yêu cầu -> UPDATE & COMMIT NGAY
      if (availableSeats.length === requestedSeatIds.length) {
        const reservedUntil = new Date(Date.now() + SEAT_HOLD_DURATION_SECONDS * 1000);
        const updatedSeats = await ticketRepository.reserveSeats(userId, reservedUntil, availableIds, client);

        await ticketRepository.commitTransaction(client);
        logger.hold('SUCCESS', `User ${userId} đã giữ thành công ${updatedSeats.length} ghế: [${updatedSeats.map(s => s.seat_number).join(', ')}] đến ${reservedUntil.toLocaleTimeString()}`);

        return {
          success: true,
          code: 'FULLY_RESERVED',
          reservedSeats: updatedSeats,
          reservedUntil,
        };
      }

      // TRƯỜNG HỢP C: Khóa được MỘT PHẦN (Ví dụ 2/3 ghế)
      await ticketRepository.rollbackTransaction(client);

      const unavailableSeatIds = requestedSeatIds.filter(
        (id) => !availableIds.includes(id)
      );
      const unavailableSeatNumbers = await ticketRepository.getSeatNumbersByIds(unavailableSeatIds);

      logger.hold('CONFLICT', `User ${userId} chỉ giữ được một phần (${availableIds.length}/${requestedSeatIds.length} ghế)`);

      return {
        success: false,
        code: 'PARTIAL_AVAILABILITY',
        message: 'Một số ghế bạn chọn vừa có người khác giữ.',
        unavailableSeats: unavailableSeatNumbers,
        availableSeats: availableSeats.map((s) => ({
          id: s.id,
          seat_number: s.seat_number,
        })),
        availableSeatIds: availableIds,
      };
    } catch (err) {
      await ticketRepository.rollbackTransaction(client);
      logger.error('SEAT_HOLD_REQUEST', err.message, err);
      throw err;
    }
  }

  async confirmPartialHold(userId, confirmSeatIds) {
    const client = await ticketRepository.beginTransaction();
    try {
      const hasActiveHold = await ticketRepository.checkActiveHold(userId);
      if (hasActiveHold) {
        logger.hold('CONFLICT', `User ${userId} bị chặn confirm vì đang có phiên giữ vé chưa hoàn tất`);
        await ticketRepository.rollbackTransaction(client);
        return {
          success: false,
          code: 'USER_HAS_ACTIVE_HOLD',
          message: 'Bạn đang có một phiên giữ vé chưa hoàn tất.',
        };
      }

      const reservedUntil = new Date(Date.now() + SEAT_HOLD_DURATION_SECONDS * 1000);
      const updateRows = await ticketRepository.confirmAvailableSeatsHold(userId, reservedUntil, confirmSeatIds, client);

      if (updateRows.length !== confirmSeatIds.length) {
        await ticketRepository.rollbackTransaction(client);
        logger.hold('CONFLICT', `User ${userId} xác nhận partial thất bại (ghế đã bị người khác chọn trong lúc chờ)`);
        return {
          success: false,
          code: 'PARTIAL_HOLD_EXPIRED',
          message: 'Rất tiếc! Trong lúc bạn suy nghĩ, các ghế còn lại cũng đã được người khác giữ mất.',
        };
      }

      await ticketRepository.commitTransaction(client);
      logger.hold('SUCCESS', `User ${userId} đã xác nhận partial giữ ${updateRows.length} ghế thành công`);

      return {
        success: true,
        code: 'PARTIAL_RESERVED_SUCCESS',
        reservedSeats: updateRows,
        reservedUntil,
      };
    } catch (err) {
      await ticketRepository.rollbackTransaction(client);
      logger.error('CONFIRM_PARTIAL_HOLD', err.message, err);
      throw err;
    }
  }

  async reserveSeatsByMultipleZones(userId, eventId, zoneRequests) {
    if (!zoneRequests || !Array.isArray(zoneRequests) || zoneRequests.length === 0) {
      throw new Error('Danh sách khu vực chọn không hợp lệ.');
    }

    const validRequests = zoneRequests
      .map(r => ({ zone_name: r.zone_name || r.zoneName, quantity: Number(r.quantity) }))
      .filter(r => r.quantity > 0);

    if (validRequests.length === 0) {
      throw new Error('Bạn chưa chọn số lượng vé hợp lệ nào.');
    }

    const totalRequested = validRequests.reduce((sum, r) => sum + r.quantity, 0);
    const now = new Date();
    const until = new Date(Date.now() + SEAT_HOLD_DURATION_SECONDS * 1000);

    try {
      const rows = await ticketRepository.reserveSeatsByZoneDemands(userId, eventId, validRequests, now, until);

      if (rows.length !== totalRequested) {
        logger.hold('CONFLICT', `User ${userId} giữ vé khu vực thất bại: Yêu cầu ${totalRequested} vé, đáp ứng ${rows.length} vé`);
        throw new Error('Số lượng vé khả dụng không đủ hoặc bạn đang có một phiên giữ vé chưa hoàn tất.');
      }

      logger.hold('SUCCESS', `User ${userId} giữ thành công ${rows.length} vé khu vực đến ${until.toLocaleTimeString()}`);

      return {
        seats: rows,
        seatIds: rows.map(s => s.id),
        reserved_until: until,
        totalTickets: rows.length
      };
    } catch (err) {
      if (err.message && !err.message.includes('Số lượng vé')) {
        logger.error('RESERVE_ZONE_ERROR', err.message, err);
      }
      throw err;
    }
  }

  // ==================== Release Seats & Cancel ====================
  async releaseReservedSeats(userId, seatIds, orderCode = null) {
    const client = await ticketRepository.beginTransaction();
    let txClosed = false;
    try {
      let effectiveSeatIds = Array.isArray(seatIds) ? [...seatIds].filter(Boolean) : [];

      if (orderCode) {
        const numericCode = Number(orderCode);
        if (Number.isInteger(numericCode) && numericCode > 0) {
          const foundIds = await ticketRepository.getSeatIdsByOrderCode(numericCode, client);
          effectiveSeatIds = [...new Set([...effectiveSeatIds, ...foundIds])];
        }
      }

      if (effectiveSeatIds.length === 0 && userId) {
        const foundIds = await ticketRepository.getHeldSeatIdsByUserId(userId, client);
        effectiveSeatIds = foundIds;
      }

      const releasedRows = await ticketRepository.releaseSeatsByIds(effectiveSeatIds, userId, client);

      const orderCodes = [...new Set(releasedRows.map((r) => r.current_order_code).filter(Boolean))];
      if (orderCode) {
        orderCodes.push(Number(orderCode));
      }
      const uniqueOrderCodes = [...new Set(orderCodes.filter(Boolean))];

      let updatedOrders = [];
      if (uniqueOrderCodes.length > 0) {
        updatedOrders = await ticketRepository.cancelOrExpireProcessingOrders(uniqueOrderCodes, client);
      }

      await ticketRepository.commitTransaction(client);
      txClosed = true;

      for (const code of uniqueOrderCodes) {
        try {
          await payos.paymentRequests.cancel(Number(code), 'User cancelled reservation');
          logger.payment('CANCEL', `Đã hủy link PayOS cho đơn #${code}`);
        } catch (cancelErr) {
          logger.payment('WARN', `Không thể hủy link PayOS cho đơn #${code} (có thể đã hết hạn/hủy trước đó): ${cancelErr.message}`);
        }
      }

      for (const ord of updatedOrders) {
        await this.emitOrderStatusSnapshot(ord.order_code);
      }

      logger.release(`User ${userId} đã hủy/nhả ${releasedRows.length} ghế [${releasedRows.map((r) => r.seat_number).join(', ')}] về AVAILABLE`);

      return releasedRows;
    } catch (err) {
      if (!txClosed) {
        await ticketRepository.rollbackTransaction(client);
        txClosed = true;
      }
      logger.error('SEAT_RELEASE', err.message, err);
      throw err;
    }
  }

  async cancelOrder(userId, orderCode) {
    const numericCode = Number(orderCode);
    if (!Number.isInteger(numericCode) || numericCode <= 0) {
      throw this.createHttpError(400, 'Mã đơn hàng không hợp lệ.');
    }

    const client = await ticketRepository.beginTransaction();
    let txClosed = false;
    let releasedRows = [];
    try {
      const order = await ticketRepository.getOrderByCodeForUpdate(numericCode, client);
      if (!order || String(order.user_id) !== String(userId)) {
        throw this.createHttpError(404, 'Không tìm thấy đơn hàng hoặc bạn không có quyền truy cập.');
      }

      if (order.status !== 'PAYMENT_PROCESSING') {
        throw this.createHttpError(
          409,
          `Không thể hủy đơn hàng vì đơn đang ở trạng thái ${order.status}.`,
        );
      }

      const timing = computeOrderTiming(
        order.expires_at,
        order.status,
        new Date(),
        PAYMENT_CONFIRM_WINDOW_SECONDS,
      );
      if (timing.isPastExpiresAt) {
        throw this.createHttpError(
          409,
          'Đơn hàng đang trong quá trình xác nhận giao dịch với ngân hàng, vui lòng chờ giây lát.',
        );
      }

      await ticketRepository.updateOrderStatus(numericCode, 'CANCELLED', client);
      releasedRows = await ticketRepository.releaseSeatsByOrderCode(numericCode, client);
      await ticketRepository.commitTransaction(client);
      txClosed = true;
    } catch (err) {
      if (!txClosed) {
        await ticketRepository.rollbackTransaction(client);
        txClosed = true;
      }
      if (!err.statusCode) {
        logger.error('CANCEL_ORDER', err.message, err);
      }
      throw err;
    }

    try {
      await payos.paymentRequests.cancel(numericCode, 'User cancelled order');
      logger.payment('CANCEL', `Đã hủy link PayOS cho đơn #${numericCode}`);
    } catch (cancelErr) {
      logger.payment(
        'WARN',
        `Không thể hủy link PayOS cho đơn #${numericCode} (có thể đã hết hạn/hủy trước đó): ${cancelErr.message}`,
      );
    }

    await this.emitOrderStatusSnapshot(numericCode);
    logger.release(
      `User ${userId} đã hủy đơn #${numericCode} và nhả ${releasedRows.length} ghế [${releasedRows.map((r) => r.seat_number).join(', ')}] về AVAILABLE`,
    );

    return {
      orderCode: numericCode,
      status: 'CANCELLED',
      releasedSeats: releasedRows,
    };
  }

  // ==================== Checkout ====================
  async startCheckoutSeats(userId, seatIds, returnUrl, cancelUrl) {
    const client = await ticketRepository.beginTransaction();
    try {
      logger.payment('START_CHECKOUT_SERVICE', `Inputs: ${JSON.stringify({
        userId,
        seatCount: Array.isArray(seatIds) ? seatIds.length : 0,
        returnUrl,
        cancelUrl
      })}`);

      const uniqueSeatIds = [...new Set(seatIds)];

      // FIX #1: Race condition - Lock ghế và verify ownership trong cùng transaction
      const seatRows = await ticketRepository.getSeatsByIdsForUpdate(uniqueSeatIds, client);

      if (seatRows.length !== uniqueSeatIds.length) {
        throw new Error('Một hoặc nhiều ghế bạn chọn không tồn tại.');
      }

      const now = new Date();
      let total = 0;

      // FIX #1: Kiểm tra chặt chẽ ownership và status
      for (const seat of seatRows) {
        if (seat.reserved_by !== userId) {
          throw new Error(`Ghế ${seat.seat_number} không thuộc quyền sở hữu của bạn.`);
        }
        if (seat.status !== 'RESERVED') {
          throw new Error(`Ghế ${seat.seat_number} đã được thanh toán hoặc không còn hợp lệ.`);
        }
        if (new Date(seat.reserved_until) <= now) {
          throw new Error(`Ghế ${seat.seat_number} đã hết hạn giữ chỗ.`);
        }
        total += Number(seat.price);
      }

      const nowSec = Math.floor(Date.now() / 1000);
      const expiredAt = nowSec + PAYMENT_TIMEOUT_SECONDS;
      const paymentTimeout = new Date(expiredAt * 1000);
      const confirmUntil = new Date((expiredAt + PAYMENT_CONFIRM_WINDOW_SECONDS) * 1000);

      const order = await ticketRepository.createOrder(userId, total, paymentTimeout, client);
      const orderCode = Number(order.order_code);

      for (const s of seatRows) {
        await ticketRepository.createOrderItem(orderCode, s.id, s.price, client);
      }

      // Ghế giữ đến confirmUntil (T + 150s) để bảo vệ giao dịch ở giây 119 khi webhook về chậm
      await ticketRepository.updateSeatsToPaymentProcessing(confirmUntil, orderCode, uniqueSeatIds, client);

      const frontendOrigin = (process.env.FRONTEND_ORIGIN || 'http://localhost:5173').replace(/\/$/, '');
      const defaultCheckoutUrl = `${frontendOrigin}/checkout/${orderCode}`;

      let checkoutUrl = null;
      let paymentInfo = null;
      try {
        const description = `VE SU KIEN ${orderCode}`.slice(0, 25);
        const payosOrder = {
          orderCode,
          amount: Number(total),
          description,
          expiredAt,
          returnUrl: returnUrl || defaultCheckoutUrl,
          cancelUrl: cancelUrl || defaultCheckoutUrl,
        };
        const paymentLink = await payos.paymentRequests.create(payosOrder);
        if (!paymentLink || !paymentLink.qrCode) {
          throw new Error('PayOS không trả về chuỗi mã QR hợp lệ.');
        }

        checkoutUrl = paymentLink.checkoutUrl || null;
        paymentInfo = {
          paymentLinkId: paymentLink.paymentLinkId || null,
          bin: String(paymentLink.bin || ''),
          accountNumber: String(paymentLink.accountNumber || ''),
          accountName: String(paymentLink.accountName || ''),
          amount: Number(paymentLink.amount ?? total),
          description: String(paymentLink.description || description),
          qrCode: String(paymentLink.qrCode),
          currency: String(paymentLink.currency || 'VND'),
        };

        await ticketRepository.updateOrderPaymentData(orderCode, checkoutUrl, paymentInfo, client);
      } catch (payErr) {
        logger.error('PAYOS_LINK_CREATION', `Lỗi tạo link PayOS cho đơn #${orderCode}: ${payErr.message}`, payErr);
        throw new Error(`Không thể tạo liên kết thanh toán PayOS: ${payErr.message}`);
      }

      await ticketRepository.commitTransaction(client);

      const serverTime = new Date().toISOString();
      logger.payment(
        'START',
        `User ${userId} tạo đơn #${orderCode} | ${seatRows.length} ghế | Tổng tiền: ${total.toLocaleString()}đ | Hết hạn sau ${PAYMENT_TIMEOUT_SECONDS}s (+${PAYMENT_CONFIRM_WINDOW_SECONDS}s chờ webhook)`,
      );

      return {
        orderCode,
        checkoutUrl,
        totalAmount: Number(total),
        expiresAt: paymentTimeout.toISOString(),
        confirmUntil: confirmUntil.toISOString(),
        paymentTimeout: paymentTimeout.toISOString(),
        expiredAt,
        serverTime,
        paymentInfo,
      };
    } catch (err) {
      await ticketRepository.rollbackTransaction(client);
      logger.error('START_CHECKOUT', err.message, err);
      throw err;
    }
  }

  // ==================== Webhook & Sync ====================
  async handlePaymentWebhook(orderCode, isSuccess, paidAmount = null, transactionDateTime = null) {
    const client = await ticketRepository.beginTransaction();
    let txClosed = false;
    let finalOrderStatus = null;
    let prevOrderStatus = null;
    const numericOrderCode = Number(orderCode);

    try {
      if (!Number.isInteger(numericOrderCode) || numericOrderCode <= 0) {
        await ticketRepository.rollbackTransaction(client);
        txClosed = true;
        logger.payment('WARN', `Mã đơn hàng không hợp lệ từ webhook: ${orderCode}`);
        return { success: true, message: 'Mã đơn hàng không hợp lệ.' };
      }

      const order = await ticketRepository.getOrderByCodeForUpdate(numericOrderCode, client);
      if (!order) {
        await ticketRepository.rollbackTransaction(client);
        txClosed = true;
        logger.payment('WARN', `Không tìm thấy đơn hàng #${numericOrderCode} (có thể là ping test từ PayOS)`);
        return { success: true, message: 'Đơn hàng không tồn tại hoặc là ping test từ cổng thanh toán.' };
      }

      prevOrderStatus = order.status;

      if (order.status === 'SUCCESS') {
        await ticketRepository.commitTransaction(client);
        txClosed = true;
        logger.payment('INFO', `Đơn #${numericOrderCode} đã ở trạng thái SUCCESS từ trước.`);
        return { status: 'SUCCESS', orderCode: numericOrderCode };
      }

      if (order.status === 'REFUNDED') {
        await ticketRepository.commitTransaction(client);
        txClosed = true;
        logger.payment('INFO', `Đơn #${numericOrderCode} đã ở trạng thái REFUNDED từ trước.`);
        return { status: 'REFUNDED', orderCode: numericOrderCode };
      }

      if (order.status === 'REFUND_PENDING') {
        await ticketRepository.commitTransaction(client);
        txClosed = true;
        logger.payment('INFO', `Đơn #${numericOrderCode} đã ở trạng thái REFUND_PENDING từ trước.`);
        return { status: 'REFUND_PENDING', orderCode: numericOrderCode };
      }

      const paidAt = parsePayOSTransactionTime(transactionDateTime);
      let validSuccess = Boolean(isSuccess);
      if (validSuccess && paidAmount !== null && Number(paidAmount) < Number(order.total_amount)) {
        logger.payment('WARN', `Đơn #${numericOrderCode} thanh toán thiếu tiền: Nhận ${paidAmount} < Cần ${order.total_amount}`);
        validSuccess = false;
      }

      let updatedSeats = [];
      finalOrderStatus = order.status;

      if (validSuccess) {
        if (['CANCELLED', 'EXPIRED', 'FAILED'].includes(order.status)) {
          const prevStatus = order.status;
          await ticketRepository.releaseSeatsByOrderCode(numericOrderCode, client);
          await ticketRepository.updateOrderStatus(numericOrderCode, 'REFUND_PENDING', client);
          finalOrderStatus = 'REFUND_PENDING';
          logger.payment(
            'REFUND_PENDING',
            `Đơn #${numericOrderCode} đã ở trạng thái ${prevStatus} nhưng ghi nhận tiền vào -> Chuyển trạng thái ${prevStatus} -> REFUND_PENDING (Chờ hoàn tiền)!`,
          );
        } else if (order.status === 'PAYMENT_PROCESSING') {
          const orderItems = await ticketRepository.getOrderItemsWithSeatsForUpdate(numericOrderCode, client);
          // Quy tắc chặt: chỉ hợp lệ khi thời điểm chuyển tiền <= expires_at (quá 1ms cũng bị chặn)
          const isPaidOnTime = isPaidWithinDeadline(paidAt, order.expires_at);

          const isStillActivelyHeld =
            orderItems.length > 0 &&
            orderItems.every(
              (item) =>
                item.seat_status === 'PAYMENT_PROCESSING' &&
                Number(item.current_order_code) === numericOrderCode,
            );

          if (isPaidOnTime && isStillActivelyHeld) {
            const seatIdsToSell = orderItems.map((item) => item.current_seat_id);
            const soldRows = await ticketRepository.markSeatsAsSold(seatIdsToSell, numericOrderCode, client);

            if (soldRows.length === orderItems.length) {
              await ticketRepository.updateOrderStatus(numericOrderCode, 'SUCCESS', client);
              finalOrderStatus = 'SUCCESS';
              updatedSeats = soldRows;
              logger.payment('SUCCESS', `Đơn #${numericOrderCode} THANH TOÁN THÀNH CÔNG! ${updatedSeats.length} ghế thành SOLD`);
            } else {
              await ticketRepository.updateOrderStatus(numericOrderCode, 'CANCELLED', client);
              await ticketRepository.releaseSeatsByOrderCode(numericOrderCode, client);
              await ticketRepository.updateOrderStatus(numericOrderCode, 'REFUND_PENDING', client);
              finalOrderStatus = 'REFUND_PENDING';
              logger.payment('REFUND_PENDING', `Đơn #${numericOrderCode} không giữ đủ ${orderItems.length} ghế -> Chuyển PAYMENT_PROCESSING -> CANCELLED -> REFUND_PENDING!`);
            }
          } else {
            const stepOneStatus = !isPaidOnTime ? 'EXPIRED' : 'CANCELLED';
            await ticketRepository.updateOrderStatus(numericOrderCode, stepOneStatus, client);
            await ticketRepository.releaseSeatsByOrderCode(numericOrderCode, client);
            logger.payment(
              stepOneStatus === 'EXPIRED' ? 'EXPIRED' : 'CANCEL',
              `Đơn #${numericOrderCode} ${!isPaidOnTime ? `thanh toán muộn (paidAt=${paidAt.toISOString()} > expiresAt=${order.expires_at ? new Date(order.expires_at).toISOString() : 'null'})` : 'mất giữ chỗ'} -> Chuyển PAYMENT_PROCESSING -> ${stepOneStatus} và nhả ghế về AVAILABLE.`,
            );

            await ticketRepository.updateOrderStatus(numericOrderCode, 'REFUND_PENDING', client);
            finalOrderStatus = 'REFUND_PENDING';
            logger.payment(
              'REFUND_PENDING',
              `Đơn #${numericOrderCode} nhận được tiền sau khi ${stepOneStatus} -> Chuyển trạng thái ${stepOneStatus} -> REFUND_PENDING (Chờ hoàn tiền)!`,
            );
          }
        }
      } else if (order.status === 'PAYMENT_PROCESSING') {
        const isExpiredByTime = Boolean(order.expires_at && new Date(order.expires_at) <= new Date());
        const failedOrExpired = isExpiredByTime ? 'EXPIRED' : 'FAILED';
        await ticketRepository.updateOrderStatus(numericOrderCode, failedOrExpired, client);
        finalOrderStatus = failedOrExpired;

        const releasedRows = await ticketRepository.releaseSeatsByOrderCode(numericOrderCode, client);
        updatedSeats = releasedRows;
        logger.payment('CANCEL', `Đơn #${numericOrderCode} chuyển PAYMENT_PROCESSING -> ${failedOrExpired}! ${updatedSeats.length} ghế về AVAILABLE`);
      }

      await ticketRepository.commitTransaction(client);
      txClosed = true;
    } catch (err) {
      if (!txClosed) {
        await ticketRepository.rollbackTransaction(client);
        txClosed = true;
      }
      logger.error('HANDLE_PAYMENT_WEBHOOK', err.message, err);
      throw err;
    }

    if (finalOrderStatus && finalOrderStatus !== prevOrderStatus) {
      await this.emitOrderStatusSnapshot(numericOrderCode);
    }

    return { status: finalOrderStatus, orderCode: numericOrderCode };
  }

  async syncOrderWithPayOSThrottled(order, { force = false } = {}) {
    if (!order) return null;
    const numericOrderCode = Number(order.order_code);
    const status = order.order_status || order.status;

    if (!['PAYMENT_PROCESSING', 'CANCELLED', 'EXPIRED', 'FAILED'].includes(status)) {
      return null;
    }

    if (this.payosSyncInFlight.has(numericOrderCode)) {
      return this.payosSyncInFlight.get(numericOrderCode);
    }

    const nowMs = Date.now();
    const lastAt = this.payosSyncLastAt.get(numericOrderCode) || 0;
    if (!force && lastAt && nowMs - lastAt < PAYOS_SYNC_COOLDOWN_MS) {
      return null;
    }

    // Dọn cache cooldown cũ nếu map phình to
    if (this.payosSyncLastAt.size > 200) {
      for (const [k, ts] of this.payosSyncLastAt.entries()) {
        if (nowMs - ts > 5 * 60 * 1000) this.payosSyncLastAt.delete(k);
      }
    }

    const syncPromise = (async () => {
      this.payosSyncLastAt.set(numericOrderCode, Date.now());
      try {
        const payosData = await payos.paymentRequests.get(numericOrderCode);
        const hasPaidFullAmount =
          payosData?.status === 'PAID' ||
          (Number(payosData?.amountPaid) >= Number(order.total_amount) && Number(order.total_amount) > 0);

        if (hasPaidFullAmount) {
          const paidAt = extractLatestPaidAt(payosData?.transactions);
          await this.handlePaymentWebhook(
            numericOrderCode,
            true,
            payosData.amountPaid || payosData.amount,
            paidAt,
          );
          return await ticketRepository.getOrderWithItemsByCode(numericOrderCode);
        }

        if (status === 'PAYMENT_PROCESSING') {
          const timing = computeOrderTiming(
            order.expires_at,
            status,
            new Date(),
            PAYMENT_CONFIRM_WINDOW_SECONDS,
          );
          const isPayosCancelled = payosData?.status === 'CANCELLED';

          // Tuyệt đối không đánh EXPIRED trong pha CONFIRMING (120s..150s) dù PayOS báo EXPIRED
          if (isPayosCancelled || timing.isPastConfirmUntil) {
            const nextStatus = isPayosCancelled && !timing.isPastExpiresAt ? 'CANCELLED' : 'EXPIRED';
            const client = await ticketRepository.beginTransaction();
            let didTransition = false;
            try {
              const locked = await ticketRepository.getOrderByCodeForUpdate(numericOrderCode, client);
              if (locked && locked.status === 'PAYMENT_PROCESSING') {
                await ticketRepository.updateOrderStatus(numericOrderCode, nextStatus, client);
                await ticketRepository.releaseSeatsByOrderCode(numericOrderCode, client);
                didTransition = true;
              }
              await ticketRepository.commitTransaction(client);
              if (didTransition) {
                logger.payment(
                  nextStatus === 'EXPIRED' ? 'EXPIRED' : 'CANCEL',
                  `Đồng bộ đơn #${numericOrderCode}: Chuyển PAYMENT_PROCESSING -> ${nextStatus} và nhả ghế về AVAILABLE.`,
                );
              }
            } catch (txErr) {
              await ticketRepository.rollbackTransaction(client);
              logger.error('SYNC_ORDER_STATUS', txErr.message, txErr);
            }

            if (didTransition) {
              await this.emitOrderStatusSnapshot(numericOrderCode);
              return await ticketRepository.getOrderWithItemsByCode(numericOrderCode);
            }
          }
        }

        return null;
      } catch (err) {
        logger.payment('WARN', `Không thể đồng bộ trạng thái đơn #${numericOrderCode} từ PayOS: ${err.message}`);
        return null;
      } finally {
        if (this.payosSyncInFlight.get(numericOrderCode) === syncPromise) {
          this.payosSyncInFlight.delete(numericOrderCode);
        }
      }
    })();

    this.payosSyncInFlight.set(numericOrderCode, syncPromise);
    return syncPromise;
  }

  async getOrderPaymentForUser(userId, orderCode, { sync = false } = {}) {
    const numericOrderCode = Number(orderCode);
    if (!Number.isInteger(numericOrderCode) || numericOrderCode <= 0) {
      throw this.createHttpError(400, 'Mã đơn hàng không hợp lệ.');
    }

    let order = await ticketRepository.getOrderWithItemsByCode(numericOrderCode);
    if (!order || String(order.user_id) !== String(userId)) {
      throw this.createHttpError(404, 'Không tìm thấy đơn hàng hoặc bạn không có quyền truy cập.');
    }

    if (sync && order.order_status === 'PAYMENT_PROCESSING') {
      const synced = await this.syncOrderWithPayOSThrottled(order);
      if (synced) {
        order = synced;
      }
    }

    return order;
  }

  async getOrderStatusAndSync(userId, orderCode) {
    const numericOrderCode = Number(orderCode);
    if (!Number.isInteger(numericOrderCode) || numericOrderCode <= 0) {
      throw this.createHttpError(400, 'Mã đơn hàng không hợp lệ.');
    }

    const order = await ticketRepository.getOrderWithItemsByCode(numericOrderCode);
    if (!order || String(order.user_id) !== String(userId)) {
      throw this.createHttpError(404, 'Không tìm thấy đơn hàng hoặc bạn không có quyền truy cập.');
    }

    const synced = await this.syncOrderWithPayOSThrottled(order);
    return synced || order;
  }

  async reconcileExpiredProcessingOrders() {
    const expiredCodes = await ticketRepository.getExpiredProcessingOrderCodes(
      PAYMENT_CONFIRM_WINDOW_SECONDS,
    );
    for (const code of expiredCodes) {
      try {
        const order = await ticketRepository.getOrderWithItemsByCode(code);
        if (order && order.order_status === 'PAYMENT_PROCESSING') {
          await this.syncOrderWithPayOSThrottled(order, { force: true });
        }
      } catch (err) {
        logger.payment('WARN', `Lỗi đối soát đơn quá hạn #${code}: ${err.message}`);
      }
    }
  }

  /**
   * Trả về phiên giữ ghế (RESERVED) hoặc thanh toán (PAYMENT_PROCESSING) đang hoạt động
   * của user hiện tại trên toàn hệ thống, dùng để đồng bộ xuyên thiết bị/trình duyệt.
   */
  async getUserActiveHoldSession(userId) {
    await this.releaseExpiredSeatsAndNotify();
    const rows = await ticketRepository.getActiveHoldByUserId(userId);
    if (!rows || rows.length === 0) return null;

    const processingRow = rows.find(
      (r) => r.seat_status === 'PAYMENT_PROCESSING' && r.current_order_code,
    );

    if (processingRow) {
      const order = await this.getOrderStatusAndSync(userId, processingRow.current_order_code);
      if (!order || order.order_status !== 'PAYMENT_PROCESSING') {
        return null;
      }

      const timing = computeOrderTiming(
        order.expires_at,
        order.order_status,
        new Date(),
        PAYMENT_CONFIRM_WINDOW_SECONDS,
      );
      if (timing.isPastConfirmUntil) {
        return null;
      }

      const itemRows = Array.isArray(order.items) && order.items.length > 0 ? order.items : rows;
      return {
        step: 'PAYMENT_PROCESSING',
        eventId: order.event_id || processingRow.event_id,
        eventTitle: order.event_title || processingRow.event_title,
        eventType: order.event_type || processingRow.event_type,
        orderCode: Number(order.order_code),
        checkoutUrl: null,
        totalAmount: Number(order.total_amount),
        reservedUntil: order.expires_at || processingRow.reserved_until,
        expiresAt: timing.expiresAt,
        confirmUntil: timing.confirmUntil,
        serverTime: timing.serverTime,
        phase: timing.phase,
        seats: itemRows.map((item) => ({
          id: item.seat_id,
          seat_number: item.seat_number,
          zone_name: item.zone_name,
          price: Number(item.price),
        })),
      };
    }

    const totalAmount = rows.reduce((sum, r) => sum + Number(r.price || 0), 0);
    return {
      step: 'RESERVED',
      eventId: rows[0].event_id,
      eventTitle: rows[0].event_title,
      eventType: rows[0].event_type,
      orderCode: null,
      checkoutUrl: null,
      totalAmount,
      reservedUntil: rows[0].reserved_until,
      serverTime: new Date().toISOString(),
      seats: rows.map((r) => ({
        id: r.seat_id,
        seat_number: r.seat_number,
        zone_name: r.zone_name,
        price: Number(r.price),
      })),
    };
  }

  // ==================== Admin Functions ====================
  async getRefundOrdersForAdmin() {
    return await ticketRepository.getRefundOrdersForAdmin();
  }

  async getAllAdminTickets() {
    return await ticketRepository.getAllAdminTickets();
  }

  async confirmOrderRefund(orderCode, input) {
    const numericOrderCode = Number(orderCode);
    if (!Number.isInteger(numericOrderCode) || numericOrderCode <= 0) {
      throw new Error('Mã đơn hàng không hợp lệ.');
    }
    const updated = await ticketRepository.confirmOrderRefund(numericOrderCode, input);
    if (!updated) {
      throw new Error(
        'Không thể xác nhận: đơn không còn Chờ hoàn tiền, đang bị báo Sai TK, hoặc khách vừa đổi thông tin ngân hàng. Vui lòng tải lại danh sách và quét lại QR.'
      );
    }
    logger.payment(
      'REFUNDED',
      `Admin ${input.refundedBy} xác nhận hoàn tiền đơn #${numericOrderCode} -> ${input.bankAccountNo} (${input.bankAccountName})${input.note ? ` | ${input.note}` : ''}`
    );
    return updated;
  }

  async markRefundBankError(orderCode, reason) {
    const numericOrderCode = Number(orderCode);
    if (!Number.isInteger(numericOrderCode) || numericOrderCode <= 0) {
      throw new Error('Mã đơn hàng không hợp lệ.');
    }
    const updated = await ticketRepository.markRefundBankError(numericOrderCode, reason);
    if (!updated) {
      throw new Error('Không tìm thấy đơn hàng ở trạng thái Chờ hoàn tiền (REFUND_PENDING).');
    }
    logger.payment('REFUND_BANK_ERROR', `Admin báo sai TT ngân hàng cho đơn #${numericOrderCode}: ${reason}`);
    return updated;
  }

  async createEventWithConfig(eventData) {
    const {
      title,
      description,
      location,
      start_time,
      event_type,
      seatConfig,
      zoneConfigs,
      category,
      city,
      time,
      min_price,
      max_price,
      image,
      banner,
      organizer,
      highlights,
      rules,
      thumbnails,
    } = eventData;
    const client = await ticketRepository.beginTransaction();

    try {
      const event = await ticketRepository.createEvent(
        title,
        description,
        location,
        start_time || new Date(),
        event_type,
        client
      );

      const updatedEvent = await ticketRepository.updateEvent(
        event.id,
        {
          category,
          city,
          time,
          min_price,
          max_price,
          image,
          banner,
          organizer,
          highlights,
          rules,
          thumbnails,
        },
        client
      );

      if (event_type === 'SEAT_BASED') {
        const rowsCount = Number(seatConfig?.rowsCount) || 1;
        const seatsPerRow =
          Number(seatConfig?.seatsPerRow) ||
          Math.ceil((Number(seatConfig?.totalSeats) || 12) / rowsCount);
        const price = Number(seatConfig?.price) || 200000;

        for (let r = 0; r < rowsCount; r++) {
          const rowLetter = String.fromCharCode(65 + r);
          for (let s = 1; s <= seatsPerRow; s++) {
            await ticketRepository.createSeat(event.id, `${rowLetter}${s}`, 'STANDARD', price, client);
          }
        }
      } else {
        for (const z of (zoneConfigs || [])) {
          const count = Number(z.count) || 10;
          const price = Number(z.price) || 200000;
          const zoneName = (z.zoneName || 'STANDARD').toUpperCase();

          for (let i = 1; i <= count; i++) {
            await ticketRepository.createSeat(event.id, `${zoneName}-${String(i).padStart(2, '0')}`, zoneName, price, client);
          }
        }
      }

      await ticketRepository.commitTransaction(client);
      return updatedEvent || event;
    } catch (err) {
      await ticketRepository.rollbackTransaction(client);
      throw err;
    }
  }

  async updateEventWithConfig(eventId, eventData) {
    const {
      title,
      description,
      location,
      start_time,
      event_type,
      seatConfig,
      zoneConfigs,
      category,
      city,
      time,
      min_price,
      max_price,
      image,
      banner,
      organizer,
      highlights,
      rules,
      thumbnails,
    } = eventData;

    const client = await ticketRepository.beginTransaction();
    try {
      const updatedEvent = await ticketRepository.updateEvent(
        eventId,
        {
          title,
          description,
          location,
          start_time,
          event_type,
          category,
          city,
          time,
          min_price,
          max_price,
          image,
          banner,
          organizer,
          highlights,
          rules,
          thumbnails,
        },
        client
      );

      if (!updatedEvent) {
        throw new Error(`Sự kiện với ID ${eventId} không tồn tại.`);
      }

      const soldCount = await ticketRepository.countUnavailableSeatsByEvent(eventId, client);
      const hasSoldOrHeld = soldCount > 0;

      if (!hasSoldOrHeld) {
        await ticketRepository.deleteSeatsByEventId(eventId, client);

        if (event_type === 'SEAT_BASED' && seatConfig) {
          const rowsCount = Number(seatConfig.rowsCount) || 1;
          const seatsPerRow =
            Number(seatConfig.seatsPerRow) ||
            Math.ceil((Number(seatConfig.totalSeats) || 12) / rowsCount);
          const price = Number(seatConfig.price) || 200000;

          for (let r = 0; r < rowsCount; r++) {
            const rowLetter = String.fromCharCode(65 + r);
            for (let s = 1; s <= seatsPerRow; s++) {
              await ticketRepository.createSeat(eventId, `${rowLetter}${s}`, 'STANDARD', price, client);
            }
          }
        } else if (event_type === 'ZONE_BASED' && Array.isArray(zoneConfigs)) {
          for (const z of zoneConfigs) {
            const count = Number(z.count) || 10;
            const price = Number(z.price) || 200000;
            const zoneName = (z.zoneName || 'STANDARD').toUpperCase();

            for (let i = 1; i <= count; i++) {
              await ticketRepository.createSeat(eventId, `${zoneName}-${String(i).padStart(2, '0')}`, zoneName, price, client);
            }
          }
        }
      } else {
        if (event_type === 'SEAT_BASED' && seatConfig?.price) {
          await ticketRepository.updateAvailableSeatsPrice(eventId, Number(seatConfig.price), client);
        } else if (event_type === 'ZONE_BASED' && Array.isArray(zoneConfigs)) {
          for (const z of zoneConfigs) {
            if (z.zoneName && z.price !== undefined) {
              await ticketRepository.updateAvailableZoneSeatsPrice(eventId, z.zoneName, Number(z.price), client);
            }
          }
        }
      }

      await ticketRepository.commitTransaction(client);
      return updatedEvent;
    } catch (err) {
      await ticketRepository.rollbackTransaction(client);
      throw err;
    }
  }

  async deleteEvent(eventId) {
    return await ticketRepository.deleteEvent(eventId);
  }
}

module.exports = new TicketService();

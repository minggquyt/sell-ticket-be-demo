const payos = require('../config/payos');
const ticketRepository = require('../repositories/ticket.repository');
const logger = require('../utils/logger');
const {
  SEAT_HOLD_DURATION_SECONDS,
  PAYMENT_TIMEOUT_SECONDS,
} = require('../config/constants');

class TicketService {
  // ==================== Customer Functions ====================
  async getUserOrderHistory(userId) {
    return await ticketRepository.getUserOrderHistory(userId);
  }

  async getAllEvents() {
    return await ticketRepository.getAllEvents();
  }

  async getSeatsByEvent(eventId) {
    await ticketRepository.releaseExpiredSeats();
    return await ticketRepository.getSeatsByEvent(eventId);
  }

  async getZonesByEvent(eventId) {
    await ticketRepository.releaseExpiredSeats();
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

      const orderCodes = [...new Set(releasedRows.map(r => r.current_order_code).filter(Boolean))];
      if (orderCode) {
        orderCodes.push(Number(orderCode));
      }
      const uniqueOrderCodes = [...new Set(orderCodes.filter(Boolean))];

      if (uniqueOrderCodes.length > 0) {
        await ticketRepository.cancelOrExpireProcessingOrders(uniqueOrderCodes, client);
      }

      await ticketRepository.commitTransaction(client);

      for (const code of uniqueOrderCodes) {
        try {
          await payos.paymentRequests.cancel(Number(code), 'User cancelled reservation');
          logger.payment('CANCEL', `Đã hủy link PayOS cho đơn #${code}`);
        } catch (cancelErr) {
          logger.payment('WARN', `Không thể hủy link PayOS cho đơn #${code} (có thể đã hết hạn/hủy trước đó): ${cancelErr.message}`);
        }
      }

      logger.release(`User ${userId} đã hủy/nhả ${releasedRows.length} ghế [${releasedRows.map(r => r.seat_number).join(', ')}] về AVAILABLE`);

      return releasedRows;
    } catch (err) {
      await ticketRepository.rollbackTransaction(client);
      logger.error('SEAT_RELEASE', err.message, err);
      throw err;
    }
  }

  async cancelOrder(userId, orderCode) {
    const numericCode = Number(orderCode);
    if (!Number.isInteger(numericCode) || numericCode <= 0) {
      throw new Error('Mã đơn hàng không hợp lệ.');
    }
    return await this.releaseReservedSeats(userId, [], numericCode);
  }

  // ==================== Checkout ====================
  async startCheckoutSeats(userId, seatIds, returnUrl, cancelUrl, phone, citizenId) {
    const client = await ticketRepository.beginTransaction();
    try {
      logger.payment('START_CHECKOUT_SERVICE', `Inputs: ${JSON.stringify({
        userId,
        seatCount: Array.isArray(seatIds) ? seatIds.length : 0,
        phone,
        citizenId,
        returnUrl,
        cancelUrl
      })}`);

      const uniqueSeatIds = [...new Set(seatIds)];
      
      // FIX #5: Kiểm tra tổng số vé SUCCESS của user trong database
      const successfulTicketsCount = await ticketRepository.countSuccessfulTicketsByUser(userId, client);
      const requestedCount = uniqueSeatIds.length;
      
      if (successfulTicketsCount + requestedCount > MAX_TICKETS_PER_USER) {
        throw new Error(`Bạn đã mua ${successfulTicketsCount} vé. Chỉ được mua tối đa ${MAX_TICKETS_PER_USER} vé (còn lại ${MAX_TICKETS_PER_USER - successfulTicketsCount} vé).`);
      }
      
      // FIX #1: Race condition - Lock ghế và verify ownership trong cùng transaction
      const seatRows = await ticketRepository.getSeatsByIdsForUpdate(uniqueSeatIds, client);

      if (seatRows.length !== uniqueSeatIds.length) {
        throw new Error('Một hoặc nhiều ghế bạn chọn không tồn tại.');
      }

      const now = new Date();
      let total = 0;
      
      // FIX #1: Kiểm tra chặt chẽ ownership và status
      for (const seat of seatRows) {
        // Kiểm tra ghế phải đang được user này giữ
        if (seat.reserved_by !== userId) {
          throw new Error(`Ghế ${seat.seat_number} không thuộc quyền sở hữu của bạn.`);
        }
        
        // Kiểm tra status phải là RESERVED (chưa checkout)
        if (seat.status !== 'RESERVED') {
          throw new Error(`Ghế ${seat.seat_number} đã được thanh toán hoặc không còn hợp lệ.`);
        }
        
        // Kiểm tra chưa hết hạn giữ chỗ
        if (new Date(seat.reserved_until) <= now) {
          throw new Error(`Ghế ${seat.seat_number} đã hết hạn giữ chỗ.`);
        }
        
        total += Number(seat.price);
      }

      const nowSec = Math.floor(Date.now() / 1000);
      const expiredAt = nowSec + PAYMENT_TIMEOUT_SECONDS;
      const paymentTimeout = new Date(expiredAt * 1000);
      const seatReservedUntil = paymentTimeout;

      const order = await ticketRepository.createOrder(userId, total, paymentTimeout, phone, citizenId, client);
      const orderCode = Number(order.order_code);

      for (const s of seatRows) {
        await ticketRepository.createOrderItem(orderCode, s.id, s.price, client);
      }

      await ticketRepository.updateSeatsToPaymentProcessing(seatReservedUntil, orderCode, uniqueSeatIds, client);

      let checkoutUrl = null;
      try {
        const payosOrder = {
          orderCode,
          amount: Number(total),
          description: `VE SU KIEN ${orderCode}`.slice(0, 25),
          expiredAt,
          returnUrl: returnUrl || `http://127.0.0.1:5500/index.html?orderCode=${orderCode}&status=success`,
          cancelUrl: cancelUrl || `http://127.0.0.1:5500/index.html?orderCode=${orderCode}&status=cancel`,
        };
        const paymentLink = await payos.paymentRequests.create(payosOrder);
        checkoutUrl = paymentLink.checkoutUrl;
      } catch (payErr) {
        logger.error('PAYOS_LINK_CREATION', `Lỗi tạo link PayOS cho đơn #${orderCode}: ${payErr.message}`, payErr);
        throw new Error(`Không thể tạo liên kết thanh toán PayOS: ${payErr.message}`);
      }

      await ticketRepository.commitTransaction(client);

      logger.payment('START', `User ${userId} tạo đơn #${orderCode} | ${seatRows.length} ghế | Tổng tiền: ${total.toLocaleString()}đ | Hết hạn sau ${PAYMENT_TIMEOUT_SECONDS}s`);

      return { 
        orderCode, 
        checkoutUrl, 
        totalAmount: total, 
        paymentTimeout,
        expiredAt
      };
    } catch (err) {
      await ticketRepository.rollbackTransaction(client);
      logger.error('START_CHECKOUT', err.message, err);
      throw err;
    }
  }

  // ==================== Webhook & Sync ====================
  async handlePaymentWebhook(orderCode, isSuccess, paidAmount = null) {
    const client = await ticketRepository.beginTransaction();
    try {
      const numericOrderCode = Number(orderCode);
      if (!Number.isInteger(numericOrderCode) || numericOrderCode <= 0) {
        await ticketRepository.rollbackTransaction(client);
        logger.payment('WARN', `Mã đơn hàng không hợp lệ từ webhook: ${orderCode}`);
        return { success: true, message: 'Mã đơn hàng không hợp lệ.' };
      }

      const order = await ticketRepository.getOrderByCodeForUpdate(numericOrderCode, client);
      if (!order) {
        await ticketRepository.rollbackTransaction(client);
        logger.payment('WARN', `Không tìm thấy đơn hàng #${numericOrderCode} (có thể là ping test từ PayOS)`);
        return { success: true, message: 'Đơn hàng không tồn tại hoặc là ping test từ cổng thanh toán.' };
      }

      if (order.status === 'SUCCESS') {
        await ticketRepository.commitTransaction(client);
        logger.payment('INFO', `Đơn #${numericOrderCode} đã ở trạng thái SUCCESS từ trước.`);
        return { status: 'SUCCESS', orderCode: numericOrderCode };
      }

      if (order.status === 'REFUNDED') {
        await ticketRepository.commitTransaction(client);
        logger.payment('INFO', `Đơn #${numericOrderCode} đã ở trạng thái REFUNDED từ trước.`);
        return { status: 'REFUNDED', orderCode: numericOrderCode };
      }

      if (order.status === 'REFUND_PENDING') {
        await ticketRepository.commitTransaction(client);
        logger.payment('INFO', `Đơn #${numericOrderCode} đã ở trạng thái REFUND_PENDING từ trước.`);
        return { status: 'REFUND_PENDING', orderCode: numericOrderCode };
      }

      let validSuccess = Boolean(isSuccess);
      if (validSuccess && paidAmount !== null && Number(paidAmount) < Number(order.total_amount)) {
        logger.payment('WARN', `Đơn #${numericOrderCode} thanh toán thiếu tiền: Nhận ${paidAmount} < Cần ${order.total_amount}`);
        validSuccess = false;
      }

      let updatedSeats = [];
      let finalOrderStatus = order.status;

      if (validSuccess) {
        // TRƯỜNG HỢP A: Đơn đã ở trạng thái CANCELLED, EXPIRED hoặc FAILED từ trước ->
        // Chuyển tiếp đúng trình tự vòng đời: CANCELLED / EXPIRED / FAILED -> REFUND_PENDING
        if (['CANCELLED', 'EXPIRED', 'FAILED'].includes(order.status)) {
          const prevStatus = order.status;
          await ticketRepository.releaseSeatsByOrderCode(numericOrderCode, client);
          await ticketRepository.updateOrderStatus(numericOrderCode, 'REFUND_PENDING', client);
          finalOrderStatus = 'REFUND_PENDING';
          logger.payment(
            'REFUND_PENDING',
            `Đơn #${numericOrderCode} đã ở trạng thái ${prevStatus} nhưng ghi nhận tiền vào -> Chuyển trạng thái ${prevStatus} -> REFUND_PENDING (Chờ hoàn tiền)!`
          );
        } else if (order.status === 'PAYMENT_PROCESSING') {
          const orderItems = await ticketRepository.getOrderItemsWithSeatsForUpdate(numericOrderCode, client);
          const isExpiredByTime = Boolean(order.expires_at && new Date(order.expires_at) <= new Date());

          const isStillActivelyHeld =
            !isExpiredByTime &&
            orderItems.length > 0 &&
            orderItems.every(
              (item) =>
                item.seat_status === 'PAYMENT_PROCESSING' &&
                Number(item.current_order_code) === numericOrderCode
            );

          if (isStillActivelyHeld) {
            const seatIdsToSell = orderItems.map((item) => item.current_seat_id);
            const soldRows = await ticketRepository.markSeatsAsSold(seatIdsToSell, numericOrderCode, client);

            if (soldRows.length === orderItems.length) {
              await ticketRepository.updateOrderStatus(numericOrderCode, 'SUCCESS', client);
              finalOrderStatus = 'SUCCESS';
              updatedSeats = soldRows;
              logger.payment('SUCCESS', `Đơn #${numericOrderCode} THANH TOÁN THÀNH CÔNG! ${updatedSeats.length} ghế thành SOLD`);
            } else {
              // BƯỚC 1: PAYMENT_PROCESSING -> CANCELLED & nhả ghế
              await ticketRepository.updateOrderStatus(numericOrderCode, 'CANCELLED', client);
              await ticketRepository.releaseSeatsByOrderCode(numericOrderCode, client);
              // BƯỚC 2: CANCELLED -> REFUND_PENDING
              await ticketRepository.updateOrderStatus(numericOrderCode, 'REFUND_PENDING', client);
              finalOrderStatus = 'REFUND_PENDING';
              logger.payment('REFUND_PENDING', `Đơn #${numericOrderCode} không giữ đủ ${orderItems.length} ghế -> Chuyển PAYMENT_PROCESSING -> CANCELLED -> REFUND_PENDING!`);
            }
          } else {
            // Đơn quá hạn 2 phút hoặc mất quyền giữ ghế:
            // BƯỚC 1: Chuyển PAYMENT_PROCESSING -> EXPIRED (hoặc CANCELLED) và nhả ghế về AVAILABLE
            const stepOneStatus = isExpiredByTime ? 'EXPIRED' : 'CANCELLED';
            await ticketRepository.updateOrderStatus(numericOrderCode, stepOneStatus, client);
            await ticketRepository.releaseSeatsByOrderCode(numericOrderCode, client);
            logger.payment(
              stepOneStatus === 'EXPIRED' ? 'EXPIRED' : 'CANCEL',
              `Đơn #${numericOrderCode} đã ${isExpiredByTime ? 'quá hạn 2 phút' : 'mất giữ chỗ'} -> Chuyển trạng thái PAYMENT_PROCESSING -> ${stepOneStatus} và nhả ghế về AVAILABLE.`
            );

            // BƯỚC 2: Chuyển từ EXPIRED / CANCELLED -> REFUND_PENDING
            await ticketRepository.updateOrderStatus(numericOrderCode, 'REFUND_PENDING', client);
            finalOrderStatus = 'REFUND_PENDING';
            logger.payment(
              'REFUND_PENDING',
              `Đơn #${numericOrderCode} nhận được tiền sau khi ${stepOneStatus} -> Chuyển trạng thái ${stepOneStatus} -> REFUND_PENDING (Chờ hoàn tiền)!`
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

      return { status: finalOrderStatus, orderCode: numericOrderCode };
    } catch (err) {
      await ticketRepository.rollbackTransaction(client);
      logger.error('HANDLE_PAYMENT_WEBHOOK', err.message, err);
      throw err;
    }
  }

  async getOrderStatusAndSync(userId, orderCode) {
    const numericOrderCode = Number(orderCode);
    if (!Number.isInteger(numericOrderCode) || numericOrderCode <= 0) {
      throw new Error('Mã đơn hàng không hợp lệ.');
    }

    let order = await ticketRepository.getOrderWithItemsByCode(numericOrderCode);
    if (!order || order.user_id !== userId) {
      throw new Error('Không tìm thấy đơn hàng hoặc bạn không có quyền truy cập.');
    }

    if (
      order.order_status === 'PAYMENT_PROCESSING' ||
      order.order_status === 'CANCELLED' ||
      order.order_status === 'EXPIRED' ||
      order.order_status === 'FAILED'
    ) {
      try {
        const paymentInfo = await payos.paymentRequests.get(numericOrderCode);
        const hasPaidFullAmount =
          paymentInfo?.status === 'PAID' ||
          (Number(paymentInfo?.amountPaid) >= Number(order.total_amount) && Number(order.total_amount) > 0);

        if (hasPaidFullAmount) {
          await this.handlePaymentWebhook(
            numericOrderCode,
            true,
            paymentInfo.amountPaid || paymentInfo.amount
          );
          order = await ticketRepository.getOrderWithItemsByCode(numericOrderCode);
        } else if (order.order_status === 'PAYMENT_PROCESSING') {
          const isExpiredByTime = Boolean(order.expires_at && new Date(order.expires_at) <= new Date());
          if (
            paymentInfo?.status === 'CANCELLED' ||
            paymentInfo?.status === 'EXPIRED' ||
            isExpiredByTime
          ) {
            const nextStatus =
              paymentInfo?.status === 'CANCELLED' && !isExpiredByTime ? 'CANCELLED' : 'EXPIRED';
            const client = await ticketRepository.beginTransaction();
            try {
              await ticketRepository.updateOrderStatus(numericOrderCode, nextStatus, client);
              await ticketRepository.releaseSeatsByOrderCode(numericOrderCode, client);
              await ticketRepository.commitTransaction(client);
              logger.payment(
                nextStatus === 'EXPIRED' ? 'EXPIRED' : 'CANCEL',
                `Đồng bộ đơn #${numericOrderCode}: Chuyển trạng thái PAYMENT_PROCESSING -> ${nextStatus} và nhả ghế về AVAILABLE.`
              );
            } catch (txErr) {
              await ticketRepository.rollbackTransaction(client);
              logger.error('SYNC_ORDER_STATUS', txErr.message, txErr);
            }
            order = await ticketRepository.getOrderWithItemsByCode(numericOrderCode);
          }
        }
      } catch (err) {
        logger.payment('WARN', `Không thể đồng bộ trạng thái đơn #${numericOrderCode} từ PayOS: ${err.message}`);
      }
    }

    return order;
  }

  // ==================== Admin Functions ====================
  async getRefundOrdersForAdmin() {
    return await ticketRepository.getRefundOrdersForAdmin();
  }

  async getAllAdminTickets() {
    return await ticketRepository.getAllAdminTickets();
  }

  async confirmOrderRefund(orderCode) {
    const numericOrderCode = Number(orderCode);
    if (!Number.isInteger(numericOrderCode) || numericOrderCode <= 0) {
      throw new Error('Mã đơn hàng không hợp lệ.');
    }
    const updated = await ticketRepository.confirmOrderRefund(numericOrderCode);
    if (!updated) {
      throw new Error('Không tìm thấy đơn hàng ở trạng thái Chờ hoàn tiền (REFUND_PENDING).');
    }
    logger.payment('REFUNDED', `Admin đã xác nhận hoàn tiền thành công cho đơn #${numericOrderCode}`);
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

      await ticketRepository.updateEvent(
        event.id,
        {
          category,
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
      return event;
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

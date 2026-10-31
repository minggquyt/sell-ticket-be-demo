const pool = require('../config/db');
const payos = require('../config/payos');
const ticketRepository = require('../repositories/ticket.repository');
const logger = require('../utils/logger');
const {
  SEAT_HOLD_DURATION_SECONDS,
  PAYMENT_TIMEOUT_SECONDS,
  PAYMENT_GRACE_SECONDS,
} = require('../config/constants');

class TicketService {
  // Customer Functions
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

  async requestSeatHold(userId, requestedSeatIds) {
    const client = await pool.connect();
    try {
      // 1. Kiểm tra Active Hold trước khi mở Transaction
      const hasActiveHold = await ticketRepository.checkActiveHold(userId);
      if (hasActiveHold) {
        logger.hold('CONFLICT', `User ${userId} bị chặn vì đang có phiên giữ vé chưa hoàn tất`);
        return {
          success: false,
          code: 'USER_HAS_ACTIVE_HOLD',
          message: 'Bạn đang có một phiên giữ vé chưa hoàn tất.',
        };
      }

      await client.query('BEGIN');

      // 2. Thử Lock các ghế khả dụng trong mảng truyền vào (Chạy cực nhanh < 5ms)
      const lockedSeatsResult = await client.query(
        `SELECT id, seat_number, price, zone_name
         FROM seats
         WHERE id = ANY($1::uuid[])
           AND status = 'AVAILABLE'
         ORDER BY id ASC
         FOR UPDATE SKIP LOCKED;`,
        [requestedSeatIds]
      );

      const availableSeats = lockedSeatsResult.rows;
      const availableIds = availableSeats.map((s) => s.id);

      // TRƯỜNG HỢP A: Không có ghế nào còn trống
      if (availableSeats.length === 0) {
        await client.query('ROLLBACK');
        logger.hold('CONFLICT', `User ${userId} - Toàn bộ ${requestedSeatIds.length} ghế yêu cầu đều đã bị người khác chọn`);
        return {
          success: false,
          code: 'ALL_SEATS_TAKEN',
          message: 'Tất cả các ghế bạn chọn đều đã bị người khác giữ.',
        };
      }

      // TRƯỜNG HỢP B: Đủ 100% số ghế yêu cầu -> UPDATE & COMMIT NGAY
      
      // THÊM CHỨC NĂNG TẠO HÓA ĐƠN KÈM THEO SDT VÀ CCCD 
      if (availableSeats.length === requestedSeatIds.length) {
        const reservedUntil = new Date(Date.now() + SEAT_HOLD_DURATION_SECONDS * 1000);

        const updateResult = await client.query(
          `UPDATE seats 
           SET status = 'RESERVED', reserved_by = $1, reserved_until = $2
           WHERE id = ANY($3::uuid[])
           RETURNING id, seat_number, status, reserved_until, price;`,
          [userId, reservedUntil, availableIds]
        );

        await client.query('COMMIT');
        logger.hold('SUCCESS', `User ${userId} đã giữ thành công ${updateResult.rows.length} ghế: [${updateResult.rows.map(s => s.seat_number).join(', ')}] đến ${reservedUntil.toLocaleTimeString()}`);

        return {
          success: true,
          code: 'FULLY_RESERVED',
          reservedSeats: updateResult.rows,
          reservedUntil,
        };
      }

      // TRƯỜNG HỢP C: Khóa được MỘT PHẦN (Ví dụ 2/3 ghế)
      // CRITICAL: ROLLBACK NGAY ĐỂ NHẢ CONNECTION POOL VỀ DB!
      await client.query('ROLLBACK');

      // Lấy ra danh sách các ghế đã bị người khác chọn để báo cho UI
      const unavailableSeatIds = requestedSeatIds.filter(
        (id) => !availableIds.includes(id)
      );
      const unavailableSeatsResult = await pool.query(
        `SELECT seat_number FROM seats WHERE id = ANY($1::uuid[])`,
        [unavailableSeatIds]
      );

      logger.hold('CONFLICT', `User ${userId} chỉ giữ được một phần (${availableIds.length}/${requestedSeatIds.length} ghế)`);

      return {
        success: false,
        code: 'PARTIAL_AVAILABILITY',
        message: 'Một số ghế bạn chọn vừa có người khác giữ.',
        unavailableSeats: unavailableSeatsResult.rows.map((s) => s.seat_number),
        availableSeats: availableSeats.map((s) => ({
          id: s.id,
          seat_number: s.seat_number,
        })),
        availableSeatIds: availableIds,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('SEAT_HOLD_REQUEST', err.message, err);
      throw err;
    } finally {
      client.release();
    }
  }

  async confirmPartialHold(userId, confirmSeatIds) {
    const client = await pool.connect();

    try {
      // 1. Kiểm tra Active Hold
      const hasActiveHold = await ticketRepository.checkActiveHold(userId);
      if (hasActiveHold) {
        logger.hold('CONFLICT', `User ${userId} bị chặn confirm vì đang có phiên giữ vé chưa hoàn tất`);
        return {
          success: false,
          code: 'USER_HAS_ACTIVE_HOLD',
          message: 'Bạn đang có một phiên giữ vé chưa hoàn tất.',
        };
      }

      await client.query('BEGIN');

      const reservedUntil = new Date(Date.now() + SEAT_HOLD_DURATION_SECONDS * 1000);

      // 2. Thử UPDATE chính thức các ghế này NẾU chúng vẫn còn status = 'AVAILABLE'
      const updateResult = await client.query(
        `UPDATE seats
         SET status = 'RESERVED', reserved_by = $1, reserved_until = $2
         WHERE id = ANY($3::uuid[])
           AND status = 'AVAILABLE'
         RETURNING id, seat_number, status, reserved_until, price;`,
        [userId, reservedUntil, confirmSeatIds]
      );

      // 3. Kiểm tra xem có ghế nào bị User khác "cướp" mất trong thời gian User hiện tại suy nghĩ không
      if (updateResult.rows.length !== confirmSeatIds.length) {
        await client.query('ROLLBACK');
        logger.hold('CONFLICT', `User ${userId} xác nhận partial thất bại (ghế đã bị người khác chọn trong lúc chờ)`);
        return {
          success: false,
          code: 'PARTIAL_HOLD_EXPIRED',
          message: 'Rất tiếc! Trong lúc bạn suy nghĩ, các ghế còn lại cũng đã được người khác giữ mất.',
        };
      }

      await client.query('COMMIT');
      logger.hold('SUCCESS', `User ${userId} đã xác nhận partial giữ ${updateResult.rows.length} ghế thành công`);

      return {
        success: true,
        code: 'PARTIAL_RESERVED_SUCCESS',
        reservedSeats: updateResult.rows,
        reservedUntil,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('CONFIRM_PARTIAL_HOLD', err.message, err);
      throw err;
    } finally {
      client.release();
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

    const query = `
    WITH user_active_hold AS (
      SELECT 1 FROM seats 
      WHERE reserved_by = $1 
        AND status IN ('RESERVED', 'PAYMENT_PROCESSING') 
        AND reserved_until > $2
      LIMIT 1
    ),
    zone_demands AS (
      SELECT zone_name, quantity::int AS required_qty 
      FROM jsonb_to_recordset($3::jsonb) AS x(zone_name text, quantity int)
      WHERE NOT EXISTS (SELECT 1 FROM user_active_hold)
    ),
    locked_seats AS (
      SELECT s.id, s.seat_number, s.zone_name, s.price
      FROM zone_demands zd
      CROSS JOIN LATERAL (
        SELECT id, seat_number, zone_name, price
        FROM seats
        WHERE event_id = $4
          AND zone_name = zd.zone_name
          AND status = 'AVAILABLE'
        ORDER BY seat_number ASC
        LIMIT zd.required_qty
        FOR UPDATE SKIP LOCKED
      ) s
    ),
    checked_availability AS (
      SELECT zd.zone_name, zd.required_qty, COUNT(ls.id) AS locked_qty
      FROM zone_demands zd
      LEFT JOIN locked_seats ls ON zd.zone_name = ls.zone_name
      GROUP BY zd.zone_name, zd.required_qty
    )
    UPDATE seats
    SET status = 'RESERVED', reserved_by = $1, reserved_until = $5
    WHERE id IN (SELECT id FROM locked_seats)
      AND NOT EXISTS (
        SELECT 1 FROM checked_availability WHERE locked_qty < required_qty
      )
    RETURNING id, seat_number, zone_name, price, status, reserved_until;
  `;

    try {
      const result = await pool.query(query, [
        userId,
        now,
        JSON.stringify(validRequests),
        eventId,
        until
      ]);

      if (result.rows.length !== totalRequested) {
        logger.hold('CONFLICT', `User ${userId} giữ vé khu vực thất bại: Yêu cầu ${totalRequested} vé, đáp ứng ${result.rows.length} vé`);
        throw new Error('Số lượng vé khả dụng không đủ hoặc bạn đang có một phiên giữ vé chưa hoàn tất.');
      }

      logger.hold('SUCCESS', `User ${userId} giữ thành công ${result.rows.length} vé khu vực đến ${until.toLocaleTimeString()}`);

      return {
        seats: result.rows,
        seatIds: result.rows.map(s => s.id),
        reserved_until: until,
        totalTickets: result.rows.length
      };
    } catch (err) {
      if (err.message && !err.message.includes('Số lượng vé')) {
        logger.error('RESERVE_ZONE_ERROR', err.message, err);
      }
      throw err;
    }
  }

  async releaseReservedSeats(userId, seatIds, orderCode = null) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      let effectiveSeatIds = Array.isArray(seatIds) ? [...seatIds].filter(Boolean) : [];

      // 1. Nếu có orderCode, truy vấn lấy tất cả seat_id thuộc về đơn hàng này
      if (orderCode) {
        const numericCode = Number(orderCode);
        if (Number.isInteger(numericCode) && numericCode > 0) {
          const oiRes = await client.query(
            `SELECT seat_id FROM order_items WHERE order_code = $1;`,
            [numericCode]
          );
          const foundIds = oiRes.rows.map(r => r.seat_id);
          effectiveSeatIds = [...new Set([...effectiveSeatIds, ...foundIds])];
        }
      }

      // 2. Nếu effectiveSeatIds vẫn rỗng, tìm các ghế đang được giữ bởi userId này
      if (effectiveSeatIds.length === 0 && userId) {
        const heldRes = await client.query(
          `SELECT id FROM seats WHERE reserved_by = $1 AND status IN ('RESERVED', 'PAYMENT_PROCESSING');`,
          [userId]
        );
        effectiveSeatIds = heldRes.rows.map(r => r.id);
      }

      const result = await client.query(`
        WITH target_seats AS (
          SELECT id, current_order_code
          FROM seats
          WHERE id = ANY($1::uuid[])
            AND (reserved_by = $2 OR $2 IS NULL)
            AND status IN ('RESERVED', 'PAYMENT_PROCESSING')
          FOR UPDATE
        )
        UPDATE seats s
        SET status = 'AVAILABLE', reserved_by = NULL, reserved_until = NULL, current_order_code = NULL
        FROM target_seats ts
        WHERE s.id = ts.id
        RETURNING s.id, s.seat_number, ts.current_order_code;
      `, [effectiveSeatIds, userId || null]);

      const orderCodes = [...new Set(result.rows.map(r => r.current_order_code).filter(Boolean))];
      if (orderCode) {
        orderCodes.push(Number(orderCode));
      }
      const uniqueOrderCodes = [...new Set(orderCodes.filter(Boolean))];

      if (uniqueOrderCodes.length > 0) {
        await client.query(
          `UPDATE orders SET status = 'CANCELLED' WHERE order_code = ANY($1::bigint[]) AND status = 'PAYMENT_PROCESSING';`,
          [uniqueOrderCodes]
        );
      }

      await client.query('COMMIT');

      for (const code of uniqueOrderCodes) {
        try {
          await payos.paymentRequests.cancel(Number(code), 'User cancelled reservation');
          logger.payment('CANCEL', `Đã hủy link PayOS cho đơn #${code}`);
        } catch (cancelErr) {
          logger.payment('WARN', `Không thể hủy link PayOS cho đơn #${code} (có thể đã hết hạn/hủy trước đó): ${cancelErr.message}`);
        }
      }

      logger.release(`User ${userId} đã hủy/nhả ${result.rows.length} ghế [${result.rows.map(r => r.seat_number).join(', ')}] về AVAILABLE`);

      return result.rows;
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('SEAT_RELEASE', err.message, err);
      throw err;
    } finally {
      client.release();
    }
  }

  async cancelOrder(userId, orderCode) {
    const numericCode = Number(orderCode);
    if (!Number.isInteger(numericCode) || numericCode <= 0) {
      throw new Error('Mã đơn hàng không hợp lệ.');
    }
    return await this.releaseReservedSeats(userId, [], numericCode);
  }

  async startCheckoutSeats(userId, seatIds, returnUrl, cancelUrl, phone, citizenId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const uniqueSeatIds = [...new Set(seatIds)];
      const seatRes = await client.query(
        `SELECT * FROM seats WHERE id = ANY($1::uuid[]) ORDER BY id ASC FOR UPDATE;`,
        [uniqueSeatIds]
      );

      if (seatRes.rows.length !== uniqueSeatIds.length) {
        throw new Error('Một hoặc nhiều ghế bạn chọn không tồn tại.');
      }

      const now = new Date();
      let total = 0;
      for (const seat of seatRes.rows) {
        if (seat.status !== 'RESERVED' || seat.reserved_by !== userId || new Date(seat.reserved_until) <= now) {
          throw new Error(`Ghế ${seat.seat_number} không hợp lệ hoặc đã hết hạn giữ chỗ.`);
        }
        total += Number(seat.price);
      }

      const nowSec = Math.floor(Date.now() / 1000);
      const expiredAt = nowSec + PAYMENT_TIMEOUT_SECONDS;
      const paymentTimeout = new Date(expiredAt * 1000);
      const seatReservedUntil = new Date((expiredAt + PAYMENT_GRACE_SECONDS) * 1000);

      const order = await ticketRepository.createOrder(userId, total, paymentTimeout, phone, citizenId, client);
      const orderCode = Number(order.order_code);

      for (const s of seatRes.rows) {
        await ticketRepository.createOrderItem(orderCode, s.id, s.price, client);
      }

      await client.query(`
        UPDATE seats 
        SET status = 'PAYMENT_PROCESSING', reserved_until = $1, current_order_code = $2 
        WHERE id = ANY($3::uuid[]);
      `, [seatReservedUntil, orderCode, uniqueSeatIds]);

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
        logger.error('PAYOS_LINK_CREATION', `Lỗi tạo link PayOS cho đơn #${orderCode}: ${payErr.message}`);
        throw new Error(`Không thể tạo liên kết thanh toán PayOS: ${payErr.message}`);
      }

      await client.query('COMMIT');

      logger.payment('START', `User ${userId} tạo đơn #${orderCode} | ${seatRes.rows.length} ghế | Tổng tiền: ${total.toLocaleString()}đ | Hết hạn sau ${PAYMENT_TIMEOUT_SECONDS}s`);

      return { 
        orderCode, 
        checkoutUrl, 
        totalAmount: total, 
        paymentTimeout,
        expiredAt
      };
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('START_CHECKOUT', err.message, err);
      throw err;
    } finally {
      client.release();
    }
  }

  async handlePaymentWebhook(orderCode, isSuccess, paidAmount = null) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const numericOrderCode = Number(orderCode);
      if (!Number.isInteger(numericOrderCode) || numericOrderCode <= 0) {
        await client.query('ROLLBACK');
        logger.payment('WARN', `Mã đơn hàng không hợp lệ từ webhook: ${orderCode}`);
        return { success: true, message: 'Mã đơn hàng không hợp lệ.' };
      }

      const orderRes = await client.query(
        `SELECT * FROM orders WHERE order_code = $1 FOR UPDATE;`,
        [numericOrderCode]
      );
      
      if (orderRes.rows.length === 0) {
        await client.query('ROLLBACK');
        logger.payment('WARN', `Không tìm thấy đơn hàng #${numericOrderCode} (có thể là ping test từ PayOS)`);
        return { success: true, message: 'Đơn hàng không tồn tại hoặc là ping test từ cổng thanh toán.' };
      }
      
      const order = orderRes.rows[0];

      if (order.status === 'SUCCESS' && isSuccess) {
        await client.query('COMMIT');
        logger.payment('INFO', `Đơn #${numericOrderCode} đã ở trạng thái SUCCESS từ trước.`);
        return { status: 'SUCCESS', orderCode: numericOrderCode };
      }

      if ((order.status === 'REFUND_PENDING' || order.status === 'REFUNDED') && isSuccess) {
        await client.query('COMMIT');
        logger.payment('INFO', `Đơn #${numericOrderCode} đã ở trạng thái ${order.status} từ trước.`);
        return { status: order.status, orderCode: numericOrderCode };
      }

      // Kiểm tra khớp số tiền thanh toán nếu có paidAmount
      let validSuccess = Boolean(isSuccess);
      if (validSuccess && paidAmount !== null && Number(paidAmount) < Number(order.total_amount)) {
        logger.payment('WARN', `Đơn #${numericOrderCode} thanh toán thiếu tiền: Nhận ${paidAmount} < Cần ${order.total_amount}`);
        validSuccess = false;
      }

      let updatedSeats = [];
      let finalOrderStatus = order.status;

      if (validSuccess) {
        // Lấy chi tiết các vé và ghế hiện tại của đơn hàng, kèm thông tin event_type (khóa dòng để đảm bảo tính toàn vẹn)
        const orderItemsRes = await client.query(`
          SELECT 
            oi.id AS order_item_id,
            oi.seat_id,
            oi.price AS item_price,
            s.id AS current_seat_id,
            s.seat_number,
            s.zone_name,
            s.event_id,
            s.status AS seat_status,
            s.reserved_by,
            s.current_order_code,
            e.event_type
          FROM order_items oi
          JOIN seats s ON oi.seat_id = s.id
          JOIN events e ON s.event_id = e.id
          WHERE oi.order_code = $1
          ORDER BY oi.id ASC
          FOR UPDATE OF oi, s;
        `, [numericOrderCode]);

        const orderItems = orderItemsRes.rows;
        const eventType = orderItems[0]?.event_type || 'SEAT_BASED';
        const eventId = orderItems[0]?.event_id;

        // ĐIỀU KIỆN CHẶT CHẼ CHO TRƯỜNG HỢP 1 (Thanh toán bình thường trong hạn):
        // 1. Đơn đang ở trạng thái PAYMENT_PROCESSING
        // 2. Toàn bộ ghế trong đơn vẫn ĐANG ĐƯỢC GIỮ CHUẨN XÁC bởi chính đơn này (current_order_code = numericOrderCode và seat_status = PAYMENT_PROCESSING)
        const isStillActivelyHeld =
          order.status === 'PAYMENT_PROCESSING' &&
          orderItems.length > 0 &&
          orderItems.every(
            (item) =>
              item.seat_status === 'PAYMENT_PROCESSING' &&
              Number(item.current_order_code) === numericOrderCode
          );

        if (isStillActivelyHeld) {
          // TRƯỜNG HỢP 1: Cấp vé bình thường
          const seatIdsToSell = orderItems.map((item) => item.current_seat_id);
          const seatRes = await client.query(`
            UPDATE seats 
            SET status = 'SOLD', reserved_by = NULL, reserved_until = NULL, current_order_code = NULL 
            WHERE id = ANY($1::uuid[]) 
              AND current_order_code = $2 
              AND status = 'PAYMENT_PROCESSING'
            RETURNING id, seat_number;
          `, [seatIdsToSell, numericOrderCode]);

          if (seatRes.rows.length === orderItems.length) {
            await ticketRepository.updateOrderStatus(numericOrderCode, 'SUCCESS', client);
            finalOrderStatus = 'SUCCESS';
            updatedSeats = seatRes.rows;
            logger.payment('SUCCESS', `Đơn #${numericOrderCode} THANH TOÁN THÀNH CÔNG! ${updatedSeats.length} ghế thành SOLD`);
          } else {
            // Không cập nhật đủ 100% ghế -> bảo vệ chống trùng ghế, chuyển REFUND_PENDING
            await ticketRepository.updateOrderStatus(numericOrderCode, 'REFUND_PENDING', client);
            finalOrderStatus = 'REFUND_PENDING';
            logger.payment('WARN', `Đơn #${numericOrderCode} không thể cập nhật đủ ${orderItems.length} ghế thành SOLD -> Chuyển sang REFUND_PENDING!`);
          }
        }
        // TRƯỜNG HỢP 2: Đơn đã bị CANCELLED / EXPIRED / FAILED hoặc BỊ MẤT QUYỀN GIỮ CHỖ nhưng khách vẫn chuyển tiền!
        else {
          // Kiểm tra xem tất cả các ghế ban đầu còn AVAILABLE không
          const allOriginalSeatsAvailable =
            orderItems.length > 0 && orderItems.every((item) => item.seat_status === 'AVAILABLE');

          if (allOriginalSeatsAvailable) {
            // Trường hợp 2.1: Toàn bộ ghế ban đầu vẫn còn 100% trống (cả SEAT_BASED lẫn ZONE_BASED)
            const seatIdsToSell = orderItems.map((item) => item.current_seat_id);
            const seatRes = await client.query(`
              UPDATE seats
              SET status = 'SOLD', reserved_by = NULL, reserved_until = NULL, current_order_code = NULL
              WHERE id = ANY($1::uuid[]) AND status = 'AVAILABLE'
              RETURNING id, seat_number, zone_name;
            `, [seatIdsToSell]);

            if (seatRes.rows.length === orderItems.length) {
              await ticketRepository.updateOrderStatus(numericOrderCode, 'SUCCESS', client);
              finalOrderStatus = 'SUCCESS';
              updatedSeats = seatRes.rows;
              logger.payment(
                'SUCCESS',
                `[LATE_PAYMENT_ACCEPTED] Đơn #${numericOrderCode} (${eventType}) chuyển tiền muộn nhưng toàn bộ ${updatedSeats.length} ghế [${updatedSeats.map((s) => s.seat_number).join(', ')}] vẫn 100% AVAILABLE -> Cấp vé SUCCESS!`
              );
            } else {
              await ticketRepository.updateOrderStatus(numericOrderCode, 'REFUND_PENDING', client);
              finalOrderStatus = 'REFUND_PENDING';
              logger.payment(
                'WARN',
                `[REFUND_PENDING] Đơn #${numericOrderCode} (${eventType}) chuyển tiền muộn nhưng không đủ số ghế AVAILABLE -> Chuyển REFUND_PENDING!`
              );
            }
          } else if (eventType === 'ZONE_BASED' && orderItems.length > 0) {
            // Trường hợp 2.2: Sự kiện ZONE_BASED, một số ghế ban đầu đã bị người khác chọn/mua,
            // nhưng trong Zone đó vẫn còn ghế trống khác. Ta sẽ tự động bù ghế trống khác trong cùng Zone!
            const keptSeats = orderItems.filter((i) => i.seat_status === 'AVAILABLE');
            const itemsNeedingReplacement = orderItems.filter((i) => i.seat_status !== 'AVAILABLE');

            // Đếm số lượng ghế cần bù cho từng zone_name
            const neededByZone = {};
            for (const item of itemsNeedingReplacement) {
              const zName = item.zone_name;
              neededByZone[zName] = (neededByZone[zName] || 0) + 1;
            }

            let canReplaceAll = true;
            const replacementMap = new Map(); // order_item_id -> newSeatRow
            const excludeSeatIds = keptSeats.map((i) => i.current_seat_id);

            for (const [zoneName, neededQty] of Object.entries(neededByZone)) {
              const repRes = await client.query(`
                SELECT id, seat_number, zone_name, price
                FROM seats
                WHERE event_id = $1
                  AND zone_name = $2
                  AND status = 'AVAILABLE'
                  AND NOT (id = ANY($3::uuid[]))
                ORDER BY seat_number ASC
                LIMIT $4
                FOR UPDATE SKIP LOCKED;
              `, [eventId, zoneName, excludeSeatIds, neededQty]);

              if (repRes.rows.length < neededQty) {
                canReplaceAll = false;
                break;
              }

              for (const newSeat of repRes.rows) {
                excludeSeatIds.push(newSeat.id);
              }

              const itemsInZone = itemsNeedingReplacement.filter((i) => i.zone_name === zoneName);
              for (let idx = 0; idx < neededQty; idx++) {
                replacementMap.set(itemsInZone[idx].order_item_id, repRes.rows[idx]);
              }
            }

            if (canReplaceAll) {
              // Cập nhật lại order_items trỏ sang seat_id mới
              for (const [orderItemId, newSeat] of replacementMap.entries()) {
                await client.query(`
                  UPDATE order_items
                  SET seat_id = $1
                  WHERE id = $2;
                `, [newSeat.id, orderItemId]);
              }

              // Tổng hợp toàn bộ seat_id (ghế cũ còn trống + ghế mới bù vào)
              const allFinalSeatIds = [
                ...keptSeats.map((i) => i.current_seat_id),
                ...Array.from(replacementMap.values()).map((s) => s.id),
              ];

              const seatRes = await client.query(`
                UPDATE seats
                SET status = 'SOLD', reserved_by = NULL, reserved_until = NULL, current_order_code = NULL
                WHERE id = ANY($1::uuid[]) AND status = 'AVAILABLE'
                RETURNING id, seat_number, zone_name;
              `, [allFinalSeatIds]);

              if (seatRes.rows.length === allFinalSeatIds.length) {
                updatedSeats = seatRes.rows;
                await ticketRepository.updateOrderStatus(numericOrderCode, 'SUCCESS', client);
                finalOrderStatus = 'SUCCESS';

                const replacedDetails = Array.from(replacementMap.values()).map(s => `${s.zone_name}: ${s.seat_number}`).join(', ');
                logger.payment(
                  'SUCCESS',
                  `[LATE_PAYMENT_ZONE_REALLOCATED] Đơn #${numericOrderCode} (ZONE_BASED) chuyển tiền muộn: Giữ ${keptSeats.length} ghế trống cũ, cấp bù ${replacementMap.size} ghế mới [${replacedDetails}] -> Cấp vé SUCCESS!`
                );
              } else {
                await ticketRepository.updateOrderStatus(numericOrderCode, 'REFUND_PENDING', client);
                finalOrderStatus = 'REFUND_PENDING';
                logger.payment(
                  'WARN',
                  `[REFUND_PENDING] Đơn #${numericOrderCode} (ZONE_BASED) không thể cập nhật đủ ${allFinalSeatIds.length} ghế thành SOLD -> Chuyển sang REFUND_PENDING!`
                );
              }
            } else {
              // Trong Zone không còn đủ số lượng ghế trống thay thế -> chuyển REFUND_PENDING
              await ticketRepository.updateOrderStatus(numericOrderCode, 'REFUND_PENDING', client);
              finalOrderStatus = 'REFUND_PENDING';
              logger.payment(
                'WARN',
                `[REFUND_PENDING] Đơn #${numericOrderCode} (ZONE_BASED) chuyển tiền muộn nhưng khu vực không còn đủ ghế trống thay thế -> Chuyển sang REFUND_PENDING (Chờ hoàn tiền)!`
              );
            }
          } else {
            // Trường hợp 2.3: Sự kiện SEAT_BASED (ghế cố định), có ít nhất 1 ghế bị người khác chọn/mua
            await ticketRepository.updateOrderStatus(numericOrderCode, 'REFUND_PENDING', client);
            finalOrderStatus = 'REFUND_PENDING';
            const conflictSeats = orderItems
              .filter((i) => i.seat_status !== 'AVAILABLE')
              .map((i) => `${i.seat_number}(${i.seat_status})`)
              .join(', ');
            logger.payment(
              'WARN',
              `[REFUND_PENDING] Đơn #${numericOrderCode} (SEAT_BASED) chuyển tiền muộn nhưng ghế đã có người đụng tới [${conflictSeats}] -> Từ chối cấp vé, chuyển sang REFUND_PENDING (Chờ hoàn tiền)!`
            );
          }
        }
      } else if (order.status === 'PAYMENT_PROCESSING') {
        await ticketRepository.updateOrderStatus(numericOrderCode, 'FAILED', client);
        finalOrderStatus = 'FAILED';

        const seatRes = await client.query(`
          UPDATE seats 
          SET status = 'AVAILABLE', reserved_by = NULL, reserved_until = NULL, current_order_code = NULL 
          WHERE current_order_code = $1
          RETURNING id, seat_number;
        `, [numericOrderCode]);
        updatedSeats = seatRes.rows;
        logger.payment('CANCEL', `Đơn #${numericOrderCode} THẤT BẠI/HỦY! ${updatedSeats.length} ghế về AVAILABLE`);
      }

      await client.query('COMMIT');

      return { status: finalOrderStatus, orderCode: numericOrderCode };
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('HANDLE_PAYMENT_WEBHOOK', err.message, err);
      throw err;
    } finally {
      client.release();
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
      order.order_status === 'EXPIRED'
    ) {
      try {
        const paymentInfo = await payos.paymentRequests.get(numericOrderCode);
        if (paymentInfo?.status === 'PAID') {
          await this.handlePaymentWebhook(
            numericOrderCode,
            true,
            paymentInfo.amountPaid || paymentInfo.amount
          );
          order = await ticketRepository.getOrderWithItemsByCode(numericOrderCode);
        } else if (
          order.order_status === 'PAYMENT_PROCESSING' &&
          (paymentInfo?.status === 'CANCELLED' || paymentInfo?.status === 'EXPIRED')
        ) {
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            await client.query(
              `UPDATE orders SET status = $1 WHERE order_code = $2 AND status = 'PAYMENT_PROCESSING';`,
              [paymentInfo.status, numericOrderCode]
            );
            await client.query(
              `UPDATE seats SET status = 'AVAILABLE', reserved_by = NULL, reserved_until = NULL, current_order_code = NULL WHERE current_order_code = $1;`,
              [numericOrderCode]
            );
            await client.query('COMMIT');
          } catch (txErr) {
            await client.query('ROLLBACK');
            logger.error('SYNC_ORDER_STATUS', txErr.message, txErr);
          } finally {
            client.release();
          }
          order = await ticketRepository.getOrderWithItemsByCode(numericOrderCode);
        }
      } catch (err) {
        logger.payment('WARN', `Không thể đồng bộ trạng thái đơn #${numericOrderCode} từ PayOS: ${err.message}`);
      }
    }

    return order;
  }

  // Admin Functions
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
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const event = await ticketRepository.createEvent(
        title,
        description,
        location,
        start_time || new Date(),
        event_type,
        client
      );

      // Cập nhật bổ sung các trường chi tiết nếu có
      await client.query(
        `UPDATE events
         SET category = COALESCE($1, category),
             "time" = COALESCE($2, "time"),
             min_price = COALESCE($3, min_price),
             max_price = COALESCE($4, max_price),
             image = COALESCE($5, image),
             banner = COALESCE($6, banner),
             organizer = COALESCE($7, organizer),
             highlights = COALESCE($8, highlights),
             rules = COALESCE($9, rules),
             thumbnails = COALESCE($10, thumbnails)
         WHERE id = $11;`,
        [
          category || null,
          time || null,
          min_price !== undefined && min_price !== '' ? Number(min_price) : 0,
          max_price !== undefined && max_price !== '' ? Number(max_price) : 0,
          image || null,
          banner || null,
          organizer || null,
          highlights ? JSON.stringify(highlights) : null,
          rules ? JSON.stringify(rules) : null,
          Array.isArray(thumbnails) ? thumbnails : null,
          event.id,
        ]
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
            await client.query(
              `INSERT INTO seats (event_id, seat_number, zone_name, price, status)
               VALUES ($1, $2, 'STANDARD', $3, 'AVAILABLE');`,
              [event.id, `${rowLetter}${s}`, price]
            );
          }
        }
      } else {
        for (const z of (zoneConfigs || [])) {
          const count = Number(z.count) || 10;
          const price = Number(z.price) || 200000;
          const zoneName = (z.zoneName || 'STANDARD').toUpperCase();

          for (let i = 1; i <= count; i++) {
            await client.query(
              `INSERT INTO seats (event_id, seat_number, zone_name, price, status)
               VALUES ($1, $2, $3, $4, 'AVAILABLE');`,
              [event.id, `${zoneName}-${String(i).padStart(2, '0')}`, zoneName, price]
            );
          }
        }
      }

      await client.query('COMMIT');
      return event;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
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

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

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

      // Kiểm tra xem sự kiện đã có ghế nào được bán / đang giữ không
      const soldSeatsRes = await client.query(
        `SELECT COUNT(*) FROM seats WHERE event_id = $1 AND status != 'AVAILABLE';`,
        [eventId]
      );
      const hasSoldOrHeld = parseInt(soldSeatsRes.rows[0].count, 10) > 0;

      if (!hasSoldOrHeld) {
        // Chưa có vé nào bán: Xóa các ghế cũ và sinh lại layout mới theo yêu cầu
        await client.query('DELETE FROM seats WHERE event_id = $1;', [eventId]);

        if (event_type === 'SEAT_BASED' && seatConfig) {
          const rowsCount = Number(seatConfig.rowsCount) || 1;
          const seatsPerRow =
            Number(seatConfig.seatsPerRow) ||
            Math.ceil((Number(seatConfig.totalSeats) || 12) / rowsCount);
          const price = Number(seatConfig.price) || 200000;

          for (let r = 0; r < rowsCount; r++) {
            const rowLetter = String.fromCharCode(65 + r);
            for (let s = 1; s <= seatsPerRow; s++) {
              await client.query(
                `INSERT INTO seats (event_id, seat_number, zone_name, price, status)
                 VALUES ($1, $2, 'STANDARD', $3, 'AVAILABLE');`,
                [eventId, `${rowLetter}${s}`, price]
              );
            }
          }
        } else if (event_type === 'ZONE_BASED' && Array.isArray(zoneConfigs)) {
          for (const z of zoneConfigs) {
            const count = Number(z.count) || 10;
            const price = Number(z.price) || 200000;
            const zoneName = (z.zoneName || 'STANDARD').toUpperCase();

            for (let i = 1; i <= count; i++) {
              await client.query(
                `INSERT INTO seats (event_id, seat_number, zone_name, price, status)
                 VALUES ($1, $2, $3, $4, 'AVAILABLE');`,
                [eventId, `${zoneName}-${String(i).padStart(2, '0')}`, zoneName, price]
              );
            }
          }
        }
      } else {
        // Đã có vé bán: Không thể thay đổi số lượng/cấu trúc ghế để tránh mất dữ liệu vé đã mua
        // Cập nhật giá cho các ghế AVAILABLE còn lại
        if (event_type === 'SEAT_BASED' && seatConfig?.price) {
          await client.query(
            `UPDATE seats SET price = $1 WHERE event_id = $2 AND status = 'AVAILABLE';`,
            [Number(seatConfig.price), eventId]
          );
        } else if (event_type === 'ZONE_BASED' && Array.isArray(zoneConfigs)) {
          for (const z of zoneConfigs) {
            if (z.zoneName && z.price !== undefined) {
              await client.query(
                `UPDATE seats SET price = $1 WHERE event_id = $2 AND UPPER(zone_name) = $3 AND status = 'AVAILABLE';`,
                [Number(z.price), eventId, (z.zoneName || '').toUpperCase()]
              );
            }
          }
        }
      }

      await client.query('COMMIT');
      return updatedEvent;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async deleteEvent(eventId) {
    return await ticketRepository.deleteEvent(eventId);
  }
}

module.exports = new TicketService();

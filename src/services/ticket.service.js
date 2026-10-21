const pool = require('../config/db');
const payos = require('../config/payos');
const ticketRepository = require('../repositories/ticket.repository');
const logger = require('../utils/logger');
const {
  SEAT_HOLD_DURATION_SECONDS,
  PAYMENT_TIMEOUT_MINUTES,
} = require('../config/constants');

// Khai báo Map lưu vết các ghế đang tạm giữ trong RAM Node.js: seatId -> expiredAt (timestamp)
const localReservedSeats = new Map();

// Định kỳ dọn dẹp các ghế đã hết hạn trong RAM (mỗi 10 giây chạy 1 lần để tránh rò rỉ bộ nhớ)
setInterval(() => {
  const currentTime = Date.now();
  for (const [seatId, expiredAt] of localReservedSeats.entries()) {
    if (expiredAt <= currentTime) {
      localReservedSeats.delete(seatId);
    }
  }
}, 10 * 1000);

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

  async releaseReservedSeats(userId, seatIds) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const result = await client.query(`
        UPDATE seats 
        SET status = 'AVAILABLE', reserved_by = NULL, reserved_until = NULL, current_order_id = NULL
        WHERE id = ANY($1::uuid[]) 
          AND reserved_by = $2 
          AND status IN ('RESERVED', 'PAYMENT_PROCESSING')
        RETURNING id, seat_number, current_order_id;
      `, [seatIds, userId]);

      const orderIds = [...new Set(result.rows.map(r => r.current_order_id).filter(Boolean))];
      if (orderIds.length > 0) {
        await client.query(`UPDATE orders SET status = 'CANCELLED' WHERE id = ANY($1::uuid[]);`, [orderIds]);
      }

      await client.query('COMMIT');

      for (const row of result.rows) {
        localReservedSeats.delete(row.id);
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

  async startCheckoutSeats(userId, seatIds, returnUrl, cancelUrl) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const seatRes = await client.query(
        `SELECT * FROM seats WHERE id = ANY($1::uuid[]) ORDER BY id ASC FOR UPDATE;`,
        [seatIds]
      );

      const now = new Date();
      let total = 0;
      for (const seat of seatRes.rows) {
        if (seat.status !== 'RESERVED' || seat.reserved_by !== userId || new Date(seat.reserved_until) <= now) {
          throw new Error(`Ghế ${seat.seat_number} không hợp lệ hoặc đã hết hạn giữ chỗ.`);
        }
        total += Number(seat.price);
      }

      const paymentTimeout = new Date(Date.now() + PAYMENT_TIMEOUT_MINUTES * 60 * 1000);
      const orderCode = Number(String(Date.now()).slice(-6) + Math.floor(Math.random() * 90 + 10));
      
      const order = await ticketRepository.createOrder(userId, total, paymentTimeout, orderCode, client);

      for (const s of seatRes.rows) {
        await ticketRepository.createOrderItem(order.id, s.id, s.price, client);
      }

      await client.query(`
        UPDATE seats 
        SET status = 'PAYMENT_PROCESSING', reserved_until = $1, current_order_id = $2 
        WHERE id = ANY($3::uuid[]);
      `, [paymentTimeout, order.id, seatIds]);

      let checkoutUrl = null;
      try {
        const payosOrder = {
          orderCode: orderCode,
          amount: Number(total),
          description: `VE SU KIEN ${orderCode}`.slice(0, 25),
          returnUrl: returnUrl || `http://127.0.0.1:5500/index.html?orderId=${order.id}&status=success`,
          cancelUrl: cancelUrl || `http://127.0.0.1:5500/index.html?orderId=${order.id}&status=cancel`,
        };
        const paymentLink = await payos.paymentRequests.create(payosOrder);
        // DEBUG TẠM: xem PayOS trả gì khi tạo link (xóa sau khi test xong)
        console.log('[PAYOS-CREATE-DEBUG]', new Date().toISOString(), JSON.stringify(payosOrder), '=>', JSON.stringify(paymentLink));
        checkoutUrl = paymentLink.checkoutUrl;
      } catch (payErr) {
        logger.error('PAYOS_LINK_CREATION', `Lỗi tạo link PayOS cho đơn #${orderCode}: ${payErr.message}`);
        throw new Error(`Không thể tạo liên kết thanh toán PayOS: ${payErr.message}`);
      }

      await client.query('COMMIT');

      const newTimeoutMs = paymentTimeout.getTime();
      for (const seatId of seatIds) {
        localReservedSeats.set(seatId, newTimeoutMs);
      }

      logger.payment('START', `User ${userId} tạo đơn #${orderCode} | ${seatRes.rows.length} ghế | Tổng tiền: ${total.toLocaleString()}đ`);

      return { 
        orderId: order.id, 
        orderCode: orderCode, 
        checkoutUrl: checkoutUrl, 
        totalAmount: total, 
        paymentTimeout: paymentTimeout 
      };
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('START_CHECKOUT', err.message, err);
      throw err;
    } finally {
      client.release();
    }
  }

  async handlePaymentWebhook(orderIdentifier, isSuccess) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      const orderRes = await client.query(
        `SELECT * FROM orders WHERE (id::text = $1 OR order_code::text = $1) FOR UPDATE;`,
        [String(orderIdentifier)]
      );
      
      if (orderRes.rows.length === 0) {
        await client.query('ROLLBACK');
        logger.payment('WARN', `Không tìm thấy đơn hàng #${orderIdentifier} (có thể là ping test từ PayOS)`);
        return { success: true, message: 'Đơn hàng không tồn tại hoặc là ping test từ cổng thanh toán.' };
      }
      
      const order = orderRes.rows[0];
      const orderId = order.id;

      if (order.status === 'SUCCESS' && isSuccess) {
        await client.query('COMMIT');
        logger.payment('INFO', `Đơn #${order.order_code || orderId} đã ở trạng thái SUCCESS từ trước.`);
        return { success: true, message: 'Đơn hàng đã được xử lý trước đó.' };
      }

      let updatedSeats = [];

      if (isSuccess) {
        await ticketRepository.updateOrderStatus(orderId, 'SUCCESS', client);

        const seatRes = await client.query(`
          UPDATE seats 
          SET status = 'SOLD', reserved_by = NULL, reserved_until = NULL, current_order_id = NULL 
          WHERE current_order_id = $1
          RETURNING id, seat_number;
        `, [orderId]);
        updatedSeats = seatRes.rows;
        logger.payment('SUCCESS', `Đơn #${order.order_code || orderId} THANH TOÁN THÀNH CÔNG! ${updatedSeats.length} ghế thành SOLD`);
      } else {
        await ticketRepository.updateOrderStatus(orderId, 'FAILED', client);

        const seatRes = await client.query(`
          UPDATE seats 
          SET status = 'AVAILABLE', reserved_by = NULL, reserved_until = NULL, current_order_id = NULL 
          WHERE current_order_id = $1
          RETURNING id, seat_number;
        `, [orderId]);
        updatedSeats = seatRes.rows;
        logger.payment('CANCEL', `Đơn #${order.order_code || orderId} THẤT BẠI/HỦY! ${updatedSeats.length} ghế về AVAILABLE`);
      }

      await client.query('COMMIT');

      for (const seat of updatedSeats) {
        localReservedSeats.delete(seat.id);
      }

      return { status: isSuccess ? 'SUCCESS' : 'FAILED', orderId: orderId, orderCode: order.order_code };
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('HANDLE_PAYMENT_WEBHOOK', err.message, err);
      throw err;
    } finally {
      client.release();
    }
  }

  // Admin Functions
  async createEventWithConfig(eventData) {
    const { title, description, location, start_time, event_type, seatConfig, zoneConfigs } = eventData;
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

      if (event_type === 'SEAT_BASED') {
        const total = Number(seatConfig.totalSeats) || 12;
        const price = Number(seatConfig.price) || 200000;
        const prefix = seatConfig.prefix || 'S';

        for (let i = 1; i <= total; i++) {
          await client.query(`
            INSERT INTO seats (event_id, seat_number, zone_name, price, status)
            VALUES ($1, $2, 'STANDARD', $3, 'AVAILABLE');
          `, [event.id, `${prefix}${i}`, price]);
        }
      } else {
        for (const z of (zoneConfigs || [])) {
          const count = Number(z.count) || 10;
          const price = Number(z.price) || 200000;
          const zoneName = z.zoneName.toUpperCase();

          for (let i = 1; i <= count; i++) {
            await client.query(`
              INSERT INTO seats (event_id, seat_number, zone_name, price, status)
              VALUES ($1, $2, $3, $4, 'AVAILABLE');
            `, [event.id, `${zoneName}-${String(i).padStart(2, '0')}`, zoneName, price]);
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

  async deleteEvent(eventId) {
    return await ticketRepository.deleteEvent(eventId);
  }
}

module.exports = new TicketService();

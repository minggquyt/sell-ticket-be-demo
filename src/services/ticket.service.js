const pool = require('../config/db');
const payos = require('../config/payos');
const logger = require('../utils/logger');

// Customer Function
async function getUserOrderHistory(userId) {
  const query = `
    SELECT 
      o.id AS order_id,
      o.total_amount,
      o.status AS order_status,
      o.created_at,
      e.title AS event_title,
      e.event_type,
      e.location,
      COALESCE(
        json_agg(
          json_build_object(
            'seat_number', s.seat_number,
            'zone_name', s.zone_name,
            'price', oi.price
          )
        ) FILTER (WHERE s.id IS NOT NULL), '[]'
      ) AS items
    FROM orders o
    JOIN order_items oi ON o.id = oi.order_id
    JOIN seats s ON oi.seat_id = s.id
    JOIN events e ON s.event_id = e.id
    WHERE o.user_id = $1
    GROUP BY o.id, e.id
    ORDER BY o.created_at DESC;
  `;
  const res = await pool.query(query, [userId]);
  return res.rows;
}

// function check user còn phiên giữ ghế nào hay không
async function checkActiveHold(client, userId) {
  const result = await client.query(
    `
    SELECT 1 FROM seats 
    WHERE reserved_by = $1 
      AND status IN ('RESERVED', 'PAYMENT_PROCESSING') 
      AND reserved_until > NOW()
    LIMIT 1;
    `,
    [userId]
  );
  return result.rows.length > 0;
}

async function requestSeatHold(userId, requestedSeatIds) {
  const client = await pool.connect();

  try {
    // 1. Kiểm tra Active Hold trước khi mở Transaction
    const hasActiveHold = await checkActiveHold(client, userId);
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
      `
      SELECT id, seat_number, price, zone_name
      FROM seats
      WHERE id = ANY($1::uuid[])
        AND status = 'AVAILABLE'
      ORDER BY id ASC
      FOR UPDATE SKIP LOCKED;
      `,
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
      const holdDurationSeconds = 30; // Giữ 30s
      const reservedUntil = new Date(Date.now() + holdDurationSeconds * 1000);

      const updateResult = await client.query(
        `
        UPDATE seats 
        SET status = 'RESERVED', reserved_by = $1, reserved_until = $2
        WHERE id = ANY($3::uuid[])
        RETURNING id, seat_number, status, reserved_until;
        `,
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
      // Trả về danh sách ID khả dụng để FE dùng gửi lại ở Phase 2
      availableSeatIds: availableIds,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('SEAT_HOLD_REQUEST', err.message, err);
    throw err;
  } finally {
    client.release(); // Luôn giải phóng Connection
  }
}

async function confirmPartialHold(userId, confirmSeatIds) {
  const client = await pool.connect();

  try {
    // 1. Kiểm tra Active Hold
    const hasActiveHold = await checkActiveHold(client, userId);
    if (hasActiveHold) {
      logger.hold('CONFLICT', `User ${userId} bị chặn confirm vì đang có phiên giữ vé chưa hoàn tất`);
      return {
        success: false,
        code: 'USER_HAS_ACTIVE_HOLD',
        message: 'Bạn đang có một phiên giữ vé chưa hoàn tất.',
      };
    }

    await client.query('BEGIN');

    const holdDurationSeconds = 30;
    const reservedUntil = new Date(Date.now() + holdDurationSeconds * 1000);

    // 2. Thử UPDATE chính thức các ghế này NẾU chúng vẫn còn status = 'AVAILABLE'
    const updateResult = await client.query(
      `
      UPDATE seats
      SET status = 'RESERVED', reserved_by = $1, reserved_until = $2
      WHERE id = ANY($3::uuid[])
        AND status = 'AVAILABLE'
      RETURNING id, seat_number, status, reserved_until;
      `,
      [userId, reservedUntil, confirmSeatIds]
    );

    // 3. Kiểm tra xem có ghế nào bị User khác "cướp" mất trong thời gian User hiện tại suy nghĩ không
    if (updateResult.rows.length !== confirmSeatIds.length) {
      // Nếu không đủ số lượng -> Rollback hủy toàn bộ lượt chọn này
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

// Lấy danh sách sự kiện
async function getAllEvents() {
  const res = await pool.query('SELECT * FROM events ORDER BY created_at DESC;');
  return res.rows;
}

// Lấy chi tiết ghế / zones
async function getSeatsByEvent(eventId) {
  await pool.query(`
    UPDATE seats 
    SET status = 'AVAILABLE', reserved_by = NULL, reserved_until = NULL, current_order_id = NULL
    WHERE status IN ('RESERVED', 'PAYMENT_PROCESSING') AND reserved_until < NOW();
  `);
  const res = await pool.query('SELECT * FROM seats WHERE event_id = $1 ORDER BY seat_number ASC;', [eventId]);
  return res.rows;
}

async function getZonesByEvent(eventId) {
  await pool.query(`
    UPDATE seats 
    SET status = 'AVAILABLE', reserved_by = NULL, reserved_until = NULL, current_order_id = NULL
    WHERE status IN ('RESERVED', 'PAYMENT_PROCESSING') AND reserved_until < NOW();
  `);
  const res = await pool.query(`
    SELECT 
      zone_name,
      price,
      COUNT(id) FILTER (WHERE status = 'AVAILABLE') AS available_count,
      COUNT(id) AS total_count
    FROM seats 
    WHERE event_id = $1 
    GROUP BY zone_name, price 
    ORDER BY price DESC;
  `, [eventId]);
  return res.rows;
}

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

// Giữ ghế Seat-based tối ưu hiệu năng cao

// Giữ ghế Zone-based
async function reserveSeatsByMultipleZones(userId, eventId, zoneRequests) {
  // zoneRequests: [ { zoneName: 'VIP', quantity: 2 }, { zoneName: 'REGULAR', quantity: 3 } ]
  if (!zoneRequests || !Array.isArray(zoneRequests) || zoneRequests.length === 0) {
    throw new Error('Danh sách khu vực chọn không hợp lệ.');
  }

  // Lọc bỏ các request có quantity <= 0
  const validRequests = zoneRequests
    .map(r => ({ zoneName: r.zoneName, quantity: Number(r.quantity) }))
    .filter(r => r.quantity > 0);

  if (validRequests.length === 0) {
    throw new Error('Bạn chưa chọn số lượng vé hợp lệ nào.');
  }

  const totalRequested = validRequests.reduce((sum, r) => sum + r.quantity, 0);
  const now = new Date();
  const until = new Date(Date.now() + 30 * 1000); // 30s giữ ghế

  const query = `
  WITH user_active_hold AS (
    -- 1. Chặn ngay nếu user đang có phiên giữ vé còn hiệu lực
    SELECT 1 FROM seats 
    WHERE reserved_by = $1 
      AND status IN ('RESERVED', 'PAYMENT_PROCESSING') 
      AND reserved_until > $2
    LIMIT 1
  ),
  zone_demands AS (
    -- 2. Parse JSON và lọc luôn nếu user đang active hold
    SELECT "zoneName" AS zone_name, quantity::int AS required_qty 
    FROM jsonb_to_recordset($3::jsonb) AS x("zoneName" text, quantity int)
    WHERE NOT EXISTS (SELECT 1 FROM user_active_hold)
  ),
  locked_seats AS (
    -- 3. Quét B-Tree Index cực nhanh với SKIP LOCKED
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
    -- 4. Kiểm tra xem từng zone có đủ 100% số vé yêu cầu hay không
    SELECT zd.zone_name, zd.required_qty, COUNT(ls.id) AS locked_qty
    FROM zone_demands zd
    LEFT JOIN locked_seats ls ON zd.zone_name = ls.zone_name
    GROUP BY zd.zone_name, zd.required_qty
  )
  -- 5. Chỉ UPDATE nếu không có zone nào bị thiếu vé
  UPDATE seats
  SET status = 'RESERVED', reserved_by = $1, reserved_until = $5
  WHERE id IN (SELECT id FROM locked_seats)
    AND NOT EXISTS (
      SELECT 1 FROM checked_availability WHERE locked_qty < required_qty
    )
  RETURNING id, seat_number, zone_name, price, status, reserved_until;
`;

  try {
    // 1 lần trao đổi mạng duy nhất (1 Round-trip)
    const result = await pool.query(query, [
      userId,
      now,
      JSON.stringify(validRequests),
      eventId,
      until
    ]);

    // Nếu không khớp đủ tổng số vé đã yêu cầu -> Cháy vé ở 1 khu vực hoặc user đang có phiên cũ
    if (result.rows.length !== totalRequested) {
      logger.hold('CONFLICT', `User ${userId} giữ vé khu vực thất bại: Yêu cầu ${totalRequested} vé, đáp ứng ${result.rows.length} vé (Khu vực hết vé hoặc kẹt phiên)`);
      throw new Error('Số lượng vé khả dụng không đủ hoặc bạn đang có một phiên giữ vé chưa hoàn tất.');
    }

    logger.hold('SUCCESS', `User ${userId} giữ thành công ${result.rows.length} vé khu vực: ${validRequests.map(r => `${r.zoneName} (${r.quantity})`).join(', ')} đến ${until.toLocaleTimeString()}`);

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


// Hủy giữ ghế
async function releaseReservedSeats(userId, seatIds) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Giải phóng những ghế đang được giữ bởi chính user này (kể cả đang RESERVED hoặc PAYMENT_PROCESSING)
    const result = await client.query(`
      UPDATE seats 
      SET status = 'AVAILABLE', reserved_by = NULL, reserved_until = NULL, current_order_id = NULL
      WHERE id = ANY($1::uuid[]) 
        AND reserved_by = $2 
        AND status IN ('RESERVED', 'PAYMENT_PROCESSING')
      RETURNING id, seat_number, current_order_id;
    `, [seatIds, userId]);

    // Nếu các ghế này gắn với order đang chờ thanh toán, cập nhật order thành CANCELLED
    const orderIds = [...new Set(result.rows.map(r => r.current_order_id).filter(Boolean))];
    if (orderIds.length > 0) {
      await client.query(`UPDATE orders SET status = 'CANCELLED' WHERE id = ANY($1::uuid[]);`, [orderIds]);
    }

    await client.query('COMMIT');

    // CẬP NHẬT MAP: Giải phóng ngay các ghế đã hủy thành công khỏi RAM để user khác có thể đặt ngay lập tức
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

// Khởi tạo thanh toán
async function startCheckoutSeats(userId, seatIds, returnUrl, cancelUrl) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Khóa dòng của các ghế được thanh toán
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

    const paymentTimeout = new Date(Date.now() + 5 * 60 * 1000); // 5 phút chờ thanh toán
    const orderCode = Number(String(Date.now()).slice(-6) + Math.floor(Math.random() * 90 + 10));
    const orderRes = await client.query(`
      INSERT INTO orders (user_id, total_amount, status, expires_at, order_code) 
      VALUES ($1, $2, 'PAYMENT_PROCESSING', $3, $4) 
      RETURNING *;
    `, [userId, total, paymentTimeout, orderCode]);
    const order = orderRes.rows[0];

    for (const s of seatRes.rows) {
      await client.query(
        `INSERT INTO order_items (order_id, seat_id, price) VALUES ($1, $2, $3);`,
        [order.id, s.id, s.price]
      );
    }

    await client.query(`
      UPDATE seats 
      SET status = 'PAYMENT_PROCESSING', reserved_until = $1, current_order_id = $2 
      WHERE id = ANY($3::uuid[]);
    `, [paymentTimeout, order.id, seatIds]);

    // Tạo link thanh toán PayOS
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
      checkoutUrl = paymentLink.checkoutUrl;
    } catch (payErr) {
      logger.error('PAYOS_LINK_CREATION', `Lỗi tạo link PayOS cho đơn #${orderCode}: ${payErr.message}`);
      throw new Error(`Không thể tạo liên kết thanh toán PayOS: ${payErr.message}`);
    }

    await client.query('COMMIT');

    // CẬP NHẬT MAP: Gia hạn thời gian giữ ghế trong RAM theo paymentTimeout mới
    const newTimeoutMs = paymentTimeout.getTime();
    for (const seatId of seatIds) {
      localReservedSeats.set(seatId, newTimeoutMs);
    }

    logger.payment('START', `User ${userId} tạo đơn #${orderCode} | ${seatRes.rows.length} ghế [${seatRes.rows.map(s => s.seat_number).join(', ')}] | Tổng tiền: ${total.toLocaleString()}đ -> Checkout URL sẵn sàng`);

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

// Webhook xử lý thanh toán
async function handlePaymentWebhook(orderIdentifier, isSuccess) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const orderRes = await client.query(
      `SELECT * FROM orders WHERE (id::text = $1 OR order_code::text = $1) FOR UPDATE;`,
      [String(orderIdentifier)]
    );
    if (orderRes.rows.length === 0) {
      await client.query('ROLLBACK');
      logger.payment('WARN', `Không tìm thấy đơn hàng #${orderIdentifier} trong CSDL (có thể là ping test từ PayOS). Bỏ qua an toàn.`);
      return { success: true, message: 'Đơn hàng không tồn tại hoặc là ping test từ cổng thanh toán.' };
    }
    const order = orderRes.rows[0];
    const orderId = order.id;

    // Chống xử lý trùng lặp nếu đơn hàng đã được cập nhật trước đó
    if (order.status === 'SUCCESS' && isSuccess) {
      await client.query('COMMIT');
      logger.payment('INFO', `Đơn #${order.order_code || orderId} đã ở trạng thái SUCCESS từ trước.`);
      return { success: true, message: 'Đơn hàng đã được xử lý trước đó.' };
    }

    let updatedSeats = [];

    if (isSuccess) {
      await client.query(`UPDATE orders SET status = 'SUCCESS' WHERE id = $1;`, [orderId]);

      // Cập nhật ghế thành SOLD và trả về danh sách ID ghế vừa cập nhật
      const seatRes = await client.query(`
        UPDATE seats 
        SET status = 'SOLD', reserved_by = NULL, reserved_until = NULL, current_order_id = NULL 
        WHERE current_order_id = $1
        RETURNING id, seat_number;
      `, [orderId]);
      updatedSeats = seatRes.rows;
      logger.payment('SUCCESS', `Đơn #${order.order_code || orderId} THANH TOÁN THÀNH CÔNG! Đã chuyển ${updatedSeats.length} ghế [${updatedSeats.map(s => s.seat_number).join(', ')}] thành SOLD`);
    } else {
      await client.query(`UPDATE orders SET status = 'FAILED' WHERE id = $1;`, [orderId]);

      // Trả ghế về AVAILABLE và lấy danh sách ID ghế để xóa khỏi bộ nhớ đệm
      const seatRes = await client.query(`
        UPDATE seats 
        SET status = 'AVAILABLE', reserved_by = NULL, reserved_until = NULL, current_order_id = NULL 
        WHERE current_order_id = $1
        RETURNING id, seat_number;
      `, [orderId]);
      updatedSeats = seatRes.rows;
      logger.payment('CANCEL', `Đơn #${order.order_code || orderId} THẤT BẠI/HỦY! Đã trả ${updatedSeats.length} ghế [${updatedSeats.map(s => s.seat_number).join(', ')}] về AVAILABLE`);
    }

    await client.query('COMMIT');

    // CẬP NHẬT MAP: Xóa toàn bộ các ghế liên quan khỏi RAM
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

// Admin Function 
async function createEventWithConfig(eventData) {
  const { title, description, location, start_time, event_type, seatConfig, zoneConfigs } = eventData;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Tạo sự kiện
    const eventRes = await client.query(`
      INSERT INTO events (title, description, location, start_time, event_type)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
    `, [title, description, location, start_time || new Date(), event_type]);
    const event = eventRes.rows[0];

    // 2. Cấu hình ghế tùy theo loại sự kiện
    if (event_type === 'SEAT_BASED') {
      // seatConfig: { totalSeats: 20, price: 300000, prefix: 'A' }
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
      // zoneConfigs: [ { zoneName: 'VIP', count: 10, price: 500000 }, { zoneName: 'REGULAR', count: 20, price: 250000 } ]
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

async function deleteEvent(eventId) {
  await pool.query('DELETE FROM events WHERE id = $1;', [eventId]);
  return true;
}

module.exports = {
  createEventWithConfig,
  deleteEvent,
  getUserOrderHistory,
  getAllEvents,
  getSeatsByEvent,
  getZonesByEvent,
  reserveSeatsByMultipleZones,
  startCheckoutSeats,
  handlePaymentWebhook,
  releaseReservedSeats,
  confirmPartialHold,
  requestSeatHold
};

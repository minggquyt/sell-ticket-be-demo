const pool = require('../config/db');

// 1. Quét dọn ghế hết hạn (chỉ dọn RESERVED hoặc PAYMENT_PROCESSING đã quá hạn)
async function getSeatsByEvent(eventId) {
  await pool.query(`
    UPDATE seats 
    SET status = 'AVAILABLE', reserved_by = NULL, reserved_until = NULL, current_order_id = NULL
    WHERE status IN ('RESERVED', 'PAYMENT_PROCESSING') AND reserved_until < NOW();
  `);

  const query = `
    SELECT id, seat_number, price, status, reserved_until 
    FROM seats 
    WHERE event_id = $1 
    ORDER BY seat_number ASC;
  `;
  const result = await pool.query(query, [eventId]);
  return result.rows;
}

// 2. Giữ chỗ ban đầu (RESERVED trong 5 phút)
async function reserveSeats(userId, seatIds, durationMinutes = 5) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const seatQuery = `
      SELECT id, seat_number, status, reserved_until 
      FROM seats 
      WHERE id = ANY($1::uuid[]) 
      ORDER BY id ASC 
      FOR UPDATE;
    `;
    const seatRes = await client.query(seatQuery, [seatIds]);

    if (seatRes.rows.length !== seatIds.length) {
      throw new Error('Một số ghế không tồn tại.');
    }

    const now = new Date();
    for (const seat of seatRes.rows) {
      const isSold = seat.status === 'SOLD';
      const isOccupied = (seat.status === 'RESERVED' || seat.status === 'PAYMENT_PROCESSING') 
                         && new Date(seat.reserved_until) > now;

      if (isSold || isOccupied) {
        throw new Error(`Ghế ${seat.seat_number} đang được người khác xử lý hoặc đã bán.`);
      }
    }

    const reserveUntil = new Date(now.getTime() + durationMinutes * 60 * 1000);
    const updateQuery = `
      UPDATE seats 
      SET status = 'RESERVED', reserved_by = $1, reserved_until = $2, current_order_id = NULL
      WHERE id = ANY($3::uuid[]) 
      RETURNING *;
    `;
    const updated = await client.query(updateQuery, [userId, reserveUntil, seatIds]);

    await client.query('COMMIT');
    return { seats: updated.rows, reserved_until: reserveUntil };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// 3. Người dùng bấm thanh toán -> Chuyển sang PAYMENT_PROCESSING và cộng thêm 10 phút chờ Webhook
async function startCheckoutSeats(userId, seatIds, paymentWaitMinutes = 10) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const seatRes = await client.query(
      `SELECT * FROM seats WHERE id = ANY($1::uuid[]) ORDER BY id ASC FOR UPDATE;`,
      [seatIds]
    );

    if (seatRes.rows.length !== seatIds.length) {
      throw new Error('Dữ liệu ghế không hợp lệ.');
    }

    const now = new Date();
    let totalAmount = 0;

    for (const seat of seatRes.rows) {
      // Ghế phải đang ở trạng thái RESERVED do chính user giữ và chưa hết hạn 5 phút
      if (
        seat.status !== 'RESERVED' || 
        seat.reserved_by !== userId || 
        new Date(seat.reserved_until) <= now
      ) {
        throw new Error(`Phiên giữ ghế ${seat.seat_number} đã hết hạn. Vui lòng chọn lại.`);
      }
      totalAmount += Number(seat.price);
    }

    // Gia hạn thời gian giữ ghế để chờ cổng thanh toán (Webhook)
    const paymentTimeout = new Date(now.getTime() + paymentWaitMinutes * 60 * 1000);

    // Tạo Order ở trạng thái PAYMENT_PROCESSING
    const orderRes = await client.query(
      `INSERT INTO orders (user_id, total_amount, status, expires_at) 
       VALUES ($1, $2, 'PAYMENT_PROCESSING', $3) 
       RETURNING *;`,
      [userId, totalAmount, paymentTimeout]
    );
    const order = orderRes.rows[0];

    // Tạo chi tiết Order Items
    for (const seat of seatRes.rows) {
      await client.query(
        `INSERT INTO order_items (order_id, seat_id, price) VALUES ($1, $2, $3);`,
        [order.id, seat.id, seat.price]
      );
    }

    // Chuyển trạng thái ghế sang PAYMENT_PROCESSING
    await client.query(
      `UPDATE seats 
       SET status = 'PAYMENT_PROCESSING', reserved_until = $1, current_order_id = $2 
       WHERE id = ANY($3::uuid[]);`,
      [paymentTimeout, order.id, seatIds]
    );

    await client.query('COMMIT');
    return { orderId: order.id, totalAmount, expiresAt: paymentTimeout };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// 4. Webhook nhận kết quả từ Cổng thanh toán (VNPAY/MoMo/Stripe)
async function handlePaymentWebhook(orderId, isPaymentSuccessful) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Khóa đơn hàng
    const orderRes = await client.query(
      `SELECT * FROM orders WHERE id = $1 FOR UPDATE;`,
      [orderId]
    );
    if (orderRes.rows.length === 0) throw new Error('Không tìm thấy đơn hàng.');
    const order = orderRes.rows[0];

    // Tránh xử lý lặp lại nếu Webhook gọi nhiều lần
    if (order.status === 'SUCCESS' || order.status === 'FAILED') {
      await client.query('COMMIT');
      return { status: order.status, message: 'Đơn hàng đã được xử lý trước đó.' };
    }

    if (isPaymentSuccessful) {
      // 1. Chuyển đơn hàng sang SUCCESS
      await client.query(`UPDATE orders SET status = 'SUCCESS' WHERE id = $1;`, [orderId]);

      // 2. Chuyển toàn bộ ghế liên quan sang SOLD
      await client.query(
        `UPDATE seats 
         SET status = 'SOLD', reserved_by = NULL, reserved_until = NULL, current_order_id = NULL 
         WHERE current_order_id = $1;`,
        [orderId]
      );
    } else {
      // 1. Chuyển đơn hàng sang FAILED
      await client.query(`UPDATE orders SET status = 'FAILED' WHERE id = $1;`, [orderId]);

      // 2. Trả ghế về AVAILABLE để người khác mua
      await client.query(
        `UPDATE seats 
         SET status = 'AVAILABLE', reserved_by = NULL, reserved_until = NULL, current_order_id = NULL 
         WHERE current_order_id = $1;`,
        [orderId]
      );
    }

    await client.query('COMMIT');
    return { status: isPaymentSuccessful ? 'SUCCESS' : 'FAILED' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  getSeatsByEvent,
  reserveSeats,
  startCheckoutSeats,
  handlePaymentWebhook
};
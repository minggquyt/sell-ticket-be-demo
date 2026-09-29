const pool = require('../config/db');

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

// Giữ ghế Seat-based
// async function reserveSeats(userId, seatIds) {
//   if (!seatIds || !Array.isArray(seatIds) || seatIds.length === 0) {
//     throw new Error('Danh sách ghế chọn không hợp lệ.');
//   }

//   const now = new Date();
//   const until = new Date(Date.now() + 30 * 1000);

//   const query = `
//     WITH user_active_hold AS (
//       SELECT 1 FROM seats 
//       WHERE reserved_by = $1 
//         AND status IN ('RESERVED', 'PAYMENT_PROCESSING') 
//         AND reserved_until > $2
//       LIMIT 1
//     ),
//     locked_available_seats AS (
//       SELECT id, seat_number 
//       FROM seats 
//       WHERE id = ANY($3::uuid[])
//         AND status NOT IN ('SOLD')
//         AND NOT ((status IN ('RESERVED', 'PAYMENT_PROCESSING')) AND reserved_until > $2)
//         AND NOT EXISTS (SELECT 1 FROM user_active_hold)
//       ORDER BY id ASC
//       FOR UPDATE NOWAIT
//     )
//     UPDATE seats 
//     SET status = 'RESERVED', reserved_by = $1, reserved_until = $4
//     WHERE id IN (SELECT id FROM locked_available_seats)
//       AND (SELECT COUNT(*) FROM locked_available_seats) = $5
//     RETURNING id, seat_number, status, reserved_until;
//   `;

//   try {
//     // DÙNG TRỰC TIẾP pool.query: CHỈ TỐN 1 ROUND-TRIP MẠNG DUY NHẤT
//     const result = await pool.query(query, [
//       userId, 
//       now, 
//       seatIds, 
//       until, 
//       seatIds.length
//     ]);

//     if (result.rows.length !== seatIds.length) {
//       throw new Error('Một hoặc nhiều ghế bạn chọn hiện không còn khả dụng.');
//     }

//     return { seats: result.rows, reserved_until: until };
//   } catch (err) {
//     if (err.code === '55P03') {
//       const lockErr = new Error('Ghế bạn chọn đang có người khác thao tác giữ chỗ. Vui lòng chọn ghế khác!');
//       lockErr.statusCode = 409;
//       throw lockErr;
//     }
//     throw err;
//   }
// }
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
async function reserveSeats(userId, seatIds) {
  if (!seatIds || !Array.isArray(seatIds) || seatIds.length === 0) {
    const badReqErr = new Error('Danh sách ghế chọn không hợp lệ.');
    badReqErr.statusCode = 400;
    throw badReqErr;
  }

  const currentTimestamp = Date.now();

  // BƯỚC 1: EARLY EXIT - Kiểm tra nhanh trên RAM Node.js (tốn ~0.01ms)
  // Nếu có bất kỳ ghế nào vừa được giữ thành công và còn hạn, từ chối ngay lập tức!
  for (const seatId of seatIds) {
    const expiredAt = localReservedSeats.get(seatId);
    if (expiredAt && expiredAt > currentTimestamp) {
      const conflictErr = new Error('Một hoặc nhiều ghế bạn chọn vừa có người khác giữ chỗ. Vui lòng chọn ghế khác!');
      conflictErr.statusCode = 409;
      throw conflictErr;
    }
  }

  const now = new Date(currentTimestamp);
  const until = new Date(currentTimestamp + 30 * 1000); // Giữ trong 30 giây

  // BƯỚC 2: SQL QUERY SỬ DỤNG SKIP LOCKED (Không rollback, không lỗi 55P03)
  const query = `
    WITH user_active_hold AS (
      SELECT 1 FROM seats 
      WHERE reserved_by = $1 
        AND status IN ('RESERVED', 'PAYMENT_PROCESSING') 
        AND reserved_until > $2
      LIMIT 1
    ),
    locked_available_seats AS (
      SELECT id, seat_number 
      FROM seats 
      WHERE id = ANY($3::uuid[])
        AND status = 'AVAILABLE'
        AND NOT ((status IN ('RESERVED', 'PAYMENT_PROCESSING')) AND reserved_until > $2)
        AND NOT EXISTS (SELECT 1 FROM user_active_hold)
      ORDER BY id ASC
      FOR UPDATE SKIP LOCKED
    )
    UPDATE seats 
    SET status = 'RESERVED', reserved_by = $1, reserved_until = $4
    WHERE id IN (SELECT id FROM locked_available_seats)
      AND (SELECT COUNT(*) FROM locked_available_seats) = $5
    RETURNING id, seat_number, status, reserved_until;
  `;

  // BƯỚC 3: Gửi 1 round-trip duy nhất xuống DB
  const result = await pool.query(query, [
    userId, 
    now, 
    seatIds, 
    until, 
    seatIds.length
  ]);

  // BƯỚC 4: Kiểm tra kết quả
  // Nếu không đủ số ghế yêu cầu (do ghế bị skip locked hoặc user đang có phiên giữ chỗ khác)
  if (result.rows.length !== seatIds.length) {
    const unavailableErr = new Error('Một hoặc nhiều ghế bạn chọn hiện không còn khả dụng.');
    unavailableErr.statusCode = 409;
    throw unavailableErr;
  }

  // BƯỚC 5: Ghi nhận ngay các ghế vừa giữ thành công vào RAM để chặn các user tiếp theo
  const expireTimeMs = until.getTime();
  for (const row of result.rows) {
    localReservedSeats.set(row.id, expireTimeMs);
  }

  return { seats: result.rows, reserved_until: until };
}

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
      -- 1. Chặn nếu user đang có phiên giữ vé còn hiệu lực
      SELECT 1 FROM seats 
      WHERE reserved_by = $1 
        AND status IN ('RESERVED', 'PAYMENT_PROCESSING') 
        AND reserved_until > $2
      LIMIT 1
    ),
    zone_demands AS (
      -- 2. Parse danh sách yêu cầu từ JSON vào bảng tạm: zone_name, required_qty
      SELECT "zoneName" AS zone_name, quantity::int AS required_qty 
      FROM jsonb_to_recordset($3::jsonb) AS x("zoneName" text, quantity int)
    ),
    locked_seats AS (
      -- 3. Quét và khóa đúng số lượng vé AVAILABLE cho từng zone bằng SKIP LOCKED
      SELECT s.id, s.seat_number, s.zone_name, s.price
      FROM zone_demands zd
      CROSS JOIN LATERAL (
        SELECT id, seat_number, zone_name, price
        FROM seats
        WHERE event_id = $4
          AND zone_name = zd.zone_name
          AND status = 'AVAILABLE'
          AND NOT EXISTS (SELECT 1 FROM user_active_hold)
        ORDER BY seat_number ASC
        LIMIT zd.required_qty
        FOR UPDATE SKIP LOCKED
      ) s
    ),
    checked_availability AS (
      -- 4. Kiểm tra xem từng zone có đủ số vé yêu cầu hay không
      SELECT zd.zone_name, zd.required_qty, COUNT(ls.id) AS locked_qty
      FROM zone_demands zd
      LEFT JOIN locked_seats ls ON zd.zone_name = ls.zone_name
      GROUP BY zd.zone_name, zd.required_qty
    )
    -- 5. Chỉ UPDATE nếu toàn bộ các zone đều đáp ứng đủ 100% số vé yêu cầu
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
      throw new Error('Số lượng vé khả dụng không đủ hoặc bạn đang có một phiên giữ vé chưa hoàn tất.');
    }

    return {
      seats: result.rows,
      seatIds: result.rows.map(s => s.id),
      reserved_until: until,
      totalTickets: result.rows.length
    };
  } catch (err) {
    throw err;
  }
}


// // Hủy giữ ghế
// async function releaseReservedSeats(userId, seatIds) {
//   const client = await pool.connect();
//   try {
//     await client.query('BEGIN');

//     // Chỉ giải phóng những ghế đang được giữ bởi chính user này và chưa bị bán
//     const result = await client.query(`
//       UPDATE seats 
//       SET status = 'AVAILABLE', reserved_by = NULL, reserved_until = NULL, current_order_id = NULL
//       WHERE id = ANY($1::uuid[]) 
//         AND reserved_by = $2 
//         AND status = 'RESERVED'
//       RETURNING id, seat_number;
//     `, [seatIds, userId]);

//     await client.query('COMMIT');
//     return result.rows;
//   } catch (err) {
//     await client.query('ROLLBACK');
//     throw err;
//   } finally {
//     client.release();
//   }
// }

// // Khởi tạo thanh toán
// async function startCheckoutSeats(userId, seatIds) {
//   const client = await pool.connect();
//   try {
//     await client.query('BEGIN');
//     // THỰC HIỆN KHÓA DÒNG CỦA CÁC GHẾ ĐƯỢC THANH TOÁN.
//     const seatRes = await client.query(`SELECT * FROM seats WHERE id = ANY($1::uuid[]) ORDER BY id ASC FOR UPDATE;`, [seatIds]);

//     const now = new Date();
//     let total = 0;
//     for (const seat of seatRes.rows) {
//       if (seat.status !== 'RESERVED' || seat.reserved_by !== userId || new Date(seat.reserved_until) <= now) {
//         throw new Error(`Ghế ${seat.seat_number} đã quá thời hạn 5 phút.`);
//       }
//       total += Number(seat.price);
//     }

//     const paymentTimeout = new Date(Date.now() + 1 * 60 * 1000); // thời gian chờ (1 phút)
//     const orderRes = await client.query(`
//       INSERT INTO orders (user_id, total_amount, status, expires_at) 
//       VALUES ($1, $2, 'PAYMENT_PROCESSING', $3) 
//       RETURNING *;
//     `, [userId, total, paymentTimeout]);
//     const order = orderRes.rows[0];

//     for (const s of seatRes.rows) {
//       await client.query(`INSERT INTO order_items (order_id, seat_id, price) VALUES ($1, $2, $3);`, [order.id, s.id, s.price]);
//     }


//     await client.query(`
//       UPDATE seats 
//       SET status = 'PAYMENT_PROCESSING', reserved_until = $1, current_order_id = $2 
//       WHERE id = ANY($3::uuid[]);
//     `, [paymentTimeout, order.id, seatIds]); // thêm thời gian chờ thanh toán

//     await client.query('COMMIT');
//     return { orderId: order.id, totalAmount: total, paymentTimeout: paymentTimeout };
//   } catch (err) {
//     await client.query('ROLLBACK');
//     throw err;
//   } finally {
//     client.release();
//   }
// }

// Hủy giữ ghế
async function releaseReservedSeats(userId, seatIds) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Chỉ giải phóng những ghế đang được giữ bởi chính user này và chưa bị bán
    const result = await client.query(`
      UPDATE seats 
      SET status = 'AVAILABLE', reserved_by = NULL, reserved_until = NULL, current_order_id = NULL
      WHERE id = ANY($1::uuid[]) 
        AND reserved_by = $2 
        AND status = 'RESERVED'
      RETURNING id, seat_number;
    `, [seatIds, userId]);

    await client.query('COMMIT');

    // CẬP NHẬT MAP: Giải phóng ngay các ghế đã hủy thành công khỏi RAM để user khác có thể đặt ngay lập tức
    for (const row of result.rows) {
      localReservedSeats.delete(row.id);
    }

    return result.rows;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Khởi tạo thanh toán
async function startCheckoutSeats(userId, seatIds) {
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

    const paymentTimeout = new Date(Date.now() + 1 * 60 * 1000); // 1 phút chờ thanh toán
    const orderRes = await client.query(`
      INSERT INTO orders (user_id, total_amount, status, expires_at) 
      VALUES ($1, $2, 'PAYMENT_PROCESSING', $3) 
      RETURNING *;
    `, [userId, total, paymentTimeout]);
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

    await client.query('COMMIT');

    // CẬP NHẬT MAP: Gia hạn thời gian giữ ghế trong RAM theo paymentTimeout mới (1 phút)
    const newTimeoutMs = paymentTimeout.getTime();
    for (const seatId of seatIds) {
      localReservedSeats.set(seatId, newTimeoutMs);
    }

    return { orderId: order.id, totalAmount: total, paymentTimeout: paymentTimeout };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Webhook xử lý thanh toán
// async function handlePaymentWebhook(orderId, isSuccess) {
//   const client = await pool.connect();
//   try {
//     await client.query('BEGIN');
//     const orderRes = await client.query(`SELECT * FROM orders WHERE id = $1 FOR UPDATE;`, [orderId]);
//     if (orderRes.rows.length === 0) throw new Error('Không tìm thấy đơn hàng.');

//     if (isSuccess) {
//       await client.query(`UPDATE orders SET status = 'SUCCESS' WHERE id = $1;`, [orderId]);
//       await client.query(`
//         UPDATE seats 
//         SET status = 'SOLD', reserved_by = NULL, reserved_until = NULL, current_order_id = NULL 
//         WHERE current_order_id = $1;
//       `, [orderId]);
//     } else {
//       await client.query(`UPDATE orders SET status = 'FAILED' WHERE id = $1;`, [orderId]);
//       await client.query(`
//         UPDATE seats 
//         SET status = 'AVAILABLE', reserved_by = NULL, reserved_until = NULL, current_order_id = NULL 
//         WHERE current_order_id = $1;
//       `, [orderId]);
//     }

//     await client.query('COMMIT');
//     return { status: isSuccess ? 'SUCCESS' : 'FAILED' };
//   } catch (err) {
//     await client.query('ROLLBACK');
//     throw err;
//   } finally {
//     client.release();
//   }
// }
async function handlePaymentWebhook(orderId, isSuccess) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const orderRes = await client.query(
      `SELECT * FROM orders WHERE id = $1 FOR UPDATE;`, 
      [orderId]
    );
    if (orderRes.rows.length === 0) throw new Error('Không tìm thấy đơn hàng.');

    let updatedSeats = [];

    if (isSuccess) {
      await client.query(`UPDATE orders SET status = 'SUCCESS' WHERE id = $1;`, [orderId]);
      
      // Cập nhật ghế thành SOLD và trả về danh sách ID ghế vừa cập nhật
      const seatRes = await client.query(`
        UPDATE seats 
        SET status = 'SOLD', reserved_by = NULL, reserved_until = NULL, current_order_id = NULL 
        WHERE current_order_id = $1
        RETURNING id;
      `, [orderId]);
      updatedSeats = seatRes.rows;
    } else {
      await client.query(`UPDATE orders SET status = 'FAILED' WHERE id = $1;`, [orderId]);
      
      // Trả ghế về AVAILABLE và lấy danh sách ID ghế để xóa khỏi bộ nhớ đệm
      const seatRes = await client.query(`
        UPDATE seats 
        SET status = 'AVAILABLE', reserved_by = NULL, reserved_until = NULL, current_order_id = NULL 
        WHERE current_order_id = $1
        RETURNING id;
      `, [orderId]);
      updatedSeats = seatRes.rows;
    }

    await client.query('COMMIT');

    // CẬP NHẬT MAP: Xóa toàn bộ các ghế liên quan khỏi RAM
    // - Thành công (SOLD): Giải phóng RAM (dưới DB đã chặn vĩnh viễn)
    // - Thất bại (FAILED): Cho phép người dùng khác chọn ngay mà không bị Early Rejection chặn
    for (const seat of updatedSeats) {
      localReservedSeats.delete(seat.id);
    }

    return { status: isSuccess ? 'SUCCESS' : 'FAILED' };
  } catch (err) {
    await client.query('ROLLBACK');
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
  reserveSeats,
  reserveSeatsByMultipleZones,
  startCheckoutSeats,
  handlePaymentWebhook,
  releaseReservedSeats
};

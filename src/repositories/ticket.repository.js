const pool = require('../config/db');
const logger = require('../utils/logger');

class TicketRepository {
  // ==================== Transaction Helpers ====================
  async beginTransaction() {
    const client = await pool.connect();
    await client.query('BEGIN');
    return client;
  }

  async commitTransaction(client) {
    try {
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  }

  async rollbackTransaction(client) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Bỏ qua lỗi rollback nếu connection đã đóng
    } finally {
      client.release();
    }
  }

  // ==================== Events ====================
  async getAllEvents() {
    const result = await pool.query(
      'SELECT * FROM events ORDER BY created_at DESC;'
    );
    return result.rows;
  }

  async createEvent(title, description, location, startTime, eventType, dbClient = pool) {
    const result = await dbClient.query(
      `INSERT INTO events (title, description, location, start_time, event_type)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *;`,
      [title, description, location, startTime, eventType]
    );
    return result.rows[0];
  }

  async updateEvent(eventId, eventData, dbClient = pool) {
    const {
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
    } = eventData;

    const result = await dbClient.query(
      `UPDATE events
       SET title = COALESCE($1, title),
           description = COALESCE($2, description),
           location = COALESCE($3, location),
           start_time = COALESCE($4, start_time),
           event_type = COALESCE($5, event_type),
           category = COALESCE($6, category),
           "time" = COALESCE($7, "time"),
           min_price = COALESCE($8, min_price),
           max_price = COALESCE($9, max_price),
           image = COALESCE($10, image),
           banner = COALESCE($11, banner),
           organizer = COALESCE($12, organizer),
           highlights = COALESCE($13, highlights),
           rules = COALESCE($14, rules),
           thumbnails = COALESCE($15, thumbnails)
       WHERE id = $16
       RETURNING *;`,
      [
        title !== undefined ? title : null,
        description !== undefined ? description : null,
        location !== undefined ? location : null,
        start_time ? new Date(start_time) : null,
        event_type !== undefined ? event_type : null,
        category !== undefined ? category : null,
        time !== undefined ? time : null,
        min_price !== undefined && min_price !== '' ? Number(min_price) : null,
        max_price !== undefined && max_price !== '' ? Number(max_price) : null,
        image !== undefined ? image : null,
        banner !== undefined ? banner : null,
        organizer !== undefined ? organizer : null,
        highlights !== undefined ? JSON.stringify(highlights) : null,
        rules !== undefined ? JSON.stringify(rules) : null,
        Array.isArray(thumbnails) ? thumbnails : null,
        eventId,
      ]
    );
    return result.rows[0];
  }

  async deleteEvent(eventId) {
    await pool.query('DELETE FROM events WHERE id = $1;', [eventId]);
    return true;
  }

  // ==================== Seats Queries ====================
  async getSeatsByEvent(eventId) {
    const result = await pool.query(
      'SELECT * FROM seats WHERE event_id = $1 ORDER BY seat_number ASC;',
      [eventId]
    );
    return result.rows;
  }

  async getZonesByEvent(eventId) {
    const result = await pool.query(
      `SELECT 
        zone_name,
        price,
        COUNT(id) FILTER (WHERE status = 'AVAILABLE') AS available_count,
        COUNT(id) AS total_count
      FROM seats 
      WHERE event_id = $1 
      GROUP BY zone_name, price 
      ORDER BY price DESC;`,
      [eventId]
    );
    return result.rows;
  }

  async releaseExpiredSeats() {
    const result = await pool.query(
      `WITH target_seats AS (
         SELECT id, current_order_code
         FROM seats
         WHERE status IN ('RESERVED', 'PAYMENT_PROCESSING') AND reserved_until < NOW()
         FOR UPDATE SKIP LOCKED
       ),
       released_seats AS (
         UPDATE seats s
         SET status = 'AVAILABLE', reserved_by = NULL, reserved_until = NULL, current_order_code = NULL
         FROM target_seats ts
         WHERE s.id = ts.id
         RETURNING s.id, s.seat_number, ts.current_order_code
       ),
       expired_orders AS (
         UPDATE orders o
         SET status = 'EXPIRED'
         WHERE o.status = 'PAYMENT_PROCESSING'
           AND (
             o.order_code IN (SELECT current_order_code FROM target_seats WHERE current_order_code IS NOT NULL)
             OR (
               o.expires_at < NOW()
               AND NOT EXISTS (
                 SELECT 1 FROM seats s
                 WHERE s.current_order_code = o.order_code
                   AND s.status IN ('RESERVED', 'PAYMENT_PROCESSING')
                   AND s.reserved_until >= NOW()
               )
             )
           )
         RETURNING o.order_code
       )
       SELECT id, seat_number, current_order_code FROM released_seats;`
    );
    return result.rows;
  }

  async checkActiveHold(userId) {
    const result = await pool.query(
      `SELECT 1 FROM seats 
       WHERE reserved_by = $1 
         AND status IN ('RESERVED', 'PAYMENT_PROCESSING') 
         AND reserved_until > NOW()
       LIMIT 1;`,
      [userId]
    );
    return result.rows.length > 0;
  }

  // ==================== Seat Locking & Holding ====================
  async lockAvailableSeats(seatIds, dbClient = pool) {
    const result = await dbClient.query(
      `SELECT id, seat_number, price, zone_name
       FROM seats
       WHERE id = ANY($1::uuid[])
         AND status = 'AVAILABLE'
       ORDER BY id ASC
       FOR UPDATE SKIP LOCKED;`,
      [seatIds]
    );
    return result.rows;
  }

  async reserveSeats(userId, reservedUntil, seatIds, dbClient = pool) {
    const result = await dbClient.query(
      `UPDATE seats 
       SET status = 'RESERVED', reserved_by = $1, reserved_until = $2
       WHERE id = ANY($3::uuid[])
       RETURNING id, seat_number, status, reserved_until, price;`,
      [userId, reservedUntil, seatIds]
    );
    return result.rows;
  }

  async getSeatNumbersByIds(seatIds, dbClient = pool) {
    const result = await dbClient.query(
      `SELECT seat_number FROM seats WHERE id = ANY($1::uuid[])`,
      [seatIds]
    );
    return result.rows.map((s) => s.seat_number);
  }

  async confirmAvailableSeatsHold(userId, reservedUntil, confirmSeatIds, dbClient = pool) {
    const result = await dbClient.query(
      `UPDATE seats
       SET status = 'RESERVED', reserved_by = $1, reserved_until = $2
       WHERE id = ANY($3::uuid[])
         AND status = 'AVAILABLE'
       RETURNING id, seat_number, status, reserved_until, price;`,
      [userId, reservedUntil, confirmSeatIds]
    );
    return result.rows;
  }

  async reserveSeatsByZoneDemands(userId, eventId, validRequests, now, until, dbClient = pool) {
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
    const result = await dbClient.query(query, [
      userId,
      now,
      JSON.stringify(validRequests),
      eventId,
      until
    ]);
    return result.rows;
  }

  // ==================== Seat Release & Order Cancellation ====================
  async getSeatIdsByOrderCode(orderCode, dbClient = pool) {
    const result = await dbClient.query(
      `SELECT seat_id FROM order_items WHERE order_code = $1;`,
      [orderCode]
    );
    return result.rows.map((r) => r.seat_id);
  }

  async getHeldSeatIdsByUserId(userId, dbClient = pool) {
    const result = await dbClient.query(
      `SELECT id FROM seats WHERE reserved_by = $1 AND status IN ('RESERVED', 'PAYMENT_PROCESSING');`,
      [userId]
    );
    return result.rows.map((r) => r.id);
  }

  async releaseSeatsByIds(effectiveSeatIds, userId = null, dbClient = pool) {
    const result = await dbClient.query(
      `WITH target_seats AS (
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
      RETURNING s.id, s.seat_number, ts.current_order_code;`,
      [effectiveSeatIds, userId || null]
    );
    return result.rows;
  }

  async cancelOrExpireProcessingOrders(orderCodes, dbClient = pool) {
    const result = await dbClient.query(
      `UPDATE orders
       SET status = CASE WHEN expires_at <= NOW() THEN 'EXPIRED'::order_status ELSE 'CANCELLED'::order_status END
       WHERE order_code = ANY($1::bigint[]) AND status = 'PAYMENT_PROCESSING'
       RETURNING order_code, status;`,
      [orderCodes]
    );
    return result.rows;
  }

  // ==================== Checkout Seats ====================
  async getSeatsByIdsForUpdate(seatIds, dbClient = pool) {
    const result = await dbClient.query(
      `SELECT * FROM seats WHERE id = ANY($1::uuid[]) ORDER BY id ASC FOR UPDATE;`,
      [seatIds]
    );
    return result.rows;
  }

  async updateSeatsToPaymentProcessing(seatReservedUntil, orderCode, seatIds, dbClient = pool) {
    await dbClient.query(
      `UPDATE seats 
       SET status = 'PAYMENT_PROCESSING', reserved_until = $1, current_order_code = $2 
       WHERE id = ANY($3::uuid[]);`,
      [seatReservedUntil, orderCode, seatIds]
    );
  }

  // ==================== Webhook & Payment Flow ====================
  async getOrderByCodeForUpdate(orderCode, dbClient = pool) {
    const result = await dbClient.query(
      `SELECT * FROM orders WHERE order_code = $1 FOR UPDATE;`,
      [orderCode]
    );
    return result.rows[0] || null;
  }

  async releaseSeatsByOrderCode(orderCode, dbClient = pool) {
    const result = await dbClient.query(
      `UPDATE seats
       SET status = 'AVAILABLE', reserved_by = NULL, reserved_until = NULL, current_order_code = NULL
       WHERE current_order_code = $1 AND status IN ('RESERVED', 'PAYMENT_PROCESSING')
       RETURNING id, seat_number;`,
      [orderCode]
    );
    return result.rows;
  }

  async getOrderItemsWithSeatsForUpdate(orderCode, dbClient = pool) {
    const result = await dbClient.query(
      `SELECT 
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
      FOR UPDATE OF oi, s;`,
      [orderCode]
    );
    return result.rows;
  }

  async markSeatsAsSold(seatIds, orderCode, dbClient = pool) {
    const result = await dbClient.query(
      `UPDATE seats 
       SET status = 'SOLD', reserved_by = NULL, reserved_until = NULL, current_order_code = NULL 
       WHERE id = ANY($1::uuid[]) 
         AND current_order_code = $2 
         AND status = 'PAYMENT_PROCESSING'
       RETURNING id, seat_number;`,
      [seatIds, orderCode]
    );
    return result.rows;
  }

  // ==================== Orders ====================
  async getUserOrderHistory(userId) {
    const result = await pool.query(
      `SELECT 
        o.order_code,
        o.total_amount,
        o.status AS order_status,
        o.status,
        o.created_at,
        o.phone,
        o.citizen_id,
        e.id AS event_id,
        e.title AS event_title,
        e.event_type,
        e.location,
        COALESCE(
          json_agg(
            json_build_object(
              'seat_number', s.seat_number,
              'zone_name', s.zone_name,
              'price', oi.price
            ) ORDER BY s.seat_number ASC
          ) FILTER (WHERE s.id IS NOT NULL), '[]'
        ) AS items
      FROM orders o
      LEFT JOIN order_items oi ON o.order_code = oi.order_code
      LEFT JOIN seats s ON oi.seat_id = s.id
      LEFT JOIN events e ON s.event_id = e.id
      WHERE o.user_id = $1
      GROUP BY o.order_code, e.id
      ORDER BY o.created_at DESC;`,
      [userId]
    );
    return result.rows;
  }

  async getRefundOrdersForAdmin() {
    const result = await pool.query(
      `SELECT 
        o.order_code,
        o.user_id,
        u.full_name AS customer_name,
        u.email AS customer_email,
        o.phone,
        o.citizen_id,
        o.total_amount,
        o.status AS order_status,
        o.created_at,
        e.id AS event_id,
        e.title AS event_title,
        e.event_type,
        e.location,
        COALESCE(
          json_agg(
            json_build_object(
              'seat_number', s.seat_number,
              'zone_name', s.zone_name,
              'price', oi.price
            ) ORDER BY s.seat_number ASC
          ) FILTER (WHERE s.id IS NOT NULL), '[]'
        ) AS items
      FROM orders o
      JOIN users u ON o.user_id = u.id
      LEFT JOIN order_items oi ON o.order_code = oi.order_code
      LEFT JOIN seats s ON oi.seat_id = s.id
      LEFT JOIN events e ON s.event_id = e.id
      WHERE o.status IN ('REFUND_PENDING', 'REFUNDED')
      GROUP BY o.order_code, u.id, e.id
      ORDER BY CASE WHEN o.status = 'REFUND_PENDING' THEN 0 ELSE 1 END, o.created_at DESC;`
    );
    return result.rows;
  }

  async getAllAdminTickets() {
    const result = await pool.query(
      `SELECT 
        o.order_code,
        o.user_id,
        u.full_name AS customer_name,
        u.email AS customer_email,
        o.phone,
        o.citizen_id,
        o.total_amount,
        o.status AS order_status,
        o.created_at,
        e.id AS event_id,
        e.title AS event_title,
        e.event_type,
        e.location,
        COALESCE(
          json_agg(
            json_build_object(
              'seat_number', s.seat_number,
              'zone_name', s.zone_name,
              'price', oi.price
            ) ORDER BY s.seat_number ASC
          ) FILTER (WHERE s.id IS NOT NULL), '[]'
        ) AS items
      FROM orders o
      JOIN users u ON o.user_id = u.id
      JOIN order_items oi ON o.order_code = oi.order_code
      JOIN seats s ON oi.seat_id = s.id
      JOIN events e ON s.event_id = e.id
      GROUP BY o.order_code, u.id, e.id
      ORDER BY o.created_at DESC;`
    );
    return result.rows;
  }

  async confirmOrderRefund(orderCode) {
    const result = await pool.query(
      `UPDATE orders
       SET status = 'REFUNDED'
       WHERE order_code = $1 AND status = 'REFUND_PENDING'
       RETURNING *;`,
      [orderCode]
    );
    return result.rows[0] || null;
  }

  async getOrderWithItemsByCode(orderCode, dbClient = pool) {
    const result = await dbClient.query(
      `SELECT 
        o.order_code,
        o.user_id,
        o.total_amount,
        o.status AS order_status,
        o.expires_at,
        o.created_at,
        o.phone,
        o.citizen_id,
        e.id AS event_id,
        e.title AS event_title,
        e.event_type,
        e.location,
        COALESCE(
          json_agg(
            json_build_object(
              'seat_id', s.id,
              'seat_number', s.seat_number,
              'zone_name', s.zone_name,
              'price', oi.price
            ) ORDER BY s.seat_number ASC
          ) FILTER (WHERE s.id IS NOT NULL), '[]'
        ) AS items
      FROM orders o
      LEFT JOIN order_items oi ON o.order_code = oi.order_code
      LEFT JOIN seats s ON oi.seat_id = s.id
      LEFT JOIN events e ON s.event_id = e.id
      WHERE o.order_code = $1
      GROUP BY o.order_code, e.id;`,
      [orderCode]
    );
    return result.rows[0] || null;
  }

  async createOrder(userId, totalAmount, expiresAt, phone = null, citizenId = null, dbClient = pool) {
    const logPayload = {
      userId,
      totalAmount,
      expiresAt,
      phone,
      citizenId
    };

    logger.payment('CREATE_ORDER_BEFORE_INSERT', `Payload: ${JSON.stringify(logPayload)}`);

    const result = await dbClient.query(
      `INSERT INTO orders (user_id, total_amount, status, expires_at, phone, citizen_id) 
       VALUES ($1, $2, 'PAYMENT_PROCESSING', $3, $4, $5) 
       RETURNING *;`,
      [userId, totalAmount, expiresAt, phone ?? null, citizenId ?? null]
    );

    logger.payment('CREATE_ORDER_AFTER_INSERT', `Inserted order: ${JSON.stringify({
      orderCode: result.rows[0]?.order_code,
      phone: result.rows[0]?.phone,
      citizenId: result.rows[0]?.citizen_id
    })}`);

    return result.rows[0];
  }

  async createOrderItem(orderCode, seatId, price, dbClient = pool) {
    await dbClient.query(
      `INSERT INTO order_items (order_code, seat_id, price) VALUES ($1, $2, $3);`,
      [orderCode, seatId, price]
    );
  }

  async updateOrderStatus(orderCode, status, dbClient = pool) {
    await dbClient.query(
      `UPDATE orders SET status = $1 WHERE order_code = $2;`,
      [status, orderCode]
    );
  }

  // ==================== Event Management Helpers ====================
  async createSeat(eventId, seatNumber, zoneName, price, dbClient = pool) {
    await dbClient.query(
      `INSERT INTO seats (event_id, seat_number, zone_name, price, status)
       VALUES ($1, $2, $3, $4, 'AVAILABLE');`,
      [eventId, seatNumber, zoneName, price]
    );
  }

  async countUnavailableSeatsByEvent(eventId, dbClient = pool) {
    const result = await dbClient.query(
      `SELECT COUNT(*) FROM seats WHERE event_id = $1 AND status != 'AVAILABLE';`,
      [eventId]
    );
    return parseInt(result.rows[0].count, 10);
  }

  async deleteSeatsByEventId(eventId, dbClient = pool) {
    await dbClient.query('DELETE FROM seats WHERE event_id = $1;', [eventId]);
  }

  async updateAvailableSeatsPrice(eventId, price, dbClient = pool) {
    await dbClient.query(
      `UPDATE seats SET price = $1 WHERE event_id = $2 AND status = 'AVAILABLE';`,
      [price, eventId]
    );
  }

  async updateAvailableZoneSeatsPrice(eventId, zoneName, price, dbClient = pool) {
    await dbClient.query(
      `UPDATE seats SET price = $1 WHERE event_id = $2 AND UPPER(zone_name) = $3 AND status = 'AVAILABLE';`,
      [price, eventId, (zoneName || '').toUpperCase()]
    );
  }
}

module.exports = new TicketRepository();

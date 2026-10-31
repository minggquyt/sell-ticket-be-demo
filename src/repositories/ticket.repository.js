const pool = require('../config/db');

class TicketRepository {
  // Events
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

  // Seats
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

  // Orders
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
    const result = await dbClient.query(
      `INSERT INTO orders (user_id, total_amount, status, expires_at, phone, citizen_id) 
       VALUES ($1, $2, 'PAYMENT_PROCESSING', $3, $4, $5) 
       RETURNING *;`,
      [userId, totalAmount, expiresAt, phone ?? null, citizenId ?? null]
    );
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
}

module.exports = new TicketRepository();

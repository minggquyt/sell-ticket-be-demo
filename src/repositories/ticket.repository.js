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
      JOIN order_items oi ON o.order_code = oi.order_code
      JOIN seats s ON oi.seat_id = s.id
      JOIN events e ON s.event_id = e.id
      WHERE o.user_id = $1
      GROUP BY o.order_code, e.id
      ORDER BY o.created_at DESC;`,
      [userId]
    );
    return result.rows;
  }

  async createOrder(userId, totalAmount, expiresAt, dbClient = pool) {
    const result = await dbClient.query(
      `INSERT INTO orders (user_id, total_amount, status, expires_at) 
       VALUES ($1, $2, 'PAYMENT_PROCESSING', $3) 
       RETURNING *;`,
      [userId, totalAmount, expiresAt]
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

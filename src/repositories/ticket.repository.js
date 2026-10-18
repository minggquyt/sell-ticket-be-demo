const pool = require('../config/db');

class TicketRepository {
  // Events
  async getAllEvents() {
    const result = await pool.query(
      'SELECT * FROM events ORDER BY created_at DESC;'
    );
    return result.rows;
  }

  async getEventById(eventId) {
    const result = await pool.query(
      'SELECT * FROM events WHERE id = $1;',
      [eventId]
    );
    return result.rows[0] || null;
  }

  async createEvent(title, description, location, startTime, eventType) {
    const result = await pool.query(
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

  async createSeat(eventId, seatNumber, zoneName, price, status = 'AVAILABLE') {
    const result = await pool.query(
      `INSERT INTO seats (event_id, seat_number, zone_name, price, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *;`,
      [eventId, seatNumber, zoneName, price, status]
    );
    return result.rows[0];
  }

  async releaseExpiredSeats() {
    const result = await pool.query(
      `UPDATE seats 
       SET status = 'AVAILABLE', reserved_by = NULL, reserved_until = NULL, current_order_id = NULL
       WHERE status IN ('RESERVED', 'PAYMENT_PROCESSING') AND reserved_until < NOW()
       RETURNING id, seat_number;`
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
      ORDER BY o.created_at DESC;`,
      [userId]
    );
    return result.rows;
  }

  async createOrder(userId, totalAmount, expiresAt, orderCode) {
    const result = await pool.query(
      `INSERT INTO orders (user_id, total_amount, status, expires_at, order_code) 
       VALUES ($1, $2, 'PAYMENT_PROCESSING', $3, $4) 
       RETURNING *;`,
      [userId, totalAmount, expiresAt, orderCode]
    );
    return result.rows[0];
  }

  async createOrderItem(orderId, seatId, price) {
    await pool.query(
      `INSERT INTO order_items (order_id, seat_id, price) VALUES ($1, $2, $3);`,
      [orderId, seatId, price]
    );
  }

  async findOrderByIdentifier(orderIdentifier) {
    const result = await pool.query(
      `SELECT * FROM orders WHERE (id::text = $1 OR order_code::text = $1);`,
      [String(orderIdentifier)]
    );
    return result.rows[0] || null;
  }

  async updateOrderStatus(orderId, status) {
    await pool.query(
      `UPDATE orders SET status = $1 WHERE id = $2;`,
      [status, orderId]
    );
  }

  async updateSeatsStatus(seatIds, status, reservedBy = null, reservedUntil = null, orderId = null) {
    const result = await pool.query(
      `UPDATE seats 
       SET status = $1, reserved_by = $2, reserved_until = $3, current_order_id = $4
       WHERE id = ANY($5::uuid[])
       RETURNING id, seat_number, status, reserved_until;`,
      [status, reservedBy, reservedUntil, orderId, seatIds]
    );
    return result.rows;
  }

  async updateSeatsBySeatNumbers(seatNumbers, status, reservedBy = null, reservedUntil = null, orderId = null) {
    const result = await pool.query(
      `UPDATE seats 
       SET status = $1, reserved_by = $2, reserved_until = $3, current_order_id = $4
       WHERE seat_number = ANY($5::text[])
       RETURNING id, seat_number;`,
      [status, reservedBy, reservedUntil, orderId, seatNumbers]
    );
    return result.rows;
  }
}

module.exports = new TicketRepository();

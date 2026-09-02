require('dotenv').config();
const pool = require('../config/db');

async function seedData() {
  const client = await pool.connect();
  try {
    console.log('⏳ Đang xóa dữ liệu cũ và nạp dữ liệu mẫu...');
    await client.query('BEGIN');

    // 1. Reset dữ liệu cũ
    await client.query('TRUNCATE TABLE order_items, orders, seats, events, users CASCADE;');

    // 2. Tạo User
    const userRes = await client.query(`
      INSERT INTO users (id, email, full_name, password)
      VALUES ($1, $2, $3, $4)
      RETURNING id, full_name;
    `, ['11111111-1111-1111-1111-111111111111', 'customer@demo.com', 'Nguyen Van A', 'hashed_pass']);

    // 3. Tạo Event
    const eventRes = await client.query(`
      INSERT INTO events (id, title, description, location, start_time)
      VALUES ($1, $2, $3, $4, NOW() + INTERVAL '7 days')
      RETURNING id, title;
    `, ['22222222-2222-2222-2222-222222222222', 'Live Concert 2026', 'Đêm nhạc hội trực tiếp', 'TP. Hồ Chí Minh']);

    // 4. Tạo Ghế
    const seats = [
      { seat: 'A1', price: 500000 }, { seat: 'A2', price: 500000 }, { seat: 'A3', price: 500000 }, { seat: 'A4', price: 500000 },
      { seat: 'B1', price: 300000 }, { seat: 'B2', price: 300000 }, { seat: 'B3', price: 300000 }, { seat: 'B4', price: 300000 },
      { seat: 'C1', price: 200000 }, { seat: 'C2', price: 200000 }, { seat: 'C3', price: 200000 }, { seat: 'C4', price: 200000 }
    ];

    for (const item of seats) {
      await client.query(`
        INSERT INTO seats (event_id, seat_number, price, status)
        VALUES ($1, $2, $3, 'AVAILABLE');
      `, [eventRes.rows[0].id, item.seat, item.price]);
    }

    await client.query('COMMIT');
    console.log('✅ Nạp dữ liệu mẫu thành công!');
    console.log(`- User ID: ${userRes.rows[0].id}`);
    console.log(`- Event ID: ${eventRes.rows[0].id}`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Lỗi nạp dữ liệu:', error.message);
  } finally {
    client.release();
    pool.end();
  }
}

seedData();
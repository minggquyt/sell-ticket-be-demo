require('dotenv').config();
const pool = require('../config/db');
const bcrypt = require('bcryptjs');

async function seed() {
  const client = await pool.connect();
  try {
    console.log('--- Bắt đầu quy trình Seed MVP ---');
    await client.query('BEGIN');

    await client.query('TRUNCATE TABLE order_items, orders, seats, events, users CASCADE;');

    // 1. Tạo tài khoản Admin (admin@gmail.com / admin)
    const adminHashedPass = await bcrypt.hash('admin', 10);
    const adminId = '00000000-0000-0000-0000-000000000000';
    await client.query(`
      INSERT INTO users (id, email, full_name, password, role)
      VALUES ($1, 'admin@gmail.com', 'System Administrator', $2, 'ADMIN');
    `, [adminId, adminHashedPass]);

    // 2. Tạo tài khoản Khách mẫu (user@gmail.com / 123456)
    const userHashedPass = await bcrypt.hash('123456', 10);
    const userId = '11111111-1111-1111-1111-111111111111';
    await client.query(`
      INSERT INTO users (id, email, full_name, password, role)
      VALUES ($1, 'user@gmail.com', 'Khách Hàng Mẫu', $2, 'CUSTOMER');
    `, [userId, userHashedPass]);

    // 3. Sự kiện 1: Seat-based (Tạo 30 ghế từ A1 -> A30)
    const event1Id = '22222222-2222-2222-2222-222222222221';
    await client.query(`
      INSERT INTO events (id, title, description, location, start_time, event_type)
      VALUES ($1, 'Live Concert: Đêm Nhạc Mùa Thu', 'Sự kiện âm nhạc acoustic chọn ghế trực tiếp', 'Nhà hát Hòa Bình, TP.HCM', NOW() + INTERVAL '7 days', 'SEAT_BASED');
    `, [event1Id]);

    for (let i = 1; i <= 12; i++) {
      await client.query(`
        INSERT INTO seats (event_id, seat_number, zone_name, price, status)
        VALUES ($1, $2, 'STANDARD', 2000, 'AVAILABLE');
      `, [event1Id, `A${i}`]);
    }

    // 4. Sự kiện 2: Zone-based
    const event2Id = '22222222-2222-2222-2222-222222222222';
    await client.query(`
      INSERT INTO events (id, title, description, location, start_time, event_type)
      VALUES ($1, 'EDM Festival 2026: Soundwave Arena', 'Đại nhạc hội ngoài trời theo phân vùng', 'Sân vận động Quân Khu 7', NOW() + INTERVAL '14 days', 'ZONE_BASED');
    `, [event2Id]);

    for (let i = 1; i <= 10; i++) {
      await client.query(`
        INSERT INTO seats (event_id, seat_number, zone_name, price, status)
        VALUES ($1, $2, 'VIP', 5000, 'AVAILABLE');
      `, [event2Id, `VIP-${String(i).padStart(2, '0')}`]);
    }
    for (let i = 1; i <= 20; i++) {
      await client.query(`
        INSERT INTO seats (event_id, seat_number, zone_name, price, status)
        VALUES ($1, $2, 'REGULAR', 3000, 'AVAILABLE');
      `, [event2Id, `REG-${String(i).padStart(2, '0')}`]);
    }

    await client.query('COMMIT');
    console.log('✅ Seed hoàn tất!');
    console.log('-> Admin: admin@gmail.com / admin');
    console.log('-> Khách: user@gmail.com / 123456');
    console.log('-> Đã tạo 12 ghế (A1 -> A12) cho Event Seat-based');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Lỗi Seed:', err.message);
  } finally {
    client.release();
    pool.end();
  }
}

seed();
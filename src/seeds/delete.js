require('dotenv').config();
const pool = require('../config/db');

async function deleteData() {
    const client = await pool.connect();
    try {
        console.log('--- Bắt đầu quy trình Reset & Seed Database ---');
        console.log('Đang làm sạch toàn bộ bảng...');
        await client.query(`
      TRUNCATE TABLE order_items, orders, seats, events, users CASCADE;
    `);
    }
    catch (err) {
        console.error('Thất bại khi Delete:', err.message);
    } finally {
        console.log("Đã làm sạch thành công !")
        client.release();
        pool.end();
    }
}
deleteData();
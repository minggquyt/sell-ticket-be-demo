const express = require('express');
const path = require('path');
const cors = require('cors');
const pool = require('./src/config/db');
const indexRoutes = require('./src/routes/index.route');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', indexRoutes);

app.get("/", async (erq, res) => {
  res.send("Welcome to homepage")
})

// Background Job: Quét ghế hết hạn định kỳ mỗi 60 giây
// Mục đích: Để cập nhập lại status là AVAILABLE của những ghế có status là RESERVED HOẶC PAYMENT_PROCESSING 
// NHƯNG ĐÃ QUÁ THỜI HẠN GIỮ GHẾ / THANH TOÁN
setInterval(async () => {
  try {
    const releaseQuery = `
      UPDATE seats 
      SET status = 'AVAILABLE', reserved_by = NULL, reserved_until = NULL, current_order_id = NULL 
      WHERE status IN ('RESERVED', 'PAYMENT_PROCESSING') AND reserved_until < NOW();
    `;
    await pool.query(releaseQuery);
  } catch (err) {
    console.error('[Auto-Release Error]', err.message);
  }
}, 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server chạy tại: http://localhost:${PORT}`));
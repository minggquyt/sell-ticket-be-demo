const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  ssl: { rejectUnauthorized: false }
});

async function checkNetworkLatency() {
  console.log('📡 Đang kiểm tra độ trễ mạng tới Supabase/PostgreSQL...\n');
  
  // 1. Đo Handshake ban đầu (Bao gồm TCP + TLS Handshake)
  const tConnectStart = Date.now();
  const client = await pool.connect();
  console.log(`⏱️ Thời gian thiết lập kết nối (TCP + TLS): ${Date.now() - tConnectStart}ms`);

  // 2. Đo Ping RTT qua 10 lượt SELECT 1
  const latencies = [];
  for (let i = 1; i <= 10; i++) {
    const start = Date.now();
    await client.query('SELECT 1');
    const duration = Date.now() - start;
    latencies.push(duration);
    console.log(`- Lần ${i}: ${duration}ms`);
    await new Promise(r => setTimeout(r, 200)); // nghỉ 200ms
  }

  client.release();
  await pool.end();

  const avg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
  const min = Math.min(...latencies);
  const max = Math.max(...latencies);
  console.log(`\n📊 KẾT QUẢ: Trung bình = ${avg}ms | Thấp nhất = ${min}ms | Cao nhất = ${max}ms`);

  if (max - min > 150 || avg > 200) {
    console.log('⚠️ CẢNH BÁO: Mạng đang bị Jitter (chập chờn) hoặc Packet Loss do thời tiết!');
  } else {
    console.log('✅ Mạng ổn định.');
  }
}

checkNetworkLatency();
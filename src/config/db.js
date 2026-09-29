const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Cho phép tối đa 20 kết nối từ nodeJS -> DB song song
  ssl: { rejectUnauthorized: false } ,
  connectionTimeoutMillis: 5000
});

module.exports = pool;
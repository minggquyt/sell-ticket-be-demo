const { Pool } = require('pg');
require('dotenv').config();

const parsedPoolMax = Number(process.env.DB_POOL_MAX);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number.isInteger(parsedPoolMax) && parsedPoolMax > 0 ? parsedPoolMax : 15,
  ssl: { rejectUnauthorized: false },
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
});

pool.on('error', (err) => {
  console.error('[DB_POOL] Idle client error:', err.message);
});

module.exports = pool;

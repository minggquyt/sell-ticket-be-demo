const pool = require('../config/db');

class AuthRepository {
  async findUserByEmail(email) {
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1;',
      [email]
    );
    return result.rows[0] || null;
  }

  async checkEmailExists(email) {
    const result = await pool.query(
      'SELECT id FROM users WHERE email = $1;',
      [email]
    );
    return result.rows.length > 0;
  }

  async createUser(email, hashedPassword, fullName) {
    const result = await pool.query(
      `INSERT INTO users (email, password, full_name, role)
       VALUES ($1, $2, $3, 'CUSTOMER')
       RETURNING id, email, full_name, role;`,
      [email, hashedPassword, fullName]
    );
    return result.rows[0];
  }

  // Hồ sơ ngân hàng + lý do "Sai TT" mới nhất trên các đơn chờ hoàn tiền (nếu có)
  async getBankProfile(userId) {
    const result = await pool.query(
      `SELECT u.email, u.full_name, u.bank_bin, u.bank_short_name, u.bank_name, u.bank_logo,
              u.bank_account_no, u.bank_account_name,
              (SELECT o.refund_bank_error FROM orders o
                WHERE o.user_id = u.id AND o.status = 'REFUND_PENDING' AND o.refund_bank_error IS NOT NULL
                ORDER BY o.created_at DESC LIMIT 1) AS bank_error
       FROM users u
       WHERE u.id = $1;`,
      [userId]
    );
    return result.rows[0] || null;
  }

  // 1 câu lệnh = 1 transaction: lưu TK mới, và CHỈ gỡ cờ "Sai TT" nếu 1 trong 3 trường
  // (BIN, STK, Tên chủ TK) thực sự khác dữ liệu cũ (CTE đọc snapshot trước khi UPDATE users).
  async updateBankAndClearErrors(userId, b) {
    await pool.query(
      `WITH cleared AS (
         UPDATE orders SET refund_bank_error = NULL
         WHERE user_id = $1 AND status = 'REFUND_PENDING' AND refund_bank_error IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM users
             WHERE id = $1
               AND (bank_bin IS DISTINCT FROM $2
                 OR bank_account_no IS DISTINCT FROM $6
                 OR bank_account_name IS DISTINCT FROM $7)
           )
       )
       UPDATE users
       SET bank_bin = $2, bank_short_name = $3, bank_name = $4, bank_logo = $5,
           bank_account_no = $6, bank_account_name = $7
       WHERE id = $1;`,
      [userId, b.bankBin, b.bankShortName, b.bankName, b.bankLogo, b.bankAccountNo, b.bankAccountName]
    );
  }
}

module.exports = new AuthRepository();

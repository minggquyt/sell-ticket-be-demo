const pool = require('../config/db');

class AuthRepository {
  async beginTransaction() {
    const client = await pool.connect();
    await client.query('BEGIN');
    return client;
  }

  async commitTransaction(client) {
    try {
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  }

  async rollbackTransaction(client) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Connection may already be closed.
    } finally {
      client.release();
    }
  }

  async findUserByEmail(email) {
    const result = await pool.query(
      'SELECT * FROM users WHERE lower(email) = lower($1) LIMIT 1;',
      [email]
    );
    return result.rows[0] || null;
  }

  async findUserById(userId) {
    const result = await pool.query(
      'SELECT * FROM users WHERE id = $1;',
      [userId]
    );
    return result.rows[0] || null;
  }

  async updateUserPhone(userId, phone) {
    const result = await pool.query(
      `UPDATE users
       SET phone = $2
       WHERE id = $1
       RETURNING id, email, full_name, role, phone;`,
      [userId, phone]
    );
    return result.rows[0] || null;
  }

  async checkEmailExists(email) {
    const result = await pool.query(
      'SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1;',
      [email]
    );
    return result.rows.length > 0;
  }

  async createUser(email, hashedPassword, fullName, phone, dbClient = pool) {
    const result = await dbClient.query(
      `INSERT INTO users (email, password, full_name, role, phone)
       VALUES ($1, $2, $3, 'CUSTOMER', $4)
       RETURNING id, email, full_name, role, phone;`,
      [email, hashedPassword, fullName, phone]
    );
    return result.rows[0];
  }

  async expirePendingRegistrationByEmail(email, dbClient) {
    await dbClient.query(
      `WITH expired AS (
         UPDATE public.pending_registrations
         SET status = 'EXPIRED', updated_at = now()
         WHERE lower(email) = lower($1)
           AND status = 'PENDING'
           AND expires_at <= now()
         RETURNING id
       )
       UPDATE public.registration_otps
       SET status = 'EXPIRED'
       WHERE registration_id IN (SELECT id FROM expired)
         AND status = 'PENDING';`,
      [email]
    );
  }

  async findPendingRegistrationByEmailForUpdate(email, dbClient) {
    const result = await dbClient.query(
      `SELECT * FROM public.pending_registrations
       WHERE lower(email) = lower($1) AND status = 'PENDING'
       LIMIT 1 FOR UPDATE;`,
      [email]
    );
    return result.rows[0] || null;
  }

  async createPendingRegistration(data, dbClient) {
    const result = await dbClient.query(
      `INSERT INTO public.pending_registrations
         (email, full_name, password_hash, phone, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *;`,
      [data.email, data.fullName, data.passwordHash, data.phone, data.expiresAt]
    );
    return result.rows[0];
  }

  async createRegistrationOtp(data, dbClient) {
    const result = await dbClient.query(
      `INSERT INTO public.registration_otps
         (id, registration_id, otp_hash, max_attempts, expires_at, next_resend_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *;`,
      [data.id, data.registrationId, data.otpHash, data.maxAttempts, data.expiresAt, data.nextResendAt]
    );
    return result.rows[0];
  }

  async findRegistrationByIdForUpdate(registrationId, dbClient) {
    const result = await dbClient.query(
      `SELECT * FROM public.pending_registrations WHERE id = $1::uuid FOR UPDATE;`,
      [registrationId]
    );
    return result.rows[0] || null;
  }

  async findActiveOtpForUpdate(registrationId, dbClient) {
    const result = await dbClient.query(
      `SELECT * FROM public.registration_otps
       WHERE registration_id = $1 AND status = 'PENDING'
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE;`,
      [registrationId]
    );
    return result.rows[0] || null;
  }

  async incrementOtpAttempts(otpId, maxAttempts, dbClient) {
    const result = await dbClient.query(
      `UPDATE public.registration_otps
       SET attempts = attempts + 1,
           status = CASE WHEN attempts + 1 >= $2 THEN 'LOCKED' ELSE status END
       WHERE id = $1::uuid
       RETURNING attempts, status;`,
      [otpId, maxAttempts]
    );
    return result.rows[0];
  }

  async markRegistrationExpired(registrationId, dbClient) {
    await dbClient.query(
      `UPDATE public.pending_registrations
       SET status = 'EXPIRED', updated_at = now()
       WHERE id = $1::uuid AND status = 'PENDING';
       UPDATE public.registration_otps
       SET status = 'EXPIRED'
       WHERE registration_id = $1 AND status = 'PENDING';`,
      [registrationId]
    );
  }

  async countRegistrationOtps(registrationId, dbClient) {
    const result = await dbClient.query(
      `SELECT COUNT(*)::integer AS count FROM public.registration_otps WHERE registration_id = $1;`,
      [registrationId]
    );
    return result.rows[0].count;
  }

  async revokeActiveOtp(registrationId, dbClient) {
    await dbClient.query(
      `UPDATE public.registration_otps SET status = 'REVOKED'
       WHERE registration_id = $1 AND status = 'PENDING';`,
      [registrationId]
    );
  }

  async cancelRegistration(registrationId, dbClient) {
    const result = await dbClient.query(
      `WITH cancelled AS (
         UPDATE public.pending_registrations
         SET status = 'CANCELLED', updated_at = now()
         WHERE id = $1::uuid AND status = 'PENDING'
         RETURNING id
       ), revoked AS (
         UPDATE public.registration_otps
         SET status = 'REVOKED'
         WHERE registration_id IN (SELECT id FROM cancelled)
           AND status = 'PENDING'
       )
       SELECT EXISTS(SELECT 1 FROM cancelled) AS cancelled;`,
      [registrationId]
    );
    return result.rows[0]?.cancelled === true;
  }

  async completeRegistration(registrationId, otpId, userId, dbClient) {
    // Update OTP status
    await dbClient.query(
      `UPDATE public.registration_otps
       SET status = 'VERIFIED', verified_at = now()
       WHERE id = $1::uuid`,
      [otpId]
    );
    
    // Update registration status
    await dbClient.query(
      `UPDATE public.pending_registrations
       SET status = 'COMPLETED', created_user_id = $1::uuid,
           completed_at = now(), updated_at = now()
       WHERE id = $2::uuid`,
      [userId, registrationId]
    );
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

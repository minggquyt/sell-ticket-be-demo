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
}

module.exports = new AuthRepository();

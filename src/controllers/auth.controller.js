const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../middlewares/auth.middleware');
const logger = require('../utils/logger');

// Cần tách các tác vụ CRUD xuống database ra thành auth.services.js
exports.register = async (req, res) => {
  try {
    const { email, password, fullName } = req.body;
    if (!email || !password) {
      logger.auth('REGISTER', email || 'unknown', false, 'Thiếu thông tin');
      return res.status(400).json({ success: false, message: 'Vui lòng nhập đủ email và mật khẩu.' });
    }

    // Kiểm tra trùng email 
    const check = await pool.query('SELECT id FROM users WHERE email = $1;', [email]);
    if (check.rows.length > 0) {
      logger.auth('REGISTER', email, false, 'Email đã được sử dụng');
      return res.status(400).json({ success: false, message: 'Email này đã được sử dụng.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(`
      INSERT INTO users (email, password, full_name, role)
      VALUES ($1, $2, $3, 'CUSTOMER')
      RETURNING id, email, full_name, role;
    `, [email, hashedPassword, fullName || email.split('@')[0]]);

    logger.auth('REGISTER', email, true, `Tạo tài khoản thành công (ID: ${result.rows[0].id})`);
    return res.json({ success: true, message: 'Đăng ký tài khoản thành công!', data: result.rows[0] });
  } catch (err) {
    logger.error('AUTH_REGISTER', err.message, err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE email = $1;', [email]);

    if (result.rows.length === 0) {
      logger.auth('LOGIN', email, false, 'Email không tồn tại');
      return res.status(400).json({ success: false, message: 'Email hoặc mật khẩu không đúng.' });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      logger.auth('LOGIN', email, false, 'Sai mật khẩu');
      return res.status(400).json({ success: false, message: 'Email hoặc mật khẩu không đúng.' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, fullName: user.full_name },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    logger.auth('LOGIN', email, true, `Role: ${user.role} | Name: ${user.full_name}`);
    return res.json({
      success: true,
      message: 'Đăng nhập thành công!',
      token,
      user: { id: user.id, email: user.email, role: user.role, fullName: user.full_name }
    });
  } catch (err) {
    logger.error('AUTH_LOGIN', err.message, err);
    return res.status(500).json({ success: false, message: err.message });
  }
};
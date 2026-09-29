const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../middlewares/auth.middleware');

// Cần tách các tác vụ CRUD xuống database ra thành auth.services.js
exports.register = async (req, res) => {
  try {
    const { email, password, fullName } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập đủ email và mật khẩu.' });
    }

    // Kiểm tra trùng email 
    const check = await pool.query('SELECT id FROM users WHERE email = $1;', [email]);
    if (check.rows.length > 0) {
      return res.status(400).json({ success: false, message: 'Email này đã được sử dụng.' });
    }

    // Tách ra service ở đây 
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(`
      INSERT INTO users (email, password, full_name, role)
      VALUES ($1, $2, $3, 'CUSTOMER')
      RETURNING id, email, full_name, role;
    `, [email, hashedPassword, fullName || email.split('@')[0]]);

    return res.json({ success: true, message: 'Đăng ký tài khoản thành công!', data: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE email = $1;', [email]);

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Email hoặc mật khẩu không đúng.' });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Email hoặc mật khẩu không đúng.' });
    }

    // Tạo token để duy trì login phía FE
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, fullName: user.full_name },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    return res.json({
      success: true,
      message: 'Đăng nhập thành công!',
      token,
      user: { id: user.id, email: user.email, role: user.role, fullName: user.full_name }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
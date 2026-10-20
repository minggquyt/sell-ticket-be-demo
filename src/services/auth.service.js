const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const authRepository = require('../repositories/auth.repository');
const { JWT_SECRET, JWT_EXPIRES_IN, BCRYPT_SALT_ROUNDS } = require('../config/constants');
const logger = require('../utils/logger');

class AuthService {
  async register(email, password, fullName) {
    // Kiểm tra email đã tồn tại
    const emailExists = await authRepository.checkEmailExists(email);
    if (emailExists) {
      logger.auth('REGISTER', email, false, 'Email đã được sử dụng');
      throw new Error('Email này đã được sử dụng.');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

    // Tạo user mới
    const defaultFullName = fullName || email.split('@')[0];
    const user = await authRepository.createUser(email, hashedPassword, defaultFullName);

    logger.auth('REGISTER', email, true, `Tạo tài khoản thành công (ID: ${user.id})`);
    
    return user;
  }

  async login(email, password) {
    // Tìm user theo email
    const user = await authRepository.findUserByEmail(email);
    
    if (!user) {
      logger.auth('LOGIN', email, false, 'Email không tồn tại');
      throw new Error('Email hoặc mật khẩu không đúng.');
    }

    // So sánh password
    const isPasswordMatch = await bcrypt.compare(password, user.password);
    
    if (!isPasswordMatch) {
      logger.auth('LOGIN', email, false, 'Sai mật khẩu');
      throw new Error('Email hoặc mật khẩu không đúng.');
    }

    // Tạo JWT token
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        fullName: user.full_name,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    logger.auth('LOGIN', email, true, `Role: ${user.role} | Name: ${user.full_name}`);

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        fullName: user.full_name,
      },
    };
  }
}

module.exports = new AuthService();

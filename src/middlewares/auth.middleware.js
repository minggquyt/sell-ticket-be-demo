const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/constants');

function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token =
    typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : null;

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Bạn chưa đăng nhập.',
      data: { code: 'AUTH_REQUIRED' },
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    const isExpired = err?.name === 'TokenExpiredError';
    return res.status(401).json({
      success: false,
      message: isExpired
        ? 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
        : 'Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.',
      data: { code: isExpired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID' },
    });
  }
}

function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không có quyền thực hiện thao tác này.',
        data: { code: 'FORBIDDEN' },
      });
    }
    next();
  };
}

function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'ADMIN') {
    next();
  } else {
    return res.status(403).json({
      success: false,
      message: 'Yêu cầu quyền Quản trị viên (Admin).',
      data: { code: 'FORBIDDEN' },
    });
  }
}

module.exports = { verifyToken, requireAdmin, authorizeRoles };
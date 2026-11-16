const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

// Authentication - Validation now handled by DTO in controller
router.post('/register', authController.register);
router.post('/login', authController.login);

// Hồ sơ ngân hàng nhận hoàn tiền của user đang đăng nhập
router.get('/me/bank', verifyToken, authController.getMyBank);
router.put('/me/bank', verifyToken, authController.updateMyBank);

module.exports = router;

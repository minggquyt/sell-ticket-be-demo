const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { verifyToken } = require('../middlewares/auth.middleware');
const { createOtpRateLimit } = require('../middlewares/otp-rate-limit.middleware');

const registerLimit = createOtpRateLimit({ windowMs: 15 * 60 * 1000, max: 5, keyPrefix: 'register' });
const verifyOtpLimit = createOtpRateLimit({ windowMs: 5 * 60 * 1000, max: 10, keyPrefix: 'verify' });
const resendOtpLimit = createOtpRateLimit({ windowMs: 15 * 60 * 1000, max: 5, keyPrefix: 'resend' });
const cancelRegistrationLimit = createOtpRateLimit({ windowMs: 15 * 60 * 1000, max: 10, keyPrefix: 'cancel' });

// Authentication - Validation now handled by DTO in controller
router.post('/register', registerLimit, authController.register);
router.post('/register/verify', verifyOtpLimit, authController.verifyRegistration);
router.post('/register/resend', resendOtpLimit, authController.resendRegistrationOtp);
router.post('/register/cancel', cancelRegistrationLimit, authController.cancelRegistration);
router.post('/login', authController.login);

// Hồ sơ người dùng đang đăng nhập
router.get('/me', verifyToken, authController.getMyProfile);
router.put('/me', verifyToken, authController.updateMyProfile);

// Hồ sơ ngân hàng nhận hoàn tiền của user đang đăng nhập
router.get('/me/bank', verifyToken, authController.getMyBank);
router.put('/me/bank', verifyToken, authController.updateMyBank);

module.exports = router;

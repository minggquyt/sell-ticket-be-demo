const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');

// Authentication - Validation now handled by DTO in controller
router.post('/register', authController.register);
router.post('/login', authController.login);

module.exports = router;
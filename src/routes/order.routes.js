const express = require('express');
const router = express.Router();    
const ticketController = require('../controllers/ticket.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

router.get('/my-history', verifyToken, ticketController.getMyOrders);

module.exports = router;    
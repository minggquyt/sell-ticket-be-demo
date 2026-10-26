const express = require('express');
const router = express.Router();    
const ticketController = require('../controllers/ticket.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

router.get('/my-history', verifyToken, ticketController.getMyOrders);
router.get('/:orderCode/status', verifyToken, ticketController.getOrderStatus);

module.exports = router;

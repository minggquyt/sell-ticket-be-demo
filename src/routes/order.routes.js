const express = require('express');
const router = express.Router();    
const ticketController = require('../controllers/ticket.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

router.get('/my-history', verifyToken, ticketController.getMyOrders);
router.get('/:orderCode/payment', verifyToken, ticketController.getOrderPayment);
router.get('/:orderCode/events', verifyToken, ticketController.streamOrderEvents);
router.get('/:orderCode/status', verifyToken, ticketController.getOrderStatus);
router.post('/:orderCode/cancel', verifyToken, ticketController.cancelOrder);

module.exports = router;

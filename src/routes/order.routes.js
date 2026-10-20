const express = require('express');
const router = express.Router();    
const ticketController = require('../controllers/ticket.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

router.get('/my-history', verifyToken, ticketController.getMyOrders);
router.get('/:orderId/invoice', verifyToken, ticketController.getOrderInvoice);

module.exports = router;    
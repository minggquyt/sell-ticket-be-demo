const express = require('express');
const router = express.Router();    
const ticketController = require('../controllers/ticket.controller');
const { requireAdmin, verifyToken } = require('../middlewares/auth.middleware');

router.get('/tickets', verifyToken, requireAdmin, ticketController.getAdminTickets);
router.get('/refunds', verifyToken, requireAdmin, ticketController.getAdminRefunds);
router.post('/orders/:orderCode/confirm-refund', verifyToken, requireAdmin, ticketController.confirmRefundOrder);
router.post('/events', verifyToken, requireAdmin, ticketController.createEvent);
router.delete('/events/:eventId', verifyToken, requireAdmin, ticketController.deleteEvent);

module.exports = router;

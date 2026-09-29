const express = require('express');
const router = express.Router();    
const ticketController = require('../controllers/ticket.controller');
const { requireAdmin, verifyToken } = require('../middlewares/auth.middleware');

router.post('/events', verifyToken, requireAdmin, ticketController.createEvent);
router.delete('/events/:eventId', verifyToken, requireAdmin, ticketController.deleteEvent);

module.exports = router;
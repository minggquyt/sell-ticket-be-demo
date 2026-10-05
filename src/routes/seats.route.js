const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticket.controller');
const { verifyToken, authorizeRoles } = require('../middlewares/auth.middleware');

router.post('/reserve', verifyToken, authorizeRoles('CUSTOMER'), ticketController.requestSeatHold);
router.post('/confirm-partial-hold', verifyToken, ticketController.confirmPartialHold);
router.post('/reserve-zone', verifyToken, ticketController.reserveZone);
router.post('/start-checkout', verifyToken, ticketController.startCheckout);
router.post('/release', verifyToken, ticketController.releaseSeats);

module.exports = router;
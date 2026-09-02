const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticket.controller');

router.post('/reserve', ticketController.reserveSeat);

router.post('/start-checkout', ticketController.startCheckout);

module.exports = router;
const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticket.controller');

router.post("/payment/webhook",ticketController.webhook)

module.exports = router;
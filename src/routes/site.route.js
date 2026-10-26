const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticket.controller');

router.post('/payos-webhook', ticketController.payosWebhook);

module.exports = router;

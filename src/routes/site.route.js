const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticket.controller');

router.post("/payment/webhook", ticketController.webhook);
router.post("/payos-webhook", ticketController.payosWebhook);
router.post("/payment/payos-webhook", ticketController.payosWebhook);

module.exports = router;
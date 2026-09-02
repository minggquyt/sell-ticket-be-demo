const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticket.controller');

router.get('/:eventId/seats', ticketController.getSeats);


module.exports = router;
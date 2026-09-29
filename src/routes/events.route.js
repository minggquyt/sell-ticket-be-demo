const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticket.controller');

router.get('/',ticketController.getEvents)
router.get('/:eventId/details', ticketController.getEventDetails);


module.exports = router;
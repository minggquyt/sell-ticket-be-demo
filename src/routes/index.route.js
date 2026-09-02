const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticket.controller.js');
const eventsRoute = require('./events.route.js');
const seatsRoute = require('./seats.route.js');
const siteRoutes = require('./site.route.js');

router.use('/events', eventsRoute);

router.use('/seats', seatsRoute);

router.use('/',siteRoutes);

module.exports = router;
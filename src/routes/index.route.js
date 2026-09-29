const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticket.controller.js');
const eventsRoute = require('./events.route.js');
const seatsRoute = require('./seats.route.js');
const siteRoutes = require('./site.route.js');
const orderRoutes = require('./order.routes.js');
const authRoutes = require('./auth.route.js');
const adminRoutes = require('./admin.routes.js');

router.use("/auth",authRoutes)

router.use('/events', eventsRoute);

router.use('/seats', seatsRoute);

router.use('/orders',orderRoutes);

router.use('/admin', adminRoutes);

router.use('/',siteRoutes);

module.exports = router;
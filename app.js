const express = require("express");
const path = require("path");
const cors = require("cors");
const indexRoutes = require("./src/routes/index.route");
const logger = require("./src/utils/logger");
const ticketRepository = require("./src/repositories/ticket.repository");
const { startSeatReleaseJob } = require("./src/jobs/seat-release.job");
const { SSE_HEARTBEAT_INTERVAL_MS } = require("./src/config/constants");
const {
  apiResponseMiddleware,
  apiNotFoundMiddleware,
  apiErrorMiddleware,
} = require("./src/middlewares/api-response.middleware");

const app = express();
app.use(cors());
app.use("/api", apiResponseMiddleware);
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Middleware đo đạc và ghi log mọi HTTP request
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    const user = req.user
      ? req.user.email || req.user.id
      : req.headers["authorization"]
        ? "Authenticated"
        : "Guest";
    logger.http(
      req.method,
      req.originalUrl || req.url,
      res.statusCode,
      duration,
      user,
    );
  });
  next();
});

app.use("/api", indexRoutes);

app.get("/", async (req, res) => {
  res.send("Welcome to homepage");
});

app.get("/api/payos-webhook", (req, res) => {
  res.json({ success: true, message: "PayOS Webhook endpoint is active and running!" });
});

// Endpoint Server-Sent Events (SSE) để stream logs trực tiếp
app.get("/api/logs/stream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  // Gửi danh sách logs gần nhất cho client vừa kết nối
  const recent = logger.getRecentLogs();
  res.write(`data: ${JSON.stringify({ type: "INIT", logs: recent })}\n\n`);

  // Thêm client vào danh sách lắng nghe
  logger.addSSEClient(res);

  // Heartbeat ping để giữ kết nối không bị timeout bởi proxy / Cloudflare
  // FIX #9: Dùng constant thay vì magic number
  const keepAlive = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, SSE_HEARTBEAT_INTERVAL_MS);

  req.on("close", () => {
    clearInterval(keepAlive);
    logger.removeSSEClient(res);
  });
});

// Trang web xem Live Log thời gian thực
app.get("/logs", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "logs.html"));
});

app.use("/api", apiNotFoundMiddleware);
app.use(apiErrorMiddleware);

// Khởi động an toàn: đảm bảo schema DB sẵn sàng trước khi mở job & HTTP traffic
async function bootstrap() {
  try {
    await ticketRepository.ensureOrdersSchema();
  } catch (err) {
    logger.error(
      "SCHEMA_BOOTSTRAP",
      `Không thể kiểm tra cột orders.checkout_url / orders.payment_info (hãy chạy docs/migrations/add_order_checkout_url.sql và docs/migrations/add_order_payment_info.sql): ${err.message}`,
      err
    );
  }

  // Khởi động background job quét ghế hết hạn
  startSeatReleaseJob();

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () =>
    console.log(`🚀 Server đang chạy tại: http://localhost:${PORT}`),
  );
}

bootstrap();

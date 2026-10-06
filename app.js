const express = require("express");
const path = require("path");
const cors = require("cors");
const pool = require("./src/config/db");
const indexRoutes = require("./src/routes/index.route");
const ticketController = require("./src/controllers/ticket.controller");
const logger = require("./src/utils/logger");

const app = express();
app.use(cors());
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

// Hỗ trợ dự phòng nếu PayOS gửi ping vào root domain hoặc đường dẫn ngắn
app.post("/", ticketController.payosWebhook);
app.post("/payos-webhook", ticketController.payosWebhook);
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

  // Heartbeat ping mỗi 15s để giữ kết nối không bị timeout bởi proxy / Cloudflare
  const keepAlive = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 15000);

  req.on("close", () => {
    clearInterval(keepAlive);
    logger.removeSSEClient(res);
  });
});

// Trang web xem Live Log thời gian thực
app.get("/logs", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "logs.html"));
});

// Background Job: Quét ghế hết hạn định kỳ mỗi 60 giây
setInterval(async () => {
  try {
    const releaseQuery = `
      UPDATE seats 
      SET status = 'AVAILABLE', reserved_by = NULL, reserved_until = NULL, current_order_id = NULL 
      WHERE status IN ('RESERVED', 'PAYMENT_PROCESSING') AND reserved_until < NOW()
      RETURNING id, seat_number;
    `;
    const res = await pool.query(releaseQuery);
    if (res.rows.length > 0) {
      logger.cron(
        `Đã tự động giải phóng ${res.rows.length} ghế hết hạn: ${res.rows.map((s) => s.seat_number).join(", ")}`,
      );
    }
  } catch (err) {
    logger.error("CRON_AUTO_RELEASE", err.message);
  }
}, 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Server đang chạy tại: http://localhost:${PORT}`),
);

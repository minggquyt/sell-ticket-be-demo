const crypto = require("crypto");
const express = require("express");
const path = require("path");
const cors = require("cors");
const pool = require("./src/config/db");
const indexRoutes = require("./src/routes/index.route");
const logger = require("./src/utils/logger");
const paymentEvents = require("./src/utils/payment-events");
const ticketRepository = require("./src/repositories/ticket.repository");
const { startSeatReleaseJob } = require("./src/jobs/seat-release.job");
const {
  SSE_HEARTBEAT_INTERVAL_MS,
  CORS_ORIGINS,
  ENABLE_LIVE_LOGS,
  LOGS_ACCESS_TOKEN,
} = require("./src/config/constants");
const {
  apiResponseMiddleware,
  apiNotFoundMiddleware,
  apiErrorMiddleware,
} = require("./src/middlewares/api-response.middleware");

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

const normalizeOrigin = (origin) => String(origin || "").trim().replace(/\/+$/, "");

const allowedOrigins = new Set(
  [...String(CORS_ORIGINS || "").split(","), process.env.FRONTEND_ORIGIN || ""]
    .map(normalizeOrigin)
    .filter(Boolean),
);

const corsOptions = {
  exposedHeaders: ["Retry-After"],
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept", "Cache-Control"],
  origin:
    allowedOrigins.size > 0
      ? (origin, callback) => {
          if (!origin) return callback(null, true);
          if (allowedOrigins.has(normalizeOrigin(origin))) {
            return callback(null, true);
          }
          return callback(null, false);
        }
      : "*",
};

function isValidLogsToken(provided, expected) {
  const a = Buffer.from(String(provided || ""), "utf8");
  const b = Buffer.from(String(expected || ""), "utf8");
  if (a.length !== b.length || b.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

function requireLogsAccess(req, res, next) {
  const isApi = (req.originalUrl || req.path || "").startsWith("/api/");
  if (!ENABLE_LIVE_LOGS) {
    if (isApi) {
      return res.status(404).json({ success: false, message: "Not Found", data: null });
    }
    return res.status(404).send("Not Found");
  }

  if (LOGS_ACCESS_TOKEN) {
    const providedToken =
      typeof req.query.token === "string"
        ? req.query.token
        : typeof req.headers["x-logs-token"] === "string"
          ? req.headers["x-logs-token"]
          : "";
    if (!isValidLogsToken(providedToken, LOGS_ACCESS_TOKEN)) {
      if (isApi) {
        return res.status(403).json({ success: false, message: "Forbidden", data: null });
      }
      return res.status(403).send("Forbidden");
    }
  }

  return next();
}

app.use(cors(corsOptions));
app.use("/api", apiResponseMiddleware);
app.use(express.json());
app.use("/logs.html", requireLogsAccess);
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

app.get("/api/health", async (req, res) => {
  let timer;
  try {
    await Promise.race([
      pool.query("SELECT 1"),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("DB healthcheck timeout")), 3000);
        timer.unref?.();
      }),
    ]);
    return res.status(200).json({
      success: true,
      message: "OK",
      data: {
        status: "ok",
        db: "up",
        uptimeSeconds: Math.floor(process.uptime()),
        serverTime: new Date().toISOString(),
      },
    });
  } catch {
    return res.status(503).json({
      success: false,
      message: "Database unavailable.",
      data: {
        status: "degraded",
        db: "down",
        serverTime: new Date().toISOString(),
      },
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
});

app.get("/api/payos-webhook", (req, res) => {
  res.json({ success: true, message: "PayOS Webhook endpoint is active and running!" });
});

// Endpoint Server-Sent Events (SSE) để stream logs trực tiếp
app.get("/api/logs/stream", requireLogsAccess, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  // Gửi danh sách logs gần nhất cho client vừa kết nối
  const recent = logger.getRecentLogs();
  try {
    res.write(`data: ${JSON.stringify({ type: "INIT", logs: recent })}\n\n`);
  } catch {
    try {
      if (!res.writableEnded && !res.destroyed) res.end();
    } catch {}
    return;
  }

  // Thêm client vào danh sách lắng nghe
  logger.addSSEClient(res);

  let closed = false;
  let keepAlive = null;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (keepAlive) {
      clearInterval(keepAlive);
      keepAlive = null;
    }
    logger.removeSSEClient(res);
  };

  // Heartbeat ping để giữ kết nối không bị timeout bởi proxy / Heroku Router
  keepAlive = setInterval(() => {
    if (closed || res.writableEnded || res.destroyed) {
      cleanup();
      return;
    }
    try {
      res.write(": heartbeat\n\n");
      logger.touchSSEClient(res);
    } catch {
      cleanup();
      try {
        if (!res.writableEnded && !res.destroyed) res.end();
      } catch {}
    }
  }, SSE_HEARTBEAT_INTERVAL_MS);
  keepAlive.unref?.();

  req.on("close", cleanup);
  res.on("close", cleanup);
});

// Trang web xem Live Log thời gian thực
app.get("/logs", requireLogsAccess, (req, res) => {
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
  const stopSeatReleaseJob = startSeatReleaseJob();

  const PORT = process.env.PORT || 3000;
  const server = app.listen(PORT, () =>
    console.log(`🚀 Server đang chạy tại: http://localhost:${PORT}`),
  );

  let isShuttingDown = false;
  const shutdown = async (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[SHUTDOWN] Received ${signal}, draining connections...`);

    const forceExitTimer = setTimeout(() => {
      console.error("[SHUTDOWN] Forced exit after 25s timeout.");
      process.exit(1);
    }, 25000);
    forceExitTimer.unref?.();

    try {
      stopSeatReleaseJob();
    } catch {}
    try {
      paymentEvents.closeAll();
    } catch {}
    try {
      logger.closeAllSSEClients();
    } catch {}

    await new Promise((resolve) => server.close(() => resolve()));

    try {
      await pool.end();
    } catch (err) {
      console.error("[SHUTDOWN] pool.end error:", err.message);
    }

    clearTimeout(forceExitTimer);
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

bootstrap();

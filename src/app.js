import express from "express";
import cors from "cors";
import helmet from "helmet";
import { createServer } from "http";
import config from "./config/config.js";
import database from "./config/database.js";
import documentRoutes from "./routes/documentRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import webhookRoutes from "./routes/webhookRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import webSocketManager from "./services/websocketManager.js";
import dashboardService from "./services/dashboardService.js";
import logService from "./services/logService.js";
import workerManager from "./workers/workerManager.js";
import {
  startSubscriptionScheduler,
  stopSubscriptionScheduler,
} from "./services/subscriptionScheduler.js";
import { generalLimiter } from "./middleware/rateLimiter.js";

// Initialize database models
import "./models/index.js";

const app = express();

app.set("trust proxy", 1);

app.use(
  helmet({
    crossOriginResourcePolicy: false,
    contentSecurityPolicy: process.env.NODE_ENV === "production" ? undefined : false,
  })
);

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:3000",
      "http://127.0.0.1:5173",
      "https://fluentlabs.cloud",
      "https://www.fluentlabs.cloud",
      "https://pdf-converter-sable.vercel.app",
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    exposedHeaders: ["Content-Length", "X-Foo", "X-Bar"],
    maxAge: 86400,
    optionsSuccessStatus: 204,
  })
);

app.use("/api/", generalLimiter);

// Aumentar límites para archivos grandes
app.use(
  express.json({
    limit: "50mb",
    verify: (req, res, buf) => {
      req.rawBody = buf.toString();
    },
  })
);

app.use(
  express.urlencoded({
    limit: "50mb",
    extended: true,
  })
);

// Middleware para logging básico
app.use((req, res, next) => {
  const url = req.originalUrl;

  if (
    url.includes("/api/documents/status") ||
    url.includes("/api/auth/google-callback")
  ) {
    return next();
  }

  const start = process.hrtime.bigint();
  logService.info("request:start", {
    method: req.method,
    url,
    ip: req.ip,
  });

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    logService.info("request:complete", {
      method: req.method,
      url,
      statusCode: res.statusCode,
      durationMs: Number(durationMs.toFixed(2)),
      contentLength: res.getHeader("Content-Length"),
    });
  });

  next();
});

// Timeout middleware
app.use((req, res, next) => {
  const timeout = req.originalUrl.includes("/documents") ? 300000 : 30000;

  req.setTimeout(timeout, () => {
    logService.warn("request:timeout", {
      method: req.method,
      url: req.originalUrl,
    });
    if (!res.headersSent) {
      res.status(408).json({ error: "Request timeout" });
    }
  });

  next();
});

// Health check endpoint
app.get("/healthz", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

// Registrar todas las rutas
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/webhooks", webhookRoutes);
app.use("/api/dashboard", dashboardRoutes);

// Manejador de errores global
app.use((err, req, res, next) => {
  logService.error("request:error", {
    method: req.method,
    url: req.originalUrl,
    message: err.message,
    stack: err.stack,
  });

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
    error: "Error interno del servidor",
    details: err.message,
  });
});

// Manejador para rutas no encontradas
app.use("*", (req, res) => {
  console.log(
    `[${new Date().toISOString()}] 404 - Route not found: ${req.method} ${
      req.originalUrl
    }`
  );
  res.status(404).json({ error: "Ruta no encontrada" });
});

// Initialize database and start server
async function startServer() {
  try {
    // Sync database (create tables if they don't exist)
    await database.sync({ alter: false });
    console.log("[APP] Database synchronized");

    // Create HTTP server
    const server = createServer(app);

    // Initialize WebSocket server
    webSocketManager.initialize(server);
    console.log("[APP] WebSocket server initialized");

    // Start dashboard metrics collection
    dashboardService.startMetricsCollection();
    console.log("[APP] Dashboard metrics collection started");

    // Initialize workers for processing jobs
    await workerManager.initialize();
    console.log("[APP] Workers initialized");

    startSubscriptionScheduler();

    // Start server
    server.listen(config.port, () => {
      console.log(`[APP] Servidor corriendo en el puerto ${config.port}`);
      console.log(`[APP] Environment: ${config.env}`);
      console.log(`[APP] WebSocket server ready for connections`);
    });

    server.timeout = 300000;
    server.keepAliveTimeout = 65000;
    server.headersTimeout = 66000;

    // Graceful shutdown
    process.on("SIGTERM", async () => {
      console.log("[APP] SIGTERM received, shutting down gracefully");
      dashboardService.stopMetricsCollection();
      await stopSubscriptionScheduler();
      await workerManager.close();
      server.close(() => {
        database.close();
        process.exit(0);
      });
    });

    process.on("SIGINT", async () => {
      console.log("[APP] SIGINT received, shutting down gracefully");
      dashboardService.stopMetricsCollection();
      await workerManager.close();
      server.close(() => {
        database.close();
        process.exit(0);
      });
    });
  } catch (error) {
    console.error("[APP] Failed to start server:", error);
    process.exit(1);
  }
}

startServer();

export default app;

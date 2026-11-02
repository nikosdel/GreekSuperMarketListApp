import express from "express";
import helmet from "helmet";
import { registerRoutes } from "./auth.js";
import { sendError } from "./errors.js";
import { catalogRoutes } from "./catalog.js";
import { listRoutes } from "./lists.js";
import { notificationRoutes } from "./notifications.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: false,
    strictTransportSecurity: false,
  }));
  app.use(express.json({ limit: "20kb" }));
  app.use(express.urlencoded({ extended: false, limit: "20kb" }));
  const allowedOrigins = new Set(
    (process.env.CORS_ORIGIN || "http://localhost:4200,http://127.0.0.1:4200")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  app.use((req, res, next) => {
    const requestOrigin = req.get("origin");
    if (requestOrigin && allowedOrigins.has(requestOrigin)) {
      res.set("Access-Control-Allow-Origin", requestOrigin);
    }
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.set("Vary", "Origin");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });
  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });
  registerRoutes(app);
  notificationRoutes(app);
  catalogRoutes(app);
  listRoutes(app);
  app.use((error, _req, res, _next) => {
    sendError(res, error);
  });
  return app;
}

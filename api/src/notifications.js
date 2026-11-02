import { pool } from "./db.js";
import { requireUser } from "./auth.js";
import { asyncRoute, HttpError } from "./errors.js";
import { addListener, issueStreamTicket, removeListener, takeStreamTicket } from "./notify.js";
import { readAccessToken } from "./tokens.js";

export function notificationRoutes(app) {
  app.get("/notifications", requireUser, asyncRoute(listNotifications));
  app.post("/notifications/ticket", requireUser, asyncRoute(streamTicket));
  app.post("/notifications/:id/read", requireUser, asyncRoute(markRead));
  app.get("/notifications/stream", asyncRoute(streamNotifications));
}

async function listNotifications(req, res) {
  const rows = await pool.query(
    `SELECT id, list_id, kind, message, created_at, read_at
     FROM list_notification
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [req.userId],
  );
  const unread = await pool.query(
    `SELECT count(*)::int AS unread
     FROM list_notification
     WHERE user_id = $1 AND read_at IS NULL`,
    [req.userId],
  );
  res.json({
    unread_count: unread.rows[0].unread,
    notifications: rows.rows.map((row) => ({
      id: Number(row.id),
      list_id: Number(row.list_id),
      kind: row.kind,
      message: row.message,
      created_at: row.created_at,
      read_at: row.read_at,
    })),
  });
}

async function markRead(req, res) {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new HttpError(400, "invalid_request", "That id is not valid.");
  }
  const updated = await pool.query(
    `UPDATE list_notification
     SET read_at = now()
     WHERE id = $1 AND user_id = $2 AND read_at IS NULL`,
    [id, req.userId],
  );
  if (updated.rowCount === 0) {
    throw new HttpError(404, "not_found", "That notification is not available.");
  }
  res.status(204).end();
}

function streamTicket(req, res) {
  res.json(issueStreamTicket(req.userId));
}

async function streamNotifications(req, res) {
  const userId = streamUserId(req);
  res.status(200);
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();
  res.write(": connected\n\n");
  addListener(userId, res);
  const heartbeat = setInterval(() => {
    res.write(": ping\n\n");
  }, 25000);
  req.on("close", () => {
    clearInterval(heartbeat);
    removeListener(userId, res);
  });
}

function streamUserId(req) {
  const ticket = String(req.query.ticket || "");
  if (ticket) {
    return takeStreamTicket(ticket);
  }
  return readAccessToken(req.get("authorization"));
}

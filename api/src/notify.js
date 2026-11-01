import crypto from "node:crypto";
import { HttpError } from "./errors.js";

const listeners = new Map();

export function addListener(userId, response) {
  const group = listeners.get(userId) || new Set();
  group.add(response);
  listeners.set(userId, group);
}

export function removeListener(userId, response) {
  const group = listeners.get(userId);
  if (!group) {
    return;
  }
  group.delete(response);
  if (group.size === 0) {
    listeners.delete(userId);
  }
}

function publish(userId, event) {
  const group = listeners.get(userId);
  if (!group) {
    return;
  }
  const payload = `event: notification\ndata: ${JSON.stringify(event)}\n\n`;
  for (const response of group) {
    response.write(payload);
  }
}

export async function notifyOthers(client, { listId, actorId, kind, message }) {
  const members = await client.query(
    `SELECT user_id FROM shopping_list_member WHERE list_id = $1 AND user_id <> $2`,
    [listId, actorId],
  );
  const created = [];
  for (const member of members.rows) {
    const inserted = await client.query(
      `INSERT INTO list_notification (user_id, list_id, actor_id, kind, message)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, list_id, kind, message, created_at`,
      [member.user_id, listId, actorId, kind, message.slice(0, 200)],
    );
    created.push(inserted.rows[0]);
  }
  return created;
}

export function deliver(rows) {
  for (const row of rows) {
    publish(Number(row.user_id), {
      id: Number(row.id),
      list_id: Number(row.list_id),
      kind: row.kind,
      message: row.message,
      created_at: row.created_at,
    });
  }
}

const tickets = new Map();

export function issueStreamTicket(userId) {
  const ticket = crypto.randomBytes(24).toString("base64url");
  const expiresAt = Date.now() + 30_000;
  tickets.set(ticket, { userId, expiresAt });
  return { ticket, expires_in: 30 };
}

export function takeStreamTicket(ticket) {
  const found = tickets.get(ticket);
  tickets.delete(ticket);
  if (!found || found.expiresAt <= Date.now()) {
    throw new HttpError(401, "invalid_token", "The stream ticket is expired or already used.");
  }
  return found.userId;
}

import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { pool } from "./db.js";
import { HttpError } from "./errors.js";

const ISSUER = "supermarket-api";
const AUDIENCE = "supermarket";

function secret() {
  const value = process.env.TOKEN_SECRET;
  if (!value || value.length < 32) {
    throw new Error("TOKEN_SECRET must be at least 32 characters");
  }
  return value;
}

export function accessMinutes() {
  const minutes = Number(process.env.ACCESS_TOKEN_MINUTES || 15);
  return Math.min(60, Math.max(5, minutes));
}

function refreshDays() {
  const days = Number(process.env.REFRESH_TOKEN_DAYS || 14);
  return Math.min(30, Math.max(1, days));
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function signAccessToken(userId) {
  const minutes = accessMinutes();
  const accessToken = jwt.sign({ sub: String(userId) }, secret(), {
    algorithm: "HS256",
    expiresIn: minutes * 60,
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  return { accessToken, expiresIn: minutes * 60 };
}

export function readAccessToken(header) {
  const match = /^Bearer\s+([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)$/.exec(header || "");
  if (!match) {
    throw new HttpError(401, "invalid_token", "A bearer access token is required.");
  }
  try {
    const payload = jwt.verify(match[1], secret(), {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    const userId = Number(payload.sub);
    if (!Number.isSafeInteger(userId) || userId < 1) {
      throw new HttpError(401, "invalid_token", "The access token is not valid.");
    }
    return userId;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(401, "invalid_token", "The access token is expired or not valid.");
  }
}

export async function issueRefreshToken(userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + refreshDays() * 24 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO refresh_token (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, hashToken(token), expiresAt],
  );
  return token;
}

export async function rotateRefreshToken(token) {
  const tokenHash = hashToken(token);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(
      `SELECT id, user_id, expires_at, revoked_at
       FROM refresh_token
       WHERE token_hash = $1
       FOR UPDATE`,
      [tokenHash],
    );
    const row = found.rows[0];
    if (!row || row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) {
      throw new HttpError(401, "invalid_grant", "The refresh token is expired or revoked.");
    }
    await client.query("UPDATE refresh_token SET revoked_at = now() WHERE id = $1", [row.id]);
    const next = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + refreshDays() * 24 * 60 * 60 * 1000);
    await client.query(
      `INSERT INTO refresh_token (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [row.user_id, hashToken(next), expiresAt],
    );
    await client.query("COMMIT");
    return { userId: Number(row.user_id), refreshToken: next };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeRefreshToken(token) {
  await pool.query(
    `UPDATE refresh_token
     SET revoked_at = now()
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashToken(token)],
  );
}

export function tokenResponse(userId, refreshToken) {
  const { accessToken, expiresIn } = signAccessToken(userId);
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: expiresIn,
    refresh_token: refreshToken,
  };
}

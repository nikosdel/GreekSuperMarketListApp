import bcrypt from "bcrypt";
import rateLimit from "express-rate-limit";
import { pool } from "./db.js";
import { asyncRoute, HttpError } from "./errors.js";
import { sendAccountCreated } from "./mail.js";
import { issueRefreshToken, readAccessToken, revokeRefreshToken, rotateRefreshToken, tokenResponse } from "./tokens.js";

const DUMMY_HASH = bcrypt.hashSync("invalid-password-placeholder", 12);
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Too many attempts. Try again later." },
});

function cleanEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email.length > 200) {
    throw new HttpError(400, "invalid_request", "Enter a valid email.");
  }
  return email;
}

function cleanPassword(value) {
  const password = String(value || "");
  if (password.length < 10 || password.length > 200) {
    throw new HttpError(400, "invalid_request", "Password must be 10 to 200 characters.");
  }
  return password;
}

export function requireUser(req, _res, next) {
  try {
    req.userId = readAccessToken(req.get("authorization"));
    next();
  } catch (error) {
    next(error);
  }
}

export function registerRoutes(app) {
  app.post(
    "/users",
    authLimiter,
    asyncRoute(async (req, res) => {
      const email = cleanEmail(req.body?.email);
      const displayName = String(req.body?.display_name || "").trim();
      const password = cleanPassword(req.body?.password);
      if (displayName.length < 1 || displayName.length > 80) {
        throw new HttpError(400, "invalid_request", "Display name must be 1 to 80 characters.");
      }
      const passwordHash = await bcrypt.hash(password, 12);
      try {
        const inserted = await pool.query(
          `INSERT INTO app_user (email, display_name, password_hash)
           VALUES ($1, $2, $3)
           RETURNING id, email, display_name, created_at`,
          [email, displayName, passwordHash],
        );
        let emailSent = false;
        try {
          emailSent = await sendAccountCreated({ email, displayName });
        } catch {
          console.error("welcome email failed");
        }
        res.status(201).json({ ...publicUser(inserted.rows[0]), email_sent: emailSent });
      } catch (error) {
        if (error.code === "23505") {
          throw new HttpError(409, "email_taken", "That email is already registered.");
        }
        throw error;
      }
    }),
  );

  app.post(
    "/oauth/token",
    authLimiter,
    asyncRoute(async (req, res) => {
      const grant = String(req.body?.grant_type || "");
      if (grant === "password") {
        const email = cleanEmail(req.body?.username);
        const password = String(req.body?.password || "");
        const found = await pool.query(
          "SELECT id, password_hash FROM app_user WHERE email = $1",
          [email],
        );
        const row = found.rows[0];
        const hash = row?.password_hash || DUMMY_HASH;
        const matches = await bcrypt.compare(password, hash);
        if (!row || !matches) {
          throw new HttpError(401, "invalid_grant", "The email or password is wrong.");
        }
        const refreshToken = await issueRefreshToken(row.id);
        res.json(tokenResponse(Number(row.id), refreshToken));
        return;
      }
      if (grant === "refresh_token") {
        const refreshToken = String(req.body?.refresh_token || "");
        if (refreshToken.length < 20) {
          throw new HttpError(400, "invalid_request", "A refresh token is required.");
        }
        const rotated = await rotateRefreshToken(refreshToken);
        res.json(tokenResponse(rotated.userId, rotated.refreshToken));
        return;
      }
      throw new HttpError(400, "unsupported_grant_type", "Use the password or refresh_token grant.");
    }),
  );

  app.post(
    "/oauth/revoke",
    requireUser,
    asyncRoute(async (req, res) => {
      const refreshToken = String(req.body?.token || "");
      if (refreshToken) {
        await revokeRefreshToken(refreshToken);
      }
      res.status(204).end();
    }),
  );

  app.get(
    "/users/me",
    requireUser,
    asyncRoute(async (req, res) => {
      const found = await pool.query(
        "SELECT id, email, display_name, created_at FROM app_user WHERE id = $1",
        [req.userId],
      );
      if (!found.rows[0]) {
        throw new HttpError(401, "invalid_token", "This account no longer exists.");
      }
      res.json(publicUser(found.rows[0]));
    }),
  );
}

function publicUser(row) {
  return {
    id: Number(row.id),
    email: row.email,
    display_name: row.display_name,
    created_at: row.created_at,
  };
}

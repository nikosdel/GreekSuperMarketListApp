import assert from "node:assert/strict";
import test from "node:test";
import { loginAttemptMessage } from "./auth.js";

test("login lockout names the remaining minutes", () => {
  const fullWindow = loginAttemptMessage({
    rateLimit: { resetTime: new Date(Date.now() + 15 * 60 * 1000) },
  });
  assert.equal(fullWindow.message, "Too many attempts. Try again after 15 minutes.");

  const oneMinute = loginAttemptMessage({
    rateLimit: { resetTime: new Date(Date.now() + 30 * 1000) },
  });
  assert.equal(oneMinute.message, "Too many attempts. Try again after 1 minute.");
});

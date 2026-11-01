const base = "http://127.0.0.1:3000";
const stamp = Date.now();
const productId = 25956;

async function json(path, options = {}) {
  const response = await fetch(base + path, options);
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${path} ${response.status} ${text}`);
  }
  return body;
}

function form(path, fields) {
  return json(path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
}

const anna = await json("/users", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    email: `anna-${stamp}@example.com`,
    display_name: "Anna",
    password: "correct-horse-1",
  }),
});
const nikos = await json("/users", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    email: `nikos-${stamp}@example.com`,
    display_name: "Nikos",
    password: "correct-horse-2",
  }),
});
const annaToken = await form("/oauth/token", {
  grant_type: "password",
  username: anna.email,
  password: "correct-horse-1",
});
const nikosToken = await form("/oauth/token", {
  grant_type: "password",
  username: nikos.email,
  password: "correct-horse-2",
});
if (annaToken.expires_in !== 900 || annaToken.token_type !== "Bearer") {
  throw new Error("unexpected token response");
}
const bad = await fetch(base + "/oauth/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "password",
    username: anna.email,
    password: "wrong-password",
  }),
});
if (bad.status !== 401) {
  throw new Error("bad password should be 401");
}
const refreshed = await form("/oauth/token", {
  grant_type: "refresh_token",
  refresh_token: annaToken.refresh_token,
});
const list = await json("/lists", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${refreshed.access_token}`,
  },
  body: JSON.stringify({ title: "Weekly shop" }),
});
await json("/lists/join", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${nikosToken.access_token}`,
  },
  body: JSON.stringify({ invite_code: list.invite_code }),
});
const ticket = await json("/notifications/ticket", {
  method: "POST",
  headers: { authorization: `Bearer ${nikosToken.access_token}` },
});
const streamControl = new AbortController();
const stream = await fetch(`${base}/notifications/stream?ticket=${ticket.ticket}`, {
  signal: streamControl.signal,
});
if (!stream.ok) {
  throw new Error(`stream ${stream.status}`);
}
const reader = stream.body.getReader();
const decoder = new TextDecoder();
let buffered = "";
const readUntil = async (needle) => {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (buffered.includes(needle)) {
      return buffered;
    }
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }
    buffered += decoder.decode(chunk.value);
  }
  throw new Error(`missing ${needle}: ${buffered}`);
};
await readUntil(": connected");
await json(`/lists/${list.id}/items`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${refreshed.access_token}`,
  },
  body: JSON.stringify({ product_id: productId, quantity: 2 }),
});
const eventText = await readUntil("event: notification");
const stored = await json("/notifications", {
  headers: { authorization: `Bearer ${nikosToken.access_token}` },
});
if (stored.notifications.length < 1 || !stored.notifications[0].message.includes("added")) {
  throw new Error(JSON.stringify(stored));
}
const reused = await fetch(base + "/oauth/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: annaToken.refresh_token,
  }),
});
if (reused.status !== 401) {
  throw new Error("used refresh token should be 401");
}
await json(`/lists/${list.id}/save`, {
  method: "POST",
  headers: { authorization: `Bearer ${refreshed.access_token}` },
});
const locked = await fetch(`${base}/lists/${list.id}/items`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${nikosToken.access_token}`,
  },
  body: JSON.stringify({ product_id: productId, quantity: 1 }),
});
if (locked.status !== 409) {
  throw new Error(`saved list should be 409, got ${locked.status}`);
}
streamControl.abort();
console.log("ok");
console.log(stored.notifications[0].message);
console.log(eventText.includes("item_added") ? "live-event" : "missing-live-event");

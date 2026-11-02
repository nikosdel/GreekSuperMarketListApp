import crypto from "node:crypto";
import { pool, withTx } from "./db.js";
import { requireUser } from "./auth.js";
import { asyncRoute, HttpError } from "./errors.js";
import { deliver, notifyOthers } from "./notify.js";

export function listRoutes(app) {
  app.post("/lists", requireUser, asyncRoute(createList));
  app.get("/lists", requireUser, asyncRoute(myLists));
  app.post("/lists/join", requireUser, asyncRoute(joinList));
  app.get("/lists/:id", requireUser, asyncRoute(listDetail));
  app.post("/lists/:id/items", requireUser, asyncRoute(addItem));
  app.patch("/lists/:id/items/:itemId", requireUser, asyncRoute(updateItem));
  app.delete("/lists/:id/items/:itemId", requireUser, asyncRoute(removeItem));
  app.post("/lists/:id/save", requireUser, asyncRoute(saveList));
}

async function createList(req, res) {
  const title = cleanTitle(req.body?.title);
  const list = await withTx(async (client) => {
    const inviteCode = await unusedInviteCode(client);
    const inserted = await client.query(
      `INSERT INTO shopping_list (title, created_by, invite_code)
       VALUES ($1, $2, $3)
       RETURNING id, title, status, invite_code, created_at`,
      [title, req.userId, inviteCode],
    );
    await client.query(
      `INSERT INTO shopping_list_member (list_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [inserted.rows[0].id, req.userId],
    );
    return inserted.rows[0];
  });
  res.status(201).json({ ...publicList(list), role: "owner" });
}

async function myLists(req, res) {
  const rows = await pool.query(
    `SELECT list.id, list.title, list.status, list.invite_code, list.created_at, list.saved_at,
            member.role, saver.display_name AS saved_by_name,
            (SELECT count(*)::int FROM shopping_list_item item WHERE item.list_id = list.id) AS item_count,
            (SELECT count(*)::int FROM shopping_list_member person WHERE person.list_id = list.id) AS member_count
     FROM shopping_list list
     JOIN shopping_list_member member ON member.list_id = list.id
     LEFT JOIN app_user saver ON saver.id = list.saved_by
     WHERE member.user_id = $1
     ORDER BY COALESCE(list.saved_at, list.created_at) DESC`,
    [req.userId],
  );
  res.json({ lists: rows.rows.map(publicList) });
}

async function joinList(req, res) {
  const inviteCode = String(req.body?.invite_code || "").trim();
  if (!/^[A-Za-z0-9_-]{8,20}$/.test(inviteCode)) {
    throw new HttpError(400, "invalid_request", "Enter the invite code.");
  }
  const result = await withTx(async (client) => {
    const found = await client.query(
      `SELECT id, title, status FROM shopping_list WHERE invite_code = $1 AND status = 'open'`,
      [inviteCode],
    );
    const list = found.rows[0];
    if (!list) {
      throw new HttpError(404, "not_found", "No open list uses that invite code.");
    }
    const member = await client.query(
      `INSERT INTO shopping_list_member (list_id, user_id, role)
       VALUES ($1, $2, 'editor')
       ON CONFLICT (list_id, user_id) DO NOTHING
       RETURNING user_id`,
      [list.id, req.userId],
    );
    let notices = [];
    if (member.rows[0]) {
      const actor = await displayName(client, req.userId);
      notices = await notifyOthers(client, {
        listId: list.id,
        actorId: req.userId,
        kind: "member_joined",
        message: `${actor} joined ${list.title}.`,
      });
    }
    return { listId: Number(list.id), notices };
  });
  deliver(result.notices);
  res.status(201).json({ list_id: result.listId });
}

async function listDetail(req, res) {
  const listId = cleanId(req.params.id);
  await assertMember(listId, req.userId);
  const list = await pool.query(
    `SELECT list.id, list.title, list.status, list.invite_code, list.created_at, list.saved_at,
            saver.display_name AS saved_by_name
     FROM shopping_list list
     LEFT JOIN app_user saver ON saver.id = list.saved_by
     WHERE list.id = $1`,
    [listId],
  );
  const members = await pool.query(
    `SELECT app_user.id, app_user.display_name, member.role
     FROM shopping_list_member member
     JOIN app_user ON app_user.id = member.user_id
     WHERE member.list_id = $1
     ORDER BY member.joined_at`,
    [listId],
  );
  const items = await pool.query(
    `SELECT item.id, item.product_id, item.quantity, item.product_name, item.chain_name,
            item.price_at_save, item.unit_price_at_save, item.added_by,
            current_price.price AS current_price, current_price.unit_price_text,
            product.image_url
     FROM shopping_list_item item
     LEFT JOIN product ON product.id = item.product_id
     LEFT JOIN current_price ON current_price.product_id = item.product_id
     WHERE item.list_id = $1
     ORDER BY item.id`,
    [listId],
  );
  res.json({
    ...publicList(list.rows[0]),
    members: members.rows.map((row) => ({
      id: Number(row.id),
      display_name: row.display_name,
      role: row.role,
    })),
    items: items.rows.map(publicItem),
  });
}

async function addItem(req, res) {
  const listId = cleanId(req.params.id);
  const productId = cleanId(req.body?.product_id);
  const quantity = cleanQuantity(req.body?.quantity ?? 1);
  const result = await withTx(async (client) => {
    const list = await openListForMember(client, listId, req.userId);
    const product = await client.query(
      `SELECT product.name, chain.name AS chain_name
       FROM product
       JOIN chain ON chain.id = product.chain_id
       WHERE product.id = $1`,
      [productId],
    );
    if (!product.rows[0]) {
      throw new HttpError(404, "not_found", "That product is not in the catalog.");
    }
    const existing = await client.query(
      `SELECT id, quantity FROM shopping_list_item WHERE list_id = $1 AND product_id = $2`,
      [listId, productId],
    );
    let item;
    let kind;
    if (existing.rows[0]) {
      const updated = await client.query(
        `UPDATE shopping_list_item
         SET quantity = quantity + $2, updated_at = now()
         WHERE id = $1
         RETURNING id, product_id, quantity, product_name, chain_name, price_at_save, unit_price_at_save, added_by`,
        [existing.rows[0].id, quantity],
      );
      item = updated.rows[0];
      kind = "item_updated";
    } else {
      const inserted = await client.query(
        `INSERT INTO shopping_list_item
           (list_id, product_id, quantity, added_by, product_name, chain_name)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, product_id, quantity, product_name, chain_name, price_at_save, unit_price_at_save, added_by`,
        [listId, productId, quantity, req.userId, product.rows[0].name, product.rows[0].chain_name],
      );
      item = inserted.rows[0];
      kind = "item_added";
    }
    const actor = await displayName(client, req.userId);
    const verb = kind === "item_added" ? "added" : "updated";
    const notices = await notifyOthers(client, {
      listId,
      actorId: req.userId,
      kind,
      message: `${actor} ${verb} ${item.product_name} on ${list.title}.`,
    });
    return { item, notices };
  });
  deliver(result.notices);
  res.status(201).json(publicItem(result.item));
}

async function updateItem(req, res) {
  const listId = cleanId(req.params.id);
  const itemId = cleanId(req.params.itemId);
  const quantity = cleanQuantity(req.body?.quantity);
  const result = await withTx(async (client) => {
    const list = await openListForMember(client, listId, req.userId);
    const updated = await client.query(
      `UPDATE shopping_list_item
       SET quantity = $3, updated_at = now()
       WHERE id = $1 AND list_id = $2
       RETURNING id, product_id, quantity, product_name, chain_name, price_at_save, unit_price_at_save, added_by`,
      [itemId, listId, quantity],
    );
    if (!updated.rows[0]) {
      throw new HttpError(404, "not_found", "That item is not on this list.");
    }
    const actor = await displayName(client, req.userId);
    const notices = await notifyOthers(client, {
      listId,
      actorId: req.userId,
      kind: "item_updated",
      message: `${actor} updated ${updated.rows[0].product_name} on ${list.title}.`,
    });
    return { item: updated.rows[0], notices };
  });
  deliver(result.notices);
  res.json(publicItem(result.item));
}

async function removeItem(req, res) {
  const listId = cleanId(req.params.id);
  const itemId = cleanId(req.params.itemId);
  const result = await withTx(async (client) => {
    const list = await openListForMember(client, listId, req.userId);
    const removed = await client.query(
      `DELETE FROM shopping_list_item
       WHERE id = $1 AND list_id = $2
       RETURNING product_name`,
      [itemId, listId],
    );
    if (!removed.rows[0]) {
      throw new HttpError(404, "not_found", "That item is not on this list.");
    }
    const actor = await displayName(client, req.userId);
    const notices = await notifyOthers(client, {
      listId,
      actorId: req.userId,
      kind: "item_removed",
      message: `${actor} removed ${removed.rows[0].product_name} from ${list.title}.`,
    });
    return { notices };
  });
  deliver(result.notices);
  res.status(204).end();
}

async function saveList(req, res) {
  const listId = cleanId(req.params.id);
  const notices = await withTx(async (client) => {
    const list = await openListForMember(client, listId, req.userId);
    await client.query(
      `UPDATE shopping_list_item AS item
       SET product_name = product.name,
           chain_name = chain.name,
           price_at_save = current_price.price,
           unit_price_at_save = current_price.unit_price,
           updated_at = now()
       FROM product
       JOIN chain ON chain.id = product.chain_id
       LEFT JOIN current_price ON current_price.product_id = product.id
       WHERE item.list_id = $1 AND item.product_id = product.id`,
      [listId],
    );
    await client.query(
      `UPDATE shopping_list
       SET status = 'saved', saved_at = now(), saved_by = $2, invite_code = NULL
       WHERE id = $1`,
      [listId, req.userId],
    );
    const actor = await displayName(client, req.userId);
    return notifyOthers(client, {
      listId,
      actorId: req.userId,
      kind: "list_saved",
      message: `${actor} saved ${list.title}.`,
    });
  });
  deliver(notices);
  res.status(204).end();
}

async function openListForMember(client, listId, userId) {
  const found = await client.query(
    `SELECT list.id, list.title, list.status
     FROM shopping_list list
     JOIN shopping_list_member member ON member.list_id = list.id
     WHERE list.id = $1 AND member.user_id = $2`,
    [listId, userId],
  );
  const list = found.rows[0];
  if (!list) {
    throw new HttpError(404, "not_found", "That list is not available to you.");
  }
  if (list.status !== "open") {
    throw new HttpError(409, "list_saved", "This list is saved history and cannot be changed.");
  }
  return list;
}

async function assertMember(listId, userId) {
  const found = await pool.query(
    `SELECT 1 FROM shopping_list_member WHERE list_id = $1 AND user_id = $2`,
    [listId, userId],
  );
  if (!found.rows[0]) {
    throw new HttpError(404, "not_found", "That list is not available to you.");
  }
}

async function displayName(client, userId) {
  const found = await client.query("SELECT display_name FROM app_user WHERE id = $1", [userId]);
  return found.rows[0]?.display_name || "Someone";
}

async function unusedInviteCode(client) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = crypto.randomBytes(9).toString("base64url").slice(0, 12);
    const found = await client.query("SELECT 1 FROM shopping_list WHERE invite_code = $1", [code]);
    if (!found.rows[0]) {
      return code;
    }
  }
  throw new HttpError(500, "server_error", "Could not create an invite code.");
}

function publicList(row) {
  return {
    id: Number(row.id),
    title: row.title,
    status: row.status,
    invite_code: row.invite_code,
    role: row.role,
    created_at: row.created_at,
    saved_at: row.saved_at,
    saved_by_name: row.saved_by_name || null,
    item_count: row.item_count === undefined ? undefined : Number(row.item_count),
    member_count: row.member_count === undefined ? undefined : Number(row.member_count),
  };
}

function publicItem(row) {
  return {
    id: Number(row.id),
    product_id: row.product_id === null ? null : Number(row.product_id),
    quantity: row.quantity,
    product_name: row.product_name,
    chain_name: row.chain_name,
    price_at_save: row.price_at_save === null || row.price_at_save === undefined ? null : Number(row.price_at_save),
    unit_price_at_save: row.unit_price_at_save === null || row.unit_price_at_save === undefined ? null : Number(row.unit_price_at_save),
    current_price: row.current_price === null || row.current_price === undefined ? null : Number(row.current_price),
    unit_price_text: row.unit_price_text || null,
    image_url: row.image_url || null,
    added_by: row.added_by === null ? null : Number(row.added_by),
  };
}

function cleanTitle(value) {
  const title = String(value || "").trim();
  if (title.length < 1 || title.length > 120) {
    throw new HttpError(400, "invalid_request", "The list title must be 1 to 120 characters.");
  }
  return title;
}

function cleanId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new HttpError(400, "invalid_request", "That id is not valid.");
  }
  return id;
}

function cleanQuantity(value) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 9999) {
    throw new HttpError(400, "invalid_request", "Quantity must be greater than 0.");
  }
  return quantity.toFixed(3);
}

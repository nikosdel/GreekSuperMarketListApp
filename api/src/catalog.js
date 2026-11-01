import rateLimit from "express-rate-limit";
import { pool } from "./db.js";
import { requireUser } from "./auth.js";
import { asyncRoute, HttpError } from "./errors.js";

const FOLD_FROM = "άέήίόύώϊϋΐΰςΆΈΉΊΌΎΏΪΫΣ";
const FOLD_TO = "αεηιουωιυιυσΑΕΗΙΟΥΩΙΥΣ";
const STOPWORDS = new Set([
  "ενα", "ενας", "μια", "το", "τη", "την", "ο", "η", "και", "να", "παρω", "που", "συμφερει",
]);

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Too many searches. Try again in a minute." },
});

export function catalogRoutes(app) {
  app.get("/catalog/search", requireUser, searchLimiter, asyncRoute(searchCatalog));
}

function fold(value) {
  return [...value].map((char) => {
    const index = FOLD_FROM.indexOf(char);
    return index === -1 ? char : FOLD_TO[index];
  }).join("").toLocaleLowerCase("el");
}

function tokensFor(raw) {
  const words = fold(String(raw || ""))
    .split(/[^\p{L}\p{N}]+/u)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
  const useful = words.filter((part) => !STOPWORDS.has(part));
  return (useful.length ? useful : words).slice(0, 6);
}

async function searchCatalog(req, res) {
  const tokens = tokensFor(req.query.q);
  if (!tokens.length) {
    throw new HttpError(400, "invalid_request", "Type at least two letters of the product name.");
  }
  const where = tokens.map((token, index) => {
    return `translate(product.name, '${FOLD_FROM}', '${FOLD_TO}') ILIKE $${index + 1}`;
  });
  const params = tokens.map((token) => `%${token.replace(/[%_\\]/g, "")}%`);
  const found = await pool.query(
    `SELECT product.id, product.name, chain.name AS chain_name,
            current_price.price, current_price.unit_price_text, current_price.observed_at
     FROM product
     JOIN chain ON chain.id = product.chain_id
     JOIN current_price ON current_price.product_id = product.id
     WHERE ${where.join(" AND ")}
     ORDER BY current_price.price ASC, product.name ASC
     LIMIT 12`,
    params,
  );
  res.json({
    products: found.rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      chain_name: row.chain_name,
      price: row.price === null ? null : Number(row.price),
      unit_price_text: row.unit_price_text,
      observed_at: row.observed_at,
    })),
  });
}

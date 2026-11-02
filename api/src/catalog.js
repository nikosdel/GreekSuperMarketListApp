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
  app.get("/catalog/categories", requireUser, searchLimiter, asyncRoute(listCategories));
  app.get("/catalog/chains", requireUser, asyncRoute(listChains));
  app.get("/catalog/products", requireUser, searchLimiter, asyncRoute(listProducts));
  app.get("/catalog/search", requireUser, searchLimiter, asyncRoute(searchCatalog));
}

function likePrefix(path) {
  return `${path.replace(/[\\%_]/g, "\\$&")} > %`;
}

function categoryClause(path, params) {
  if (!path) {
    return "TRUE";
  }
  params.push(path, likePrefix(path));
  const exact = params.length - 1;
  const child = params.length;
  return `(product.category_path = $${exact} OR product.category_path LIKE $${child} ESCAPE '\\')`;
}

async function listCategories(req, res) {
  const path = String(req.query.path || "").trim();
  const depth = path ? path.split(" > ").length : 0;
  const params = [];
  const scoped = categoryClause(path, params);
  const found = await pool.query(
    `SELECT split_part(product.category_path, ' > ', ${depth + 1}) AS name,
            count(*)::int AS products
     FROM product
     WHERE product.category_path IS NOT NULL
       AND ${scoped}
       AND split_part(product.category_path, ' > ', ${depth + 1}) <> ''
     GROUP BY 1
     ORDER BY 1`,
    params,
  );
  res.json({
    path,
    categories: found.rows.map((row) => ({ name: row.name, products: row.products })),
  });
}

async function listChains(_req, res) {
  const found = await pool.query(
    `SELECT DISTINCT chain.name
     FROM chain
     JOIN product ON product.chain_id = chain.id
     ORDER BY chain.name`,
  );
  res.json({ chains: found.rows.map((row) => row.name) });
}

async function listProducts(req, res) {
  const path = String(req.query.path || "").trim();
  const chain = String(req.query.chain || "").trim();
  const sort = req.query.sort === "name" ? "name" : "price";
  const limit = Math.min(48, Math.max(1, Number(req.query.limit) || 24));
  const offset = Math.min(10000, Math.max(0, Number(req.query.offset) || 0));
  const tokens = String(req.query.q || "").trim() ? tokensFor(req.query.q) : [];
  if (String(req.query.q || "").trim() && !tokens.length) {
    throw new HttpError(400, "invalid_request", "Type at least two letters of the product name.");
  }
  const params = [];
  const where = [categoryClause(path, params)];
  for (const token of tokens) {
    params.push(`%${token.replace(/[%_\\]/g, "")}%`);
    where.push(`translate(product.name, '${FOLD_FROM}', '${FOLD_TO}') ILIKE $${params.length}`);
  }
  if (chain) {
    params.push(chain);
    where.push(`chain.name = $${params.length}`);
  }
  const order = sort === "name"
    ? "product.name ASC, current_price.price ASC"
    : "current_price.price ASC, product.name ASC";
  const found = await pool.query(
    `SELECT product.id, product.name, product.category_path, product.image_url, chain.name AS chain_name,
            current_price.price, current_price.unit_price_text, current_price.observed_at,
            count(*) OVER()::int AS total
     FROM product
     JOIN chain ON chain.id = product.chain_id
     JOIN current_price ON current_price.product_id = product.id
     WHERE ${where.join(" AND ")}
     ORDER BY ${order}
     LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  res.json({
    total: found.rows[0]?.total ?? 0,
    products: found.rows.map(publicProduct),
  });
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
    `SELECT product.id, product.name, product.category_path, product.image_url, chain.name AS chain_name,
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
    products: found.rows.map(publicProduct),
  });
}

function publicProduct(row) {
  return {
    id: Number(row.id),
    name: row.name,
    category_path: row.category_path,
    image_url: row.image_url || null,
    chain_name: row.chain_name,
    price: row.price === null ? null : Number(row.price),
    unit_price_text: row.unit_price_text,
    observed_at: row.observed_at,
  };
}

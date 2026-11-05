import rateLimit from "express-rate-limit";
import { pool } from "./db.js";
import { requireUser } from "./auth.js";
import { asyncRoute, HttpError } from "./errors.js";

const FOLD_FROM = "άέήίόύώϊϋΐΰςΆΈΉΊΌΎΏΪΫΣ";
const FOLD_TO = "αεηιουωιυιυσΑΕΗΙΟΥΩΙΥΣ";
const STOPWORDS = new Set([
  "ενα", "ενας", "μια", "το", "τη", "την", "ο", "η", "και", "να", "παρω", "που", "συμφερει",
]);

const browseLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Too many catalog requests. Try again in a minute." },
});

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Too many searches. Try again in a minute." },
});

export function catalogRoutes(app) {
  app.get("/catalog/categories", requireUser, asyncRoute(listCategories));
  app.get("/catalog/chains", requireUser, asyncRoute(listChains));
  app.get("/catalog/products", requireUser, productListLimiter, asyncRoute(listProducts));
  app.get("/catalog/search", requireUser, searchLimiter, asyncRoute(searchCatalog));
}

function productListLimiter(req, res, next) {
  const limiter = String(req.query.q || "").trim() ? searchLimiter : browseLimiter;
  return limiter(req, res, next);
}

function productKeySql() {
  return `lower(translate(regexp_replace(btrim(product.name), '[[:space:]]+', ' ', 'g'), '${FOLD_FROM}', '${FOLD_TO}'))`;
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
            min(product.image_url) FILTER (WHERE product.image_url IS NOT NULL) AS image_url,
            count(DISTINCT ${productKeySql()})::int AS products
     FROM product
     JOIN current_price ON current_price.product_id = product.id
     WHERE product.category_path IS NOT NULL
       AND ${scoped}
       AND split_part(product.category_path, ' > ', ${depth + 1}) <> ''
     GROUP BY 1
     ORDER BY 1`,
    params,
  );
  res.json({
    path,
    categories: found.rows.map((row) => ({
      name: row.name,
      image_url: row.image_url || null,
      products: row.products,
    })),
  });
}

async function listChains(_req, res) {
  const found = await pool.query(
    `SELECT chain.name, chain.logo_url
     FROM chain
     JOIN product ON product.chain_id = chain.id
     GROUP BY chain.id, chain.name, chain.logo_url
     ORDER BY chain.name`,
  );
  res.json({
    chains: found.rows.map((row) => ({
      name: row.name,
      logo_url: row.logo_url || null,
    })),
  });
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
  res.json(await queryProductGroups({ path, chain, sort, limit, offset, tokens }));
}

async function searchCatalog(req, res) {
  const tokens = tokensFor(req.query.q);
  if (!tokens.length) {
    throw new HttpError(400, "invalid_request", "Type at least two letters of the product name.");
  }
  res.json(await queryProductGroups({ sort: "price", limit: 12, offset: 0, tokens }));
}

async function queryProductGroups({ path = "", chain = "", sort = "price", limit, offset, tokens }) {
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
  const order = sort === "name" ? "sort_name ASC, min_price ASC" : "min_price ASC, sort_name ASC";
  const limitParam = params.length + 1;
  const offsetParam = params.length + 2;
  const found = await pool.query(
    `WITH filtered AS (
       SELECT product.id, product.name, product.category_path, product.image_url, chain.name AS chain_name,
              chain.logo_url AS chain_logo_url,
              current_price.price, current_price.unit_price_text, current_price.observed_at,
              ${productKeySql()} AS identity_key
       FROM product
       JOIN chain ON chain.id = product.chain_id
       JOIN current_price ON current_price.product_id = product.id
       WHERE ${where.join(" AND ")}
     ),
     groups AS (
       SELECT identity_key, min(price) AS min_price, min(name) AS sort_name
       FROM filtered
       GROUP BY identity_key
     ),
     total AS (
       SELECT count(*)::int AS count FROM groups
     ),
     page AS (
       SELECT identity_key, row_number() OVER (ORDER BY ${order}) AS position
       FROM groups
       ORDER BY ${order}
       LIMIT $${limitParam} OFFSET $${offsetParam}
     )
     SELECT filtered.*, total.count AS total
     FROM total
     LEFT JOIN page ON TRUE
     LEFT JOIN filtered ON filtered.identity_key = page.identity_key
     ORDER BY page.position NULLS LAST, filtered.price NULLS LAST, filtered.chain_name`,
    [...params, limit, offset],
  );
  return {
    total: Number(found.rows[0]?.total || 0),
    products: groupProductRows(found.rows),
  };
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

export function groupProductRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (row.id === null || row.id === undefined) {
      continue;
    }
    let group = groups.get(row.identity_key);
    if (!group) {
      group = {
        key: row.identity_key,
        name: row.name,
        category_path: row.category_path,
        offers: [],
      };
      groups.set(row.identity_key, group);
    }
    const logoUrl = row.logo_url || row.chain_logo_url || null;
    group.offers.push({
      id: Number(row.id),
      chain_name: row.chain_name,
      logo_url: logoUrl,
      chain_logo_url: logoUrl,
      price: row.price === null ? null : Number(row.price),
      unit_price_text: row.unit_price_text,
      observed_at: row.observed_at,
      image_url: row.image_url || null,
    });
  }
  return [...groups.values()].map((group) => {
    group.offers.sort((left, right) => {
      const byPrice = (left.price ?? Number.POSITIVE_INFINITY) - (right.price ?? Number.POSITIVE_INFINITY);
      return byPrice || left.chain_name.localeCompare(right.chain_name);
    });
    return {
      ...group,
      image_url: group.offers.find((offer) => offer.image_url)?.image_url ?? null,
      lowest_price: group.offers[0]?.price ?? null,
      offer_count: group.offers.length,
    };
  });
}

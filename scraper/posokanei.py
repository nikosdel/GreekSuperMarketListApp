"""Catalog importer for https://posokanei.gov.gr/.

Reads the public price API the site itself uses (api.posokanei.gov.gr).
Greece only. Each product is stored once per supermarket, with that shop's
pack price, unit price, and the date the site says the row was updated.
The API rejects Python's HTTP client on this PC and accepts curl, so
requests go through curl. They are spaced at least 1.5 seconds apart.
"""

from __future__ import annotations

import json
import logging
import subprocess
import sys
import time
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

from scraper.config import posokanei_delay_seconds
from scraper.db import Chain, UpsertStats, connect, upsert_products
from scraper.parsing import CatalogProduct, to_price

logger = logging.getLogger("posokanei")

API = "https://api.posokanei.gov.gr"
ORIGIN = "https://posokanei.gov.gr"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)
PAGE_SIZE = 100
_PER_UNIT = {
    "kg": "κιλό",
    "g": "γρ.",
    "l": "λίτρο",
    "lt": "λίτρο",
    "ml": "ml",
    "τεμ": "τεμ.",
    "pcs": "τεμ.",
}


class CatalogClient:
    def __init__(self, delay: float) -> None:
        self.delay = delay
        self._next_at = 0.0

    def get_json(self, path: str) -> dict:
        url = path if path.startswith("http") else API + path
        last_error = "no response"
        for attempt in range(4):
            self._wait()
            completed = subprocess.run(
                [
                    "curl.exe",
                    "-sS",
                    "-A",
                    USER_AGENT,
                    "-H",
                    "Accept: application/json",
                    "--max-time",
                    "90",
                    "--max-redirs",
                    "3",
                    "-w",
                    "\n%{http_code}",
                    url,
                ],
                capture_output=True,
                check=False,
            )
            stdout = completed.stdout
            body, _, code_raw = stdout.rpartition(b"\n")
            code = code_raw.decode("ascii", "replace").strip()
            if completed.returncode != 0 or code in {"429", "500", "502", "503", "504"}:
                last_error = completed.stderr.decode("utf-8", "replace").strip() or code
                time.sleep(self.delay * (attempt + 1))
                continue
            if code != "200":
                raise RuntimeError(f"{url} returned {code}")
            return json.loads(body.decode("utf-8"))
        raise RuntimeError(f"gave up on {url}: {last_error}")

    def _wait(self) -> None:
        now = time.monotonic()
        if now < self._next_at:
            time.sleep(self._next_at - now)
        self._next_at = time.monotonic() + self.delay


def _greek_amount(value: Decimal) -> str:
    quantized = value.quantize(Decimal("0.01"))
    sign = "-" if quantized < 0 else ""
    whole, frac = f"{abs(quantized):.2f}".split(".")
    groups: list[str] = []
    while whole:
        groups.append(whole[-3:])
        whole = whole[:-3]
    return sign + ".".join(reversed(groups)) + "," + frac


def _parse_time(value: object) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    text = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _size(unit: str | None, quantity: object) -> tuple[str | None, str | None]:
    if quantity is None or not unit:
        return None, None
    try:
        amount = Decimal(str(quantity))
    except (InvalidOperation, ValueError):
        return None, unit
    if amount <= 0:
        return None, None
    kind = unit.lower()
    if kind == "kg":
        grams = amount * 1000
        if grams == grams.to_integral_value() and grams < 1000:
            return f"{int(grams)}g", "g"
        return f"{amount.normalize()} kg", "kg"
    if kind in {"l", "lt", "liter", "litre"}:
        ml = amount * 1000
        if ml == ml.to_integral_value() and ml < 1000:
            return f"{int(ml)}ml", "ml"
        return f"{amount.normalize()} L", "l"
    text = format(amount.normalize(), "f")
    return f"{text} {unit}", kind


def _unit_price_text(amount: Decimal | None, unit: str | None) -> str | None:
    if amount is None or not unit:
        return None
    label = _PER_UNIT.get(unit.lower(), unit)
    return f"{_greek_amount(amount)} €/{label}"


def category_paths(tree_payload: dict) -> dict[str, str]:
    paths: dict[str, str] = {}

    def walk(nodes: list, parents: list[str]) -> None:
        for node in nodes:
            name = str(node.get("name") or "").strip()
            chain = parents + ([name] if name else [])
            cid = str(node.get("category_id") or "")
            if cid and chain:
                paths[cid] = " > ".join(chain)
            walk(node.get("children") or [], chain)

    walk(tree_payload.get("tree") or [], [])
    return paths


def product_category(category_ids: object, paths: dict[str, str]) -> str | None:
    if not isinstance(category_ids, list):
        return None
    chosen = ""
    for raw in category_ids:
        path = paths.get(str(raw), "")
        if len(path) > len(chosen):
            chosen = path
    return chosen or None


def logo_url(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if text.startswith("https://") or text.startswith("http://"):
        return text
    if text.startswith("/"):
        return API + text
    return None


def chain_from_retailer(retailer_id: str, info: dict, display: str = "") -> Chain:
    chain_name = str(info.get("name") or display or retailer_id)
    website = info.get("website")
    if not isinstance(website, str) or not website.startswith("http"):
        website = ORIGIN
    country = str(info.get("country") or "GR").upper()[:2]
    return Chain(retailer_id, chain_name, country, website, logo_url(info.get("logo_url")))


def rows_for_product(item: dict, paths: dict[str, str], retailers: dict[str, dict]) -> list[tuple[Chain, CatalogProduct]]:
    product_id = str(item.get("id") or "").strip()
    name = str(item.get("name") or "").strip()
    if not product_id or not name:
        return []
    size_text, unit = _size(
        item.get("unit") if isinstance(item.get("unit"), str) else None,
        item.get("unit_quantity"),
    )
    category = product_category(item.get("category_ids"), paths)
    image = item.get("image_url")
    image_url = image if isinstance(image, str) and image.startswith("http") else None
    product_url = f"{API}/products/{product_id}?countries=GR"
    brand = item.get("brand")
    brand_text = str(brand).strip() if isinstance(brand, str) and brand.strip() else None
    built: list[tuple[Chain, CatalogProduct]] = []
    for price_row in item.get("retailer_prices") or []:
        if not isinstance(price_row, dict):
            continue
        if str(price_row.get("country") or "GR").upper() != "GR":
            continue
        retailer_id = str(price_row.get("retailer") or "").strip()
        if not retailer_id:
            continue
        info = retailers.get(retailer_id) or {}
        display = str(price_row.get("retailer_display_name") or "").strip()
        chain = chain_from_retailer(retailer_id, info, display)
        unit_price = to_price(price_row.get("price_normalized"), "0.0001")
        basis = item.get("unit") if isinstance(item.get("unit"), str) else None
        built.append(
            (
                chain,
                CatalogProduct(
                    external_id=product_id,
                    name=name,
                    brand=brand_text,
                    size_text=size_text,
                    unit=unit,
                    category_path=category,
                    image_url=image_url,
                    product_url=product_url,
                    price=to_price(price_row.get("price")),
                    unit_price=unit_price,
                    unit_price_text=_unit_price_text(unit_price, basis),
                    observed_at=_parse_time(price_row.get("last_updated")),
                ),
            )
        )
    return built


def _roots(tree_payload: dict) -> list[tuple[str, str, int]]:
    roots: list[tuple[str, str, int]] = []
    for node in tree_payload.get("tree") or []:
        cid = str(node.get("category_id") or "")
        name = str(node.get("name") or cid)
        count = int(node.get("total_product_count") or 0)
        if cid and count > 0:
            roots.append((cid, name, count))
    return roots


def _save_group(grouped: dict[str, tuple[Chain, list[CatalogProduct]]], scraped_at: datetime) -> UpsertStats:
    total = UpsertStats()
    for chain, products in grouped.values():
        if not products:
            continue
        with connect() as conn:
            stats = upsert_products(conn, products, scraped_at, chain)
        total.products += stats.products
        total.snapshots_new += stats.snapshots_new
        total.snapshots_refreshed += stats.snapshots_refreshed
        total.skipped_price += stats.skipped_price
    return total


def _store_logos(retailers: dict[str, dict]) -> int:
    stored = 0
    with connect() as conn:
        with conn.transaction():
            for retailer_id, info in retailers.items():
                if str(info.get("country") or "").upper() != "GR":
                    continue
                chain = chain_from_retailer(retailer_id, info)
                conn.execute(
                    """
                    INSERT INTO chain (id, name, country, website_url, logo_url)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE
                        SET name = EXCLUDED.name,
                            country = EXCLUDED.country,
                            website_url = EXCLUDED.website_url,
                            logo_url = COALESCE(EXCLUDED.logo_url, chain.logo_url)
                    """,
                    (chain.id, chain.name, chain.country, chain.website_url, chain.logo_url),
                )
                stored += 1
    return stored


def _catalog_counts() -> tuple[int, int, int]:
    with connect() as conn:
        row = conn.execute(
            """
            SELECT
                (SELECT count(*) FROM product),
                (SELECT count(DISTINCT external_id) FROM product),
                (SELECT count(*) FROM price_snapshot)
            """
        ).fetchone()
    return int(row[0]), int(row[1]), int(row[2])


def _print_report() -> None:
    with connect() as conn:
        totals = conn.execute(
            """
            SELECT count(DISTINCT external_id), count(*), count(DISTINCT chain_id)
            FROM product
            """
        ).fetchone()
        categories = conn.execute(
            """
            SELECT split_part(category_path, ' > ', 1) AS category,
                   count(DISTINCT external_id) AS products
            FROM product
            GROUP BY 1
            ORDER BY 1
            """
        ).fetchall()
        shops = conn.execute(
            """
            SELECT ch.name, c.price, c.unit_price_text, c.observed_at::date, p.category_path
            FROM product p
            JOIN chain ch ON ch.id = p.chain_id
            JOIN current_price c ON c.product_id = p.id
            WHERE p.name ILIKE '%tostaki%'
              AND p.name ILIKE '%πάριζα%'
              AND p.name ILIKE '%160g%'
            ORDER BY c.price, ch.name
            """
        ).fetchall()
    print(
        f"Catalog: {totals[0]} products, {totals[1]} supermarket prices, "
        f"{totals[2]} supermarkets"
    )
    print("Categories:")
    for name, count in categories:
        print(f"  {name}: {count}")
    print("ΤΟΣΤΑΚΙ Πάριζα Χωρίς γλουτένη 160g:")
    if shops:
        print(f"  {shops[0][4]}")
    for name, price, unit_text, observed, _path in shops:
        print(f"  {name}: {price} EUR | {unit_text or '-'} | updated {observed}")


def run_posokanei() -> int:
    from scraper.config import ROOT

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(ROOT / "posokanei-run.log", encoding="utf-8"),
        ],
        force=True,
    )
    delay = posokanei_delay_seconds()
    logger.info("PosoKanei delay %.1fs, Greece only", delay)
    try:
        with connect() as conn:
            conn.execute("SELECT observed_at FROM price_snapshot LIMIT 0")
    except Exception as exc:
        logger.error("Postgres is not ready (run python -m scraper migrate): %s", exc)
        return 1

    client = CatalogClient(delay)
    try:
        tree = client.get_json(
            "/meta/categories/tree?include_counts=true&include_hidden=false"
        )
        retailer_payload = client.get_json("/meta/retailers?countries=GR")
    except (RuntimeError, json.JSONDecodeError, OSError) as exc:
        logger.error("could not read the catalog index: %s", exc)
        return 1
    paths = category_paths(tree)
    before = _catalog_counts()
    logger.info(
        "before: %s product rows, %s distinct products, %s prices",
        before[0],
        before[1],
        before[2],
    )
    retailers = {
        str(row.get("id")): row
        for row in retailer_payload.get("retailers") or []
        if isinstance(row, dict) and row.get("id")
    }
    logos = _store_logos(retailers)
    logger.info("chain logos stored: %s", logos)
    roots = _roots(tree)
    logger.info("root categories: %s", len(roots))
    scraped_at = datetime.now(timezone.utc)
    saved = 0
    prices_changed = 0
    failed = False
    for category_id, name, count in roots:
        page = 1
        seen: set[tuple[str, str]] = set()
        logger.info("%s: %s products", name, count)
        while page <= 200:
            try:
                payload = client.get_json(
                    f"/products?category={category_id}&countries=GR"
                    f"&page={page}&page_size={PAGE_SIZE}"
                )
            except (RuntimeError, json.JSONDecodeError, OSError) as exc:
                logger.error("%s page %s failed: %s", name, page, exc)
                failed = True
                break
            products = payload.get("products") or []
            if not products:
                break
            grouped: dict[str, tuple[Chain, list[CatalogProduct]]] = {}
            for item in products:
                if not isinstance(item, dict):
                    continue
                for chain, product in rows_for_product(item, paths, retailers):
                    key = (chain.id, product.external_id)
                    if key in seen:
                        continue
                    seen.add(key)
                    _chain, bucket = grouped.get(chain.id, (chain, []))
                    bucket.append(product)
                    grouped[chain.id] = (chain, bucket)
            stats = _save_group(grouped, scraped_at)
            saved += stats.products
            prices_changed += stats.snapshots_new
            logger.info("%s page %s: %s price rows so far", name, page, len(seen))
            if not payload.get("has_next"):
                break
            page += 1
    after = _catalog_counts()
    logger.info("supermarket prices saved this run: %s", saved)
    logger.info("prices changed: %s", prices_changed)
    logger.info(
        "after: %s product rows, %s distinct products, %s prices",
        after[0],
        after[1],
        after[2],
    )
    _print_report()
    return 0 if saved and not failed else 1

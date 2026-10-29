"""Sklavenitis catalog importer.

Reads the public category listings on sklavenitis.gr. Each department page
shows 24 products; the next page is the same URL with ?pg=2. robots.txt
disallows /netvolution and paths ending in .aspx. This scraper does not
request those. Shelf departments are saved first. A product sitemap URL that
never appeared on a department is read from its own page.
"""

from __future__ import annotations

import html
import json
import logging
import math
import re
import sys
import time
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpx

from scraper.config import sklavenitis_delay_seconds
from scraper.db import Chain, connect, upsert_products
from scraper.parsing import CatalogProduct, parse_eu_decimal, to_price
from scraper.robots import Robots

logger = logging.getLogger("sklavenitis")

SKLAVENITIS_CHAIN = Chain(
    "sklavenitis",
    "Sklavenitis",
    "GR",
    "https://www.sklavenitis.gr",
)
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)
ORIGIN = "https://www.sklavenitis.gr"
ROBOTS_URL = f"{ORIGIN}/robots.txt"
CATEGORY_SITEMAP = f"{ORIGIN}/sitemap/ProductCategories/1.xml"
PRODUCT_SITEMAP_INDEX = f"{ORIGIN}/sitemap/Products/sitemap_index.xml"
MAX_PAGES = 400
_COUNT_RE = re.compile(r"(\d+)\s+από\s+τα\s+(\d+)\s+προϊόντα")
_LOC_RE = re.compile(r"<loc>(.*?)</loc>")
_ANALYTICS_RE = re.compile(r'data-plugin-analyticsimpressions="([^"]*)"')
_SKU_RE = re.compile(r'data-productsku="(\d+)"')
_TITLE_RE = re.compile(r'class="product__title">\s*<a[^>]*>(.*?)</a>', re.S)
_PRICE_RE = re.compile(r'data-price="([^"]+)"')
_LINK_RE = re.compile(r'href="([^"]+)" class="absLink"')
_IMAGE_RE = re.compile(r'src="(https://[^"]+/ProductMedia/Products/[^"]+)"')
_VOLUME_RE = re.compile(
    r"(\d{1,3}(?:\.\d{3})*(?:,\d+)?|\d+(?:[.,]\d+)?)\s*€"
)
_SIZE_RE = re.compile(
    r"(?i)(\d+(?:[.,]\d+)?(?:\s*[x×]\s*\d+(?:[.,]\d+)?)?)\s*"
    r"(κιλά|κιλό|κιλο|κιλ\.?|kg|γρ\.?|gr|ml|cl|lt|λίτρα|λίτρο|τεμ\.?|g)"
)
_VIEW_ITEM_RE = re.compile(
    r'"event"\s*:\s*"view_item"\s*,\s*"ecommerce"\s*:\s*(\{(?:[^{}]|\{[^{}]*\})*\})',
    re.S,
)
_UNIT_ALIASES = {
    "γρ": "g",
    "gr": "g",
    "g": "g",
    "κιλ": "kg",
    "κιλο": "kg",
    "κιλό": "kg",
    "κιλά": "kg",
    "kg": "kg",
    "ml": "ml",
    "cl": "cl",
    "lt": "l",
    "l": "l",
    "λίτρο": "l",
    "λίτρα": "l",
    "τεμ": "τεμ",
}


class PoliteClient:
    def __init__(self, delay: float, robots: Robots) -> None:
        self.delay = delay
        self.robots = robots
        self._next_at = 0.0
        self._http = httpx.Client(
            headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xml"},
            follow_redirects=True,
            max_redirects=3,
            timeout=40,
        )

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> PoliteClient:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def get(self, url: str) -> str | None:
        if not self.robots.allowed(url):
            logger.warning("robots.txt disallows %s", url)
            return None
        last_error: Exception | None = None
        for attempt in range(4):
            self._wait()
            try:
                response = self._http.get(url)
            except httpx.TransportError as exc:
                last_error = exc
                time.sleep(self.delay * (attempt + 1))
                continue
            if response.status_code in {429, 500, 502, 503, 504}:
                time.sleep(self.delay * (attempt + 1))
                continue
            if response.status_code == 404:
                return None
            if response.status_code != 200:
                logger.warning("%s -> %s", url, response.status_code)
                return None
            return response.text
        logger.warning("gave up on %s (%s)", url, last_error)
        return None

    def _wait(self) -> None:
        now = time.monotonic()
        if now < self._next_at:
            time.sleep(self._next_at - now)
        self._next_at = time.monotonic() + self.delay


def fetch_robots() -> Robots | None:
    try:
        response = httpx.get(
            ROBOTS_URL,
            headers={"User-Agent": USER_AGENT},
            timeout=30,
            follow_redirects=True,
        )
    except httpx.HTTPError as exc:
        logger.error("could not read robots.txt: %s", exc)
        return None
    if response.status_code != 200:
        logger.error("robots.txt returned %s", response.status_code)
        return None
    robots = Robots.parse(response.text)
    logger.info("robots.txt disallow rules: %s", ", ".join(robots.rules) or "(none)")
    return robots


def _locs(xml: str) -> list[str]:
    return [html.unescape(loc).strip() for loc in _LOC_RE.findall(xml)]


def _category_path(url: str) -> str:
    return urlsplit(url).path.strip("/")


def _absolute(url: str) -> str:
    if url.startswith("//"):
        return "https:" + url
    if url.startswith("/"):
        return ORIGIN + url
    return url


def _path_key(url: str) -> str:
    return urlsplit(_absolute(url)).path.rstrip("/").lower()


def _with_page(url: str, page: int) -> str:
    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query["pg"] = str(page)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), ""))


def _clean(value: object) -> str | None:
    if value is None:
        return None
    text = html.unescape(str(value)).strip()
    text = re.sub(r"\s+", " ", text)
    return text or None


def _size_from(name: str) -> tuple[str | None, str | None]:
    match = None
    for candidate in _SIZE_RE.finditer(name):
        match = candidate
    if match is None:
        return None, None
    token = match.group(2).lower().rstrip(".")
    return match.group(0), _UNIT_ALIASES.get(token, token)


def _amount_from_html(fragment: str) -> tuple[Decimal | None, str | None]:
    plain = re.sub(r"<[^>]+>", "", fragment)
    plain = re.sub(r"\s+", " ", html.unescape(plain)).strip()
    plain = re.sub(r"\s*/\s*", "/", plain)
    if not plain or "€" not in plain:
        return None, None
    amount_match = _VOLUME_RE.search(plain)
    if not amount_match:
        return None, plain
    try:
        amount = parse_eu_decimal(amount_match.group(1)).quantize(Decimal("0.0001"))
    except (InvalidOperation, ValueError):
        return None, plain
    if amount <= 0:
        return None, plain
    return amount, plain


def _volume(block: str) -> tuple[Decimal | None, str | None]:
    # Offers put the current unit price in hightlight and the old one in deleted.
    highlight = re.search(r'class="hightlight">(.*?)</div>', block, re.S)
    if highlight:
        amount, text = _amount_from_html(highlight.group(1))
        if amount is not None:
            return amount, text
    kilo = re.search(r'class="priceKil">(.*?)<div class="main-price', block, re.S)
    if kilo:
        chunk = re.sub(
            r'<div class="deleted">.*?</div>',
            "",
            kilo.group(1),
            count=1,
            flags=re.S,
        )
        amount, text = _amount_from_html(chunk)
        if amount is not None:
            return amount, text
    # Loose fruit and similar rows print the unit on the shelf price itself.
    main = re.search(r'class="price"(?![A-Za-z])[^>]*>(.*?)</div>', block, re.S)
    if main and "/" in re.sub(r"<[^>]+>", "", main.group(1)):
        return _amount_from_html(main.group(1))
    return None, None


def _analytics_item(block: str) -> dict | None:
    match = _ANALYTICS_RE.search(block)
    if not match:
        return None
    try:
        payload = json.loads(html.unescape(match.group(1)))
        items = payload["Call"]["ecommerce"]["items"]
    except (json.JSONDecodeError, KeyError, TypeError, IndexError):
        return None
    if not items or not isinstance(items[0], dict):
        return None
    return items[0]


def map_listing_block(block: str) -> CatalogProduct | None:
    item = _analytics_item(block) or {}
    external_id = _clean(item.get("item_id"))
    if not external_id:
        sku = _SKU_RE.search(block)
        external_id = sku.group(1) if sku else None
    name = _clean(item.get("item_name"))
    if not name:
        title = _TITLE_RE.search(block)
        if title:
            name = _clean(re.sub(r"<[^>]+>", "", title.group(1)))
    if not external_id or not name:
        return None
    price = to_price(item.get("price"))
    if price is None:
        raw_price = _PRICE_RE.search(block)
        price = to_price(raw_price.group(1)) if raw_price else None
    list_name = _clean(item.get("item_list_name"))
    leaf = _clean(item.get("item_category"))
    parts: list[str] = []
    if list_name:
        parts.append(list_name)
    if leaf and leaf not in parts:
        parts.append(leaf)
    link = _LINK_RE.search(block)
    image = _IMAGE_RE.search(block)
    unit_price, unit_price_text = _volume(block)
    size_text, unit = _size_from(name)
    return CatalogProduct(
        external_id=external_id,
        name=name,
        brand=_clean(item.get("item_brand")),
        size_text=size_text,
        unit=unit,
        category_path=" > ".join(parts) or None,
        image_url=image.group(1) if image else None,
        product_url=_absolute(link.group(1)) if link else None,
        price=price,
        unit_price=unit_price,
        unit_price_text=unit_price_text,
        currency="EUR",
    )


def products_from_listing(page: str) -> list[CatalogProduct]:
    products: list[CatalogProduct] = []
    seen: set[str] = set()
    for part in page.split('<div data-plugin-product=')[1:]:
        product = map_listing_block('<div data-plugin-product=' + part)
        if product is None or product.external_id in seen:
            continue
        seen.add(product.external_id)
        products.append(product)
    return products


def listing_total(page: str) -> tuple[int | None, int | None]:
    match = _COUNT_RE.search(page)
    if not match:
        return None, None
    shown, total = int(match.group(1)), int(match.group(2))
    if shown <= 0 or total < 0:
        return None, None
    return shown, total


def map_product_page(page: str, url: str) -> CatalogProduct | None:
    match = _VIEW_ITEM_RE.search(page)
    item: dict = {}
    if match:
        try:
            payload = json.loads(match.group(1))
            items = payload.get("items") or []
            if items and isinstance(items[0], dict):
                item = items[0]
        except json.JSONDecodeError:
            item = {}
    external_id = _clean(item.get("item_id"))
    if not external_id:
        sku = re.search(r'data-sku="(\d+)"', page)
        external_id = sku.group(1) if sku else None
    name = _clean(item.get("item_name"))
    if not name:
        title = re.search(r"<h1[^>]*>(.*?)</h1>", page, re.S)
        name = _clean(re.sub(r"<[^>]+>", "", title.group(1))) if title else None
    if not external_id or not name:
        return None
    price = to_price(item.get("price"))
    if price is None:
        raw_price = _PRICE_RE.search(page)
        price = to_price(raw_price.group(1)) if raw_price else None
    leaf = _clean(item.get("item_category"))
    image = _IMAGE_RE.search(page)
    unit_price, unit_price_text = _volume(page)
    size_text, unit = _size_from(name)
    return CatalogProduct(
        external_id=external_id,
        name=name,
        brand=_clean(item.get("item_brand")),
        size_text=size_text,
        unit=unit,
        category_path=leaf,
        image_url=image.group(1) if image else None,
        product_url=url.split("?")[0],
        price=price,
        unit_price=unit_price,
        unit_price_text=unit_price_text,
        currency="EUR",
    )


def category_urls(client: PoliteClient) -> list[str]:
    xml = client.get(CATEGORY_SITEMAP)
    if not xml:
        return []
    urls: list[str] = []
    seen: set[str] = set()
    for loc in _locs(xml):
        path = _category_path(loc).strip("/")
        if not path or path.endswith(".aspx") or "search" in path:
            continue
        url = f"{ORIGIN}/{path}/"
        if url in seen:
            continue
        seen.add(url)
        urls.append(url)
    return urls


def _leaves(urls: list[str]) -> list[str]:
    paths = [_category_path(url).strip("/") + "/" for url in urls]
    leaves: list[str] = []
    for url, path in zip(urls, paths):
        if any(other.startswith(path) and other != path for other in paths):
            continue
        leaves.append(url)
    return leaves


def _tops(urls: list[str]) -> list[str]:
    return [url for url in urls if "/" not in _category_path(url).strip("/")]


def fetch_listing(client: PoliteClient, url: str) -> list[CatalogProduct]:
    first = client.get(url)
    if not first:
        return []
    products = products_from_listing(first)
    shown, total = listing_total(first)
    label = _category_path(url)
    if shown is None or total is None or shown >= total:
        logger.info("%s: %s products on one page", label, len(products))
        return products
    pages = min(MAX_PAGES, math.ceil(total / shown))
    logger.info("%s: %s products, %s pages", label, total, pages)
    for page in range(2, pages + 1):
        body = client.get(_with_page(url, page))
        if not body:
            break
        batch = products_from_listing(body)
        if not batch:
            break
        products.extend(batch)
    return products


def product_sitemap_urls(client: PoliteClient) -> list[str]:
    index = client.get(PRODUCT_SITEMAP_INDEX)
    if not index:
        return []
    found: list[str] = []
    seen: set[str] = set()
    for loc in _locs(index):
        if not loc.endswith(".xml"):
            continue
        xml = client.get(loc)
        if not xml:
            continue
        for product_url in _locs(xml):
            key = _path_key(product_url)
            if not key or key in seen:
                continue
            seen.add(key)
            found.append(product_url.split("?")[0])
    logger.info("product sitemap urls: %s", len(found))
    return found


def _remember(seen_ids: set[str], seen_paths: set[str], product: CatalogProduct) -> bool:
    if product.external_id in seen_ids:
        return False
    seen_ids.add(product.external_id)
    if product.product_url:
        seen_paths.add(_path_key(product.product_url))
    return True


def _save(products: list[CatalogProduct], scraped_at: datetime, label: str) -> int:
    if not products:
        logger.info("%s added no new products", label)
        return 0
    with connect() as conn:
        stats = upsert_products(conn, products, scraped_at, SKLAVENITIS_CHAIN)
    logger.info(
        "saved %s: %s new products (%s with a price)",
        label,
        stats.products,
        stats.products - stats.skipped_price,
    )
    return stats.products


def _print_samples() -> None:
    with connect() as conn:
        totals = conn.execute(
            """
            SELECT p.chain_id, count(*), count(c.product_id), count(c.unit_price)
            FROM product p
            LEFT JOIN current_price c ON c.product_id = p.id
            GROUP BY p.chain_id
            ORDER BY p.chain_id
            """
        ).fetchall()
        rows = conn.execute(
            """
            SELECT p.name, p.category_path, c.price, c.unit_price, c.unit_price_text
            FROM product p
            JOIN current_price c ON c.product_id = p.id
            WHERE p.chain_id = 'sklavenitis'
            ORDER BY p.name
            LIMIT 5
            """
        ).fetchall()
    print("Products by supermarket:")
    for chain_id, products, priced, unit_priced in totals:
        print(
            f"  {chain_id}: {products} products, {priced} with a price, "
            f"{unit_priced} with a unit price"
        )
    print("Sklavenitis sample:")
    for row in rows:
        print(f"  {row[0]} | {row[1]} | {row[2]} EUR | {row[3]} | {row[4] or '-'}")


def run_sklavenitis() -> int:
    from scraper.config import ROOT

    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(ROOT / "sklavenitis-run.log", encoding="utf-8"),
        ],
        force=True,
    )
    delay = sklavenitis_delay_seconds()
    logger.info("Sklavenitis delay %.1fs", delay)
    try:
        with connect() as conn:
            conn.execute("SELECT 1")
    except Exception as exc:
        logger.error("Postgres is not reachable: %s", exc)
        return 1

    robots = fetch_robots()
    if robots is None:
        return 1
    if not robots.allowed(CATEGORY_SITEMAP) or not robots.allowed(f"{ORIGIN}/allantika/?pg=2"):
        logger.error("robots.txt blocks the category listings")
        return 1

    scraped_at = datetime.now(timezone.utc)
    seen_ids: set[str] = set()
    seen_paths: set[str] = set()
    saved = 0
    with PoliteClient(delay, robots) as client:
        urls = category_urls(client)
        if not urls:
            logger.error("Sklavenitis category sitemap was empty")
            return 1
        tops = _tops(urls)
        leaves = _leaves(urls)
        logger.info("categories: %s total, %s departments, %s leaves", len(urls), len(tops), len(leaves))
        crawl = tops or leaves
        for url in crawl:
            fresh: list[CatalogProduct] = []
            for product in fetch_listing(client, url):
                if _remember(seen_ids, seen_paths, product):
                    fresh.append(product)
            saved += _save(fresh, scraped_at, _category_path(url) or url)

        sitemap_urls = product_sitemap_urls(client)
        missing = [url for url in sitemap_urls if _path_key(url) not in seen_paths]
        logger.info("sitemap products not in the department listings: %s", len(missing))
        if missing:
            parents: list[str] = []
            parent_seen: set[str] = set()
            crawled = {_path_key(url) for url in crawl}
            for url in missing:
                parent = _path_key(url).rsplit("/", 1)[0]
                if not parent or parent in parent_seen or parent in crawled:
                    continue
                parent_seen.add(parent)
                parents.append(f"{ORIGIN}/{parent}/")
            logger.info("extra category pages for the gaps: %s", len(parents))
            for url in parents:
                fresh = []
                for product in fetch_listing(client, url):
                    if _remember(seen_ids, seen_paths, product):
                        fresh.append(product)
                saved += _save(fresh, scraped_at, _category_path(url) or url)
            still_missing = [url for url in missing if _path_key(url) not in seen_paths]
            logger.info("product pages still missing: %s", len(still_missing))
            page_fresh: list[CatalogProduct] = []
            for index, url in enumerate(still_missing, start=1):
                body = client.get(url)
                if not body:
                    continue
                product = map_product_page(body, url)
                if product is None or not _remember(seen_ids, seen_paths, product):
                    continue
                page_fresh.append(product)
                if len(page_fresh) >= 100:
                    saved += _save(page_fresh, scraped_at, "product pages")
                    page_fresh = []
                if index == 1 or index == len(still_missing) or index % 25 == 0:
                    logger.info("product pages %s/%s", index, len(still_missing))
            saved += _save(page_fresh, scraped_at, "product pages")

    logger.info("Sklavenitis products saved this run: %s", saved)
    _print_samples()
    return 0 if saved else 1

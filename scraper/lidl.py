"""Lidl Greece catalog importer.

Reads the public category listings on lidl.gr (they redirect to lidl-hellas.gr),
then fills any sitemap products those listings did not include by reading the
product page. robots.txt disallows /q/search?id=*; this scraper does not call it.
"""

from __future__ import annotations

import gzip
import json
import logging
import re
import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

import httpx

from scraper.config import lidl_delay_seconds, lidl_fetch_size
from scraper.db import connect, upsert_products
from scraper.parsing import CatalogProduct, prefer, parse_product_html, products_from_category
from scraper.robots import Robots

logger = logging.getLogger("lidl")

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)
ROBOTS_URLS = (
    "https://www.lidl.gr/robots.txt",
    "https://www.lidl-hellas.gr/robots.txt",
)
SITEMAP_INDEX = "https://www.lidl-hellas.gr/static/sitemap.xml"
CATEGORY_RE = re.compile(r"/(?:h|c)/[a-z0-9-]+/[hs]\d+")
PRODUCT_ID_RE = re.compile(r"/p(\d+)/?(?:\?|$)")
SKIP_RE = re.compile(
    r"cookie|newsletter|imprint|prostasia|dedomen|katastimat|plhrofor|yphresi|"
    r"nomik|oroi-|how-to|gnomi|gnwmh|kids-team|uefa|dwrokart|metrit|lidl-plus|"
    r"lidl-point|diagonis|fylladio|galpo|noma|lupilu|silvercrest|max-mila|thematikes",
    re.IGNORECASE,
)
# Used only when the homepage HTML does not expose category links.
FALLBACK_CATEGORIES = (
    "/c/fagito-poto/s10068374",
    "/c/moda-axesoyar/s10068373",
    "/c/oikiakos-exoplismos/s10068371",
    "/c/koyzina-oikiakos-exoplismos/s10068166",
    "/c/ergaleia-eidi-kipoy/s10068222",
    "/c/vrefika-paidika-eidi/s10068225",
    "/c/athlitiki-endysi-anapsychi/s10068226",
    "/c/eidi-gia-katoikidia/s10100091",
)


class PoliteClient:
    """Waits between requests and refuses URLs robots.txt disallows."""

    def __init__(self, delay: float, robots: Robots) -> None:
        self.delay = delay
        self.robots = robots
        self._next = 0.0
        self._client = httpx.Client(
            timeout=httpx.Timeout(40.0),
            follow_redirects=True,
            max_redirects=3,
            headers={
                "User-Agent": USER_AGENT,
                "Accept-Language": "el-GR,el;q=0.9,en;q=0.5",
            },
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> PoliteClient:
        return self

    def __exit__(self, *_) -> None:
        self.close()

    def _pause(self) -> None:
        remaining = self._next - time.monotonic()
        if remaining > 0:
            time.sleep(remaining)

    def get(self, url: str, *, accept: str, referer: str) -> httpx.Response | None:
        if not self.robots.allowed(url):
            logger.warning("robots.txt disallows %s", url)
            return None
        for attempt in range(4):
            self._pause()
            try:
                response = self._client.get(
                    url,
                    headers={"Accept": accept, "Referer": referer},
                )
            except httpx.TooManyRedirects:
                logger.warning("redirect loop, skipping %s", url)
                self._next = time.monotonic() + self.delay
                return None
            except httpx.HTTPError as exc:
                logger.warning("request error (%s) %s", exc, url)
                self._next = time.monotonic() + self.delay * (attempt + 1)
                continue
            self._next = time.monotonic() + self.delay
            if not self.robots.allowed(str(response.url)):
                logger.warning("robots.txt disallows redirect %s", response.url)
                return None
            if response.status_code in {429, 500, 502, 503, 504}:
                retry_after = response.headers.get("Retry-After", "")
                extra = float(retry_after) if retry_after.isdigit() else self.delay * (attempt + 1)
                logger.warning("HTTP %s for %s; waiting %.1fs", response.status_code, url, extra)
                self._next = time.monotonic() + extra
                continue
            return response
        logger.error("giving up on %s", url)
        return None


def fetch_robots(delay: float) -> Robots | None:
    rules: list[str] = []
    with httpx.Client(timeout=30.0, follow_redirects=True, headers={"User-Agent": USER_AGENT}) as http:
        for index, url in enumerate(ROBOTS_URLS):
            if index:
                time.sleep(delay)
            try:
                response = http.get(url)
                response.raise_for_status()
            except httpx.HTTPError as exc:
                logger.error("could not read %s (%s); not scraping without robots.txt", url, exc)
                return None
            rules.extend(Robots.parse(response.text).rules)
    robots = Robots(rules)
    logger.info("loaded %s robots.txt disallow rules", len(robots.rules))
    return robots


def category_id(path: str) -> str:
    match = re.search(r"(\d+)$", path)
    return match.group(1) if match else path


def discover_categories(client: PoliteClient) -> list[str]:
    response = client.get(
        "https://www.lidl.gr/",
        accept="text/html,application/xhtml+xml",
        referer="https://www.lidl.gr/",
    )
    found: list[str] = []
    if response is not None and response.status_code == 200:
        found = sorted(set(CATEGORY_RE.findall(response.text)), key=lambda path: (0 if path.startswith("/c/") else 1, path))
        found = [path for path in found if not SKIP_RE.search(path)]
    if not found:
        logger.warning("homepage exposed no category links; using the fallback department list")
        return list(FALLBACK_CATEGORIES)
    logger.info("discovered %s category paths", len(found))
    return found


def _selected_category(nodes: list) -> dict | None:
    for node in nodes or []:
        if not isinstance(node, dict):
            continue
        if node.get("selected"):
            return _selected_category(node.get("children") or []) or node
        nested = _selected_category(node.get("children") or [])
        if nested:
            return nested
    return None


def _collect_ids(node: dict, found: set[str]) -> None:
    value = node.get("value")
    if value is not None and str(value).isdigit():
        found.add(str(value))
    for child in node.get("children") or []:
        if isinstance(child, dict):
            _collect_ids(child, found)


def descendant_ids(payload: dict) -> set[str]:
    found: set[str] = set()
    for facet in payload.get("facets") or []:
        if not isinstance(facet, dict) or facet.get("code") != "category":
            continue
        selected = _selected_category(facet.get("values") or facet.get("topvalues") or [])
        if selected:
            _collect_ids(selected, found)
    return found


def fetch_category(
    client: PoliteClient,
    path: str,
    fetch_size: int,
) -> tuple[dict[str, CatalogProduct], set[str], bool]:
    products: dict[str, CatalogProduct] = {}
    descendants: set[str] = set()
    offset = 0
    complete = False
    referer = "https://www.lidl-hellas.gr" + path
    while offset < 5000:
        url = (
            "https://www.lidl-hellas.gr/q/api/category"
            f"{path}?assortment=GR&locale=el_GR&version=v2.0.0"
            f"&offset={offset}&fetchsize={fetch_size}"
        )
        response = client.get(url, accept="application/json, text/plain, */*", referer=referer)
        if response is None or response.status_code != 200:
            status = None if response is None else response.status_code
            logger.warning("category %s offset %s failed (HTTP %s)", path, offset, status)
            break
        try:
            payload = response.json()
        except json.JSONDecodeError:
            logger.warning("category %s offset %s was not JSON", path, offset)
            break
        if offset == 0:
            descendants = descendant_ids(payload)
        fresh = 0
        for product in products_from_category(payload):
            current = products.get(product.external_id)
            if current is None:
                fresh += 1
                products[product.external_id] = product
            else:
                products[product.external_id] = prefer(current, product)
        num_found = int(payload.get("numFound") or 0)
        logger.info("category %s offset %s: %s/%s products", path, offset, len(products), num_found)
        if fresh == 0 or not payload.get("items") or len(products) >= num_found:
            complete = num_found == 0 or len(products) >= num_found
            break
        offset += len(payload.get("items") or []) or int(payload.get("fetchsize") or fetch_size)
    return products, descendants, complete


def _locs(body: bytes) -> list[str]:
    if body[:2] == b"\x1f\x8b":
        body = gzip.decompress(body)
    root = ET.fromstring(body)
    return [node.text.strip() for node in root.iter() if node.tag.endswith("loc") and node.text]


def sitemap_products(client: PoliteClient) -> dict[str, str]:
    response = client.get(SITEMAP_INDEX, accept="application/xml,text/xml,*/*", referer="https://www.lidl.gr/")
    maps: list[str] = []
    if response is not None and response.status_code == 200:
        try:
            maps = [loc for loc in _locs(response.content) if "product_sitemap" in loc]
        except ET.ParseError:
            logger.warning("sitemap index was not XML")
    if not maps:
        maps = ["https://www.lidl.gr/p/export/GR/el/product_sitemap.xml.gz"]
    found: dict[str, str] = {}
    for loc in maps:
        body = client.get(loc, accept="*/*", referer="https://www.lidl.gr/")
        if body is None or body.status_code != 200:
            logger.warning("product sitemap unavailable: %s", loc)
            continue
        try:
            locs = _locs(body.content)
        except (ET.ParseError, gzip.BadGzipFile, OSError) as exc:
            logger.warning("could not read %s (%s)", loc, exc)
            continue
        for url in locs:
            match = PRODUCT_ID_RE.search(url)
            if match:
                # lidl.gr 301s to lidl-hellas.gr; fetch the target directly.
                direct = url.split("?", 1)[0].replace(
                    "https://www.lidl.gr/",
                    "https://www.lidl-hellas.gr/",
                    1,
                )
                found[match.group(1)] = direct
    logger.info("product sitemap lists %s urls", len(found))
    return found


def fetch_product_page(client: PoliteClient, url: str) -> CatalogProduct | None:
    response = client.get(url, accept="text/html", referer="https://www.lidl.gr/")
    if response is None or response.status_code != 200:
        return None
    return parse_product_html(response.text, fallback_url=url)


def _print_samples() -> None:
    with connect() as conn:
        totals = conn.execute(
            """
            SELECT
                (SELECT count(*) FROM product WHERE chain_id = 'lidl'),
                (SELECT count(*) FROM product p
                   JOIN current_price c ON c.product_id = p.id
                  WHERE p.chain_id = 'lidl')
            """
        ).fetchone()
        print(f"Lidl products in Postgres: {totals[0]} ({totals[1]} with a price)")
        rows = conn.execute(
            """
            SELECT p.external_id, p.name, p.brand, c.price, c.unit_price_text
            FROM product p
            JOIN current_price c ON c.product_id = p.id
            WHERE p.chain_id = 'lidl'
            ORDER BY p.name
            LIMIT 5
            """
        ).fetchall()
    for row in rows:
        print(f"  {row[0]} | {row[1]} | {row[2] or '-'} | {row[3]} EUR | {row[4] or '-'}")


def run_lidl() -> int:
    from scraper.config import ROOT

    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(ROOT / "lidl-run.log", encoding="utf-8"),
        ],
    )
    delay = lidl_delay_seconds()
    fetch_size = lidl_fetch_size()
    logger.info("Lidl delay %.1fs, page size %s", delay, fetch_size)
    robots = fetch_robots(delay)
    if robots is None:
        return 1

    catalog: dict[str, CatalogProduct] = {}
    page_only: list[CatalogProduct] = []
    scraped_at = datetime.now(timezone.utc)
    with PoliteClient(delay, robots) as client:
        covered: set[str] = set()
        for path in discover_categories(client):
            cid = category_id(path)
            if cid in covered:
                logger.info("skip %s; already included with a parent category", path)
                continue
            found, descendants, complete = fetch_category(client, path, fetch_size)
            for external_id, product in found.items():
                current = catalog.get(external_id)
                catalog[external_id] = product if current is None else prefer(current, product)
            covered.add(cid)
            if complete:
                covered.update(descendants)
        logger.info("category listings collected %s products", len(catalog))
        if catalog:
            with connect() as conn:
                stats = upsert_products(conn, list(catalog.values()), scraped_at)
            logger.info(
                "saved category pass: %s products, %s new prices, %s refreshed, %s without a price",
                stats.products,
                stats.snapshots_new,
                stats.snapshots_refreshed,
                stats.skipped_price,
            )

        missing = [
            (external_id, url)
            for external_id, url in sitemap_products(client).items()
            if external_id not in catalog
        ]
        logger.info("sitemap products not in the category listings: %s", len(missing))
        for index, (_external_id, url) in enumerate(missing, start=1):
            product = fetch_product_page(client, url)
            if product is None or product.external_id in catalog:
                logger.warning("no catalog row from %s", url)
                continue
            catalog[product.external_id] = product
            page_only.append(product)
            if index == 1 or index == len(missing) or index % 25 == 0:
                logger.info("product pages %s/%s", index, len(missing))

    if page_only:
        with connect() as conn:
            stats = upsert_products(conn, page_only, scraped_at)
        logger.info(
            "saved product-page pass: %s products, %s new prices",
            stats.products,
            stats.snapshots_new,
        )
    if not catalog:
        logger.error("no Lidl products collected")
        return 1
    _print_samples()
    return 0

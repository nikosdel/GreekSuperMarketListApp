"""Masoutis catalog importer.

Uses the same public listing API as masoutis.gr (GetCred, then the category
listing). robots.txt disallows category search pages; this scraper does not
call them. Shelf departments are saved first. Offer, brand, and diet views
are only used to pick up products that never appeared on a shelf.
"""

from __future__ import annotations

import logging
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

import httpx

from scraper.config import masoutis_delay_seconds
from scraper.db import Chain, connect, upsert_products
from scraper.parsing import CatalogProduct, parse_eu_decimal, to_price
from scraper.robots import Robots

logger = logging.getLogger("masoutis")

MASOUTIS_CHAIN = Chain("masoutis", "Masoutis", "GR", "https://www.masoutis.gr")
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)
ORIGIN = "https://www.masoutis.gr"
ROBOTS_URL = f"{ORIGIN}/robots.txt"
CRED_URL = f"{ORIGIN}/api/eshop/GetCred"
MENU_URL = f"{ORIGIN}/api/eshop/GetScanNShopMenuAllLevelsAutoScheduler"
LIST_URL = f"{ORIGIN}/api/eshop/GetPromoItemWithListCouponsSubCategoriesAutoPromosv2"
# The website sends this fixed catalog key with every listing request.
PASS_KEY = "Sc@NnSh0p"
PAGE_SIZE = 50
MAX_PAGES = 400
# Merchandising views. Their products also sit on a shelf department.
FILTER_IDS = {"0", "2", "5", "6", "7", "9", "10", "11", "13", "564"}
_SIZE_RE = re.compile(
    r"(?i)(\d+(?:[.,]\d+)?)\s*"
    r"(κιλά|κιλό|κιλο|κιλ\.?|kg|γρ\.?|gr|ml|cl|lt|λίτρα|λίτρο|τεμ\.?)"
)
_VOLUME_RE = re.compile(
    r"(?i)(\d+(?:[.,]\d+)?)\s*€\s*/\s*"
    r"(κιλ[οά]?|kg|λιτ|λ[ίι]τρ[οα]?|lt|l|τεμ\.?|τεμάχιο|μεζ\.?|τ\.μ\.?)"
)
_UNIT_ALIASES = {
    "γρ": "g",
    "gr": "g",
    "κιλ": "kg",
    "κιλο": "kg",
    "κιλό": "kg",
    "κιλά": "kg",
    "lt": "l",
    "λίτρο": "l",
    "λίτρα": "l",
    "τεμ": "τεμ",
    "τεμάχιο": "τεμ",
}


@dataclass(frozen=True)
class Department:
    id: str
    name: str
    is_filter: bool


class MasoutisClient:
    def __init__(self, delay: float, robots: Robots) -> None:
        self.delay = delay
        self.robots = robots
        self._next_at = 0.0
        self._cred_at = 0.0
        self._cred: dict[str, str] = {}
        self._http = httpx.Client(
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            follow_redirects=True,
            max_redirects=3,
            timeout=40,
        )

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> MasoutisClient:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def get_json(self, url: str) -> object | None:
        if not self._allowed(url):
            return None
        return self._send("GET", url, None, None)

    def post_json(self, url: str, body: dict, auth: bool = True) -> object | None:
        if not self._allowed(url):
            return None
        headers = {"Content-Type": "application/json"}
        if auth and not self._ensure_cred():
            return None
        if auth:
            headers.update(self._cred)
        return self._send("POST", url, body, headers)

    def _allowed(self, url: str) -> bool:
        if self.robots.allowed(url):
            return True
        logger.warning("robots.txt disallows %s", url)
        return False

    def _wait(self) -> None:
        now = time.monotonic()
        if now < self._next_at:
            time.sleep(self._next_at - now)
        self._next_at = time.monotonic() + self.delay

    def _ensure_cred(self, force: bool = False) -> bool:
        fresh = time.monotonic() - self._cred_at < 90
        if self._cred and fresh and not force:
            return True
        payload = self.get_json(CRED_URL)
        if not isinstance(payload, dict):
            logger.error("Masoutis did not return catalog credentials")
            return False
        uid = str(payload.get("Uid") or "")
        usl = str(payload.get("Usl") or "")
        key = str(payload.get("Key") or "")
        if not uid or not key:
            logger.error("Masoutis catalog credentials were incomplete")
            return False
        self._cred = {"Uid": uid, "Usl": usl, "Key": key}
        self._cred_at = time.monotonic()
        return True

    def _send(
        self,
        method: str,
        url: str,
        body: dict | None,
        headers: dict[str, str] | None,
    ) -> object | None:
        last_error: Exception | None = None
        for attempt in range(4):
            self._wait()
            try:
                response = self._http.request(method, url, json=body, headers=headers)
            except httpx.TransportError as exc:
                last_error = exc
                time.sleep(self.delay * (attempt + 1))
                continue
            if response.status_code in {429, 500, 502, 503, 504}:
                time.sleep(self.delay * (attempt + 1))
                continue
            if (
                response.status_code in {401, 403}
                and headers
                and "Key" in headers
                and attempt == 0
            ):
                if self._ensure_cred(force=True):
                    headers = {**headers, **self._cred}
                continue
            if response.status_code != 200:
                logger.warning("%s %s -> %s", method, url, response.status_code)
                return None
            return response.json()
        logger.warning("gave up on %s (%s)", url, last_error)
        return None


def fetch_robots(client: httpx.Client) -> Robots | None:
    try:
        response = client.get(ROBOTS_URL, timeout=30)
    except httpx.HTTPError as exc:
        logger.error("could not read robots.txt: %s", exc)
        return None
    if response.status_code != 200:
        logger.error("robots.txt returned %s", response.status_code)
        return None
    robots = Robots.parse(response.text)
    logger.info("robots.txt disallow rules: %s", len(robots.rules))
    return robots


def fetch_departments(client: MasoutisClient) -> list[Department]:
    payload = client.post_json(MENU_URL, {"PassKey": PASS_KEY, "Zip": ""})
    found: dict[str, Department] = {}
    if isinstance(payload, list):
        for row in payload:
            if not isinstance(row, dict):
                continue
            dept_id = str(row.get("HeaderMenuItem") or "").strip()
            link = str(row.get("HeaderMenuItemLinkDescr") or "").lower()
            if not dept_id or dept_id in found or "search" in link:
                continue
            name = str(row.get("HeaderMenuItemDescr") or dept_id).strip()
            found[dept_id] = Department(dept_id, name, dept_id in FILTER_IDS)
    if not found:
        logger.error("Masoutis menu was empty")
        return []
    departments = list(found.values())
    departments.sort(key=lambda item: (item.is_filter, item.name))
    logger.info(
        "departments: %s shelves, %s extra views",
        sum(not item.is_filter for item in departments),
        sum(item.is_filter for item in departments),
    )
    return departments


def _as_int(value: object) -> int | None:
    try:
        number = int(str(value))
    except (TypeError, ValueError):
        return None
    return number if number >= 0 else None


def fetch_department(client: MasoutisClient, department: Department) -> list[dict]:
    rows: list[dict] = []
    total: int | None = None
    for page in range(1, MAX_PAGES + 1):
        payload = client.post_json(
            LIST_URL,
            {
                "PassKey": PASS_KEY,
                "Itemcode": department.id,
                "ItemDescr": "0",
                "IfWeight": str(page),
                "ServiceResponse": "",
                "Token": "",
                "Zip": "",
                "BrandName": "",
                "TeamId": "",
                "ExtraFilter": "",
            },
        )
        if not isinstance(payload, list) or not payload:
            break
        if total is None:
            total = _as_int(payload[0].get("PassKey"))
            logger.info(
                "%s (%s): %s products",
                department.name,
                department.id,
                total if total is not None else "unknown",
            )
        rows.extend(item for item in payload if isinstance(item, dict))
        if total is not None and page * PAGE_SIZE >= total:
            break
        if len(payload) < PAGE_SIZE:
            break
    else:
        logger.warning("%s stopped at %s pages", department.name, MAX_PAGES)
    return rows


def _clean(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _size_from(item: dict, name: str) -> tuple[str | None, str | None]:
    for key in ("StartPrItemVolume", "ItemSize"):
        raw = _clean(item.get(key))
        if raw and "€" not in raw:
            match = _SIZE_RE.search(raw)
            if match:
                return match.group(0), _unit_name(match.group(2))
            return raw, None
    match = None
    for candidate in _SIZE_RE.finditer(name):
        match = candidate
    if match is None:
        return None, None
    return match.group(0), _unit_name(match.group(2))


def _unit_name(raw: str) -> str:
    token = raw.lower().rstrip(".")
    return _UNIT_ALIASES.get(token, token)


def _volume_amount(text: str) -> Decimal | None:
    match = _VOLUME_RE.search(text)
    if not match:
        return None
    try:
        amount = parse_eu_decimal(match.group(1)).quantize(Decimal("0.0001"))
    except (InvalidOperation, ValueError):
        return None
    if amount <= 0:
        return None
    return amount


def map_item(item: dict, category: str) -> CatalogProduct | None:
    external_id = _clean(item.get("Itemcode"))
    name = _clean(item.get("ItemDescr"))
    if not external_id or not name:
        return None
    volume = _clean(item.get("ItemVolume"))
    unit_price_text = volume if volume and "€" in volume else None
    unit_price = to_price(item.get("PricePerUnit"), "0.0001")
    if unit_price is None and unit_price_text:
        unit_price = _volume_amount(unit_price_text)
    size_text, unit = _size_from(item, name)
    parts = [category]
    for key in (
        "OfferCategoryDescr",
        "SubItemDescrL2",
        "SubItemDescrL3",
        "SubItemDescrL4",
        "SubItemDescrL5",
    ):
        part = _clean(item.get(key))
        if part and part not in parts:
            parts.append(part)
    link = _clean(item.get("ItemDescrLink")) or _clean(item.get("CanonicalUrl"))
    if link and link.startswith("/"):
        link = ORIGIN + link
    return CatalogProduct(
        external_id=external_id,
        name=name,
        brand=_clean(item.get("BrandNameDesciption")),
        size_text=size_text,
        unit=unit,
        category_path=" > ".join(parts),
        image_url=_clean(item.get("PhotoData")),
        product_url=link,
        price=to_price(item.get("PosPrice")),
        unit_price=unit_price,
        unit_price_text=unit_price_text,
        currency="EUR",
    )


def _print_samples() -> None:
    with connect() as conn:
        totals = conn.execute(
            """
            SELECT p.chain_id, count(*), count(c.product_id),
                   count(c.unit_price)
            FROM product p
            LEFT JOIN current_price c ON c.product_id = p.id
            GROUP BY p.chain_id
            ORDER BY p.chain_id
            """
        ).fetchall()
        rows = conn.execute(
            """
            SELECT p.chain_id, p.name, p.category_path, c.price, c.unit_price_text
            FROM product p
            JOIN current_price c ON c.product_id = p.id
            WHERE p.chain_id = 'masoutis'
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
    print("Masoutis sample:")
    for row in rows:
        print(f"  {row[1]} | {row[2]} | {row[3]} EUR | {row[4] or '-'}")


def run_masoutis() -> int:
    from scraper.config import ROOT

    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(ROOT / "masoutis-run.log", encoding="utf-8"),
        ],
        force=True,
    )
    delay = masoutis_delay_seconds()
    logger.info("Masoutis delay %.1fs", delay)
    try:
        with connect() as conn:
            conn.execute("SELECT 1")
    except Exception as exc:
        logger.error("Postgres is not reachable: %s", exc)
        return 1

    probe = httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=30)
    try:
        robots = fetch_robots(probe)
    finally:
        probe.close()
    if robots is None:
        return 1

    scraped_at = datetime.now(timezone.utc)
    seen: set[str] = set()
    saved = 0
    with MasoutisClient(delay, robots) as client:
        departments = fetch_departments(client)
        if not departments:
            return 1
        for department in departments:
            fresh: list[CatalogProduct] = []
            for item in fetch_department(client, department):
                product = map_item(item, department.name)
                if product is None or product.external_id in seen:
                    continue
                seen.add(product.external_id)
                fresh.append(product)
            if not fresh:
                logger.info("%s added no new products", department.name)
                continue
            with connect() as conn:
                stats = upsert_products(conn, fresh, scraped_at, MASOUTIS_CHAIN)
            saved += stats.products
            logger.info(
                "saved %s: %s new products (%s with a price)",
                department.name,
                stats.products,
                stats.products - stats.skipped_price,
            )
    logger.info("Masoutis products saved this run: %s", saved)
    _print_samples()
    return 0 if saved else 1

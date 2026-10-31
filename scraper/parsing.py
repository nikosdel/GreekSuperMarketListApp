"""Pure helpers for Lidl payloads and price text. No network."""

from __future__ import annotations

import html
import json
import re
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation

_UNIT_RE = re.compile(
    r"(?i)(\d+(?:[.,]\d+)?)\s*(kg|g|ml|cl|l|τεμ\.?|τεμάχια|τεμάχιο|pcs)\b"
)
_NUMBER = r"\d{1,3}(?:\.\d{3})*(?:,\d+)?|\d+(?:,\d+)?"
# "Από 4,58€ σε 2,70€" — the amount after σε is the current unit price.
_UNIT_PRICE_NOW_RE = re.compile(rf"σε\s*({_NUMBER})\s*€")
_UNIT_PRICE_RE = re.compile(rf"=\s*({_NUMBER})\s*€")
_JSON_LD_RE = re.compile(
    r'<script type="application/ld\+json">(.*?)</script>',
    re.DOTALL,
)
_BRAND_RE = re.compile(r'"brand"\s*:\s*\{\s*"name"\s*:\s*"((?:\\.|[^"\\])*)"')
_WON_RE = re.compile(r'"wonCategoryPrimary"\s*:\s*"((?:\\.|[^"\\])*)"')
_PACKAGING_RE = re.compile(
    r'"packaging"\s*:\s*\{\s*"text"\s*:\s*"((?:\\.|[^"\\])*)"'
)
_BASE_PRICE_RE = re.compile(
    r'"basePrice"\s*:\s*\{[^{}]*"text"\s*:\s*"((?:\\.|[^"\\])*)"'
)
_UNIT_ALIASES = {
    "τεμ": "τεμ",
    "τεμάχια": "τεμ",
    "τεμάχιο": "τεμ",
    "pcs": "τεμ",
}


@dataclass
class CatalogProduct:
    external_id: str
    name: str
    brand: str | None
    size_text: str | None
    unit: str | None
    category_path: str | None
    image_url: str | None
    product_url: str | None
    price: Decimal | None
    unit_price: Decimal | None
    unit_price_text: str | None
    currency: str = "EUR"
    observed_at: datetime | None = None

    def richness(self) -> int:
        fields = (
            self.brand,
            self.size_text,
            self.unit,
            self.category_path,
            self.image_url,
            self.product_url,
            self.price,
            self.unit_price,
            self.unit_price_text,
        )
        return sum(value not in (None, "") for value in fields)


def parse_eu_decimal(raw: str) -> Decimal:
    text = raw.strip().replace("€", "").strip()
    if "," in text and "." in text:
        text = text.replace(".", "").replace(",", ".")
    elif "," in text:
        text = text.replace(",", ".")
    return Decimal(text)


def to_price(value: object, places: str = "0.01") -> Decimal | None:
    if value is None or value is False:
        return None
    try:
        if isinstance(value, str):
            cleaned = value.strip()
            if not cleaned:
                return None
            number = parse_eu_decimal(cleaned)
        else:
            number = Decimal(str(value))
        quantized = number.quantize(Decimal(places))
    except (InvalidOperation, ValueError):
        return None
    if quantized <= 0:
        return None
    return quantized


def parse_unit_price(text: str | None) -> tuple[Decimal | None, str | None]:
    if not text:
        return None, None
    cleaned = html.unescape(text).replace("\u00a0", " ")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if not cleaned:
        return None, None
    match = _UNIT_PRICE_NOW_RE.search(cleaned) or _UNIT_PRICE_RE.search(cleaned)
    if not match:
        return None, cleaned
    try:
        amount = parse_eu_decimal(match.group(1)).quantize(Decimal("0.0001"))
    except (InvalidOperation, ValueError):
        return None, cleaned
    if amount <= 0:
        return None, cleaned
    return amount, cleaned


def size_and_unit(packaging: str | None) -> tuple[str | None, str | None]:
    if not packaging:
        return None, None
    text = html.unescape(packaging).strip()
    if not text:
        return None, None
    matches = list(_UNIT_RE.finditer(text))
    if not matches:
        return text, None
    unit = matches[-1].group(2).lower().rstrip(".")
    return text, _UNIT_ALIASES.get(unit, unit)


def _clean(value: object) -> str | None:
    if value is None:
        return None
    text = html.unescape(str(value)).strip()
    return text or None


def _abs_url(url: str | None, origin: str) -> str | None:
    if not url:
        return None
    if url.startswith("//"):
        return "https:" + url
    if url.startswith("/"):
        return origin.rstrip("/") + url
    if url.startswith("http://") or url.startswith("https://"):
        return url
    return None


def map_gridbox(data: dict) -> CatalogProduct | None:
    external_id = str(data.get("erpNumber") or data.get("productId") or "").strip()
    if not external_id.isdigit():
        return None
    keyfacts = data.get("keyfacts") or {}
    name = _clean(data.get("fullTitle") or keyfacts.get("fullTitle") or keyfacts.get("title"))
    if not name:
        return None
    brand = _clean((data.get("brand") or {}).get("name"))
    price_obj = data.get("price") or {}
    size_text, unit = size_and_unit(_clean((price_obj.get("packaging") or {}).get("text")))
    unit_price_text = _clean((price_obj.get("basePrice") or {}).get("text"))
    unit_price, unit_price_text = parse_unit_price(unit_price_text)
    currency = (_clean(price_obj.get("currencyCode")) or "EUR").upper()
    canonical = _clean(data.get("canonicalPath") or data.get("canonicalUrl"))
    image = _abs_url(_clean(data.get("image")), "https://www.lidl-hellas.gr")
    return CatalogProduct(
        external_id=external_id,
        name=name,
        brand=brand,
        size_text=size_text,
        unit=unit,
        category_path=_clean(keyfacts.get("wonCategoryPrimary")),
        image_url=image,
        product_url=_abs_url(canonical, "https://www.lidl.gr"),
        price=to_price(price_obj.get("price")),
        unit_price=unit_price,
        unit_price_text=unit_price_text,
        currency=currency,
    )


def products_from_category(payload: dict) -> list[CatalogProduct]:
    products: list[CatalogProduct] = []
    for item in payload.get("items") or []:
        if item.get("resultClass") not in (None, "product") and item.get("type") != "product":
            continue
        data = ((item.get("gridbox") or {}).get("data")) or None
        if not isinstance(data, dict):
            continue
        product = map_gridbox(data)
        if product is not None:
            products.append(product)
    return products


def _json_string(raw: str) -> str:
    try:
        return json.loads(f'"{raw}"')
    except json.JSONDecodeError:
        return raw


def _first_json_string(pattern: re.Pattern[str], text: str) -> str | None:
    for match in pattern.finditer(text):
        value = _clean(_json_string(match.group(1)))
        if value:
            return value
    return None


def _product_json_ld(page_html: str) -> dict | None:
    for match in _JSON_LD_RE.finditer(page_html):
        try:
            data = json.loads(match.group(1))
        except json.JSONDecodeError:
            continue
        if isinstance(data, dict) and data.get("@type") == "Product":
            return data
    return None


def _offer(product_ld: dict) -> dict:
    offers = product_ld.get("offers") or {}
    if isinstance(offers, list):
        return offers[0] if offers and isinstance(offers[0], dict) else {}
    return offers if isinstance(offers, dict) else {}


def _image_url(product_ld: dict) -> str | None:
    image = product_ld.get("image")
    if isinstance(image, list):
        image = image[0] if image else None
    if isinstance(image, dict):
        image = image.get("url")
    return _abs_url(_clean(image), "https://www.lidl-hellas.gr")


def parse_product_html(page_html: str, fallback_url: str | None = None) -> CatalogProduct | None:
    product_ld = _product_json_ld(page_html)
    unescaped = html.unescape(page_html)
    if product_ld is None and '"erpNumber"' not in unescaped and '"fullTitle"' not in unescaped:
        return None

    offer = _offer(product_ld or {})
    external_id = _clean((product_ld or {}).get("sku")) or ""
    if not external_id.isdigit():
        match = re.search(r'"erpNumber"\s*:\s*"(\d+)"', unescaped)
        external_id = match.group(1) if match else ""
    if not external_id.isdigit():
        return None

    name = _clean((product_ld or {}).get("name"))
    if not name:
        name = _first_json_string(re.compile(r'"fullTitle"\s*:\s*"((?:\\.|[^"\\])*)"'), unescaped)
    if not name:
        return None

    brand_ld = (product_ld or {}).get("brand")
    brand = None
    if isinstance(brand_ld, dict):
        brand = _clean(brand_ld.get("name"))
    elif isinstance(brand_ld, str):
        brand = _clean(brand_ld)
    if not brand:
        brand = _first_json_string(_BRAND_RE, unescaped)

    size_text, unit = size_and_unit(_first_json_string(_PACKAGING_RE, unescaped))
    unit_price, unit_price_text = parse_unit_price(_first_json_string(_BASE_PRICE_RE, unescaped))
    # JSON-LD offer price only. Other "price" numbers on the page belong to other widgets.
    price = to_price(offer.get("price"))
    currency = (_clean(offer.get("priceCurrency")) or "EUR").upper()
    product_url = _abs_url(_clean((product_ld or {}).get("url")), "https://www.lidl.gr") or fallback_url
    return CatalogProduct(
        external_id=external_id,
        name=name,
        brand=brand,
        size_text=size_text,
        unit=unit,
        category_path=_first_json_string(_WON_RE, unescaped),
        image_url=_image_url(product_ld or {}),
        product_url=product_url,
        price=price,
        unit_price=unit_price,
        unit_price_text=unit_price_text,
        currency=currency,
    )


def prefer(current: CatalogProduct, incoming: CatalogProduct) -> CatalogProduct:
    return current if current.richness() >= incoming.richness() else incoming

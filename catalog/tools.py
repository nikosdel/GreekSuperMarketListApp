"""Catalog lookups a later free local model can call.

These functions only read Postgres. They return the short product name,
the shop, the category, the pack price, the unit price, and the date that
price was updated. They do not return images, descriptions, or page text.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from psycopg.rows import dict_row

from scraper.db import connect

TOOL_SPECS = [
    {
        "name": "search_products",
        "description": (
            "Find offers whose name contains every word in the query as a "
            "whole word. A number such as 160 also matches 160g. Sorted by "
            "pack price. Optional category is matched inside the category path."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "category": {"type": "string"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 30},
            },
            "required": ["query"],
        },
    },
    {
        "name": "compare_product",
        "description": (
            "Compare one product across shops. Do not use this for a list of "
            "several products. A name whose category also uses the words "
            "wins, then the cheapest pack. Lists that name's pack price at each shop."
        ),
        "parameters": {
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"],
        },
    },
    {
        "name": "cheapest_basket",
        "description": (
            "Use this for two or more products. Pass each product as its own "
            "string in items, copied from the user. Returns the cheapest "
            "pack of each chosen name and the one-shop totals."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "items": {
                    "type": "array",
                    "items": {"type": "string"},
                    "minItems": 1,
                    "maxItems": 12,
                }
            },
            "required": ["items"],
        },
    },
]


@dataclass(frozen=True)
class Offer:
    product_id: int
    name: str
    shop: str
    category_path: str | None
    price: Decimal
    unit_price: Decimal | None
    unit_price_text: str | None
    observed_on: date | None

    def to_dict(self) -> dict:
        return {
            "product_id": self.product_id,
            "name": self.name,
            "shop": self.shop,
            "category_path": self.category_path,
            "price": _decimal_text(self.price),
            "unit_price": _decimal_text(self.unit_price),
            "unit_price_text": self.unit_price_text,
            "observed_on": None if self.observed_on is None else self.observed_on.isoformat(),
        }


@dataclass(frozen=True)
class NameHit:
    name: str
    shops: int
    category_path: str | None = None
    cheapest: Decimal | None = None

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "shops": self.shops,
            "category_path": self.category_path,
            "cheapest": _decimal_text(self.cheapest),
        }


@dataclass(frozen=True)
class CompareResult:
    query: str
    chosen_name: str | None
    candidates: list[NameHit]
    offers: list[Offer]

    def to_dict(self) -> dict:
        return {
            "query": self.query,
            "chosen_name": self.chosen_name,
            "candidates": [hit.to_dict() for hit in self.candidates],
            "offers": [offer.to_dict() for offer in self.offers],
        }


@dataclass(frozen=True)
class BasketLine:
    query: str
    chosen_name: str | None
    candidates: list[NameHit]
    offer: Offer | None

    def to_dict(self) -> dict:
        return {
            "query": self.query,
            "chosen_name": self.chosen_name,
            "candidates": [hit.to_dict() for hit in self.candidates],
            "offer": None if self.offer is None else self.offer.to_dict(),
        }


@dataclass(frozen=True)
class ShopBasket:
    shop: str
    total: Decimal
    offers: list[Offer]

    def to_dict(self) -> dict:
        return {
            "shop": self.shop,
            "total": _decimal_text(self.total),
            "offers": [offer.to_dict() for offer in self.offers],
        }


@dataclass(frozen=True)
class BasketResult:
    lines: list[BasketLine]
    split_total: Decimal
    one_shop: list[ShopBasket]

    @property
    def complete(self) -> bool:
        return bool(self.lines) and all(line.offer is not None for line in self.lines)

    def to_dict(self) -> dict:
        return {
            "lines": [line.to_dict() for line in self.lines],
            "split_total": _decimal_text(self.split_total),
            "complete": self.complete,
            "one_shop": [shop.to_dict() for shop in self.one_shop],
        }


def search_products(
    query: str,
    *,
    category: str | None = None,
    limit: int = 12,
) -> list[Offer]:
    tokens = _tokens(query)
    bounded = _bounded_limit(limit)
    where, params = _name_match(tokens)
    if category and category.strip():
        category_where, category_params = _column_match("p.category_path", _tokens(category))
        where = f"{where} AND {category_where}"
        params.extend(category_params)
    params.append(bounded)
    sql = f"""
        SELECT
            p.id AS product_id,
            p.name,
            ch.name AS shop,
            p.category_path,
            c.price,
            c.unit_price,
            c.unit_price_text,
            c.observed_at::date AS observed_on
        FROM product p
        JOIN chain ch ON ch.id = p.chain_id
        JOIN current_price c ON c.product_id = p.id
        WHERE {where}
        ORDER BY c.price ASC, c.unit_price ASC NULLS LAST, ch.name
        LIMIT %s
    """
    with connect() as conn:
        conn.row_factory = dict_row
        rows = conn.execute(sql, params).fetchall()
    return [_offer(row) for row in rows]


def compare_product(query: str) -> CompareResult:
    tokens = _tokens(query)
    with connect() as conn:
        conn.row_factory = dict_row
        candidates = _candidate_names(conn, tokens, limit=5, prefer="price")
        if not candidates:
            return CompareResult(query=query, chosen_name=None, candidates=[], offers=[])
        chosen = candidates[0].name
        offers = _offers_for_names(conn, [hit.name for hit in candidates])
    offers.sort(key=lambda offer: (offer.price, offer.shop))
    return CompareResult(
        query=query,
        chosen_name=chosen,
        candidates=candidates,
        offers=offers,
    )


def cheapest_basket(items: list[str]) -> BasketResult:
    if not items:
        raise ValueError("basket needs at least one item")
    if len(items) > 12:
        raise ValueError("basket accepts at most 12 items")

    with connect() as conn:
        conn.row_factory = dict_row
        picked: list[tuple[str, list[NameHit]]] = []
        chosen_names: list[str] = []
        for item in items:
            candidates = _candidate_names(conn, _tokens(item), limit=5, prefer="shops")
            picked.append((item, candidates))
            if candidates:
                chosen_names.append(candidates[0].name)
        offers = _offers_for_names(conn, chosen_names) if chosen_names else []

    by_name: dict[str, list[Offer]] = {}
    for offer in offers:
        by_name.setdefault(offer.name, []).append(offer)

    lines: list[BasketLine] = []
    for item, candidates in picked:
        if not candidates:
            lines.append(BasketLine(query=item, chosen_name=None, candidates=[], offer=None))
            continue
        chosen = candidates[0].name
        name_offers = by_name.get(chosen, [])
        cheapest = min(name_offers, key=lambda offer: (offer.price, offer.shop)) if name_offers else None
        lines.append(
            BasketLine(
                query=item,
                chosen_name=chosen,
                candidates=candidates,
                offer=cheapest,
            )
        )

    needed = [line.chosen_name for line in lines if line.chosen_name is not None]
    by_shop: dict[str, dict[str, Offer]] = {}
    for offer in offers:
        shop_offers = by_shop.setdefault(offer.shop, {})
        current = shop_offers.get(offer.name)
        if current is None or offer.price < current.price:
            shop_offers[offer.name] = offer

    one_shop: list[ShopBasket] = []
    if lines and all(line.chosen_name is not None for line in lines):
        for shop, shop_offers in by_shop.items():
            if any(name not in shop_offers for name in needed):
                continue
            shop_lines = [shop_offers[name] for name in needed]
            total = sum((offer.price for offer in shop_lines), Decimal("0"))
            one_shop.append(ShopBasket(shop=shop, total=total, offers=shop_lines))
        one_shop.sort(key=lambda shop: (shop.total, shop.shop))

    split_total = sum((line.offer.price for line in lines if line.offer is not None), Decimal("0"))
    return BasketResult(lines=lines, split_total=split_total, one_shop=one_shop)


def _tokens(query: str) -> list[str]:
    tokens = [part for part in query.split() if len(part.strip()) >= 2]
    if not tokens:
        raise ValueError("query needs at least one word of 2 characters")
    if len(tokens) > 8:
        raise ValueError("query has too many words")
    return tokens


def _bounded_limit(limit: int) -> int:
    if limit < 1 or limit > 30:
        raise ValueError("limit must be from 1 to 30")
    return limit


# Letters that count as part of a word. "γάλα" must not match inside "μεγάλα".
_WORD_CHARS = "0-9A-Za-zΑ-Ωα-ωΆ-ώϊϋΐΰ"


def _name_match(tokens: list[str]) -> tuple[str, list]:
    return _column_match("p.name", tokens)


def _column_match(column: str, tokens: list[str]) -> tuple[str, list]:
    clauses: list[str] = []
    params: list = []
    for token in tokens:
        if any(ch.isalpha() for ch in token):
            clauses.append(f"{column} ~* %s")
            params.append(_word_pattern(token))
        else:
            clauses.append(f"{column} ~ %s")
            params.append(_number_pattern(token))
    return " AND ".join(clauses), params


def _word_pattern(token: str) -> str:
    escaped = re.escape(token)
    boundary = f"[^{_WORD_CHARS}]"
    return f"(^|{boundary}){escaped}($|{boundary})"


def _number_pattern(token: str) -> str:
    """Match 160 inside 160g, and not inside 1600 or 2160."""
    escaped = re.escape(token)
    return f"(^|[^0-9]){escaped}([^0-9]|$)"


def _candidate_names(conn, tokens: list[str], *, limit: int, prefer: str) -> list[NameHit]:
    by_shops = _name_hits(conn, tokens, order="shops")
    if prefer == "price":
        hits = _merge_hits(by_shops, _name_hits(conn, tokens, order="price"))
    else:
        hits = by_shops
    return _prefer_category_matches(hits, tokens, prefer=prefer)[:limit]


def _name_hits(conn, tokens: list[str], *, order: str) -> list[NameHit]:
    where, params = _name_match(tokens)
    params.append(80)
    order_sql = (
        "min(c.price), count(DISTINCT p.chain_id) DESC, char_length(p.name), p.name"
        if order == "price"
        else "count(DISTINCT p.chain_id) DESC, min(c.price), char_length(p.name), p.name"
    )
    sql = f"""
        SELECT
            p.name,
            count(DISTINCT p.chain_id)::int AS shops,
            min(p.category_path) AS category_path,
            min(c.price) AS cheapest
        FROM product p
        JOIN current_price c ON c.product_id = p.id
        WHERE {where}
        GROUP BY p.name
        ORDER BY {order_sql}
        LIMIT %s
    """
    rows = conn.execute(sql, params).fetchall()
    return [
        NameHit(
            name=row["name"],
            shops=row["shops"],
            category_path=row["category_path"],
            cheapest=row["cheapest"],
        )
        for row in rows
    ]


def _merge_hits(first: list[NameHit], second: list[NameHit]) -> list[NameHit]:
    merged: dict[str, NameHit] = {hit.name: hit for hit in first}
    for hit in second:
        merged.setdefault(hit.name, hit)
    return list(merged.values())


def _prefer_category_matches(hits: list[NameHit], tokens: list[str], *, prefer: str) -> list[NameHit]:
    """Prefer a name whose category uses the query words.

    "ελαιόλαδο" is sold as tuna and as oil. The oil category contains the
    word, so the oil name wins over the tuna name even when fewer shops
    stock that exact bottle.
    """

    def score(hit: NameHit) -> int:
        text = hit.category_path or ""
        return sum(1 for token in tokens if _contains_token(text, token))

    scored = [(score(hit), hit) for hit in hits]
    best = max((value for value, _hit in scored), default=0)
    if best > 0:
        scored = [(value, hit) for value, hit in scored if value == best]
    def price_key(hit: NameHit) -> Decimal:
        return hit.cheapest if hit.cheapest is not None else Decimal("999999")

    if prefer == "price":
        scored.sort(key=lambda pair: (-pair[0], price_key(pair[1]), -pair[1].shops, len(pair[1].name), pair[1].name))
    else:
        scored.sort(key=lambda pair: (-pair[0], -pair[1].shops, price_key(pair[1]), len(pair[1].name), pair[1].name))
    return [hit for _value, hit in scored]


def _contains_token(text: str, token: str) -> bool:
    if any(ch.isalpha() for ch in token):
        return re.search(_word_pattern(token), text, flags=re.IGNORECASE) is not None
    return re.search(_number_pattern(token), text) is not None


def _offers_for_names(conn, names: list[str]) -> list[Offer]:
    unique = list(dict.fromkeys(names))
    if not unique:
        return []
    rows = conn.execute(
        """
        SELECT
            p.id AS product_id,
            p.name,
            ch.name AS shop,
            p.category_path,
            c.price,
            c.unit_price,
            c.unit_price_text,
            c.observed_at::date AS observed_on
        FROM product p
        JOIN chain ch ON ch.id = p.chain_id
        JOIN current_price c ON c.product_id = p.id
        WHERE p.name = ANY(%s)
        ORDER BY c.price, ch.name
        """,
        (unique,),
    ).fetchall()
    return [_offer(row) for row in rows]


def run_tool(name: str, arguments: dict | None) -> dict:
    """Run one catalog tool. Used by the free local chat."""
    arguments = arguments or {}
    if name == "search_products":
        query = arguments.get("query")
        if not isinstance(query, str):
            raise ValueError("search_products needs a query string")
        limit = arguments.get("limit", 8)
        offers = search_products(
            query,
            category=arguments.get("category") if isinstance(arguments.get("category"), str) else None,
            limit=int(limit),
        )
        return {"offers": [offer.to_dict() for offer in offers]}
    if name == "compare_product":
        query = arguments.get("query")
        if not isinstance(query, str):
            raise ValueError("compare_product needs a query string")
        return compare_product(query).to_dict()
    if name == "cheapest_basket":
        items = arguments.get("items")
        if isinstance(items, str):
            items = [items]
        if not isinstance(items, list) or not all(isinstance(item, str) for item in items):
            raise ValueError("cheapest_basket needs items as a list of strings")
        return cheapest_basket(items).to_dict()
    raise ValueError(f"unknown tool {name}")


def _offer(row: dict) -> Offer:
    return Offer(
        product_id=row["product_id"],
        name=row["name"],
        shop=row["shop"],
        category_path=row["category_path"],
        price=row["price"],
        unit_price=row["unit_price"],
        unit_price_text=row["unit_price_text"],
        observed_on=row["observed_on"],
    )


def _decimal_text(value: Decimal | None) -> str | None:
    if value is None:
        return None
    return format(value, "f")

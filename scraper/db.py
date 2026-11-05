"""Postgres connection, migrations, and catalog upserts."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

import psycopg

from scraper.config import ROOT, database_url
from scraper.parsing import CatalogProduct

MIGRATIONS = ROOT / "migrations"


def connect() -> psycopg.Connection:
    return psycopg.connect(database_url())


def _statements(sql: str) -> list[str]:
    """Split SQL on semicolons, keeping function bodies intact."""
    statements: list[str] = []
    buf: list[str] = []
    i = 0
    n = len(sql)
    dollar: str | None = None
    in_single = False
    while i < n:
        if dollar is not None:
            if sql.startswith(dollar, i):
                buf.append(dollar)
                i += len(dollar)
                dollar = None
            else:
                buf.append(sql[i])
                i += 1
            continue
        if in_single:
            buf.append(sql[i])
            if sql[i] == "'":
                if i + 1 < n and sql[i + 1] == "'":
                    buf.append("'")
                    i += 2
                    continue
                in_single = False
            i += 1
            continue
        if sql.startswith("--", i):
            newline = sql.find("\n", i)
            i = n if newline < 0 else newline
            continue
        if sql[i] == "'":
            in_single = True
            buf.append("'")
            i += 1
            continue
        if sql[i] == "$":
            match = re.match(r"\$[A-Za-z0-9_]*\$", sql[i:])
            if match:
                dollar = match.group(0)
                buf.append(dollar)
                i += len(dollar)
                continue
        if sql[i] == ";":
            statement = "".join(buf).strip()
            if statement:
                statements.append(statement)
            buf = []
            i += 1
            continue
        buf.append(sql[i])
        i += 1
    trailing = "".join(buf).strip()
    if trailing:
        statements.append(trailing)
    return statements


def migrate() -> list[str]:
    applied: list[str] = []
    with connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version TEXT PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        )
        conn.commit()
        for path in sorted(MIGRATIONS.glob("*.sql")):
            version = path.name
            exists = conn.execute(
                "SELECT 1 FROM schema_migrations WHERE version = %s",
                (version,),
            ).fetchone()
            if exists:
                print(f"migration {version} already applied")
                continue
            with conn.transaction():
                for statement in _statements(path.read_text(encoding="utf-8")):
                    conn.execute(statement)
                conn.execute(
                    "INSERT INTO schema_migrations (version) VALUES (%s)",
                    (version,),
                )
            applied.append(version)
            print(f"applied {version}")
    return applied


@dataclass(frozen=True)
class Chain:
    id: str
    name: str
    country: str
    website_url: str
    logo_url: str | None = None


@dataclass
class UpsertStats:
    products: int = 0
    snapshots_new: int = 0
    snapshots_refreshed: int = 0
    skipped_price: int = 0


def _same_moment(left: datetime | None, right: datetime | None) -> bool:
    if left is None and right is None:
        return True
    if left is None or right is None:
        return False
    left_utc = left if left.tzinfo else left.replace(tzinfo=timezone.utc)
    right_utc = right if right.tzinfo else right.replace(tzinfo=timezone.utc)
    return left_utc.astimezone(timezone.utc).replace(microsecond=0) == right_utc.astimezone(
        timezone.utc
    ).replace(microsecond=0)


def _same_amount(left: Decimal | None, right: Decimal | None, places: str) -> bool:
    if left is None and right is None:
        return True
    if left is None or right is None:
        return False
    quantum = Decimal(places)
    return Decimal(left).quantize(quantum) == Decimal(right).quantize(quantum)


def upsert_products(
    conn: psycopg.Connection,
    products: list[CatalogProduct],
    scraped_at: datetime,
    chain: Chain,
) -> UpsertStats:
    stats = UpsertStats()
    with conn.transaction():
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
        for product in products:
            price = product.price if product.currency == "EUR" else None
            row = conn.execute(
                """
                INSERT INTO product (
                    chain_id, external_id, name, brand, size_text, unit,
                    category_path, image_url, product_url, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (chain_id, external_id) DO UPDATE
                    SET name = EXCLUDED.name,
                        brand = EXCLUDED.brand,
                        size_text = EXCLUDED.size_text,
                        unit = EXCLUDED.unit,
                        category_path = EXCLUDED.category_path,
                        image_url = EXCLUDED.image_url,
                        product_url = EXCLUDED.product_url,
                        updated_at = EXCLUDED.updated_at
                RETURNING id
                """,
                (
                    chain.id,
                    product.external_id,
                    product.name,
                    product.brand,
                    product.size_text,
                    product.unit,
                    product.category_path,
                    product.image_url,
                    product.product_url,
                    scraped_at,
                ),
            ).fetchone()
            stats.products += 1
            if price is None or row is None:
                stats.skipped_price += 1
                continue
            product_id = row[0]
            latest = conn.execute(
                """
                SELECT id, price, unit_price, unit_price_text, observed_at
                FROM price_snapshot
                WHERE product_id = %s
                ORDER BY scraped_at DESC, id DESC
                LIMIT 1
                """,
                (product_id,),
            ).fetchone()
            unchanged = (
                latest is not None
                and _same_amount(latest[1], price, "0.01")
                and _same_amount(latest[2], product.unit_price, "0.0001")
                and (latest[3] or None) == (product.unit_price_text or None)
                and _same_moment(latest[4], product.observed_at)
            )
            if unchanged:
                conn.execute(
                    "UPDATE price_snapshot SET scraped_at = %s WHERE id = %s",
                    (scraped_at, latest[0]),
                )
                stats.snapshots_refreshed += 1
                continue
            conn.execute(
                """
                INSERT INTO price_snapshot (
                    product_id, price, unit_price, unit_price_text, currency,
                    scraped_at, observed_at
                )
                VALUES (%s, %s, %s, %s, 'EUR', %s, %s)
                """,
                (
                    product_id,
                    price,
                    product.unit_price,
                    product.unit_price_text,
                    scraped_at,
                    product.observed_at,
                ),
            )
            stats.snapshots_new += 1
    return stats

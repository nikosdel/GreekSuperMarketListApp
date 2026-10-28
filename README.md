# Super Market Web App

Phase 1 starts here: a Postgres catalog and a Lidl Greece importer. `https://www.lidl.gr` redirects to `https://www.lidl-hellas.gr`. The scraper reads public category listings, then any product sitemap URLs those listings missed.

It waits at least 1.5 seconds between requests and skips anything `robots.txt` disallows (including `/q/search?id=`). Prices are in EUR. A new price snapshot is stored when the price or unit price changes. If a later run sees the same price, it refreshes `scraped_at` on the latest snapshot. When Lidl writes a unit price as «Από 4,58€ σε 2,70€», the number stored is the current amount (2.70). Products with no published price are kept without a snapshot.

Port **5433** is used because another Postgres container on this PC already listens on 5432.

## Start Postgres

Docker Desktop has to be running.

```powershell
cd C:\Users\Nikos\Desktop\super-market-web-app
copy .env.example .env
docker compose up -d --wait
```

### Without Docker

Install PostgreSQL 16, then create the role and database:

```sql
CREATE USER supermarket WITH PASSWORD 'supermarket';
CREATE DATABASE supermarket OWNER supermarket;
```

Point `DATABASE_URL` in `.env` at that server (port 5432 if that is the one you installed). The SQL files in `migrations/` are what `python -m scraper migrate` applies.

## Run migrations

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m scraper migrate
```

## Run the Lidl scraper

```powershell
python -m scraper lidl
```

Requests are spaced 1.5 seconds apart, so a full run is not instant.

## Query a few products

```powershell
docker compose exec postgres psql -U supermarket -d supermarket -c "SELECT p.name, p.brand, p.size_text, c.price, c.unit_price_text FROM product p JOIN current_price c ON c.product_id = p.id WHERE p.chain_id = 'lidl' ORDER BY p.name LIMIT 10;"
```

```powershell
docker compose exec postgres psql -U supermarket -d supermarket -c "SELECT count(*) AS products, count(c.product_id) AS with_price FROM product p LEFT JOIN current_price c ON c.product_id = p.id WHERE p.chain_id = 'lidl';"
```

```powershell
docker compose exec postgres psql -U supermarket -d supermarket -c "SELECT p.name, c.price, c.unit_price_text, p.category_path FROM product p JOIN current_price c ON c.product_id = p.id WHERE p.chain_id = 'lidl' AND p.name ILIKE '%γάλα%' LIMIT 10;"
```

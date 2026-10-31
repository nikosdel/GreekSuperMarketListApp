# Super Market Web App

The catalog comes from [Πόσο Κάνει](https://posokanei.gov.gr/), the public Greek supermarket price observatory. Each product belongs to one supermarket through `product.chain_id`. The chain name is the shop on that site (Χαλκιαδάκης, My Market, Γαλαξίας, Κρητικός, Μασούτης, and the rest). The same item at two shops is two rows.

`category_path` keeps the site's category hierarchy, for example `Τρόφιμα > Πουλερικά, Αλλαντικά > Αλλαντικά > Πάριζα Παριζάκι`. `price` is the pack price. `unit_price` is the comparable amount (€/κιλό, €/λίτρο, or the equivalent the site publishes). `observed_at` is the date that row was updated on the site (Ενημερώθηκε).

The importer waits at least 1.5 seconds between requests and loads Greece only. A new price snapshot is stored when the price, the unit price, or the site's update date changes.

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

`004_posokanei.sql` clears products and prices loaded by the earlier shop scrapers. Those scrapers are not the catalog.

## Users and shared lists

`005_users_and_lists.sql` adds the tables: `app_user`, `shopping_list`, `shopping_list_member`, and `shopping_list_item`. The backend will create users, share lists, add products, and do the last save. There are no stored procedures for that.

A password is a bcrypt hash written by the backend. The database only checks that the stored value looks like a bcrypt hash.

An open list has an invite code. A saved list has no invite code, and it has `saved_at` and `saved_by`. The next shared list is a new row.

A list line points at a catalog product. History keeps the short product name and the saved price. It does not copy product descriptions or images.

## Load the catalog

```powershell
python -m scraper posokanei
```

Requests are spaced 1.5 seconds apart. A full Greece catalog is about a hundred listing pages.

## Query a few products

```powershell
docker compose exec postgres psql -U supermarket -d supermarket -c "SELECT ch.name, c.price, c.unit_price_text, c.observed_at::date FROM product p JOIN chain ch ON ch.id = p.chain_id JOIN current_price c ON c.product_id = p.id WHERE p.name ILIKE '%tostaki%' AND p.name ILIKE '%160g%' ORDER BY c.price;"
```

```powershell
docker compose exec postgres psql -U supermarket -d supermarket -c "SELECT split_part(category_path, ' > ', 1) AS category, count(DISTINCT external_id) AS products FROM product GROUP BY 1 ORDER BY 1;"
```

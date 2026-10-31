-- The catalog source is posokanei.gov.gr. Drop shop-scraper rows and
-- keep the date each supermarket price was updated on that site.
DELETE FROM product;

DELETE FROM chain;

DROP VIEW current_price;

ALTER TABLE price_snapshot
    ADD COLUMN observed_at TIMESTAMPTZ;

CREATE VIEW current_price AS
SELECT DISTINCT ON (product_id)
    product_id,
    price,
    unit_price,
    unit_price_text,
    currency,
    scraped_at,
    observed_at
FROM price_snapshot
ORDER BY product_id, scraped_at DESC, id DESC;

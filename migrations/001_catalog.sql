CREATE TABLE chain (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    country     CHAR(2) NOT NULL,
    website_url TEXT NOT NULL
);

CREATE TABLE product (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    chain_id      TEXT NOT NULL REFERENCES chain (id),
    external_id   TEXT NOT NULL,
    name          TEXT NOT NULL,
    brand         TEXT,
    size_text     TEXT,
    unit          TEXT,
    category_path TEXT,
    image_url     TEXT,
    product_url   TEXT,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (chain_id, external_id)
);

CREATE TABLE price_snapshot (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id      BIGINT NOT NULL REFERENCES product (id) ON DELETE CASCADE,
    price           NUMERIC(12, 2) NOT NULL,
    unit_price      NUMERIC(12, 4),
    unit_price_text TEXT,
    currency        CHAR(3) NOT NULL DEFAULT 'EUR' CHECK (currency = 'EUR'),
    scraped_at      TIMESTAMPTZ NOT NULL
);

CREATE INDEX price_snapshot_product_scraped_idx
    ON price_snapshot (product_id, scraped_at DESC);

CREATE VIEW current_price AS
SELECT DISTINCT ON (product_id)
    product_id,
    price,
    unit_price,
    unit_price_text,
    currency,
    scraped_at
FROM price_snapshot
ORDER BY product_id, scraped_at DESC;

INSERT INTO chain (id, name, country, website_url)
VALUES ('lidl', 'Lidl', 'GR', 'https://www.lidl.gr');

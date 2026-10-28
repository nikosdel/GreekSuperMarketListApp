INSERT INTO chain (id, name, country, website_url)
VALUES ('masoutis', 'Masoutis', 'GR', 'https://www.masoutis.gr')
ON CONFLICT (id) DO NOTHING;

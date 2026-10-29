INSERT INTO chain (id, name, country, website_url)
VALUES ('sklavenitis', 'Sklavenitis', 'GR', 'https://www.sklavenitis.gr')
ON CONFLICT (id) DO NOTHING;

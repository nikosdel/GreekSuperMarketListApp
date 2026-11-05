import { CatalogOffer, CatalogProductGroup } from './models';

type CatalogRow = Record<string, unknown>;

export function normalizeCatalogProducts(rows: unknown[]): CatalogProductGroup[] {
  const groups = new Map<string, CatalogProductGroup>();

  for (const value of rows) {
    const row = asRecord(value);
    if (!row || typeof row['name'] !== 'string' || !row['name'].trim()) {
      throw new Error('The catalog returned an invalid product.');
    }

    const name = row['name'].trim();
    const key = identityKey(name);
    const categoryPath = typeof row['category_path'] === 'string' ? row['category_path'] : null;
    const imageUrl = nullableString(row['image_url']);
    const offers = Array.isArray(row['offers'])
      ? row['offers'].map(readOffer)
      : [readLegacyOffer(row, imageUrl)];
    if (offers.some((offer) => offer === null)) {
      throw new Error('The catalog returned an invalid shop offer.');
    }

    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        name,
        category_path: categoryPath,
        image_url: imageUrl,
        offers: [],
        lowest_price: null,
        offer_count: 0,
      };
      groups.set(key, group);
    }
    group.image_url ??= imageUrl;
    group.category_path ??= categoryPath;
    for (const offer of offers) {
      if (offer && !group.offers.some((existing) => existing.id === offer.id)) {
        group.offers.push(offer);
      }
    }
  }

  return [...groups.values()].map((group) => {
    group.offers.sort((left, right) => {
      const byPrice = (left.price ?? Number.POSITIVE_INFINITY) - (right.price ?? Number.POSITIVE_INFINITY);
      return byPrice || left.chain_name.localeCompare(right.chain_name);
    });
    return {
      ...group,
      image_url: group.image_url ?? group.offers.find((offer) => offer.image_url)?.image_url ?? null,
      lowest_price: group.offers.find((offer) => offer.price !== null)?.price ?? null,
      offer_count: group.offers.length,
    };
  });
}

function readLegacyOffer(row: CatalogRow, imageUrl: string | null): CatalogOffer | null {
  const id = readNumber(row['id']);
  if (id === null || typeof row['chain_name'] !== 'string') {
    return null;
  }
  return {
    id,
    chain_name: row['chain_name'],
    logo_url: nullableString(row['logo_url'] ?? row['chain_logo_url']),
    chain_logo_url: nullableString(row['logo_url'] ?? row['chain_logo_url']),
    price: readNullableNumber(row['price']),
    unit_price_text: nullableString(row['unit_price_text']),
    observed_at: nullableString(row['observed_at']),
    image_url: imageUrl,
  };
}

function readOffer(value: unknown): CatalogOffer | null {
  const row = asRecord(value);
  if (!row || typeof row['chain_name'] !== 'string') {
    return null;
  }
  const id = readNumber(row['id']);
  if (id === null) {
    return null;
  }
  return {
    id,
    chain_name: row['chain_name'],
    logo_url: nullableString(row['logo_url'] ?? row['chain_logo_url']),
    chain_logo_url: nullableString(row['logo_url'] ?? row['chain_logo_url']),
    price: readNullableNumber(row['price']),
    unit_price_text: nullableString(row['unit_price_text']),
    observed_at: nullableString(row['observed_at']),
    image_url: nullableString(row['image_url']),
  };
}

function identityKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('el')
    .replace(/ς/g, 'σ');
}

function asRecord(value: unknown): CatalogRow | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as CatalogRow
    : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function readNumber(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function readNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

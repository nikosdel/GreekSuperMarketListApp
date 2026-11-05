import { normalizeCatalogProducts } from './catalog-products';

describe('normalizeCatalogProducts', () => {
  it('groups legacy product rows by normalized name and preserves shop offers', () => {
    const products = normalizeCatalogProducts([
      {
        id: 14,
        name: 'Γάλα Πλήρες 1lt',
        category_path: 'Γάλα',
        image_url: 'https://example.test/milk.jpg',
        chain_name: 'Alpha Market',
        price: 1.2,
        unit_price_text: '1,20 €/λίτρο',
        observed_at: '2026-11-05',
      },
      {
        id: 15,
        name: 'ΓΑΛΑ ΠΛΗΡΕΣ 1lt',
        category_path: 'Γάλα',
        image_url: null,
        chain_name: 'Beta Foods',
        price: 1.1,
        unit_price_text: '1,10 €/λίτρο',
        observed_at: '2026-11-04',
      },
      {
        id: 16,
        name: 'Γάλα Ελαφρύ 1lt',
        category_path: 'Γάλα',
        image_url: null,
        chain_name: 'Beta Foods',
        price: 1.05,
        unit_price_text: '1,05 €/λίτρο',
        observed_at: '2026-11-04',
      },
    ]);

    expect(products.length).toBe(2);
    expect(products[0].offers.map((offer) => offer.id)).toEqual([15, 14]);
    expect(products[0].lowest_price).toBe(1.1);
    expect(products[0].offer_count).toBe(2);
    expect(products[0].image_url).toBe('https://example.test/milk.jpg');
    expect(products[1].offers.length).toBe(1);
  });

  it('keeps already grouped catalog responses and their offers', () => {
    const products = normalizeCatalogProducts([
      {
        key: 'milk-1',
        name: 'Milk 1L',
        category_path: null,
        image_url: null,
        lowest_price: 1.2,
        offer_count: 1,
        offers: [{
          id: 22,
          chain_name: 'Alpha Market',
          price: 1.2,
          unit_price_text: '1.20 €/L',
          observed_at: null,
          image_url: null,
        }],
      },
    ]);

    expect(products[0].offers[0].chain_name).toBe('Alpha Market');
    expect(products[0].lowest_price).toBe(1.2);
  });
});

import assert from "node:assert/strict";
import test from "node:test";
import { groupProductRows } from "./catalog.js";

test("groups exact product identities while preserving separate supermarket offers", () => {
  const products = groupProductRows([
    {
      id: "14",
      identity_key: "royal γαλα πληρες 1lt",
      name: "ROYAL Γάλα Μακράς Διάρκειας Πλήρες 1lt",
      category_path: "Γάλα",
      chain_name: "ΑΒ Βασιλόπουλος",
      price: "1.20",
      unit_price_text: "1,20 €/λίτρο",
      observed_at: "2026-11-05",
      image_url: "https://example.test/milk-ab.jpg",
    },
    {
      id: "12",
      identity_key: "royal γαλα πληρες 1lt",
      name: "ROYAL Γάλα Μακράς Διάρκειας Πλήρες 1lt",
      category_path: "Γάλα",
      chain_name: "Χαλκιαδάκης",
      logo_url: "https://api.posokanei.gov.gr/images/retailer/xalkiadakis",
      price: "1.10",
      unit_price_text: "1,10 €/λίτρο",
      observed_at: "2026-11-05",
      image_url: "https://example.test/milk-xalk.jpg",
    },
    {
      id: "18",
      identity_key: "royal γαλα ελαφρυ 1lt",
      name: "ROYAL Γάλα Μακράς Διάρκειας Ελαφρύ 1lt",
      category_path: "Γάλα",
      chain_name: "Χαλκιαδάκης",
      price: "1.05",
      unit_price_text: "1,05 €/λίτρο",
      observed_at: "2026-11-05",
    },
  ]);

  assert.equal(products.length, 2);
  assert.deepEqual(products[0].offers.map((offer) => offer.id), [12, 14]);
  assert.equal(products[0].lowest_price, 1.1);
  assert.equal(products[0].offer_count, 2);
  assert.equal(products[0].image_url, "https://example.test/milk-xalk.jpg");
  assert.equal(products[0].offers[0].image_url, "https://example.test/milk-xalk.jpg");
  assert.equal(products[0].offers[0].logo_url, "https://api.posokanei.gov.gr/images/retailer/xalkiadakis");
  assert.equal(products[0].offers[0].chain_logo_url, "https://api.posokanei.gov.gr/images/retailer/xalkiadakis");
  assert.equal(products[0].offers[1].logo_url, null);
  assert.equal(products[1].offers.length, 1);
});

test("ignores the empty row returned for an out-of-range product page", () => {
  assert.deepEqual(groupProductRows([{ id: null, identity_key: null }]), []);
});

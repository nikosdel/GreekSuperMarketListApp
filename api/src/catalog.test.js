import assert from "node:assert/strict";
import test from "node:test";
import { categoryFiltersClause, groupProductRows } from "./catalog.js";

test("combines multi-selected categories with any selected subcategory", () => {
  const params = [];
  const clause = categoryFiltersClause(
    ["Dairy", "Fruit"],
    ["Dairy > Milk", "Fruit > Apples"],
    params,
  );

  assert.equal(
    clause,
    "((product.category_path = $1 OR product.category_path LIKE $2 ESCAPE '\\') OR (product.category_path = $3 OR product.category_path LIKE $4 ESCAPE '\\')) AND ((product.category_path = $5 OR product.category_path LIKE $6 ESCAPE '\\') OR (product.category_path = $7 OR product.category_path LIKE $8 ESCAPE '\\'))",
  );
  assert.deepEqual(params, [
    "Dairy", "Dairy > %", "Fruit", "Fruit > %",
    "Dairy > Milk", "Dairy > Milk > %", "Fruit > Apples", "Fruit > Apples > %",
  ]);
});

test("omits unselected category dimensions", () => {
  const params = [];

  assert.equal(categoryFiltersClause([], [], params), "TRUE");
  assert.equal(categoryFiltersClause(["Dairy"], [], params), "((product.category_path = $1 OR product.category_path LIKE $2 ESCAPE '\\'))");
  assert.deepEqual(params, ["Dairy", "Dairy > %"]);
});

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

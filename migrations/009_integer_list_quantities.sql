UPDATE shopping_list_item
SET quantity = round(quantity)
WHERE quantity <> trunc(quantity);

ALTER TABLE shopping_list_item
    ADD CONSTRAINT shopping_list_item_quantity_integer_check
    CHECK (quantity = trunc(quantity) AND quantity BETWEEN 1 AND 9999);

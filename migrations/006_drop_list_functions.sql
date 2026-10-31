-- Accounts and lists stay as tables.
-- Registration, sharing, and last-save will live in the application backend.
DROP TRIGGER IF EXISTS shopping_list_lock ON shopping_list;
DROP TRIGGER IF EXISTS shopping_list_member_lock ON shopping_list_member;
DROP TRIGGER IF EXISTS shopping_list_item_lock ON shopping_list_item;

DROP FUNCTION IF EXISTS reject_saved_list_change();
DROP FUNCTION IF EXISTS reject_saved_list_child_change();
DROP FUNCTION IF EXISTS register_user(text, text, text);
DROP FUNCTION IF EXISTS authenticate_user(text, text);
DROP FUNCTION IF EXISTS create_shopping_list(bigint, text);
DROP FUNCTION IF EXISTS join_shopping_list(bigint, text);
DROP FUNCTION IF EXISTS add_list_product(bigint, bigint, bigint, numeric);
DROP FUNCTION IF EXISTS save_shopping_list(bigint, bigint);

DROP EXTENSION IF EXISTS pgcrypto;

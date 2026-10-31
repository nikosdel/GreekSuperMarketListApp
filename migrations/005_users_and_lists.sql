-- Accounts and shared shopping lists.
-- Passwords are stored as bcrypt hashes (pgcrypto). The database cannot
-- turn a hash back into the password.
-- A list item points at a catalog product. History keeps the short product
-- name and the price at save time. It does not copy descriptions or images.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE app_user (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    display_name  TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT app_user_email_shape CHECK (
        email = lower(email)
        AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    ),
    CONSTRAINT app_user_display_name_length CHECK (char_length(display_name) BETWEEN 1 AND 80),
    CONSTRAINT app_user_password_hash_bcrypt CHECK (
        password_hash ~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$'
    )
);

CREATE TABLE shopping_list (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title       TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'saved')),
    created_by  BIGINT NOT NULL REFERENCES app_user (id),
    invite_code TEXT UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    saved_at    TIMESTAMPTZ,
    saved_by    BIGINT REFERENCES app_user (id),
    CONSTRAINT shopping_list_title_length CHECK (char_length(title) BETWEEN 1 AND 120),
    CONSTRAINT shopping_list_saved_fields CHECK (
        (status = 'open' AND saved_at IS NULL AND saved_by IS NULL AND invite_code IS NOT NULL)
        OR
        (status = 'saved' AND saved_at IS NOT NULL AND saved_by IS NOT NULL AND invite_code IS NULL)
    )
);

CREATE TABLE shopping_list_member (
    list_id   BIGINT NOT NULL REFERENCES shopping_list (id) ON DELETE CASCADE,
    user_id   BIGINT NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    role      TEXT NOT NULL CHECK (role IN ('owner', 'editor')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (list_id, user_id)
);

CREATE INDEX shopping_list_member_user_idx ON shopping_list_member (user_id);

CREATE TABLE shopping_list_item (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    list_id            BIGINT NOT NULL REFERENCES shopping_list (id) ON DELETE CASCADE,
    product_id         BIGINT REFERENCES product (id) ON DELETE SET NULL,
    quantity           NUMERIC(12, 3) NOT NULL CHECK (quantity > 0),
    added_by           BIGINT REFERENCES app_user (id) ON DELETE SET NULL,
    product_name       TEXT NOT NULL,
    chain_name         TEXT NOT NULL,
    price_at_save      NUMERIC(12, 2),
    unit_price_at_save NUMERIC(12, 4),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (list_id, product_id)
);

CREATE INDEX shopping_list_item_list_idx ON shopping_list_item (list_id);

CREATE FUNCTION reject_saved_list_change()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'saved' THEN
            RAISE EXCEPTION 'saved lists are history and cannot be deleted';
        END IF;
        RETURN OLD;
    END IF;
    IF OLD.status = 'saved' THEN
        RAISE EXCEPTION 'saved lists are history and cannot be changed';
    END IF;
    RETURN NEW;
END;
$fn$;

CREATE TRIGGER shopping_list_lock
BEFORE UPDATE OR DELETE ON shopping_list
FOR EACH ROW
EXECUTE FUNCTION reject_saved_list_change();

CREATE FUNCTION reject_saved_list_child_change()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
    parent_id bigint;
    parent_status text;
BEGIN
    parent_id := COALESCE(NEW.list_id, OLD.list_id);
    SELECT status INTO parent_status FROM shopping_list WHERE id = parent_id;
    IF parent_status = 'saved' THEN
        RAISE EXCEPTION 'saved lists are history and cannot be changed';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$fn$;

CREATE TRIGGER shopping_list_member_lock
BEFORE INSERT OR UPDATE OR DELETE ON shopping_list_member
FOR EACH ROW
EXECUTE FUNCTION reject_saved_list_child_change();

CREATE TRIGGER shopping_list_item_lock
BEFORE INSERT OR UPDATE OR DELETE ON shopping_list_item
FOR EACH ROW
EXECUTE FUNCTION reject_saved_list_child_change();

CREATE FUNCTION register_user(p_email text, p_display_name text, p_password text)
RETURNS bigint
LANGUAGE plpgsql
AS $fn$
DECLARE
    new_id bigint;
    clean_email text;
    clean_name text;
BEGIN
    clean_email := lower(trim(p_email));
    clean_name := trim(p_display_name);
    IF clean_name IS NULL OR char_length(clean_name) < 1 OR char_length(clean_name) > 80 THEN
        RAISE EXCEPTION 'display name must be 1 to 80 characters';
    END IF;
    IF p_password IS NULL OR char_length(p_password) < 8 OR char_length(p_password) > 200 THEN
        RAISE EXCEPTION 'password must be 8 to 200 characters';
    END IF;
    INSERT INTO app_user (email, display_name, password_hash)
    VALUES (clean_email, clean_name, crypt(p_password, gen_salt('bf', 12)))
    RETURNING id INTO new_id;
    RETURN new_id;
END;
$fn$;

CREATE FUNCTION authenticate_user(p_email text, p_password text)
RETURNS bigint
LANGUAGE sql
STABLE
AS $fn$
    SELECT id
    FROM app_user
    WHERE email = lower(trim(p_email))
      AND password_hash = crypt(p_password, password_hash);
$fn$;

CREATE FUNCTION create_shopping_list(p_user_id bigint, p_title text)
RETURNS TABLE (new_list_id bigint, new_invite_code text)
LANGUAGE plpgsql
AS $fn$
DECLARE
    clean_title text;
    code text;
    created_id bigint;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM app_user WHERE id = p_user_id) THEN
        RAISE EXCEPTION 'user not found';
    END IF;
    clean_title := trim(p_title);
    IF clean_title IS NULL OR char_length(clean_title) < 1 OR char_length(clean_title) > 120 THEN
        RAISE EXCEPTION 'list title must be 1 to 120 characters';
    END IF;
    LOOP
        code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
        EXIT WHEN NOT EXISTS (
            SELECT 1 FROM shopping_list WHERE shopping_list.invite_code = code
        );
    END LOOP;
    INSERT INTO shopping_list (title, created_by, invite_code)
    VALUES (clean_title, p_user_id, code)
    RETURNING id INTO created_id;
    INSERT INTO shopping_list_member (list_id, user_id, role)
    VALUES (created_id, p_user_id, 'owner');
    new_list_id := created_id;
    new_invite_code := code;
    RETURN NEXT;
END;
$fn$;

CREATE FUNCTION join_shopping_list(p_user_id bigint, p_invite_code text)
RETURNS bigint
LANGUAGE plpgsql
AS $fn$
DECLARE
    found_id bigint;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM app_user WHERE id = p_user_id) THEN
        RAISE EXCEPTION 'user not found';
    END IF;
    SELECT id INTO found_id
    FROM shopping_list
    WHERE invite_code = trim(p_invite_code)
      AND status = 'open';
    IF found_id IS NULL THEN
        RAISE EXCEPTION 'invite code is not valid';
    END IF;
    INSERT INTO shopping_list_member (list_id, user_id, role)
    VALUES (found_id, p_user_id, 'editor')
    ON CONFLICT (list_id, user_id) DO NOTHING;
    RETURN found_id;
END;
$fn$;

CREATE FUNCTION add_list_product(
    p_user_id bigint,
    p_list_id bigint,
    p_product_id bigint,
    p_quantity numeric
)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
    prod_name text;
    shop_name text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM shopping_list_member
        WHERE list_id = p_list_id AND user_id = p_user_id
    ) THEN
        RAISE EXCEPTION 'not a member of this list';
    END IF;
    IF (SELECT status FROM shopping_list WHERE id = p_list_id) IS DISTINCT FROM 'open' THEN
        RAISE EXCEPTION 'this list is already saved';
    END IF;
    IF p_quantity IS NULL OR p_quantity <= 0 THEN
        RAISE EXCEPTION 'quantity must be greater than zero';
    END IF;
    SELECT p.name, ch.name INTO prod_name, shop_name
    FROM product p
    JOIN chain ch ON ch.id = p.chain_id
    WHERE p.id = p_product_id;
    IF prod_name IS NULL THEN
        RAISE EXCEPTION 'product not found';
    END IF;
    INSERT INTO shopping_list_item (
        list_id, product_id, quantity, added_by, product_name, chain_name
    )
    VALUES (p_list_id, p_product_id, p_quantity, p_user_id, prod_name, shop_name)
    ON CONFLICT (list_id, product_id) DO UPDATE
        SET quantity = shopping_list_item.quantity + EXCLUDED.quantity,
            updated_at = now();
END;
$fn$;

CREATE FUNCTION save_shopping_list(p_user_id bigint, p_list_id bigint)
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM shopping_list_member
        WHERE list_id = p_list_id AND user_id = p_user_id
    ) THEN
        RAISE EXCEPTION 'not a member of this list';
    END IF;
    IF (SELECT status FROM shopping_list WHERE id = p_list_id) IS DISTINCT FROM 'open' THEN
        RAISE EXCEPTION 'this list is already saved';
    END IF;
    UPDATE shopping_list_item AS item
    SET product_name = product.name,
        chain_name = chain.name,
        price_at_save = current_price.price,
        unit_price_at_save = current_price.unit_price,
        updated_at = now()
    FROM product
    JOIN chain ON chain.id = product.chain_id
    LEFT JOIN current_price ON current_price.product_id = product.id
    WHERE item.list_id = p_list_id
      AND item.product_id = product.id;
    UPDATE shopping_list
    SET status = 'saved',
        saved_at = now(),
        saved_by = p_user_id,
        invite_code = NULL
    WHERE id = p_list_id;
END;
$fn$;

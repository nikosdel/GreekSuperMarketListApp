ALTER TABLE list_notification
    DROP CONSTRAINT IF EXISTS list_notification_kind_check;

ALTER TABLE list_notification
    ADD CONSTRAINT list_notification_kind_check
    CHECK (kind IN (
        'item_added',
        'item_updated',
        'item_removed',
        'list_saved',
        'member_joined',
        'member_removed'
    ));

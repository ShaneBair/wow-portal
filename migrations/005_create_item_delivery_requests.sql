-- Run this migration while connected to the schema configured by
-- PORTAL_STATE_DATABASE. The portal never runs schema migrations itself.
CREATE TABLE IF NOT EXISTS item_delivery_requests (
    request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    boost_key VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    account_id INT UNSIGNED NOT NULL,
    character_guid INT UNSIGNED NOT NULL,
    character_name VARCHAR(12) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    item_entry INT UNSIGNED NOT NULL,
    item_name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
    item_quantity INT UNSIGNED NOT NULL,
    item_stack_size INT UNSIGNED NOT NULL,
    status ENUM('pending', 'sent', 'failed', 'unknown') NOT NULL,
    result_category VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    completed_at DATETIME(3) NULL,
    PRIMARY KEY (request_id),
    KEY ix_item_delivery_requests_account (account_id, created_at),
    KEY ix_item_delivery_requests_pending (status, created_at),
    CONSTRAINT ck_item_delivery_boost_key CHECK (boost_key = 'item-delivery-v1'),
    CONSTRAINT ck_item_delivery_quantity CHECK (item_quantity > 0),
    CONSTRAINT ck_item_delivery_stack_size CHECK (item_stack_size > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

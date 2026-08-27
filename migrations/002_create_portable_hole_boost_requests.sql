-- Run this migration while connected to the schema configured by
-- PORTAL_STATE_DATABASE. The portal never runs schema migrations itself.
CREATE TABLE IF NOT EXISTS portable_hole_boost_requests (
    request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    boost_key VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    account_id INT UNSIGNED NOT NULL,
    character_guid INT UNSIGNED NOT NULL,
    character_name VARCHAR(12) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    item_entry INT UNSIGNED NOT NULL,
    item_count TINYINT UNSIGNED NOT NULL,
    status ENUM('pending', 'sent', 'failed', 'unknown') NOT NULL,
    result_category VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    completed_at DATETIME(3) NULL,
    PRIMARY KEY (request_id),
    KEY ix_portable_hole_boost_requests_account (account_id, created_at),
    KEY ix_portable_hole_boost_requests_pending (status, created_at),
    CONSTRAINT ck_portable_hole_boost_key CHECK (boost_key = 'portable-holes-v1'),
    CONSTRAINT ck_portable_hole_item_entry CHECK (item_entry = 51809),
    CONSTRAINT ck_portable_hole_item_count CHECK (item_count = 4)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

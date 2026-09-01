-- Run this migration while connected to the schema configured by
-- PORTAL_STATE_DATABASE. The portal never runs schema migrations itself.
CREATE TABLE IF NOT EXISTS character_level_boost_requests (
    request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    boost_key VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    account_id INT UNSIGNED NOT NULL,
    character_guid INT UNSIGNED NOT NULL,
    character_name VARCHAR(12) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    starting_level TINYINT UNSIGNED NOT NULL,
    target_level TINYINT UNSIGNED NOT NULL,
    resulting_level TINYINT UNSIGNED NULL,
    status ENUM('pending', 'applied', 'failed', 'unknown') NOT NULL,
    result_category VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    completed_at DATETIME(3) NULL,
    PRIMARY KEY (request_id),
    KEY ix_character_level_boost_account (account_id, created_at),
    KEY ix_character_level_boost_character (character_guid, created_at),
    KEY ix_character_level_boost_pending (status, created_at),
    CONSTRAINT ck_character_level_boost_key CHECK (boost_key = 'character-level-raise-v1'),
    CONSTRAINT ck_character_level_start CHECK (starting_level BETWEEN 1 AND 79),
    CONSTRAINT ck_character_level_target CHECK (target_level BETWEEN 2 AND 80),
    CONSTRAINT ck_character_level_raise CHECK (target_level > starting_level),
    CONSTRAINT ck_character_level_result CHECK (resulting_level IS NULL OR resulting_level BETWEEN 1 AND 80)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

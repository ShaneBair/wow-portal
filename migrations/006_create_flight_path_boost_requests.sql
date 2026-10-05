-- Run while connected to PORTAL_STATE_DATABASE. The portal never runs migrations itself.
CREATE TABLE IF NOT EXISTS flight_path_boost_requests (
    request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    boost_key VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    account_id INT UNSIGNED NOT NULL,
    character_guid INT UNSIGNED NOT NULL,
    character_name VARCHAR(12) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    faction ENUM('alliance', 'horde') NOT NULL,
    class_id TINYINT UNSIGNED NOT NULL,
    mask_revision VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    result ENUM('learned', 'already-known') NULL,
    status ENUM('pending', 'applied', 'failed') NOT NULL,
    result_category VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    completed_at DATETIME(3) NULL,
    PRIMARY KEY (request_id),
    KEY ix_flight_path_requests_account (account_id, created_at),
    KEY ix_flight_path_requests_pending (status, created_at),
    CONSTRAINT ck_flight_path_boost_key CHECK (boost_key = 'flight-paths-v1'),
    CONSTRAINT ck_flight_path_applied_result CHECK (
      (status = 'applied' AND result IS NOT NULL AND completed_at IS NOT NULL)
      OR (status <> 'applied' AND result IS NULL)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

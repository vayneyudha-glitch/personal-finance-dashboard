-- ============================================================
--  MIGRATION V3 — Phone Verification & Security Enhancements
--  MySQL compatible (works with MySQL 5.7+ and Aiven)
--
--  This migration ADDS columns to the existing users table.
--  It does NOT drop or modify existing data.
--  Backward compatible — all new columns have defaults.
--
--  Run:  mysql -u root -p < migration_v3.sql
--  Or:   cd backend && npm run seed  (auto-runs)
-- ============================================================

USE personal_finance;

-- ============================================================
--  ALTER users table: Add phone verification columns
--  Uses procedure to check if column exists before adding
-- ============================================================
DROP PROCEDURE IF EXISTS add_column_if_missing;
DELIMITER //
CREATE PROCEDURE add_column_if_missing(
    IN p_table VARCHAR(64),
    IN p_column VARCHAR(64),
    IN p_definition VARCHAR(500)
)
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE table_schema = DATABASE()
          AND table_name = p_table
          AND column_name = p_column
    ) THEN
        SET @sql = CONCAT('ALTER TABLE ', p_table, ' ADD COLUMN ', p_column, ' ', p_definition);
        PREPARE stmt FROM @sql;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END //
DELIMITER ;

CALL add_column_if_missing('users', 'phone_verified', 'TINYINT(1) NOT NULL DEFAULT 0');
CALL add_column_if_missing('users', 'phone_verification_code', 'VARCHAR(255) DEFAULT NULL');
CALL add_column_if_missing('users', 'phone_verification_expires_at', 'TIMESTAMP NULL DEFAULT NULL');
CALL add_column_if_missing('users', 'phone_verification_attempts', 'INT NOT NULL DEFAULT 0');
CALL add_column_if_missing('users', 'phone_verification_last_sent_at', 'TIMESTAMP NULL DEFAULT NULL');

DROP PROCEDURE IF EXISTS add_column_if_missing;

-- ============================================================
--  Mark existing users (including admin) as phone_verified=1
-- ============================================================
UPDATE users SET phone_verified = 1 WHERE phone_verified = 0;

-- ============================================================
--  Index for faster phone verification lookups
-- ============================================================
DROP PROCEDURE IF EXISTS add_index_if_missing;
DELIMITER //
CREATE PROCEDURE add_index_if_missing(
    IN p_table VARCHAR(64),
    IN p_index VARCHAR(64),
    IN p_cols VARCHAR(255)
)
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.STATISTICS
        WHERE table_schema = DATABASE()
          AND table_name = p_table
          AND index_name = p_index
    ) THEN
        SET @sql = CONCAT('CREATE INDEX ', p_index, ' ON ', p_table, ' (', p_cols, ')');
        PREPARE stmt FROM @sql;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END //
DELIMITER ;

CALL add_index_if_missing('users', 'idx_phone_verified', 'phone_verified');

DROP PROCEDURE IF EXISTS add_index_if_missing;

-- ============================================================
--  Table: token_blacklist — for JWT invalidation on logout
-- ============================================================
CREATE TABLE IF NOT EXISTS token_blacklist (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    token           VARCHAR(500) NOT NULL,
    user_id         INT,
    expires_at      TIMESTAMP NOT NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_token (token(255)),
    INDEX idx_expires (expires_at)
) ENGINE=InnoDB;

-- ============================================================
--  Table: otp_attempts — track OTP send/verify rate limiting
-- ============================================================
CREATE TABLE IF NOT EXISTS otp_attempts (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    phone_number    VARCHAR(20) NOT NULL,
    attempt_type    ENUM('send','verify') NOT NULL,
    ip_address      VARCHAR(45),
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_phone (phone_number),
    INDEX idx_ip (ip_address),
    INDEX idx_created (created_at)
) ENGINE=InnoDB;

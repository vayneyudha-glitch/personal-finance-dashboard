-- ============================================================
--  MIGRATION V2 — Analytics Platform Upgrade
--  Adds: budgets, alerts, system_settings tables
--  Non-breaking: existing tables/data untouched
--  Run: mysql -u root -p personal_finance < migration_v2.sql
--  Or: included automatically in seed.js
-- ============================================================

USE personal_finance;

-- ============================================================
--  TABLE: budgets
-- ============================================================
CREATE TABLE IF NOT EXISTS budgets (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    user_id         INT NOT NULL,
    category_id     INT,
    amount          DECIMAL(15,2) NOT NULL,
    period          ENUM('monthly','weekly','yearly') NOT NULL DEFAULT 'monthly',
    start_date      DATE NOT NULL,
    end_date        DATE,
    status          ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
    INDEX idx_budget_user (user_id),
    INDEX idx_budget_category (category_id),
    INDEX idx_budget_period (period),
    INDEX idx_budget_dates (start_date, end_date)
) ENGINE=InnoDB;

-- ============================================================
--  TABLE: alerts
-- ============================================================
CREATE TABLE IF NOT EXISTS alerts (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    user_id         INT,
    type            VARCHAR(50) NOT NULL,
    severity        ENUM('INFO','WARNING','CRITICAL') NOT NULL DEFAULT 'INFO',
    title           VARCHAR(200) NOT NULL,
    message         VARCHAR(500) NOT NULL,
    is_read         BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_alert_user (user_id),
    INDEX idx_alert_type (type),
    INDEX idx_alert_read (is_read),
    INDEX idx_alert_created (created_at)
) ENGINE=InnoDB;

-- ============================================================
--  TABLE: system_settings
-- ============================================================
CREATE TABLE IF NOT EXISTS system_settings (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    setting_key     VARCHAR(100) NOT NULL UNIQUE,
    setting_value   VARCHAR(500),
    description     VARCHAR(300),
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_setting_key (setting_key)
) ENGINE=InnoDB;

-- Default system settings
INSERT IGNORE INTO system_settings (setting_key, setting_value, description) VALUES
    ('currency', 'IDR', 'Default currency code'),
    ('date_format', 'DD/MM/YYYY', 'Date display format'),
    ('timezone', 'Asia/Jakarta', 'System timezone'),
    ('pagination_default', '10', 'Default items per page'),
    ('transaction_min_amount', '1', 'Minimum transaction amount'),
    ('transaction_max_amount', '1000000000', 'Maximum transaction amount'),
    ('budget_warning_threshold', '70', 'Budget warning threshold percentage'),
    ('budget_critical_threshold', '90', 'Budget critical threshold percentage'),
    ('large_transaction_threshold', '5000000', 'Large transaction alert threshold'),
    ('max_login_attempts', '5', 'Max failed login attempts before lockout');

-- ============================================================
--  ADDITIONAL INDEXES for performance (non-breaking)
--  Note: MySQL < 8.0.29 doesn't support "CREATE INDEX IF NOT EXISTS"
--  so we wrap in procedures that check first.
-- ============================================================
DROP PROCEDURE IF EXISTS add_index_if_missing;
DELIMITER //
CREATE PROCEDURE add_index_if_exists(IN p_table VARCHAR(64), IN p_index VARCHAR(64), IN p_cols VARCHAR(255))
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

CALL add_index_if_exists('transactions', 'idx_trx_amount', 'amount');
CALL add_index_if_exists('transactions', 'idx_trx_created', 'created_at');
CALL add_index_if_exists('transactions', 'idx_trx_composite', 'user_id, type, transaction_date');
CALL add_index_if_exists('users', 'idx_user_created', 'created_at');
CALL add_index_if_exists('activity_logs', 'idx_log_user_action', 'user_id, action');

DROP PROCEDURE IF EXISTS add_index_if_exists;

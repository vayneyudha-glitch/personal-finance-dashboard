-- ============================================================
--  DATABASE SCHEMA — Personal Finance Management System
--  MySQL 8.0+
--
--  Run manually:  mysql -u root -p < schema.sql
--  Or via seed:   cd backend && npm run seed
-- ============================================================

CREATE DATABASE IF NOT EXISTS personal_finance
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE personal_finance;

-- ============================================================
--  TABLE: users
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id                              INT AUTO_INCREMENT PRIMARY KEY,
    name                            VARCHAR(100) NOT NULL,
    email                           VARCHAR(255) NOT NULL,
    phone                           VARCHAR(20),
    password_hash                   VARCHAR(255) NOT NULL,
    role                            ENUM('ADMIN','USER') NOT NULL DEFAULT 'USER',
    status                          ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    phone_verified                  TINYINT(1) NOT NULL DEFAULT 0,
    phone_verification_code         VARCHAR(255) DEFAULT NULL,
    phone_verification_expires_at   TIMESTAMP NULL DEFAULT NULL,
    phone_verification_attempts     INT NOT NULL DEFAULT 0,
    phone_verification_last_sent_at TIMESTAMP NULL DEFAULT NULL,
    created_at                      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at                      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_email (email),
    UNIQUE KEY uk_phone (phone),
    INDEX idx_role (role),
    INDEX idx_status (status),
    INDEX idx_phone_verified (phone_verified)
) ENGINE=InnoDB;

-- ============================================================
--  TABLE: categories
-- ============================================================
CREATE TABLE IF NOT EXISTS categories (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    name            VARCHAR(50) NOT NULL,
    type            ENUM('Income','Expense') NOT NULL,
    description     VARCHAR(200),
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_type_name (type, name),
    INDEX idx_type (type)
) ENGINE=InnoDB;

-- ============================================================
--  TABLE: transactions
-- ============================================================
CREATE TABLE IF NOT EXISTS transactions (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    user_id             INT NOT NULL,
    category_id         INT NOT NULL,
    type                ENUM('Income','Expense') NOT NULL,
    amount              DECIMAL(15,2) NOT NULL,
    description         VARCHAR(200) NOT NULL,
    transaction_date    DATE NOT NULL,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT,
    INDEX idx_user (user_id),
    INDEX idx_category (category_id),
    INDEX idx_type (type),
    INDEX idx_date (transaction_date)
) ENGINE=InnoDB;

-- ============================================================
--  TABLE: activity_logs
-- ============================================================
CREATE TABLE IF NOT EXISTS activity_logs (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    user_id         INT,
    action          VARCHAR(100) NOT NULL,
    description     VARCHAR(500),
    ip_address      VARCHAR(45),
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_user (user_id),
    INDEX idx_action (action),
    INDEX idx_created (created_at)
) ENGINE=InnoDB;

-- ============================================================
--  TABLE: token_blacklist — JWT invalidation on logout
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
--  TABLE: otp_attempts — OTP rate limiting tracking
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

-- ============================================================
--  SEED: Default categories
-- ============================================================
INSERT IGNORE INTO categories (name, type, description) VALUES
    ('Gaji',          'Income',  'Gaji bulanan'),
    ('Bonus',         'Income',  'Bonus tahunan / insentif'),
    ('Investasi',     'Income',  'Return investasi / dividen'),
    ('Freelance',     'Income',  'Pendapatan freelance'),
    ('Lainnya',       'Income',  'Pendapatan lain-lain'),
    ('Makanan',       'Expense', 'Pengeluaran makanan & minuman'),
    ('Transportasi',  'Expense', 'Bensin, tiket, parkir'),
    ('Belanja',       'Expense', 'Pakaian, kebutuhan rumah'),
    ('Tagihan',       'Expense', 'Listrik, air, internet'),
    ('Hiburan',       'Expense', 'Film, game, jalan-jalan'),
    ('Kesehatan',     'Expense', 'Obat, dokter, rumah sakit'),
    ('Pendidikan',    'Expense', 'Buku, kursus, sekolah'),
    ('Lainnya',       'Expense', 'Pengeluaran lain-lain');

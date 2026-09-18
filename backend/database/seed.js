/* ============================================================
   DATABASE/SEED.JS — Database initialization & admin seeder
   ============================================================
   Usage:  cd backend && npm run seed

   This script:
   1. Creates the database and tables (from schema.sql)
   2. Seeds default categories
   3. Creates the primary ADMIN account from .env variables
      - Reads ADMIN_EMAIL and ADMIN_PASSWORD
      - Checks if admin already exists (no duplicates)
      - Hashes password with bcrypt
      - Role = ADMIN
   ============================================================ */

require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

async function initDatabase() {
    console.log('\n========================================');
    console.log('  Personal Finance Management System');
    console.log('  Database Initialization');
    console.log('========================================\n');

    // --- Validate env vars ---
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminEmail) {
        console.error('[ERROR] ADMIN_EMAIL not found in .env');
        console.error('        Set ADMIN_EMAIL=vayneyudha@gmail.com in backend/.env');
        process.exit(1);
    }

    if (!adminPassword) {
        console.error('[ERROR] ADMIN_PASSWORD not found in .env');
        console.error('        Set ADMIN_PASSWORD=<your-secure-password> in backend/.env');
        process.exit(1);
    }

    if (adminPassword.length < 8) {
        console.error('[ERROR] ADMIN_PASSWORD must be at least 8 characters');
        process.exit(1);
    }

    const dbHost = process.env.DB_HOST || 'localhost';
    const dbPort = process.env.DB_PORT || 3306;
    const dbUser = process.env.DB_USER || 'root';
    const dbPassword = process.env.DB_PASSWORD || '';
    const dbName = process.env.DB_NAME || 'personal_finance';

    // --- Step 1: Connect to MySQL (without database) ---
    console.log('[1/5] Connecting to MySQL...');
    let connection;
    try {
        connection = await mysql.createConnection({
            host: dbHost,
            port: parseInt(dbPort),
            user: dbUser,
            password: dbPassword,
            multipleStatements: true
        });
        console.log('      Connected to MySQL server');
    } catch (err) {
        console.error('[ERROR] Cannot connect to MySQL:', err.message);
        console.error('        Make sure MySQL is running and credentials are correct.');
        process.exit(1);
    }

    // --- Step 2: Execute schema.sql ---
    console.log('[2/5] Creating database & tables...');
    try {
        const schemaPath = path.join(__dirname, 'schema.sql');
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');
        await connection.query(schemaSql);
        console.log('      Database & tables created');
    } catch (err) {
        console.error('[ERROR] Schema creation failed:', err.message);
        await connection.end();
        process.exit(1);
    }

    // --- Step 2b: Migration v2 (budgets, alerts, settings, indexes) ---
    // Execute only the CREATE TABLE IF NOT EXISTS parts (safe for re-runs)
    try {
        await connection.query(`USE ${dbName}`);

        // budgets
        await connection.query(`
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
        `);

        // alerts
        await connection.query(`
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
        `);

        // system_settings
        await connection.query(`
            CREATE TABLE IF NOT EXISTS system_settings (
                id              INT AUTO_INCREMENT PRIMARY KEY,
                setting_key     VARCHAR(100) NOT NULL UNIQUE,
                setting_value   VARCHAR(500),
                description     VARCHAR(300),
                updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_setting_key (setting_key)
            ) ENGINE=InnoDB;
        `);

        // Default settings
        await connection.query(`
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
        `);

        // Add indexes if missing
        const indexesToAdd = [
            ['transactions', 'idx_trx_amount', 'amount'],
            ['transactions', 'idx_trx_created', 'created_at'],
            ['transactions', 'idx_trx_composite', 'user_id, type, transaction_date'],
            ['users', 'idx_user_created', 'created_at'],
            ['activity_logs', 'idx_log_user_action', 'user_id, action']
        ];

        for (const [table, indexName, cols] of indexesToAdd) {
            const [idxExists] = await connection.query(
                `SELECT 1 FROM information_schema.STATISTICS WHERE table_schema = ? AND table_name = ? AND index_name = ?`,
                [dbName, table, indexName]
            );
            if (idxExists.length === 0) {
                try {
                    await connection.query(`CREATE INDEX ${indexName} ON ${dbName}.${table} (${cols})`);
                } catch (e) { /* index might already exist */
                }
            }
        }

        console.log('      Migration v2 (budgets, alerts, settings) applied');
    } catch (err) {
        console.error('[WARNING] Migration v2 skipped:', err.message);
    }

    // --- Step 2c: Migration v4 (phone verification, OTP, token blacklist) ---
    try {
        // Add columns if missing
        const columnsToAdd = [
            ['phone_verified', 'TINYINT(1) NOT NULL DEFAULT 0'],
            ['phone_verification_code', 'VARCHAR(255) DEFAULT NULL'],
            ['phone_verification_expires_at', 'TIMESTAMP NULL DEFAULT NULL'],
            ['phone_verification_attempts', 'INT NOT NULL DEFAULT 0'],
            ['phone_verification_last_sent_at', 'TIMESTAMP NULL DEFAULT NULL']
        ];

        for (const [colName, colDef] of columnsToAdd) {
            const [colExists] = await connection.query(
                `SELECT 1 FROM information_schema.COLUMNS WHERE table_schema = ? AND table_name = 'users' AND column_name = ?`,
                [dbName, colName]
            );
            if (colExists.length === 0) {
                try {
                    await connection.query(`ALTER TABLE ${dbName}.users ADD COLUMN ${colName} ${colDef}`);
                } catch (e) { /* column might already exist */ }
            }
        }

        // Mark existing users as phone_verified=1
        await connection.query(`UPDATE ${dbName}.users SET phone_verified = 1 WHERE phone_verified = 0`);

        // Add index if missing
        const [idxExists] = await connection.query(
            `SELECT 1 FROM information_schema.STATISTICS WHERE table_schema = ? AND table_name = 'users' AND index_name = 'idx_phone_verified'`,
            [dbName]
        );
        if (idxExists.length === 0) {
            try {
                await connection.query(`CREATE INDEX idx_phone_verified ON ${dbName}.users (phone_verified)`);
            } catch (e) { /* index might already exist */ }
        }

        // token_blacklist table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS ${dbName}.token_blacklist (
                id              INT AUTO_INCREMENT PRIMARY KEY,
                token           VARCHAR(500) NOT NULL,
                user_id         INT,
                expires_at      TIMESTAMP NOT NULL,
                created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                INDEX idx_token (token(255)),
                INDEX idx_expires (expires_at)
            ) ENGINE=InnoDB;
        `);

        // otp_attempts table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS ${dbName}.otp_attempts (
                id              INT AUTO_INCREMENT PRIMARY KEY,
                phone_number    VARCHAR(20) NOT NULL,
                attempt_type    ENUM('send','verify') NOT NULL,
                ip_address      VARCHAR(45),
                created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_phone (phone_number),
                INDEX idx_ip (ip_address),
                INDEX idx_created (created_at)
            ) ENGINE=InnoDB;
        `);

        // Clean up
        await connection.query(`DELETE FROM ${dbName}.otp_attempts WHERE created_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)`);
        await connection.query(`DELETE FROM ${dbName}.token_blacklist WHERE expires_at <= NOW()`);

        console.log('      Migration v4 (phone verification, OTP, token blacklist) applied');
    } catch (err) {
        console.error('[WARNING] Migration v4 skipped:', err.message);
    }

    // --- Step 3: Verify categories ---
    console.log('[3/5] Verifying default categories...');
    try {
        const [cats] = await connection.query(
            `SELECT COUNT(*) as count FROM ${dbName}.categories`
        );
        console.log(`      ${cats[0].count} categories available`);
    } catch (err) {
        console.error('[ERROR] Category check failed:', err.message);
    }

    // --- Step 4: Create primary admin account ---
    console.log('[4/5] Creating primary admin account...');
    const cleanEmail = adminEmail.toLowerCase().trim();

    try {
        const [existing] = await connection.query(
            `SELECT id, email, role FROM ${dbName}.users WHERE email = ?`,
            [cleanEmail]
        );

        if (existing.length === 0) {
            // Hash password with bcrypt
            const hashedPassword = await bcrypt.hash(adminPassword, 10);

            await connection.query(
                `INSERT INTO ${dbName}.users (name, email, phone, password_hash, role, status, phone_verified)
                 VALUES (?, ?, NULL, ?, 'ADMIN', 'ACTIVE', 1)`,
                ['Administrator', cleanEmail, hashedPassword]
            );

            console.log('      Primary admin created:');
            console.log(`        Email: ${cleanEmail}`);
            console.log('        Role: ADMIN');
            console.log('        Status: ACTIVE');
        } else {
            console.log('      Admin account already exists, skipping:');
            console.log(`        Email: ${existing[0].email}`);
            console.log(`        Role: ${existing[0].role}`);
        }
    } catch (err) {
        console.error('[ERROR] Admin creation failed:', err.message);
        await connection.end();
        process.exit(1);
    }

    // --- Step 5: Verify ---
    console.log('[5/5] Verification...');
    try {
        const [users] = await connection.query(
            `SELECT id, name, email, role, status FROM ${dbName}.users ORDER BY id`
        );
        const [cats] = await connection.query(
            `SELECT COUNT(*) as count FROM ${dbName}.categories`
        );

        console.log(`\n  Users: ${users.length}`);
        users.forEach(u => {
            console.log(`    - [${u.role}] ${u.email} (status: ${u.status})`);
        });
        console.log(`  Categories: ${cats[0].count}`);
    } catch (err) {
        console.error('[ERROR] Verification failed:', err.message);
    }

    console.log('\n========================================');
    console.log('  Database initialized successfully!');
    console.log('========================================');
    console.log('\n  Admin login:');
    console.log(`    Email:    ${cleanEmail}`);
    console.log('    Password: (from .env ADMIN_PASSWORD)');
    console.log('\n  Next: Start the server with `npm run dev`\n');

    await connection.end();
    process.exit(0);
}

initDatabase().catch(err => {
    console.error('\n[FATAL ERROR]', err.message);
    process.exit(1);
});

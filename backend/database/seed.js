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

    // --- Step 2b: Execute migration_v2.sql (analytics upgrade) ---
    try {
        const migrationPath = path.join(__dirname, 'migration_v2.sql');
        if (fs.existsSync(migrationPath)) {
            const migrationSql = fs.readFileSync(migrationPath, 'utf8');
            await connection.query(migrationSql);
            console.log('      Migration v2 (budgets, alerts, settings) applied');
        }
    } catch (err) {
        console.error('[WARNING] Migration v2 skipped:', err.message);
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
                `INSERT INTO ${dbName}.users (name, email, phone, password_hash, role, status)
                 VALUES (?, ?, NULL, ?, 'ADMIN', 'ACTIVE')`,
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

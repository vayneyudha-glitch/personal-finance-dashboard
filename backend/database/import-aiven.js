require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

async function importAiven() {
    console.log('\n========================================');
    console.log('  AIVEN DATABASE IMPORT');
    console.log('========================================\n');

    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        multipleStatements: true,
        ssl: {
            rejectUnauthorized: false
        }
    });

    console.log(`[1/5] Connected to: ${process.env.DB_NAME}`);

    console.log('[2/5] Importing schema_aiven.sql...');

    const schemaPath = path.join(__dirname, 'schema_aiven.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    await connection.query(schemaSql);

    console.log('      Main tables created.');

    console.log('[3/5] Importing migration_aiven.sql...');

    const migrationPath = path.join(__dirname, 'migration_aiven.sql');

    if (fs.existsSync(migrationPath)) {
        const migrationSql = fs.readFileSync(migrationPath, 'utf8');

        const statements = migrationSql
            .split(';')
            .map(sql => sql.trim())
            .filter(sql => sql.length > 0);

        try {
            for (const statement of statements) {
                await connection.query(statement);
            }

            console.log('      Migration v2 applied.');
        } catch (err) {
            console.log('      Migration warning:', err.message);
        }
    }

    console.log('[4/5] Creating/checking admin account...');

    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminEmail || !adminPassword) {
        throw new Error('ADMIN_EMAIL atau ADMIN_PASSWORD belum tersedia di .env');
    }

    const cleanEmail = adminEmail.toLowerCase().trim();

    const [existing] = await connection.query(
        'SELECT id, email, role FROM users WHERE email = ?',
        [cleanEmail]
    );

    if (existing.length === 0) {
        const hashedPassword = await bcrypt.hash(adminPassword, 10);

        await connection.query(
            `INSERT INTO users
            (name, email, phone, password_hash, role, status)
            VALUES (?, ?, NULL, ?, 'ADMIN', 'ACTIVE')`,
            ['Administrator', cleanEmail, hashedPassword]
        );

        console.log(`      Admin created: ${cleanEmail}`);
    } else {
        console.log(`      Admin already exists: ${existing[0].email}`);
    }

    console.log('[5/5] Verification...');

    const [tables] = await connection.query('SHOW TABLES');

    console.log('\nTables in Aiven:');

    tables.forEach(table => {
        console.log(`   ${Object.values(table)[0]}`);
    });

    const [users] = await connection.query(
        'SELECT id, name, email, role, status FROM users'
    );

    const [categories] = await connection.query(
        'SELECT COUNT(*) AS count FROM categories'
    );

    console.log(`\nUsers: ${users.length}`);
    console.log(`Categories: ${categories[0].count}`);

    console.log('\n========================================');
    console.log('  AIVEN IMPORT SUCCESSFUL!');
    console.log('========================================\n');

    await connection.end();
}

importAiven().catch(err => {
    console.error('\n[ERROR]', err.message);
    process.exit(1);
});

/* ============================================================
   DATABASE/SEED-DEMO.JS — Sample Transactions for Demo / Testing
   ============================================================
   Usage:  cd backend && node database/seed-demo.js

   Adds sample income/expense transactions distributed across
   the last 12 months so that admin dashboard charts have data.

   - Idempotent: checks if transactions exist before inserting
   - Realistic amounts (Rupiah)
   - Spreads across Income and Expense categories
   ============================================================ */

require('dotenv').config();
const mysql = require('mysql2/promise');

async function seedDemoData() {
    console.log('\n========================================');
    console.log('  Demo Data Seeder (Sample Transactions)');
    console.log('========================================\n');

    const dbHost = process.env.DB_HOST || 'localhost';
    const dbPort = process.env.DB_PORT || 3306;
    const dbUser = process.env.DB_USER || 'root';
    const dbPassword = process.env.DB_PASSWORD || '';
    const dbName = process.env.DB_NAME || 'personal_finance';

    let conn;
    try {
        conn = await mysql.createConnection({
            host: dbHost,
            port: parseInt(dbPort),
            user: dbUser,
            password: dbPassword,
            database: dbName,
            multipleStatements: true
        });
        console.log('      Connected to MySQL');
    } catch (err) {
        console.error('[ERROR] Cannot connect to MySQL:', err.message);
        process.exit(1);
    }

    try {
        // Check existing count
        const [existing] = await conn.query(
            'SELECT COUNT(*) as count FROM transactions'
        );

        if (existing[0].count > 0) {
            console.log(`[INFO] ${existing[0].count} transactions already exist — skipping demo seed.`);
            console.log('       Run with FORCE=1 to wipe demo transactions and reseed.');
            if (process.env.FORCE !== '1') {
                await conn.end();
                process.exit(0);
            }
            // Optional: wipe only demo-tagged transactions
            await conn.query("DELETE FROM transactions WHERE description LIKE '[DEMO]%'");
            console.log('      Existing demo transactions removed.');
        }

        // Fetch all categories
        const [categories] = await conn.query('SELECT id, name, type FROM categories');
        if (categories.length === 0) {
            console.error('[ERROR] No categories found. Run `npm run seed` first.');
            process.exit(1);
        }

        const incomeCats = categories.filter(c => c.type === 'Income');
        const expenseCats = categories.filter(c => c.type === 'Expense');

        if (incomeCats.length === 0 || expenseCats.length === 0) {
            console.error('[ERROR] Need both Income and Expense categories.');
            process.exit(1);
        }

        // Fetch all users (admin included) — sample data is for admin dashboard demo
        const [users] = await conn.query(
            "SELECT id, name FROM users ORDER BY id"
        );
        if (users.length === 0) {
            console.error('[ERROR] No users found. Register or seed a user first.');
            process.exit(1);
        }

        console.log(`[INFO] Seeding sample transactions for ${users.length} user(s)...`);
        console.log(`       Income categories: ${incomeCats.length}, Expense categories: ${expenseCats.length}\n`);

        // Generate transactions spread across the last 12 months
        const now = new Date();
        const sampleData = [];
        const descriptions = {
            Income: [
                'Monthly salary',
                'Freelance project payment',
                'Bonus payment',
                'Investment dividend',
                'Side hustle income',
                'Consulting fee',
                'Stock sale profit',
                'Refund received',
                'Rental income',
                'Royalties'
            ],
            Expense: [
                'Grocery shopping',
                'Restaurant dinner',
                'Gas/fuel',
                'Electricity bill',
                'Internet subscription',
                'Movie ticket',
                'Coffee',
                'Clothing purchase',
                'Transportation',
                'Phone bill',
                'Gym membership',
                'Medical checkup',
                'Books',
                'Gift purchase',
                'Home supplies',
                'Online subscription'
            ]
        };

        // Build ~3-5 transactions per month per user for the last 12 months
        for (const user of users) {
            for (let monthOffset = 11; monthOffset >= 0; monthOffset--) {
                const monthDate = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1);

                // 2-4 income transactions per month
                const incomeCount = 2 + Math.floor(Math.random() * 3);
                for (let i = 0; i < incomeCount; i++) {
                    const day = 1 + Math.floor(Math.random() * 28);
                    const cat = incomeCats[Math.floor(Math.random() * incomeCats.length)];
                    const amount = Math.floor(2_000_000 + Math.random() * 8_000_000); // 2-10jt
                    const desc = descriptions.Income[Math.floor(Math.random() * descriptions.Income.length)];
                    sampleData.push([
                        user.id,
                        cat.id,
                        'Income',
                        amount,
                        `[DEMO] ${desc}`,
                        new Date(monthDate.getFullYear(), monthDate.getMonth(), day)
                    ]);
                }

                // 4-8 expense transactions per month
                const expenseCount = 4 + Math.floor(Math.random() * 5);
                for (let i = 0; i < expenseCount; i++) {
                    const day = 1 + Math.floor(Math.random() * 28);
                    const cat = expenseCats[Math.floor(Math.random() * expenseCats.length)];
                    const amount = Math.floor(20_000 + Math.random() * 1_500_000); // 20k-1.5jt
                    const desc = descriptions.Expense[Math.floor(Math.random() * descriptions.Expense.length)];
                    sampleData.push([
                        user.id,
                        cat.id,
                        'Expense',
                        amount,
                        `[DEMO] ${desc}`,
                        new Date(monthDate.getFullYear(), monthDate.getMonth(), day)
                    ]);
                }
            }
        }

        console.log(`[INFO] Inserting ${sampleData.length} sample transactions...`);

        // Bulk insert
        const insertSql = `
            INSERT INTO transactions
                (user_id, category_id, type, amount, description, transaction_date)
            VALUES ?
        `;
        const [result] = await conn.query(insertSql, [sampleData]);
        console.log(`[OK] Inserted ${result.affectedRows} transactions.\n`);

        // Verify
        const [verify] = await conn.query(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN type='Income' THEN amount ELSE 0 END) as total_income,
                SUM(CASE WHEN type='Expense' THEN amount ELSE 0 END) as total_expense
            FROM transactions
        `);
        console.log('========================================');
        console.log('  Demo Data Summary');
        console.log('========================================');
        console.log(`  Total transactions : ${verify[0].total}`);
        console.log(`  Total income       : Rp ${Number(verify[0].total_income).toLocaleString('id-ID')}`);
        console.log(`  Total expense      : Rp ${Number(verify[0].total_expense).toLocaleString('id-ID')}`);
        console.log('========================================\n');

        await conn.end();
        process.exit(0);
    } catch (err) {
        console.error('[ERROR] Demo seed failed:', err.message);
        await conn.end();
        process.exit(1);
    }
}

seedDemoData();
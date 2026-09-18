// Debug dashboard - catch actual error
const mysql = require('mysql2/promise');
require('dotenv').config({ path: 'backend/.env' });

async function test() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        port: parseInt(process.env.DB_PORT),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        waitForConnections: true,
        charset: 'utf8mb4',
        dateStrings: true
    });

    try {
        // Test the month query (likely the one that fails)
        const now = new Date();
        const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        console.log('Month key:', monthKey);

        // Try the exact query from dashboard.js
        const [monthRows] = await pool.query(
            `SELECT
                COALESCE(SUM(CASE WHEN t.type = 'Income' THEN t.amount ELSE 0 END), 0) as month_income,
                COALESCE(SUM(CASE WHEN t.type = 'Expense' THEN t.amount ELSE 0 END), 0) as month_expense,
                COUNT(*) as month_count
             FROM transactions t WHERE DATE_FORMAT(t.transaction_date, "%Y-%m") = ?`,
            [monthKey]
        );
        console.log('Month query result:', monthRows);

        // Test the summary query
        const [summaryRows] = await pool.query(
            `SELECT
                COALESCE(SUM(CASE WHEN t.type = 'Income' THEN t.amount ELSE 0 END), 0) as total_income,
                COALESCE(SUM(CASE WHEN t.type = 'Expense' THEN t.amount ELSE 0 END), 0) as total_expense,
                COUNT(*) as total_transactions
             FROM transactions t`
        );
        console.log('Summary query result:', summaryRows);

        // Test the trend query
        const [trendRows] = await pool.query(
            `SELECT
                DATE_FORMAT(t.transaction_date, '%Y-%m') as month,
                COALESCE(SUM(CASE WHEN t.type = 'Income' THEN t.amount ELSE 0 END), 0) as income,
                COALESCE(SUM(CASE WHEN t.type = 'Expense' THEN t.amount ELSE 0 END), 0) as expense,
                COUNT(*) as count
             FROM transactions t
             WHERE t.transaction_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
             GROUP BY DATE_FORMAT(t.transaction_date, '%Y-%m')
             ORDER BY month ASC`
        );
        console.log('Trend query result:', trendRows);

        // Test the category query
        const [catRows] = await pool.query(
            `SELECT c.name, c.id, SUM(t.amount) as total
             FROM transactions t
             JOIN categories c ON t.category_id = c.id
             WHERE t.type = 'Expense'
             GROUP BY c.id, c.name
             ORDER BY total DESC`
        );
        console.log('Category query result:', catRows);

        console.log('\nAll queries passed!');
    } catch (err) {
        console.error('ERROR:', err.message);
        console.error('SQL State:', err.sqlState);
        console.error('Error Code:', err.code);
        console.error('SQL:', err.sql);
    }
    await pool.end();
}
test();

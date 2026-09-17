/* ============================================================
   CONFIG/DB.JS — MySQL Connection Pool
   ============================================================
   Uses mysql2/promise for async/await support.
   Pool enables connection reuse for better performance.
   All config from .env environment variables.
   ============================================================ */

const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'personal_finance',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4',
    dateStrings: true
});

// Test connection on startup
(async () => {
    try {
        const conn = await pool.getConnection();
        console.log('[DB] MySQL connected:', process.env.DB_NAME || 'personal_finance');
        conn.release();
    } catch (err) {
        console.error('[DB] MySQL connection failed:', err.message);
        console.error('     Make sure MySQL is running and .env is configured.');
    }
})();

module.exports = pool;

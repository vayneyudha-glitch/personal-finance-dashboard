/* ============================================================
   MIDDLEWARE/ACTIVITYLOG.JS — Activity Logger Middleware
   ============================================================
   Logs user actions to activity_logs table.
   Usage: After auth middleware, wrap controller with logActivity.
   ============================================================ */

const pool = require('../config/db');

async function logActivity(userId, action, description, ipAddress) {
    try {
        await pool.query(
            'INSERT INTO activity_logs (user_id, action, description, ip_address) VALUES (?, ?, ?, ?)',
            [userId || null, action, description || '', ipAddress || null]
        );
    } catch (err) {
        console.error('[ActivityLog] Failed to log:', err.message);
    }
}

function getClientIp(req) {
    return req.ip || req.connection?.remoteAddress || req.headers['x-forwarded-for'] || null;
}

module.exports = { logActivity, getClientIp };

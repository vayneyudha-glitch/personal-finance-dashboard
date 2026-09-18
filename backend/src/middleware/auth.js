/* ============================================================
   MIDDLEWARE/AUTH.JS — JWT Authentication & Authorization
   ============================================================
   1. auth          — Verify JWT, check blacklist, attach user
   2. requireAdmin  — Check req.user.role === 'ADMIN'
   3. optionalAuth   — Verify token if present, not mandatory

   Token sent from frontend via:
   Authorization: Bearer <token>
   ============================================================ */

const jwt = require('jsonwebtoken');
const pool = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

function generateToken(user) {
    return jwt.sign(
        {
            id: user.id,
            email: user.email,
            role: user.role,
            name: user.name
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );
}

/**
 * Check if a JWT token has been blacklisted (invalidated via logout).
 * @param {string} token
 * @returns {Promise<boolean>}
 */
async function isTokenBlacklisted(token) {
    try {
        const [rows] = await pool.query(
            'SELECT id FROM token_blacklist WHERE token = ? AND expires_at > NOW() LIMIT 1',
            [token]
        );
        return rows.length > 0;
    } catch (err) {
        // If token_blacklist table doesn't exist yet, skip check
        return false;
    }
}

/**
 * Add a token to the blacklist (called on logout).
 * @param {string} token
 * @param {number} userId
 */
async function blacklistToken(token, userId) {
    try {
        // Decode to get expiry
        const decoded = jwt.decode(token);
        const expiresAt = decoded && decoded.exp
            ? new Date(decoded.exp * 1000)
            : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // fallback 7d

        await pool.query(
            'INSERT INTO token_blacklist (token, user_id, expires_at) VALUES (?, ?, ?)',
            [token, userId || null, expiresAt]
        );
    } catch (err) {
        // Table might not exist yet — fail silently
    }
}

/**
 * Cleanup expired blacklisted tokens (call periodically).
 */
async function cleanupExpiredTokens() {
    try {
        await pool.query('DELETE FROM token_blacklist WHERE expires_at <= NOW()');
    } catch (err) {
        // fail silently
    }
}

function auth(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            success: false,
            message: 'Token not found. Please login.'
        });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        req.token = token; // Store for potential blacklisting on logout
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Token expired. Please login again.'
            });
        }
        return res.status(401).json({
            success: false,
            message: 'Invalid token.'
        });
    }

    // Check blacklist before proceeding (async)
    isTokenBlacklisted(token).then(blacklisted => {
        if (blacklisted) {
            return res.status(401).json({
                success: false,
                message: 'Session expired. Please login again.'
            });
        }
        next();
    }).catch(() => {
        // If blacklist check fails (e.g. table missing), allow request (fail-open for availability)
        next();
    });
}

function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'ADMIN') {
        return res.status(403).json({
            success: false,
            message: 'Access denied. Admin only.'
        });
    }
    next();
}

function optionalAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        try {
            req.user = jwt.verify(token, JWT_SECRET);
            req.token = token;
        } catch (err) {
            // Ignore invalid token for optional auth
        }
    }
    next();
}

/**
 * No-cache middleware — sets Cache-Control: no-store on API responses
 * to prevent browser back-button from showing cached authenticated pages.
 */
function noCache(req, res, next) {
    res.set({
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        'Pragma': 'no-cache',
        'Expires': '0'
    });
    next();
}

module.exports = {
    auth,
    requireAdmin,
    optionalAuth,
    generateToken,
    blacklistToken,
    cleanupExpiredTokens,
    noCache
};

/* ============================================================
   ROUTES/AUTH.JS — Authentication Routes
   ============================================================
   POST   /api/auth/register         — Public registration (USER only)
   POST   /api/auth/login            — Login with email or phone + password
   POST   /api/auth/logout           — Logout
   GET    /api/auth/me               — Get current user info
   PUT    /api/auth/profile          — Update profile
   PUT    /api/auth/change-password  — Change password
   ============================================================ */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { auth } = require('../middleware/auth');
const { generateToken } = require('../middleware/auth');
const { logActivity, getClientIp } = require('../middleware/activityLog');
const { validate } = require('../middleware/validate');
const { registerRules, loginRules, profileUpdateRules } = require('../validators/auth');

// POST /api/auth/register
router.post('/register', registerRules, validate, async (req, res, next) => {
    try {
        const { name, email, phone, password } = req.body;

        const cleanEmail = email.toLowerCase().trim();
        const cleanPhone = phone.trim();

        // Check email uniqueness
        const [emailCheck] = await pool.query('SELECT id FROM users WHERE email = ?', [cleanEmail]);
        if (emailCheck.length > 0) {
            return res.status(409).json({ success: false, message: 'Email already registered.' });
        }

        // Check phone uniqueness
        const [phoneCheck] = await pool.query('SELECT id FROM users WHERE phone = ?', [cleanPhone]);
        if (phoneCheck.length > 0) {
            return res.status(409).json({ success: false, message: 'Phone number already registered.' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert — always USER role
        const [result] = await pool.query(
            'INSERT INTO users (name, email, phone, password_hash, role, status) VALUES (?, ?, ?, ?, "USER", "ACTIVE")',
            [name.trim(), cleanEmail, cleanPhone, hashedPassword]
        );

        const user = { id: result.insertId, name: name.trim(), email: cleanEmail, role: 'USER' };
        const token = generateToken(user);

        await logActivity(result.insertId, 'REGISTER', 'User registered', getClientIp(req));

        return res.status(201).json({
            success: true,
            message: 'Registration successful! Welcome.',
            data: {
                token,
                user: { id: result.insertId, name: name.trim(), email: cleanEmail, phone: cleanPhone, role: 'USER' }
            }
        });
    } catch (err) {
        next(err);
    }
});

// POST /api/auth/login
router.post('/login', loginRules, validate, async (req, res, next) => {
    try {
        const { identifier, password } = req.body;
        const cleanId = identifier.trim();

        // Find by email or phone
        const [rows] = await pool.query(
            'SELECT id, name, email, phone, password_hash, role, status FROM users WHERE email = ? OR phone = ?',
            [cleanId.toLowerCase(), cleanId]
        );

        if (rows.length === 0) {
            await logActivity(null, 'LOGIN_FAILED', `Login attempt with unknown identifier: ${cleanId}`, getClientIp(req));
            return res.status(404).json({ success: false, message: 'Account not found. Please register first.' });
        }

        const user = rows[0];

        // Check if account is active
        if (user.status === 'INACTIVE') {
            await logActivity(user.id, 'LOGIN_FAILED', 'Login attempt on inactive account', getClientIp(req));
            return res.status(403).json({ success: false, message: 'Account is deactivated. Contact administrator.' });
        }

        // Verify password
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            await logActivity(user.id, 'LOGIN_FAILED', 'Incorrect password', getClientIp(req));
            return res.status(401).json({ success: false, message: 'Email/phone or password is incorrect.' });
        }

        const token = generateToken(user);
        await logActivity(user.id, 'LOGIN', 'User logged in', getClientIp(req));

        return res.json({
            success: true,
            message: 'Login successful!',
            data: {
                token,
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    phone: user.phone,
                    role: user.role
                }
            }
        });
    } catch (err) {
        next(err);
    }
});

// POST /api/auth/logout
router.post('/logout', auth, async (req, res, next) => {
    try {
        await logActivity(req.user.id, 'LOGOUT', 'User logged out', getClientIp(req));
        return res.json({ success: true, message: 'Logout successful.' });
    } catch (err) {
        next(err);
    }
});

// GET /api/auth/me
router.get('/me', auth, async (req, res, next) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, name, email, phone, role, status, created_at FROM users WHERE id = ?',
            [req.user.id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        const u = rows[0];
        return res.json({
            success: true,
            data: {
                id: u.id,
                name: u.name,
                email: u.email,
                phone: u.phone,
                role: u.role,
                status: u.status,
                createdAt: u.created_at
            }
        });
    } catch (err) {
        next(err);
    }
});

// PUT /api/auth/profile
router.put('/profile', auth, profileUpdateRules, validate, async (req, res, next) => {
    try {
        const { name, phone, currentPassword, newPassword } = req.body;
        const userId = req.user.id;

        const [userRows] = await pool.query('SELECT id, password_hash FROM users WHERE id = ?', [userId]);
        if (userRows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        const updates = [];
        const params = [];

        if (name && name.trim()) {
            updates.push('name = ?');
            params.push(name.trim());
        }

        if (phone !== undefined) {
            const [phoneCheck] = await pool.query('SELECT id FROM users WHERE phone = ? AND id != ?', [phone.trim(), userId]);
            if (phoneCheck.length > 0) {
                return res.status(409).json({ success: false, message: 'Phone number already in use.' });
            }
            updates.push('phone = ?');
            params.push(phone.trim());
        }

        if (newPassword) {
            if (!currentPassword) {
                return res.status(400).json({ success: false, message: 'Current password is required to change password.' });
            }
            const isMatch = await bcrypt.compare(currentPassword, userRows[0].password_hash);
            if (!isMatch) {
                return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
            }
            const newHash = await bcrypt.hash(newPassword, 10);
            updates.push('password_hash = ?');
            params.push(newHash);
        }

        if (updates.length === 0) {
            return res.status(400).json({ success: false, message: 'No fields to update.' });
        }

        params.push(userId);
        await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
        await logActivity(userId, 'UPDATE_PROFILE', 'Profile updated', getClientIp(req));

        return res.json({ success: true, message: 'Profile updated successfully!' });
    } catch (err) {
        next(err);
    }
});

// PUT /api/auth/change-password
router.put('/change-password', auth, async (req, res, next) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const userId = req.user.id;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ success: false, message: 'Current password and new password are required.' });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({ success: false, message: 'New password must be at least 8 characters.' });
        }

        const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [userId]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        const isMatch = await bcrypt.compare(currentPassword, rows[0].password_hash);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
        }

        const newHash = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, userId]);
        await logActivity(userId, 'CHANGE_PASSWORD', 'Password changed', getClientIp(req));

        return res.json({ success: true, message: 'Password changed successfully!' });
    } catch (err) {
        next(err);
    }
});

module.exports = router;

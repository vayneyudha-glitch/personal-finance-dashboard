/* ============================================================
   ROUTES/OTP.JS — OTP Verification Routes
   ============================================================
   POST   /api/otp/send    — Send OTP to user's email address
   POST   /api/otp/verify  — Verify OTP code

   Security:
   - OTP is hashed (SHA-256) before storing in DB
   - OTP never returned in API response
   - Rate limited (per-IP + per-phone)
   - Cooldown between sends (60s)
   - Max 5 verification attempts
   - OTP expires in 5 minutes
   - One-time use: cleared after successful verify

   OTP DELIVERY:
   - Email is the ONLY channel for OTP delivery.
   - OTP is sent to the user's email address via SMTP.
   - OTP is NEVER sent via SMS, WhatsApp, or Meta WhatsApp API.
   - The WhatsApp webhook (routes/webhooks.js) remains active
     for Meta integration but is NOT used for OTP delivery.
   ============================================================ */

const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { otpSendRules, otpVerifyRules } = require('../validators/auth');
const { validate } = require('../middleware/validate');
const { otpSendLimiter, otpVerifyLimiter } = require('../middleware/rateLimiters');
const { getClientIp } = require('../middleware/activityLog');
const {
    generateOtp,
    hashOtp,
    verifyOtpHash,
    sendOtp,
    OTP_TTL_MINUTES,
    OTP_MAX_ATTEMPTS,
    OTP_COOLDOWN_SECONDS
} = require('../config/otp');
const { normalizePhone } = require('../utils/phone');
const { maskEmail } = require('../services/emailService');

// POST /api/otp/send
router.post('/send', otpSendLimiter, otpSendRules, validate, async (req, res, next) => {
    try {
        const { phone: rawPhone, name, email } = req.body;

        // Email is REQUIRED — OTP is sent via email only
        if (!email || !email.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Email wajib diisi. Kode verifikasi akan dikirim ke email Anda.'
            });
        }

        var cleanEmail = email.toLowerCase().trim();

        // Basic email format validation
        if (cleanEmail.indexOf('@') < 1 || cleanEmail.indexOf('.') < 0) {
            return res.status(400).json({
                success: false,
                message: 'Format email tidak valid.'
            });
        }

        // Normalize phone (still required for user record, but NOT used for OTP delivery)
        var normalizedPhone = normalizePhone(rawPhone);
        if (!normalizedPhone) {
            return res.status(400).json({
                success: false,
                message: 'Invalid phone number format. Please enter a valid Indonesian phone number (e.g. 081234567890).'
            });
        }

        // Check if this email is already registered and verified
        var [emailRows] = await pool.query(
            'SELECT id, phone_verified, phone_verification_code, phone_verification_expires_at, phone_verification_attempts, phone_verification_last_sent_at FROM users WHERE email = ?',
            [cleanEmail]
        );
        if (emailRows.length > 0 && emailRows[0].phone_verified === 1) {
            return res.status(409).json({
                success: false,
                message: 'Email ini sudah terdaftar dan terverifikasi. Silakan login.'
            });
        }

        // Check if phone is already registered and verified by a different email
        var [phoneRows] = await pool.query(
            'SELECT id, email, phone_verified FROM users WHERE phone = ?',
            [normalizedPhone]
        );
        if (phoneRows.length > 0 && phoneRows[0].phone_verified === 1 && phoneRows[0].email !== cleanEmail) {
            return res.status(409).json({
                success: false,
                message: 'Nomor HP sudah digunakan oleh akun lain.'
            });
        }

        // Cooldown check: if we recently sent an OTP for this email, reject
        var existingUserId = null;
        var cooldownUser = null;
        if (emailRows.length > 0) {
            cooldownUser = emailRows[0];
            existingUserId = cooldownUser.id;
        } else if (phoneRows.length > 0 && phoneRows[0].email === cleanEmail) {
            cooldownUser = phoneRows[0];
            existingUserId = cooldownUser.id;
        }

        if (cooldownUser && cooldownUser.phone_verification_last_sent_at) {
            var lastSentDate = new Date(cooldownUser.phone_verification_last_sent_at);
            var elapsed = (Date.now() - lastSentDate.getTime()) / 1000;
            if (elapsed < OTP_COOLDOWN_SECONDS) {
                var waitSec = Math.ceil(OTP_COOLDOWN_SECONDS - elapsed);
                return res.status(429).json({
                    success: false,
                    message: 'Silakan tunggu ' + waitSec + ' detik sebelum meminta kode baru.',
                    data: { cooldownRemaining: waitSec }
                });
            }
        }

        // Rate limit per email: check otp_attempts table
        var ip = getClientIp(req);
        var [recentAttempts] = await pool.query(
            "SELECT COUNT(*) as count FROM otp_attempts WHERE phone_number = ? AND attempt_type = 'send' AND created_at > DATE_SUB(NOW(), INTERVAL 10 MINUTE)",
            [cleanEmail]
        );
        if (recentAttempts[0].count >= 3) {
            return res.status(429).json({
                success: false,
                message: 'Terlalu banyak permintaan kode untuk email ini. Coba lagi nanti.'
            });
        }

        // Generate OTP
        var code = generateOtp();
        var codeHash = hashOtp(code);
        var expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

        // Store OTP hash + expiry on the users row (create a pending user if not exists)
        var userId;
        if (existingUserId) {
            // Update existing pending user — old OTP is overwritten (can't be used anymore)
            userId = existingUserId;
            await pool.query(
                'UPDATE users SET name = ?, phone = ?, phone_verification_code = ?, phone_verification_expires_at = ?, phone_verification_attempts = 0, phone_verification_last_sent_at = NOW() WHERE id = ?',
                [name ? name.trim() : '', normalizedPhone, codeHash, expiresAt, userId]
            );
        } else {
            // Create a pending user record (will be finalized on register)
            var [insertResult] = await pool.query(
                'INSERT INTO users (name, email, phone, password_hash, role, status, phone_verified, phone_verification_code, phone_verification_expires_at, phone_verification_attempts, phone_verification_last_sent_at) VALUES (?, ?, ?, \'\', \'USER\', \'INACTIVE\', 0, ?, ?, 0, NOW())',
                [name ? name.trim() : '', cleanEmail, normalizedPhone, codeHash, expiresAt]
            );
            userId = insertResult.insertId;
        }

        // Send OTP via EMAIL — check result BEFORE telling the user it was sent
        // If email sending fails, roll back the OTP data so the user doesn't think it was sent
        var sendResult = await sendOtp(cleanEmail, code);

        if (!sendResult.success) {
            // Email failed — roll back the OTP code so user can retry cleanly
            try {
                await pool.query(
                    'UPDATE users SET phone_verification_code = NULL, phone_verification_expires_at = NULL, phone_verification_attempts = 0, phone_verification_last_sent_at = NULL WHERE id = ?',
                    [userId]
                );
            } catch (rollbackErr) {
                console.error('[OTP] Rollback failed for user ' + userId + ':', rollbackErr.message);
            }
            return res.status(502).json({
                success: false,
                message: 'Gagal mengirim kode verifikasi ke email. Periksa konfigurasi SMTP atau coba lagi nanti.'
            });
        }

        // Email succeeded — log the attempt (store email in phone_number field for rate limiting)
        await pool.query(
            "INSERT INTO otp_attempts (phone_number, attempt_type, ip_address) VALUES (?, 'send', ?)",
            [cleanEmail, ip]
        );

        return res.json({
            success: true,
            message: 'Kode verifikasi berhasil dikirim ke email Anda.',
            data: {
                email: maskEmail(cleanEmail),
                expiresIn: OTP_TTL_MINUTES * 60,
                cooldown: OTP_COOLDOWN_SECONDS
            }
        });
    } catch (err) {
        next(err);
    }
});

// POST /api/otp/verify
router.post('/verify', otpVerifyLimiter, otpVerifyRules, validate, async (req, res, next) => {
    try {
        const { phone: rawPhone, email: rawEmail, code } = req.body;

        // Email is the primary identifier for OTP verification
        if (!rawEmail || !rawEmail.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Email wajib diisi untuk verifikasi.'
            });
        }

        var cleanEmail = rawEmail.toLowerCase().trim();

        // Normalize phone (for matching the user record)
        var normalizedPhone = normalizePhone(rawPhone);
        if (!normalizedPhone) {
            return res.status(400).json({
                success: false,
                message: 'Invalid phone number format.'
            });
        }

        // Find the pending user by email
        var [rows] = await pool.query(
            'SELECT id, phone_verified, phone_verification_code, phone_verification_expires_at, phone_verification_attempts FROM users WHERE email = ?',
            [cleanEmail]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Kode verifikasi tidak ditemukan untuk email ini. Silakan minta kode baru.'
            });
        }

        var user = rows[0];

        // Already verified
        if (user.phone_verified === 1) {
            return res.status(400).json({
                success: false,
                message: 'Email ini sudah terverifikasi.'
            });
        }

        // Check if code exists
        if (!user.phone_verification_code) {
            return res.status(400).json({
                success: false,
                message: 'Kode verifikasi tidak ditemukan. Silakan minta kode baru.'
            });
        }

        // Check expiry
        if (user.phone_verification_expires_at && new Date(user.phone_verification_expires_at) < new Date()) {
            return res.status(400).json({
                success: false,
                message: 'Kode verifikasi sudah kedaluwarsa. Silakan minta kode baru.'
            });
        }

        // Check attempts
        if (user.phone_verification_attempts >= OTP_MAX_ATTEMPTS) {
            return res.status(429).json({
                success: false,
                message: 'Terlalu banyak percobaan. Silakan minta kode baru.'
            });
        }

        // Increment attempts
        await pool.query(
            'UPDATE users SET phone_verification_attempts = phone_verification_attempts + 1 WHERE id = ?',
            [user.id]
        );

        // Verify code hash
        if (!verifyOtpHash(code, user.phone_verification_code)) {
            var remaining = OTP_MAX_ATTEMPTS - (user.phone_verification_attempts + 1);
            return res.status(400).json({
                success: false,
                message: 'Kode verifikasi salah. Sisa percobaan: ' + remaining + '.',
                data: { attemptsRemaining: remaining }
            });
        }

        // Code is correct — mark phone/email as verified
        // For pending users (status INACTIVE), keep them INACTIVE until register completes
        await pool.query(
            'UPDATE users SET phone_verified = 1, phone_verification_code = NULL, phone_verification_expires_at = NULL, phone_verification_attempts = 0 WHERE id = ?',
            [user.id]
        );

        // Log OTP verify attempt
        var ip = getClientIp(req);
        await pool.query(
            "INSERT INTO otp_attempts (phone_number, attempt_type, ip_address) VALUES (?, 'verify', ?)",
            [cleanEmail, ip]
        );

        return res.json({
            success: true,
            message: 'Email berhasil diverifikasi.',
            data: {
                email: maskEmail(cleanEmail),
                verified: true,
                userId: user.id
            }
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;

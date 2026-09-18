/* ============================================================
   MIDDLEWARE/RATELIMITERS.JS — Endpoint-Specific Rate Limiters
   ============================================================
   Provides granular rate limiting for security-sensitive
   endpoints: register, login, OTP send, OTP verify.
   ============================================================ */

const rateLimit = require('express-rate-limit');

// Register: max 5 attempts per 15 minutes per IP
const registerLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: {
        success: false,
        message: 'Too many registration attempts. Please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false
});

// Login: max 10 attempts per 15 minutes per IP
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: {
        success: false,
        message: 'Too many login attempts. Please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false
});

// OTP send: max 3 per 10 minutes per IP (cooldown handled in DB too)
const otpSendLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 3,
    message: {
        success: false,
        message: 'Too many OTP requests. Please wait before requesting a new code.'
    },
    standardHeaders: true,
    legacyHeaders: false
});

// OTP verify: max 10 per 15 minutes per IP
const otpVerifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: {
        success: false,
        message: 'Too many verification attempts. Please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false
});

module.exports = {
    registerLimiter,
    loginLimiter,
    otpSendLimiter,
    otpVerifyLimiter
};

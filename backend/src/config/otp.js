/* ============================================================
   CONFIG/OTP.JS — OTP Utilities & Provider Abstraction
   ============================================================
   Provides OTP generation, hashing, verification, and a
   thin sendOtp() wrapper that delegates to the active provider.

   Provider selection: OTP_PROVIDER env var
     - "console"    → Dev mode (prints to terminal)
     - "whatsapp"   → WhatsApp Business Cloud API (Meta)
     - "sms"        → Placeholder for future SMS gateway

   SECURITY:
   - OTP is never returned in API responses.
   - In dev mode (console provider), OTP is logged to terminal ONLY.
   - In production with whatsapp provider, OTP is never logged.
   - API tokens are never exposed to the client.
   ============================================================ */

const crypto = require('crypto');
const { getOtpProvider, maskPhone } = require('../services/otp/provider');

const OTP_LENGTH = 6;
const OTP_TTL_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 5;
const OTP_COOLDOWN_SECONDS = 60;

/**
 * Generate a random 6-digit OTP code.
 * @returns {string} 6-digit zero-padded code
 */
function generateOtp() {
    return String(crypto.randomInt(0, 1000000)).padStart(OTP_LENGTH, '0');
}

/**
 * Hash an OTP code using SHA-256 (so we don't store plaintext).
 * @param {string} code
 * @returns {string}
 */
function hashOtp(code) {
    return crypto.createHash('sha256').update(code).digest('hex');
}

/**
 * Compare a plaintext OTP with a stored hash.
 * @param {string} code
 * @param {string} hash
 * @returns {boolean}
 */
function verifyOtpHash(code, hash) {
    return hashOtp(code) === hash;
}

/**
 * Send OTP via configured provider.
 *
 * Delegates to the active provider (console / whatsapp / sms).
 * The provider MUST return { success: boolean } — if success is false,
 * the caller (route) treats the send as failed and rolls back.
 *
 * SECURITY:
 * - Never returns the OTP code to the caller.
 * - Never returns API credentials.
 *
 * @param {string} phone - Normalized phone (+62...)
 * @param {string} code  - The OTP code
 * @returns {Promise<{success: boolean, provider: string, messageId?: string}>}
 */
async function sendOtp(phone, code) {
    var provider = getOtpProvider();
    return await provider.sendOtp(phone, code);
}

module.exports = {
    generateOtp,
    hashOtp,
    verifyOtpHash,
    sendOtp,
    maskPhone,
    OTP_TTL_MINUTES,
    OTP_MAX_ATTEMPTS,
    OTP_COOLDOWN_SECONDS
};

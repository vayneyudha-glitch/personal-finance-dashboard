/* ============================================================
   SERVICES/OTP/EMAILPROVIDER.JS — Email OTP Provider
   ============================================================
   Sends OTP via SMTP email using nodemailer.
   Delegates email sending to emailService.js.

   This provider is selected when OTP_PROVIDER=email in .env.

   SECURITY:
   - OTP is NEVER logged.
   - SMTP password is NEVER logged.
   - SMTP credentials are NEVER returned in API responses.
   - Email addresses are masked in logs.
   - If SMTP is misconfigured, returns failure (does NOT
     silently fall back to console).
   ============================================================ */

const { sendOtpEmail, maskEmail, validateConfig } = require('../emailService');

const name = 'email';

/**
 * Send OTP via email.
 *
 * @param {string} email  — Recipient email address
 * @param {string} code   — 6-digit OTP code
 * @returns {Promise<{ success: boolean, provider: string, messageId?: string }>}
 */
async function sendOtp(email, code) {
    var config = validateConfig();
    if (!config.valid) {
        console.error('[OTP/email] SMTP configuration incomplete. Missing:', config.missing.join(', '));
        console.error('[OTP/email] Set these in backend/.env or switch OTP_PROVIDER=console for development.');
        return { success: false, provider: name };
    }

    if (!email || typeof email !== 'string' || email.indexOf('@') < 1) {
        console.error('[OTP/email] Invalid recipient email.');
        return { success: false, provider: name };
    }

    var result = await sendOtpEmail(email, code);

    if (result.success) {
        return { success: true, provider: name, messageId: result.messageId };
    }

    return { success: false, provider: name };
}

module.exports = { name, sendOtp, validateConfig };

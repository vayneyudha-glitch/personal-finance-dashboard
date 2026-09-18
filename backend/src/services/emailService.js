/* ============================================================
   SERVICES/EMAILSERVICE.JS — SMTP Email Service
   ============================================================
   Sends transactional emails via SMTP using nodemailer.

   Required environment variables:
     SMTP_HOST       — SMTP server hostname (e.g. smtp.gmail.com)
     SMTP_PORT       — SMTP port (587 for STARTTLS, 465 for SSL)
     SMTP_SECURE     — true for SSL (465), false for STARTTLS (587)
     SMTP_USER       — SMTP authentication username
     SMTP_PASSWORD   — SMTP authentication password
     SMTP_FROM       — From email address (e.g. noreply@example.com)
     SMTP_FROM_NAME  — Display name (e.g. "Personal Finance Dashboard")

   SECURITY:
   - SMTP password is NEVER logged.
   - SMTP password is NEVER returned in API responses.
   - Errors are sanitized before reaching the client.
   - Email addresses are masked in logs.
   - In production, credentials must be set or send fails safely.
   ============================================================ */

const nodemailer = require('nodemailer');

/**
 * Mask an email address for safe logging.
 * Example: user@example.com → u***@e***.com
 * @param {string} email
 * @returns {string}
 */
function maskEmail(email) {
    if (!email || typeof email !== 'string') return '***';
    var atIndex = email.indexOf('@');
    if (atIndex < 1) return '***';

    var local = email.substring(0, atIndex);
    var domain = email.substring(atIndex + 1);

    // Mask local part: keep first char, rest as asterisks
    var maskedLocal = local.charAt(0) + '*'.repeat(Math.max(2, local.length - 1));

    // Mask domain: keep first char of domain, rest as asterisks before TLD
    var dotIndex = domain.lastIndexOf('.');
    if (dotIndex < 1) {
        return maskedLocal + '@' + domain.charAt(0) + '***';
    }
    var domainName = domain.substring(0, dotIndex);
    var tld = domain.substring(dotIndex);
    var maskedDomain = domainName.charAt(0) + '*'.repeat(Math.max(2, domainName.length - 1)) + tld;

    return maskedLocal + '@' + maskedDomain;
}

// Reuse transporter across calls (created lazily)
var _transporter = null;

/**
 * Validate that all required SMTP env vars are present.
 * @returns {{ valid: boolean, missing: string[] }}
 */
function validateConfig() {
    var required = [
        'SMTP_HOST',
        'SMTP_PORT',
        'SMTP_USER',
        'SMTP_PASSWORD',
        'SMTP_FROM'
    ];
    var missing = required.filter(function(k) {
        return !process.env[k] || process.env[k].trim() === '';
    });
    return { valid: missing.length === 0, missing: missing };
}

/**
 * Get (or create) the nodemailer transporter.
 * Uses lazy initialization so config errors are caught on first send.
 *
 * @returns {object|null} nodemailer transporter, or null if misconfigured
 */
function getTransporter() {
    if (_transporter) return _transporter;

    var config = validateConfig();
    if (!config.valid) {
        console.error('[Email] SMTP configuration incomplete. Missing:', config.missing.join(', '));
        return null;
    }

    var port = parseInt(process.env.SMTP_PORT, 10) || 587;
    var secure = process.env.SMTP_SECURE === 'true' || port === 465;

    _transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: port,
        secure: secure,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASSWORD
        }
    });

    return _transporter;
}

/**
 * Build the OTP verification email content.
 *
 * @param {string} code — 6-digit OTP code
 * @returns {{ subject: string, text: string, html: string }}
 */
function buildOtpEmail(code) {
    var fromName = process.env.SMTP_FROM_NAME || 'Personal Finance Dashboard';

    var subject = 'Personal Finance Dashboard - Kode Verifikasi';

    var text =
        'Halo,\n\n' +
        'Kode verifikasi akun Anda adalah:\n\n' +
        code + '\n\n' +
        'Kode ini berlaku selama 5 menit dan hanya dapat digunakan satu kali.\n\n' +
        'Jika Anda tidak melakukan permintaan ini, abaikan email ini.\n\n' +
        fromName;

    // Simple, safe HTML email — no external resources, no tracking pixels
    var html =
        '<div style="font-family: Arial, Helvetica, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">' +
            '<h2 style="color: #2563eb; margin-bottom: 24px;">Personal Finance Dashboard</h2>' +
            '<p style="color: #333; font-size: 16px; line-height: 1.5;">Halo,</p>' +
            '<p style="color: #333; font-size: 16px; line-height: 1.5;">Kode verifikasi akun Anda adalah:</p>' +
            '<div style="text-align: center; margin: 32px 0;">' +
                '<span style="display: inline-block; font-size: 36px; font-weight: bold; letter-spacing: 8px; ' +
                'color: #2563eb; background: #eff6ff; padding: 16px 32px; border-radius: 8px; border: 1px solid #dbeafe;">' +
                    code +
                '</span>' +
            '</div>' +
            '<p style="color: #666; font-size: 14px; line-height: 1.5;">Kode ini berlaku selama 5 menit dan hanya dapat digunakan satu kali.</p>' +
            '<p style="color: #999; font-size: 13px; line-height: 1.5;">Jika Anda tidak melakukan permintaan ini, abaikan email ini.</p>' +
            '<hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">' +
            '<p style="color: #999; font-size: 12px;">' + fromName + '</p>' +
        '</div>';

    return { subject: subject, text: text, html: html };
}

/**
 * Send an OTP verification email.
 *
 * @param {string} toEmail — Recipient email address
 * @param {string} code    — 6-digit OTP code
 * @returns {Promise<{ success: boolean, messageId?: string }>}
 */
async function sendOtpEmail(toEmail, code) {
    var transporter = getTransporter();
    if (!transporter) {
        console.error('[Email] Cannot send OTP — SMTP not configured.');
        return { success: false };
    }

    var fromName = process.env.SMTP_FROM_NAME || 'Personal Finance Dashboard';
    var fromAddress = process.env.SMTP_FROM;
    var fromHeader = '"' + fromName + '" <' + fromAddress + '>';

    var emailContent = buildOtpEmail(code);

    try {
        var info = await transporter.sendMail({
            from: fromHeader,
            to: toEmail,
            subject: emailContent.subject,
            text: emailContent.text,
            html: emailContent.html
        });

        console.log('[Email] OTP sent to ' + maskEmail(toEmail) + ' (msg: ' + (info.messageId || '') + ')');
        return { success: true, messageId: info.messageId };
    } catch (err) {
        // Log error message only — never log SMTP password or full error with credentials
        console.error('[Email] Failed to send OTP to ' + maskEmail(toEmail) + ': ' + err.message);
        return { success: false };
    }
}

/**
 * Reset the transporter (useful for testing or config changes).
 */
function resetTransporter() {
    _transporter = null;
}

module.exports = {
    sendOtpEmail,
    maskEmail,
    validateConfig,
    buildOtpEmail,
    resetTransporter
};

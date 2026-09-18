/* ============================================================
   SERVICES/OTP/PROVIDER.JS — OTP Provider Factory
   ============================================================
   Abstracts OTP delivery so the route logic never changes
   when switching between providers (console, whatsapp, etc).

   Provider is selected via OTP_PROVIDER env var:
     - "email"      → SMTP email (DEFAULT — the only supported OTP channel)
     - "console"    → Dev mode: prints OTP to server terminal (dev only)
     - "whatsapp"   → Redirected to email (WhatsApp is NOT an OTP channel)
     - "sms"        → Redirected to email (SMS is NOT supported)

   NOTE: The WhatsApp Meta webhook (routes/webhooks.js) remains fully
   active for integration purposes, but WhatsApp is no longer used
   to DELIVER OTP codes. Email is the sole OTP delivery channel.

   Each provider implements:
     async sendOtp(recipient, code) → { success, provider, messageId? }
     For email provider, recipient is an email address.
     For console/whatsapp providers, recipient is a phone number.

   SECURITY:
   - Never returns the OTP code to the caller.
   - Never logs credentials.
   - Errors are sanitized before reaching the API response.
   ============================================================ */

const consoleProvider = require('./consoleProvider');
const whatsappProvider = require('./whatsappProvider');
const emailProvider = require('./emailProvider');
const { maskPhone } = require('./mask');

/**
 * Get the active OTP provider based on OTP_PROVIDER env var.
 *
 * IMPORTANT: Email is the ONLY supported channel for OTP delivery.
 * WhatsApp and SMS are no longer used as OTP channels.
 * The WhatsApp webhook remains active for Meta integration but
 * is NOT used for sending OTP codes.
 *
 * @returns {{ sendOtp: Function, name: string }}
 */
function getOtpProvider() {
    var provider = (process.env.OTP_PROVIDER || 'email').toLowerCase().trim();

    switch (provider) {
        case 'email':
            return emailProvider;

        case 'console':
            // Dev-only: logs OTP to terminal. Refuses in production.
            console.warn('[OTP] Using console provider — OTP will be printed to terminal. Do NOT use in production. Set OTP_PROVIDER=email with SMTP config for production.');
            return consoleProvider;

        case 'whatsapp':
            // WhatsApp is NO LONGER an OTP channel — redirect to email
            console.warn('[OTP] WhatsApp is no longer used as an OTP channel. Using email provider instead. WhatsApp webhook remains active for Meta integration.');
            return emailProvider;

        case 'sms':
            // SMS is NOT supported — redirect to email
            console.warn('[OTP] SMS is not supported. Using email provider instead.');
            return emailProvider;

        default:
            console.warn('[OTP] Unknown provider "' + provider + '". Using email provider.');
            return emailProvider;
    }
}

module.exports = {
    getOtpProvider,
    maskPhone
};

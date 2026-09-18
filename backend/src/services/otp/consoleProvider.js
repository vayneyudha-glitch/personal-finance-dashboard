/* ============================================================
   SERVICES/OTP/CONSOLEPROVIDER.JS — Console OTP Provider (Dev)
   ============================================================
   Development-only provider that prints the OTP code to the
   server terminal. NEVER used in production.

   SECURITY:
   - OTP is only logged when NODE_ENV !== 'production'.
   - In production, this provider returns failure to prevent
     accidental use without a real delivery channel.
   - Never logs credentials (there are none).
   ============================================================ */

// OTP TTL in minutes — kept local to avoid circular dependency with config/otp.js
var OTP_TTL_MINUTES = 5;

const name = 'console';

/**
 * Send OTP by printing it to the server console.
 *
 * @param {string} phone - Normalized phone (+62...)
 * @param {string} code  - 6-digit OTP code
 * @returns {Promise<{success: boolean, provider: string}>}
 */
async function sendOtp(phone, code) {
    const isDev = process.env.NODE_ENV !== 'production';

    if (!isDev) {
        // Refuse to send OTP via console in production — no real delivery
        console.error('[OTP/console] Refusing to log OTP in production mode. Set OTP_PROVIDER to a real provider.');
        return { success: false, provider: name };
    }

    // Dev mode: log to terminal only
    console.log('');
    console.log('┌──────────────────────────────────┐');
    console.log('│  OTP Verification Code           │');
    console.log('│  Phone: ' + phone.padEnd(24) + '│');
    console.log('│  Code:  ' + code.padEnd(24) + '│');
    console.log('│  Expires in ' + OTP_TTL_MINUTES + ' minutes' + ' '.repeat(15 - String(OTP_TTL_MINUTES).length) + '│');
    console.log('└──────────────────────────────────┘');
    console.log('');

    return { success: true, provider: name };
}

module.exports = { name, sendOtp };

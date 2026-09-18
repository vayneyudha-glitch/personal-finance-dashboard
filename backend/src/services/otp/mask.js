/* ============================================================
   SERVICES/OTP/MASK.JS — Phone Masking Utility
   ============================================================
   Masks phone numbers for safe logging.
   Extracted into a separate file to avoid circular requires
   between provider.js and the individual providers.

   +6281234567890 → +6281******90
   ============================================================ */

/**
 * Mask a phone number for safe logging.
 * @param {string} phone
 * @returns {string}
 */
function maskPhone(phone) {
    if (!phone || phone.length < 6) return '***';
    var start = phone.substring(0, 4);
    var end = phone.substring(phone.length - 2);
    return start + '*'.repeat(6) + end;
}

module.exports = { maskPhone };

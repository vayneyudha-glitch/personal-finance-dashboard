/* ============================================================
   UTILS/PHONE.JS — Phone Number Validation & Normalization
   ============================================================
   Validates Indonesian phone numbers and normalizes
   them to +62 international format.
   
   Examples:
     081234567890  → +6281234567890
     6281234567890 → +6281234567890
     +6281234567890 → +6281234567890
     0812-3456-7890 → +6281234567890
   ============================================================ */

/**
 * Normalize an Indonesian phone number to +62 format.
 * Returns null if the number is invalid.
 * 
 * @param {string} raw
 * @returns {string|null} Normalized phone like "+62812..." or null
 */
function normalizePhone(raw) {
    if (!raw || typeof raw !== 'string') return null;

    // Remove all non-digit characters (spaces, dashes, parens)
    let phone = raw.replace(/\D/g, '');

    // Empty after cleaning
    if (!phone || phone.length < 9) return null;

    // Remove leading 0 and prepend 62
    if (phone.startsWith('0')) {
        phone = '62' + phone.substring(1);
    }
    // Already starts with 62
    else if (phone.startsWith('62')) {
        // keep as-is
    }
    // Starts with 8 (missing 0 prefix) — prepend 62
    else if (phone.startsWith('8')) {
        phone = '62' + phone;
    }
    // Any other prefix is invalid for Indonesian numbers
    else {
        return null;
    }

    // Validate length: 62 + 8 to 13 digits = 10 to 15 total
    if (phone.length < 10 || phone.length > 15) return null;

    // Validate that it starts with valid Indonesian prefix
    // 62 8x (mobile) or 62 2x/3x/4x... (landline) — we accept 62 + any
    // But reject obviously fake patterns like all same digit
    const mobilePart = phone.substring(2); // after "62"
    if (!/^\d{8,13}$/.test(mobilePart)) return null;

    // Reject sequential (12345678) or repeated (11111111) fake numbers
    if (isSequentialDigits(mobilePart) || isAllSameDigits(mobilePart)) {
        return null;
    }

    return '+' + phone;
}

/**
 * Validate phone number format (after normalization).
 * @param {string} phone
 * @returns {boolean}
 */
function isValidPhone(phone) {
    return normalizePhone(phone) !== null;
}

// --- Internal helpers ---

function isAllSameDigits(str) {
    if (str.length < 4) return false;
    return /^(.)\1+$/.test(str);
}

function isSequentialDigits(str) {
    if (str.length < 4) return false;
    // Check ascending: 12345678
    let ascending = true;
    let descending = true;
    for (let i = 1; i < Math.min(str.length, 6); i++) {
        if (parseInt(str[i]) !== (parseInt(str[i - 1]) + 1) % 10) ascending = false;
        if (parseInt(str[i]) !== (parseInt(str[i - 1]) - 1 + 10) % 10) descending = false;
    }
    return ascending || descending;
}

module.exports = { normalizePhone, isValidPhone };

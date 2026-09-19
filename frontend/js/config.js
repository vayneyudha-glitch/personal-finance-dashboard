/* ============================================================
   CONFIG.JS — Application Configuration
   ============================================================ */

const API_BASE_URL = '/api';

// localStorage keys
const AUTH_KEYS = {
    TOKEN: 'finance_token',
    SESSION: 'finance_session'
};

// Default categories (overridden by API)
var DEFAULT_CATEGORIES = {
    Income: ['Gaji', 'Bonus', 'Investasi', 'Freelance', 'Lainnya'],
    Expense: ['Makanan', 'Transportasi', 'Belanja', 'Tagihan', 'Hiburan', 'Kesehatan', 'Pendidikan', 'Lainnya']
};

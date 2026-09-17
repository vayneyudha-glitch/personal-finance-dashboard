/* ============================================================
   VALIDATORS/USER.JS — Express Validator Rules for Admin User Management
   ============================================================ */
const { body } = require('express-validator');

const userUpdateRules = [
    body('name').optional().trim().notEmpty().isLength({ max: 100 }),
    body('email').optional().trim().isEmail().normalizeEmail(),
    body('phone').optional().trim(),
    body('role').optional().isIn(['ADMIN', 'USER']),
    body('status').optional().isIn(['ACTIVE', 'INACTIVE']),
    body('password').optional().isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
];

module.exports = { userUpdateRules };

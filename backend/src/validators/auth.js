/* ============================================================
   VALIDATORS/AUTH.JS — Express Validator Rules for Auth
   ============================================================ */
const { body } = require('express-validator');

const registerRules = [
    body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 100 }).withMessage('Name too long'),
    body('email').trim().isEmail().withMessage('Invalid email format').normalizeEmail(),
    body('phone').trim().notEmpty().withMessage('Phone is required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('confirmPassword').custom((value, { req }) => {
        if (value !== req.body.password) throw new Error('Passwords do not match');
        return true;
    })
];

const loginRules = [
    body('identifier').trim().notEmpty().withMessage('Email or phone is required'),
    body('password').notEmpty().withMessage('Password is required')
];

const profileUpdateRules = [
    body('name').optional().trim().notEmpty().withMessage('Name cannot be empty').isLength({ max: 100 }),
    body('phone').optional().trim(),
    body('currentPassword').optional(),
    body('newPassword').optional().isLength({ min: 8 }).withMessage('New password must be at least 8 characters')
];

module.exports = { registerRules, loginRules, profileUpdateRules };

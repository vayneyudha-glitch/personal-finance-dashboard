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
    }),
    body('phoneVerified').optional().isBoolean().withMessage('phoneVerified must be boolean')
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

// OTP send validation — email is required (OTP sent via email only)
const otpSendRules = [
    body('phone').trim().notEmpty().withMessage('Phone number is required'),
    body('name').optional().trim(),
    body('email').trim().notEmpty().withMessage('Email is required').isEmail().withMessage('Invalid email format')
];

// OTP verify validation — email is required to identify the OTP record
const otpVerifyRules = [
    body('phone').trim().notEmpty().withMessage('Phone number is required'),
    body('email').optional().trim().isEmail().withMessage('Invalid email format'),
    body('code').trim().notEmpty().withMessage('Verification code is required')
        .isLength({ min: 6, max: 6 }).withMessage('Code must be 6 digits')
];

module.exports = {
    registerRules,
    loginRules,
    profileUpdateRules,
    otpSendRules,
    otpVerifyRules
};

/* ============================================================
   VALIDATORS/TRANSACTION.JS — Express Validator Rules for Transactions
   ============================================================ */
const { body } = require('express-validator');

const transactionRules = [
    body('type').isIn(['Income', 'Expense']).withMessage('Type must be Income or Expense'),
    body('amount').isFloat({ gt: 0 }).withMessage('Amount must be greater than 0'),
    body('categoryId').isInt({ min: 1 }).withMessage('Valid category is required'),
    body('description').trim().notEmpty().withMessage('Description is required').isLength({ max: 200 }).withMessage('Description too long'),
    body('transactionDate').isISO8601().withMessage('Valid date is required')
];

module.exports = { transactionRules };

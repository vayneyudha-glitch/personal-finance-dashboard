/* ============================================================
   VALIDATORS/CATEGORY.JS — Express Validator Rules for Categories
   ============================================================ */
const { body } = require('express-validator');

const categoryRules = [
    body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 50 }).withMessage('Name too long'),
    body('type').isIn(['Income', 'Expense']).withMessage('Type must be Income or Expense'),
    body('description').optional().trim().isLength({ max: 200 })
];

module.exports = { categoryRules };

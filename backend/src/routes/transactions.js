/* ============================================================
   ROUTES/TRANSACTIONS.JS — Transaction CRUD
   ============================================================
   GET    /api/transactions           — List (user: own, admin: all) with pagination
   POST   /api/transactions           — Create (user: own, admin: any user)
   GET    /api/transactions/:id       — Get single (owner or admin)
   PUT    /api/transactions/:id       — Update (owner or admin)
   DELETE /api/transactions/:id      — Delete (owner or admin)
   ============================================================ */

const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { auth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { transactionRules } = require('../validators/transaction');
const { logActivity, getClientIp } = require('../middleware/activityLog');

// GET /api/transactions — List with pagination, search, filter, sort
router.get('/', auth, async (req, res, next) => {
    try {
        const {
            type, categoryId, search,
            dateFrom, dateTo,
            page = 1, limit = 10,
            sortBy = 'transaction_date', sortOrder = 'DESC'
        } = req.query;

        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
        const offset = (pageNum - 1) * limitNum;

        // Allowed sort columns
        const allowedSort = ['transaction_date', 'amount', 'created_at', 'type'];
        const sortColumn = allowedSort.includes(sortBy) ? sortBy : 'transaction_date';
        const sortDir = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        let where = 'WHERE 1=1';
        const params = [];

        // Role-based filtering: USER sees only own transactions
        if (req.user.role !== 'ADMIN') {
            where += ' AND t.user_id = ?';
            params.push(req.user.id);
        }

        if (type) { where += ' AND t.type = ?'; params.push(type); }
        if (categoryId) { where += ' AND t.category_id = ?'; params.push(parseInt(categoryId)); }
        if (search) { where += ' AND t.description LIKE ?'; params.push(`%${search}%`); }
        if (dateFrom) { where += ' AND t.transaction_date >= ?'; params.push(dateFrom); }
        if (dateTo) { where += ' AND t.transaction_date <= ?'; params.push(dateTo); }

        // Count total
        const [countRows] = await pool.query(
            `SELECT COUNT(*) as total FROM transactions t ${where}`,
            params
        );
        const total = countRows[0].total;

        // Fetch with joins
        const [rows] = await pool.query(
            `SELECT t.id, t.user_id, t.category_id, t.type, t.amount, t.description,
                    t.transaction_date, t.created_at, t.updated_at,
                    c.name as category_name, c.type as category_type,
                    u.name as user_name, u.email as user_email
             FROM transactions t
             JOIN categories c ON t.category_id = c.id
             JOIN users u ON t.user_id = u.id
             ${where}
             ORDER BY t.${sortColumn} ${sortDir}
             LIMIT ? OFFSET ?`,
            [...params, limitNum, offset]
        );

        const items = rows.map(t => ({
            id: t.id,
            userId: t.user_id,
            userName: t.user_name,
            userEmail: t.user_email,
            categoryId: t.category_id,
            categoryName: t.category_name,
            type: t.type,
            amount: parseFloat(t.amount),
            description: t.description,
            transactionDate: t.transaction_date,
            createdAt: t.created_at,
            updatedAt: t.updated_at
        }));

        return res.json({
            success: true,
            message: 'Transactions fetched',
            data: {
                items,
                pagination: {
                    total,
                    page: pageNum,
                    limit: limitNum,
                    totalPages: Math.ceil(total / limitNum)
                }
            }
        });
    } catch (err) {
        next(err);
    }
});

// POST /api/transactions — Create
router.post('/', auth, transactionRules, validate, async (req, res, next) => {
    try {
        const { type, amount, categoryId, description, transactionDate } = req.body;

        // User creates for themselves; Admin can specify user_id
        const userId = req.user.role === 'ADMIN' && req.body.userId
            ? parseInt(req.body.userId)
            : req.user.id;

        // Validate category exists and type matches
        const [catRows] = await pool.query('SELECT id, type FROM categories WHERE id = ?', [categoryId]);
        if (catRows.length === 0) {
            return res.status(400).json({ success: false, message: 'Invalid category.' });
        }
        if (catRows[0].type !== type) {
            return res.status(400).json({ success: false, message: `Category type mismatch. Expected ${type}.` });
        }

        const [result] = await pool.query(
            `INSERT INTO transactions (user_id, category_id, type, amount, description, transaction_date)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [userId, categoryId, type, amount, description.trim(), transactionDate]
        );

        await logActivity(req.user.id, 'CREATE_TRANSACTION', `Transaction #${result.insertId} created`, getClientIp(req));

        return res.status(201).json({
            success: true,
            message: 'Transaction created successfully!',
            data: {
                id: result.insertId,
                userId,
                categoryId,
                type,
                amount: parseFloat(amount),
                description: description.trim(),
                transactionDate
            }
        });
    } catch (err) {
        next(err);
    }
});

// GET /api/transactions/:id — Get single
router.get('/:id', auth, async (req, res, next) => {
    try {
        const { id } = req.params;

        const [rows] = await pool.query(
            `SELECT t.*, c.name as category_name, u.name as user_name, u.email as user_email
             FROM transactions t
             JOIN categories c ON t.category_id = c.id
             JOIN users u ON t.user_id = u.id
             WHERE t.id = ?`,
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Transaction not found.' });
        }

        const t = rows[0];

        // Authorization: only owner or admin
        if (req.user.role !== 'ADMIN' && t.user_id !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Access denied. This is not your transaction.' });
        }

        return res.json({
            success: true,
            data: {
                id: t.id,
                userId: t.user_id,
                userName: t.user_name,
                userEmail: t.user_email,
                categoryId: t.category_id,
                categoryName: t.category_name,
                type: t.type,
                amount: parseFloat(t.amount),
                description: t.description,
                transactionDate: t.transaction_date,
                createdAt: t.created_at,
                updatedAt: t.updated_at
            }
        });
    } catch (err) {
        next(err);
    }
});

// PUT /api/transactions/:id — Update
router.put('/:id', auth, transactionRules, validate, async (req, res, next) => {
    try {
        const { id } = req.params;
        const { type, amount, categoryId, description, transactionDate } = req.body;

        const [existing] = await pool.query('SELECT id, user_id FROM transactions WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Transaction not found.' });
        }

        // Authorization: only owner or admin
        if (req.user.role !== 'ADMIN' && existing[0].user_id !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Access denied. You can only edit your own transactions.' });
        }

        // Validate category
        const [catRows] = await pool.query('SELECT id, type FROM categories WHERE id = ?', [categoryId]);
        if (catRows.length === 0 || catRows[0].type !== type) {
            return res.status(400).json({ success: false, message: 'Invalid category for this transaction type.' });
        }

        await pool.query(
            `UPDATE transactions SET type = ?, amount = ?, category_id = ?, description = ?, transaction_date = ? WHERE id = ?`,
            [type, amount, categoryId, description.trim(), transactionDate, id]
        );

        await logActivity(req.user.id, 'UPDATE_TRANSACTION', `Transaction #${id} updated`, getClientIp(req));

        return res.json({
            success: true,
            message: 'Transaction updated successfully!',
            data: {
                id: parseInt(id),
                type,
                amount: parseFloat(amount),
                categoryId,
                description: description.trim(),
                transactionDate
            }
        });
    } catch (err) {
        next(err);
    }
});

// DELETE /api/transactions/:id — Delete
router.delete('/:id', auth, async (req, res, next) => {
    try {
        const { id } = req.params;

        const [existing] = await pool.query('SELECT id, user_id FROM transactions WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Transaction not found.' });
        }

        // Authorization: only owner or admin
        if (req.user.role !== 'ADMIN' && existing[0].user_id !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Access denied. You can only delete your own transactions.' });
        }

        await pool.query('DELETE FROM transactions WHERE id = ?', [id]);
        await logActivity(req.user.id, 'DELETE_TRANSACTION', `Transaction #${id} deleted`, getClientIp(req));

        return res.json({ success: true, message: 'Transaction deleted successfully!' });
    } catch (err) {
        next(err);
    }
});

module.exports = router;

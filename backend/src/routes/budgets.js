/* ============================================================
   ROUTES/BUDGETS.JS — Budget Management (User + Admin)
   ============================================================
   GET  /api/budgets           — List budgets (user: own, admin: all)
   POST /api/budgets           — Create budget
   PUT  /api/budgets/:id       — Update budget
   DELETE /api/budgets/:id     — Delete budget
   ============================================================ */

const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { auth } = require('../middleware/auth');
const { logActivity, getClientIp } = require('../middleware/activityLog');

// GET /api/budgets
router.get('/', auth, async (req, res, next) => {
    try {
        const isAdmin = req.user.role === 'ADMIN';
        let where = 'WHERE 1=1';
        const params = [];

        if (!isAdmin) {
            where += ' AND b.user_id = ?';
            params.push(req.user.id);
        }

        const [rows] = await pool.query(
            `SELECT b.id, b.user_id, b.category_id, b.amount, b.period, b.start_date, b.end_date, b.status,
                    b.created_at, b.updated_at,
                    u.name as user_name, u.email as user_email,
                    c.name as category_name, c.type as category_type
             FROM budgets b
             LEFT JOIN users u ON b.user_id = u.id
             LEFT JOIN categories c ON b.category_id = c.id
             ${where}
             ORDER BY b.created_at DESC`,
            params
        );

        // Calculate actual spending
        const budgets = [];
        for (const b of rows) {
            const [actual] = await pool.query(
                `SELECT COALESCE(SUM(amount), 0) as spent
                 FROM transactions
                 WHERE user_id = ? AND type = 'Expense'
                   AND transaction_date >= ? AND transaction_date <= ?
                   ${b.category_id ? 'AND category_id = ?' : ''}`,
                b.category_id
                    ? [b.user_id, b.start_date, b.end_date || new Date().toISOString().split('T')[0], b.category_id]
                    : [b.user_id, b.start_date, b.end_date || new Date().toISOString().split('T')[0]]
            );
            const spent = parseFloat(actual[0].spent);
            const budgetAmount = parseFloat(b.amount);
            const percentage = budgetAmount > 0 ? (spent / budgetAmount * 100) : 0;
            let budgetStatus;
            if (percentage >= 100) budgetStatus = 'OVER_BUDGET';
            else if (percentage >= 90) budgetStatus = 'CRITICAL';
            else if (percentage >= 70) budgetStatus = 'WARNING';
            else budgetStatus = 'UNDER_BUDGET';

            budgets.push({
                id: b.id, userId: b.user_id, userName: b.user_name, userEmail: b.user_email,
                categoryId: b.category_id, categoryName: b.category_name, categoryType: b.category_type,
                amount: budgetAmount, period: b.period,
                startDate: b.start_date, endDate: b.end_date, status: b.status,
                createdAt: b.created_at, updatedAt: b.updated_at,
                actual: spent, remaining: budgetAmount - spent,
                percentage: Math.round(percentage * 100) / 100,
                budgetStatus
            });
        }

        return res.json({ success: true, data: { items: budgets } });
    } catch (err) {
        next(err);
    }
});

// POST /api/budgets
router.post('/', auth, async (req, res, next) => {
    try {
        const { categoryId, amount, period, startDate, endDate, userId } = req.body;

        const budgetUserId = req.user.role === 'ADMIN' && userId
            ? parseInt(userId)
            : req.user.id;

        if (!amount || !startDate) {
            return res.status(400).json({ success: false, message: 'Amount and startDate are required.' });
        }

        const [result] = await pool.query(
            `INSERT INTO budgets (user_id, category_id, amount, period, start_date, end_date)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [budgetUserId, categoryId || null, parseFloat(amount), period || 'monthly', startDate, endDate || null]
        );

        await logActivity(req.user.id, 'CREATE_BUDGET', `Budget #${result.insertId} created`, getClientIp(req));

        return res.status(201).json({
            success: true,
            message: 'Budget created successfully!',
            data: { id: result.insertId }
        });
    } catch (err) {
        next(err);
    }
});

// PUT /api/budgets/:id
router.put('/:id', auth, async (req, res, next) => {
    try {
        const { id } = req.params;
        const { amount, period, startDate, endDate, status, categoryId } = req.body;

        const [existing] = await pool.query('SELECT id, user_id FROM budgets WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Budget not found.' });
        }

        // Authorization: owner or admin
        if (req.user.role !== 'ADMIN' && existing[0].user_id !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Access denied.' });
        }

        const updates = [];
        const params = [];

        if (amount !== undefined) { updates.push('amount = ?'); params.push(parseFloat(amount)); }
        if (period !== undefined) { updates.push('period = ?'); params.push(period); }
        if (startDate !== undefined) { updates.push('start_date = ?'); params.push(startDate); }
        if (endDate !== undefined) { updates.push('end_date = ?'); params.push(endDate); }
        if (status !== undefined) { updates.push('status = ?'); params.push(status); }
        if (categoryId !== undefined) { updates.push('category_id = ?'); params.push(categoryId || null); }

        if (updates.length === 0) {
            return res.status(400).json({ success: false, message: 'No fields to update.' });
        }

        params.push(id);
        await pool.query(`UPDATE budgets SET ${updates.join(', ')} WHERE id = ?`, params);
        await logActivity(req.user.id, 'UPDATE_BUDGET', `Budget #${id} updated`, getClientIp(req));

        return res.json({ success: true, message: 'Budget updated successfully!' });
    } catch (err) {
        next(err);
    }
});

// DELETE /api/budgets/:id
router.delete('/:id', auth, async (req, res, next) => {
    try {
        const { id } = req.params;
        const [existing] = await pool.query('SELECT id, user_id FROM budgets WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Budget not found.' });
        }

        // Authorization: owner or admin
        if (req.user.role !== 'ADMIN' && existing[0].user_id !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Access denied.' });
        }

        await pool.query('DELETE FROM budgets WHERE id = ?', [id]);
        await logActivity(req.user.id, 'DELETE_BUDGET', `Budget #${id} deleted`, getClientIp(req));

        return res.json({ success: true, message: 'Budget deleted successfully!' });
    } catch (err) {
        next(err);
    }
});

module.exports = router;

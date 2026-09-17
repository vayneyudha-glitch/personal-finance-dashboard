/* ============================================================
   ROUTES/DASHBOARD.JS — User Dashboard Stats
   ============================================================
   GET /api/dashboard — Stats for current user
   ============================================================ */

const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { auth } = require('../middleware/auth');

router.get('/', auth, async (req, res, next) => {
    try {
        const userId = req.user.id;
        const isAdmin = req.user.role === 'ADMIN';

        // For admin: show all; for user: show own
        const userFilter = isAdmin ? '' : 'WHERE t.user_id = ?';
        const params = isAdmin ? [] : [userId];

        // Summary stats
        const [summaryRows] = await pool.query(
            `SELECT
                COALESCE(SUM(CASE WHEN t.type = 'Income' THEN t.amount ELSE 0 END), 0) as total_income,
                COALESCE(SUM(CASE WHEN t.type = 'Expense' THEN t.amount ELSE 0 END), 0) as total_expense,
                COUNT(*) as total_transactions
             FROM transactions t ${userFilter}`,
            params
        );

        const summary = summaryRows[0];
        const totalIncome = parseFloat(summary.total_income);
        const totalExpense = parseFloat(summary.total_expense);
        const totalBalance = totalIncome - totalExpense;

        // This month
        const now = new Date();
        const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

        const userMonthFilter = isAdmin ? 'WHERE DATE_FORMAT(t.transaction_date, "%Y-%m") = ?' : 'WHERE t.user_id = ? AND DATE_FORMAT(t.transaction_date, "%Y-%m") = ?';
        const monthParams = isAdmin ? [monthKey] : [userId, monthKey];

        const [monthRows] = await pool.query(
            `SELECT
                COALESCE(SUM(CASE WHEN t.type = 'Income' THEN t.amount ELSE 0 END), 0) as month_income,
                COALESCE(SUM(CASE WHEN t.type = 'Expense' THEN t.amount ELSE 0 END), 0) as month_expense,
                COUNT(*) as month_count
             FROM transactions t ${userMonthFilter}`,
            monthParams
        );

        const month = monthRows[0];
        const monthIncome = parseFloat(month.month_income);
        const monthExpense = parseFloat(month.month_expense);
        const netCashFlow = monthIncome - monthExpense;

        // Savings rate
        const savingsRate = totalIncome > 0 ? ((totalIncome - totalExpense) / totalIncome * 100) : 0;

        // Monthly trend (last 6 months)
        const userTrendFilter = isAdmin ? '' : 'AND t.user_id = ?';
        const trendParams = isAdmin ? [] : [userId];
        const [trendRows] = await pool.query(
            `SELECT
                DATE_FORMAT(t.transaction_date, '%Y-%m') as month,
                COALESCE(SUM(CASE WHEN t.type = 'Income' THEN t.amount ELSE 0 END), 0) as income,
                COALESCE(SUM(CASE WHEN t.type = 'Expense' THEN t.amount ELSE 0 END), 0) as expense,
                COUNT(*) as count
             FROM transactions t
             WHERE t.transaction_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
             ${userTrendFilter}
             GROUP BY DATE_FORMAT(t.transaction_date, '%Y-%m')
             ORDER BY month ASC`,
            trendParams
        );

        const monthlyTrend = trendRows.map(r => ({
            month: r.month,
            income: parseFloat(r.income),
            expense: parseFloat(r.expense),
            count: r.count
        }));

        // Expense by category
        const userCatFilter = isAdmin ? '' : 'AND t.user_id = ?';
        const catParams = isAdmin ? [] : [userId];
        const [catRows] = await pool.query(
            `SELECT c.name, c.id, SUM(t.amount) as total
             FROM transactions t
             JOIN categories c ON t.category_id = c.id
             WHERE t.type = 'Expense' ${userCatFilter}
             GROUP BY c.id, c.name
             ORDER BY total DESC`,
            catParams
        );

        const expenseByCategory = catRows.map(c => ({
            categoryId: c.id,
            name: c.name,
            total: parseFloat(c.total)
        }));

        return res.json({
            success: true,
            data: {
                totalIncome,
                totalExpense,
                totalBalance,
                totalTransactions: summary.total_transactions,
                monthIncome,
                monthExpense,
                netCashFlow,
                savingsRate: Math.round(savingsRate * 100) / 100,
                monthTransactions: month.month_count,
                monthlyTrend,
                expenseByCategory
            }
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;

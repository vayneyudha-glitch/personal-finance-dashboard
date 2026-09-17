/* ============================================================
   ROUTES/ADMIN.JS — Admin Control Center & Analytics Platform
   ============================================================
   ENDPOINTS:
   --- Executive Dashboard ---
   GET  /api/admin/dashboard          — KPIs + comparison + charts + date filter
   --- User Management ---
   GET  /api/admin/users              — List users (with financial summary)
   GET  /api/admin/users/:id         — User 360° view (profile + financial + activity)
   PUT  /api/admin/users/:id         — Update user
   DELETE /api/admin/users/:id       — Delete user
   --- Transaction Management ---
   GET  /api/admin/transactions       — All transactions (filter, sort, pagination)
   DELETE /api/admin/transactions/:id — Delete transaction
   POST /api/admin/transactions/bulk-delete — Bulk delete
   --- Financial Analytics ---
   GET  /api/admin/analytics         — Full analytics (descriptive stats)
   GET  /api/admin/analytics/income  — Income analysis
   GET  /api/admin/analytics/expense  — Expense analysis
   GET  /api/admin/analytics/cashflow — Cash flow analysis
   --- Category Analytics ---
   GET  /api/admin/categories/usage  — Category usage stats
   --- Budget Management ---
   GET  /api/admin/budgets           — List budgets
   POST /api/admin/budgets           — Create budget
   PUT  /api/admin/budgets/:id      — Update budget
   DELETE /api/admin/budgets/:id    — Delete budget
   --- Reports ---
   GET  /api/admin/reports            — Generate report (type, date, user, category)
   --- Data Quality ---
   GET  /api/admin/data-quality      — Data quality checks + score
   --- Forecasting ---
   GET  /api/admin/forecast          — Financial forecast (moving avg + linear trend)
   --- Alerts ---
   GET  /api/admin/alerts            — System alerts
   POST /api/admin/alerts/:id/read  — Mark alert as read
   --- Activity Logs ---
   GET  /api/admin/activity-logs     — Activity logs (filter, pagination)
   --- Security Center ---
   GET  /api/admin/security          — Failed logins, recent logins, suspicious
   --- System Health ---
   GET  /api/admin/system-health     — Server/DB health
   --- Settings ---
   GET  /api/admin/settings         — System settings
   PUT  /api/admin/settings         — Update settings
   --- Insights ---
   GET  /api/admin/insights         — Automated business insights
   ============================================================ */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const os = require('os');
const pool = require('../config/db');
const { auth, requireAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { userUpdateRules } = require('../validators/user');
const { logActivity, getClientIp } = require('../middleware/activityLog');

// All admin routes require auth + admin
router.use(auth, requireAdmin);

/* ============================================================
   HELPER: Date range builder
   ============================================================ */
function buildDateRange(filter, customFrom, customTo) {
    const now = new Date();
    let dateFrom = null;
    let dateTo = null;

    switch (filter) {
        case 'today':
            dateFrom = new Date();
            dateTo = new Date();
            break;
        case '7days':
            dateFrom = new Date(now);
            dateFrom.setDate(dateFrom.getDate() - 7);
            dateTo = new Date();
            break;
        case '30days':
            dateFrom = new Date(now);
            dateFrom.setDate(dateFrom.getDate() - 30);
            dateTo = new Date();
            break;
        case 'this_month':
            dateFrom = new Date(now.getFullYear(), now.getMonth(), 1);
            dateTo = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            break;
        case 'last_month':
            dateFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            dateTo = new Date(now.getFullYear(), now.getMonth(), 0);
            break;
        case 'this_year':
            dateFrom = new Date(now.getFullYear(), 0, 1);
            dateTo = new Date(now.getFullYear(), 11, 31);
            break;
        case 'custom':
            if (customFrom) dateFrom = new Date(customFrom);
            if (customTo) dateTo = new Date(customTo);
            break;
        default:
            // No filter — all time
            break;
    }

    const fmt = (d) => d ? d.toISOString().split('T')[0] : null;
    return { dateFrom: fmt(dateFrom), dateTo: fmt(dateTo) };
}

/* ============================================================
   HELPER: Percentage change calculator
   ============================================================ */
function calcChange(current, previous) {
    if (parseFloat(previous) === 0) {
        return parseFloat(current) > 0 ? 100 : 0;
    }
    return ((parseFloat(current) - parseFloat(previous)) / parseFloat(previous)) * 100;
}

/* ============================================================
   HELPER: Build WHERE clause for date range
   ============================================================ */
function dateRangeClause(dateFrom, dateTo, column = 't.transaction_date') {
    let clause = '';
    const params = [];
    if (dateFrom) { clause += ` AND ${column} >= ?`; params.push(dateFrom); }
    if (dateTo) { clause += ` AND ${column} <= ?`; params.push(dateTo); }
    return { clause, params };
}

/* ============================================================
   GET /api/admin/dashboard — Executive Dashboard
   ============================================================ */
router.get('/dashboard', async (req, res, next) => {
    try {
        const rangeFilter = req.query.range || 'this_month';
        const { dateFrom, dateTo } = buildDateRange(rangeFilter, req.query.dateFrom, req.query.dateTo);

        // --- KPI: User stats ---
        const [userStats] = await pool.query(
            `SELECT
                COUNT(*) as total_users,
                SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) as active_users,
                SUM(CASE WHEN status = 'INACTIVE' THEN 1 ELSE 0 END) as inactive_users,
                SUM(CASE WHEN DATE_FORMAT(created_at, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m') THEN 1 ELSE 0 END) as new_users_this_month
             FROM users`
        );

        // --- KPI: Transaction stats (with date filter) ---
        let trxWhere = 'WHERE 1=1';
        let trxParams = [];
        const dr = dateRangeClause(dateFrom, dateTo);
        trxWhere += dr.clause;
        trxParams = trxParams.concat(dr.params);

        const [trxStats] = await pool.query(
            `SELECT
                COUNT(*) as total_transactions,
                COALESCE(SUM(CASE WHEN type = 'Income' THEN amount ELSE 0 END), 0) as total_income,
                COALESCE(SUM(CASE WHEN type = 'Expense' THEN amount ELSE 0 END), 0) as total_expense
             FROM transactions t ${trxWhere}`,
            trxParams
        );

        const totalIncome = parseFloat(trxStats[0].total_income);
        const totalExpense = parseFloat(trxStats[0].total_expense);
        const netCashFlow = totalIncome - totalExpense;
        const avgTransaction = trxStats[0].total_transactions > 0
            ? (totalIncome + totalExpense) / trxStats[0].total_transactions : 0;

        // --- KPI: Today ---
        const [todayRows] = await pool.query(
            `SELECT COUNT(*) as count FROM transactions WHERE DATE(transaction_date) = CURDATE()`
        );

        // --- KPI: This month ---
        const [monthRows] = await pool.query(
            `SELECT COUNT(*) as count FROM transactions WHERE DATE_FORMAT(transaction_date, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')`
        );

        // --- Categories count ---
        const [catRows] = await pool.query('SELECT COUNT(*) as count FROM categories');

        // --- Comparison: Current vs Previous period ---
        let prevDateFrom, prevDateTo;
        const now = new Date();
        if (rangeFilter === 'this_month') {
            prevDateFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            prevDateTo = new Date(now.getFullYear(), now.getMonth(), 0);
        } else if (rangeFilter === 'this_year') {
            prevDateFrom = new Date(now.getFullYear() - 1, 0, 1);
            prevDateTo = new Date(now.getFullYear() - 1, 11, 31);
        } else {
            // Default to last month for comparison
            if (dateFrom && dateTo) {
                const diff = (new Date(dateTo) - new Date(dateFrom)) + (1000 * 60 * 60 * 24);
                prevDateTo = new Date(new Date(dateFrom) - 1);
                prevDateFrom = new Date(prevDateTo - diff);
            } else {
                prevDateFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                prevDateTo = new Date(now.getFullYear(), now.getMonth(), 0);
            }
        }

        const prevFromStr = prevDateFrom ? prevDateFrom.toISOString().split('T')[0] : null;
        const prevToStr = prevDateTo ? prevDateTo.toISOString().split('T')[0] : null;

        let prevWhere = 'WHERE 1=1';
        let prevParams = [];
        const prevDr = dateRangeClause(prevFromStr, prevToStr);
        prevWhere += prevDr.clause;
        prevParams = prevParams.concat(prevDr.params);

        const [prevStats] = await pool.query(
            `SELECT
                COALESCE(SUM(CASE WHEN type = 'Income' THEN amount ELSE 0 END), 0) as prev_income,
                COALESCE(SUM(CASE WHEN type = 'Expense' THEN amount ELSE 0 END), 0) as prev_expense,
                COUNT(*) as prev_count
             FROM transactions t ${prevWhere}`,
            prevParams
        );

        const prevIncome = parseFloat(prevStats[0].prev_income);
        const prevExpense = parseFloat(prevStats[0].prev_expense);

        const incomeChange = calcChange(totalIncome, prevIncome);
        const expenseChange = calcChange(totalExpense, prevExpense);
        const userChange = calcChange(userStats[0].new_users_this_month, 0);

        // --- Charts ---

        // 1. Income vs Expense (monthly, last 12 months)
        const [incomeVsExpense] = await pool.query(
            `SELECT
                DATE_FORMAT(t.transaction_date, '%Y-%m') as month,
                COALESCE(SUM(CASE WHEN t.type = 'Income' THEN t.amount ELSE 0 END), 0) as income,
                COALESCE(SUM(CASE WHEN t.type = 'Expense' THEN t.amount ELSE 0 END), 0) as expense
             FROM transactions t
             WHERE t.transaction_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
             GROUP BY DATE_FORMAT(t.transaction_date, '%Y-%m')
             ORDER BY month ASC`
        );

        // 2. Transactions per month (last 12)
        const [trxPerMonth] = await pool.query(
            `SELECT
                DATE_FORMAT(t.transaction_date, '%Y-%m') as month,
                COUNT(*) as count
             FROM transactions t
             WHERE t.transaction_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
             GROUP BY DATE_FORMAT(t.transaction_date, '%Y-%m')
             ORDER BY month ASC`
        );

        // 3. Users growth (cumulative, last 12 months)
        const [usersGrowth] = await pool.query(
            `SELECT
                DATE_FORMAT(created_at, '%Y-%m') as month,
                COUNT(*) as new_users
             FROM users
             WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
             GROUP BY DATE_FORMAT(created_at, '%Y-%m')
             ORDER BY month ASC`
        );

        // 4. Expense by category
        const [expByCat] = await pool.query(
            `SELECT c.name, c.id, COALESCE(SUM(t.amount), 0) as total
             FROM transactions t
             JOIN categories c ON t.category_id = c.id
             WHERE t.type = 'Expense' ${dr.clause}
             GROUP BY c.id, c.name
             ORDER BY total DESC
             LIMIT 10`,
            dr.params
        );

        // 5. Income by category
        const [incByCat] = await pool.query(
            `SELECT c.name, c.id, COALESCE(SUM(t.amount), 0) as total
             FROM transactions t
             JOIN categories c ON t.category_id = c.id
             WHERE t.type = 'Income' ${dr.clause}
             GROUP BY c.id, c.name
             ORDER BY total DESC
             LIMIT 10`,
            dr.params
        );

        // 6. Daily transactions (last 30 days)
        const [dailyTrx] = await pool.query(
            `SELECT
                DATE(t.transaction_date) as date,
                COUNT(*) as count,
                COALESCE(SUM(CASE WHEN t.type = 'Income' THEN t.amount ELSE 0 END), 0) as income,
                COALESCE(SUM(CASE WHEN t.type = 'Expense' THEN t.amount ELSE 0 END), 0) as expense
             FROM transactions t
             WHERE t.transaction_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
             GROUP BY DATE(t.transaction_date)
             ORDER BY date ASC`
        );

        // 7. Monthly financial trend (last 12 months)
        const [monthlyTrend] = await pool.query(
            `SELECT
                DATE_FORMAT(t.transaction_date, '%Y-%m') as month,
                COALESCE(SUM(CASE WHEN t.type = 'Income' THEN t.amount ELSE 0 END), 0) as income,
                COALESCE(SUM(CASE WHEN t.type = 'Expense' THEN t.amount ELSE 0 END), 0) as expense,
                COUNT(*) as count
             FROM transactions t
             WHERE t.transaction_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
             GROUP BY DATE_FORMAT(t.transaction_date, '%Y-%m')
             ORDER BY month ASC`
        );

        // 8. Recent activity (last 10)
        const [recentLogs] = await pool.query(
            `SELECT al.id, al.action, al.description, al.ip_address, al.created_at,
                    u.name as user_name, u.email as user_email
             FROM activity_logs al
             LEFT JOIN users u ON al.user_id = u.id
             ORDER BY al.created_at DESC
             LIMIT 10`
        );

        return res.json({
            success: true,
            data: {
                // KPIs
                totalUsers: userStats[0].total_users,
                activeUsers: userStats[0].active_users,
                inactiveUsers: userStats[0].inactive_users,
                newUsersThisMonth: userStats[0].new_users_this_month,
                totalTransactions: trxStats[0].total_transactions,
                totalIncome,
                totalExpense,
                netCashFlow,
                averageTransaction: Math.round(avgTransaction),
                totalCategories: catRows[0].count,
                transactionsToday: todayRows[0].count,
                transactionsThisMonth: monthRows[0].count,
                // Comparisons
                comparisons: {
                    incomeChange: Math.round(incomeChange * 10) / 10,
                    expenseChange: Math.round(expenseChange * 10) / 10,
                    userChange: Math.round(userChange * 10) / 10,
                    prevIncome,
                    prevExpense,
                    prevTransactionCount: prevStats[0].prev_count
                },
                // Charts
                charts: {
                    incomeVsExpense: incomeVsExpense.map(r => ({
                        month: r.month, income: parseFloat(r.income), expense: parseFloat(r.expense)
                    })),
                    transactionsPerMonth: trxPerMonth.map(r => ({ month: r.month, count: r.count })),
                    usersGrowth: usersGrowth.map(r => ({ month: r.month, newUsers: r.new_users })),
                    expenseByCategory: expByCat.map(r => ({ id: r.id, name: r.name, total: parseFloat(r.total) })),
                    incomeByCategory: incByCat.map(r => ({ id: r.id, name: r.name, total: parseFloat(r.total) })),
                    dailyTransactions: dailyTrx.map(r => ({
                        date: r.date, count: r.count,
                        income: parseFloat(r.income), expense: parseFloat(r.expense)
                    })),
                    monthlyTrend: monthlyTrend.map(r => ({
                        month: r.month, income: parseFloat(r.income),
                        expense: parseFloat(r.expense), count: r.count
                    }))
                },
                recentActivity: recentLogs.map(l => ({
                    id: l.id, action: l.action, description: l.description,
                    ipAddress: l.ip_address, createdAt: l.created_at,
                    userName: l.user_name, userEmail: l.user_email
                }))
            }
        });
    } catch (err) {
        next(err);
    }
});

/* ============================================================
   GET /api/admin/users — List users with financial summary
   ============================================================ */
router.get('/users', async (req, res, next) => {
    try {
        const { search, role, status, page = 1, limit = 10, sortBy = 'id', sortOrder = 'ASC' } = req.query;
        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
        const offset = (pageNum - 1) * limitNum;

        const allowedSort = ['id', 'name', 'email', 'role', 'status', 'created_at'];
        const sortColumn = allowedSort.includes(sortBy) ? sortBy : 'id';
        const sortDir = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        let where = 'WHERE 1=1';
        const params = [];

        if (search) {
            where += ' AND (u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)';
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        if (role && ['ADMIN', 'USER'].includes(role)) {
            where += ' AND u.role = ?';
            params.push(role);
        }
        if (status && ['ACTIVE', 'INACTIVE'].includes(status)) {
            where += ' AND u.status = ?';
            params.push(status);
        }

        const [countRows] = await pool.query(
            `SELECT COUNT(*) as total FROM users u ${where}`,
            params
        );
        const total = countRows[0].total;

        const [rows] = await pool.query(
            `SELECT u.id, u.name, u.email, u.phone, u.role, u.status, u.created_at, u.updated_at,
                    (SELECT MAX(al.created_at) FROM activity_logs al WHERE al.user_id = u.id) as last_activity,
                    COALESCE(t.count, 0) as transaction_count,
                    COALESCE(t.income, 0) as total_income,
                    COALESCE(t.expense, 0) as total_expense
             FROM users u
             LEFT JOIN (
                 SELECT user_id, COUNT(*) as count,
                     COALESCE(SUM(CASE WHEN type = 'Income' THEN amount ELSE 0 END), 0) as income,
                     COALESCE(SUM(CASE WHEN type = 'Expense' THEN amount ELSE 0 END), 0) as expense
                 FROM transactions GROUP BY user_id
             ) t ON t.user_id = u.id
             ${where}
             ORDER BY u.${sortColumn} ${sortDir}
             LIMIT ? OFFSET ?`,
            [...params, limitNum, offset]
        );

        return res.json({
            success: true,
            data: {
                items: rows.map(u => ({
                    id: u.id, name: u.name, email: u.email, phone: u.phone,
                    role: u.role, status: u.status,
                    createdAt: u.created_at, updatedAt: u.updated_at,
                    lastActivity: u.last_activity,
                    transactionCount: u.transaction_count,
                    totalIncome: parseFloat(u.total_income),
                    totalExpense: parseFloat(u.total_expense)
                })),
                pagination: {
                    total, page: pageNum, limit: limitNum,
                    totalPages: Math.ceil(total / limitNum)
                }
            }
        });
    } catch (err) {
        next(err);
    }
});

/* ============================================================
   GET /api/admin/users/:id — User 360° view
   ============================================================ */
router.get('/users/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const [rows] = await pool.query(
            `SELECT id, name, email, phone, role, status, created_at, updated_at FROM users WHERE id = ?`,
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        const u = rows[0];

        // Financial summary
        const [trxSummary] = await pool.query(
            `SELECT
                COUNT(*) as count,
                COALESCE(SUM(CASE WHEN type = 'Income' THEN amount ELSE 0 END), 0) as income,
                COALESCE(SUM(CASE WHEN type = 'Expense' THEN amount ELSE 0 END), 0) as expense,
                COALESCE(AVG(amount), 0) as avg_amount,
                COALESCE(MAX(CASE WHEN type = 'Income' THEN amount ELSE 0 END), 0) as largest_income,
                COALESCE(MAX(CASE WHEN type = 'Expense' THEN amount ELSE 0 END), 0) as largest_expense
             FROM transactions WHERE user_id = ?`,
            [id]
        );

        const income = parseFloat(trxSummary[0].income);
        const expense = parseFloat(trxSummary[0].expense);

        // Monthly trend (last 6 months)
        const [monthlyTrend] = await pool.query(
            `SELECT
                DATE_FORMAT(t.transaction_date, '%Y-%m') as month,
                COALESCE(SUM(CASE WHEN t.type = 'Income' THEN t.amount ELSE 0 END), 0) as income,
                COALESCE(SUM(CASE WHEN t.type = 'Expense' THEN t.amount ELSE 0 END), 0) as expense
             FROM transactions t
             WHERE t.user_id = ? AND t.transaction_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
             GROUP BY DATE_FORMAT(t.transaction_date, '%Y-%m')
             ORDER BY month ASC`,
            [id]
        );

        // Expense by category
        const [expByCat] = await pool.query(
            `SELECT c.name, c.id, SUM(t.amount) as total
             FROM transactions t
             JOIN categories c ON t.category_id = c.id
             WHERE t.user_id = ? AND t.type = 'Expense'
             GROUP BY c.id, c.name ORDER BY total DESC LIMIT 10`,
            [id]
        );

        // Income by category
        const [incByCat] = await pool.query(
            `SELECT c.name, c.id, SUM(t.amount) as total
             FROM transactions t
             JOIN categories c ON t.category_id = c.id
             WHERE t.user_id = ? AND t.type = 'Income'
             GROUP BY c.id, c.name ORDER BY total DESC LIMIT 10`,
            [id]
        );

        // Recent transactions (latest 10)
        const [recentTrx] = await pool.query(
            `SELECT t.id, t.type, t.amount, t.description, t.transaction_date, t.created_at,
                    c.name as category_name
             FROM transactions t
             JOIN categories c ON t.category_id = c.id
             WHERE t.user_id = ?
             ORDER BY t.transaction_date DESC, t.id DESC
             LIMIT 10`,
            [id]
        );

        // User activity (latest 20)
        const [userActivity] = await pool.query(
            `SELECT al.id, al.action, al.description, al.ip_address, al.created_at
             FROM activity_logs al
             WHERE al.user_id = ?
             ORDER BY al.created_at DESC
             LIMIT 20`,
            [id]
        );

        return res.json({
            success: true,
            data: {
                profile: {
                    id: u.id, name: u.name, email: u.email, phone: u.phone,
                    role: u.role, status: u.status,
                    createdAt: u.created_at, updatedAt: u.updated_at
                },
                financialSummary: {
                    totalIncome: income,
                    totalExpense: expense,
                    netBalance: income - expense,
                    transactionCount: trxSummary[0].count,
                    averageTransaction: parseFloat(trxSummary[0].avg_amount),
                    largestIncome: parseFloat(trxSummary[0].largest_income),
                    largestExpense: parseFloat(trxSummary[0].largest_expense)
                },
                charts: {
                    monthlyTrend: monthlyTrend.map(r => ({
                        month: r.month, income: parseFloat(r.income), expense: parseFloat(r.expense)
                    })),
                    expenseByCategory: expByCat.map(r => ({ id: r.id, name: r.name, total: parseFloat(r.total) })),
                    incomeByCategory: incByCat.map(r => ({ id: r.id, name: r.name, total: parseFloat(r.total) }))
                },
                recentTransactions: recentTrx.map(t => ({
                    id: t.id, type: t.type, amount: parseFloat(t.amount),
                    description: t.description, categoryName: t.category_name,
                    transactionDate: t.transaction_date, createdAt: t.created_at
                })),
                activity: userActivity.map(a => ({
                    id: a.id, action: a.action, description: a.description,
                    ipAddress: a.ip_address, createdAt: a.created_at
                }))
            }
        });
    } catch (err) {
        next(err);
    }
});

/* ============================================================
   PUT /api/admin/users/:id — Update user
   ============================================================ */
router.put('/users/:id', userUpdateRules, validate, async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, email, phone, role, status, password } = req.body;

        const [existing] = await pool.query('SELECT id, email, role FROM users WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        // Prevent self-deactivation / self-role-change
        if (parseInt(id) === req.user.id) {
            if (status === 'INACTIVE') {
                return res.status(400).json({ success: false, message: 'Cannot deactivate your own account.' });
            }
            if (role && role !== 'ADMIN') {
                return res.status(400).json({ success: false, message: 'Cannot change your own role.' });
            }
        }

        const updates = [];
        const params = [];

        if (name !== undefined) { updates.push('name = ?'); params.push(name.trim()); }
        if (email !== undefined) {
            const [dup] = await pool.query('SELECT id FROM users WHERE email = ? AND id != ?', [email.toLowerCase().trim(), id]);
            if (dup.length > 0) return res.status(409).json({ success: false, message: 'Email already in use.' });
            updates.push('email = ?'); params.push(email.toLowerCase().trim());
        }
        if (phone !== undefined) {
            const [dup] = await pool.query('SELECT id FROM users WHERE phone = ? AND id != ?', [phone.trim(), id]);
            if (dup.length > 0) return res.status(409).json({ success: false, message: 'Phone already in use.' });
            updates.push('phone = ?'); params.push(phone.trim());
        }
        if (role !== undefined && ['ADMIN', 'USER'].includes(role)) {
            updates.push('role = ?'); params.push(role);
            await logActivity(req.user.id, 'ROLE_CHANGE', `User #${id} role changed to ${role}`, getClientIp(req));
        }
        if (status !== undefined && ['ACTIVE', 'INACTIVE'].includes(status)) {
            updates.push('status = ?'); params.push(status);
            if (status === 'INACTIVE') {
                await logActivity(req.user.id, 'USER_DEACTIVATED', `User #${id} deactivated`, getClientIp(req));
            } else {
                await logActivity(req.user.id, 'USER_ACTIVATED', `User #${id} activated`, getClientIp(req));
            }
        }
        if (password && password.length >= 8) {
            const hash = await bcrypt.hash(password, 10);
            updates.push('password_hash = ?'); params.push(hash);
            await logActivity(req.user.id, 'PASSWORD_RESET', `Password reset for user #${id}`, getClientIp(req));
        }

        if (updates.length === 0) {
            return res.status(400).json({ success: false, message: 'No fields to update.' });
        }

        params.push(id);
        await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
        await logActivity(req.user.id, 'ADMIN_UPDATE_USER', `User #${id} updated`, getClientIp(req));

        return res.json({ success: true, message: 'User updated successfully!' });
    } catch (err) {
        next(err);
    }
});

/* ============================================================
   DELETE /api/admin/users/:id — Delete user
   ============================================================ */
router.delete('/users/:id', async (req, res, next) => {
    try {
        const { id } = req.params;

        if (parseInt(id) === req.user.id) {
            return res.status(400).json({ success: false, message: 'Cannot delete your own account.' });
        }

        const [existing] = await pool.query('SELECT id, name, email FROM users WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        await pool.query('DELETE FROM users WHERE id = ?', [id]);
        await logActivity(req.user.id, 'ADMIN_DELETE_USER', `User "${existing[0].email}" deleted`, getClientIp(req));

        return res.json({ success: true, message: `User "${existing[0].name}" deleted successfully.` });
    } catch (err) {
        next(err);
    }
});

/* ============================================================
   GET /api/admin/transactions — All transactions (enhanced)
   ============================================================ */
router.get('/transactions', async (req, res, next) => {
    try {
        const {
            type, categoryId, userId, search,
            dateFrom, dateTo,
            amountMin, amountMax,
            page = 1, limit = 10,
            sortBy = 'transaction_date', sortOrder = 'DESC'
        } = req.query;

        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
        const offset = (pageNum - 1) * limitNum;

        const allowedSort = ['transaction_date', 'amount', 'created_at', 'type', 'id'];
        const sortColumn = allowedSort.includes(sortBy) ? sortBy : 'transaction_date';
        const sortDir = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        let where = 'WHERE 1=1';
        const params = [];

        if (type) { where += ' AND t.type = ?'; params.push(type); }
        if (categoryId) { where += ' AND t.category_id = ?'; params.push(parseInt(categoryId)); }
        if (userId) { where += ' AND t.user_id = ?'; params.push(parseInt(userId)); }
        if (search) { where += ' AND t.description LIKE ?'; params.push(`%${search}%`); }
        if (dateFrom) { where += ' AND t.transaction_date >= ?'; params.push(dateFrom); }
        if (dateTo) { where += ' AND t.transaction_date <= ?'; params.push(dateTo); }
        if (amountMin) { where += ' AND t.amount >= ?'; params.push(parseFloat(amountMin)); }
        if (amountMax) { where += ' AND t.amount <= ?'; params.push(parseFloat(amountMax)); }

        const [countRows] = await pool.query(`SELECT COUNT(*) as total FROM transactions t ${where}`, params);
        const total = countRows[0].total;

        const [rows] = await pool.query(
            `SELECT t.id, t.user_id, t.category_id, t.type, t.amount, t.description,
                    t.transaction_date, t.created_at,
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

        return res.json({
            success: true,
            data: {
                items: rows.map(t => ({
                    id: t.id, userId: t.user_id, userName: t.user_name, userEmail: t.user_email,
                    categoryId: t.category_id, categoryName: t.category_name,
                    type: t.type, amount: parseFloat(t.amount), description: t.description,
                    transactionDate: t.transaction_date, createdAt: t.created_at
                })),
                pagination: {
                    total, page: pageNum, limit: limitNum,
                    totalPages: Math.ceil(total / limitNum)
                }
            }
        });
    } catch (err) {
        next(err);
    }
});

/* ============================================================
   DELETE /api/admin/transactions/:id — Delete transaction
   ============================================================ */
router.delete('/transactions/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const [existing] = await pool.query('SELECT id FROM transactions WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Transaction not found.' });
        }
        await pool.query('DELETE FROM transactions WHERE id = ?', [id]);
        await logActivity(req.user.id, 'DELETE_TRANSACTION', `Transaction #${id} deleted by admin`, getClientIp(req));
        return res.json({ success: true, message: 'Transaction deleted successfully!' });
    } catch (err) {
        next(err);
    }
});

/* ============================================================
   POST /api/admin/transactions/bulk-delete — Bulk delete
   ============================================================ */
router.post('/transactions/bulk-delete', async (req, res, next) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, message: 'No transaction IDs provided.' });
        }

        const placeholders = ids.map(() => '?').join(',');
        await pool.query(`DELETE FROM transactions WHERE id IN (${placeholders})`, ids);
        await logActivity(req.user.id, 'BULK_DELETE_TRANSACTIONS', `${ids.length} transactions deleted`, getClientIp(req));

        return res.json({ success: true, message: `${ids.length} transactions deleted successfully!` });
    } catch (err) {
        next(err);
    }
});

/* ============================================================
   GET /api/admin/analytics — Full Financial Analytics
   ============================================================ */
router.get('/analytics', async (req, res, next) => {
    try {
        const rangeFilter = req.query.range || 'this_month';
        const { dateFrom, dateTo } = buildDateRange(rangeFilter, req.query.dateFrom, req.query.dateTo);
        const dr = dateRangeClause(dateFrom, dateTo);

        // Descriptive statistics
        const [stats] = await pool.query(
            `SELECT
                COUNT(*) as count,
                COALESCE(SUM(CASE WHEN type = 'Income' THEN amount ELSE 0 END), 0) as total_income,
                COALESCE(SUM(CASE WHEN type = 'Expense' THEN amount ELSE 0 END), 0) as total_expense,
                COALESCE(AVG(CASE WHEN type = 'Income' THEN amount END), 0) as avg_income,
                COALESCE(AVG(CASE WHEN type = 'Expense' THEN amount END), 0) as avg_expense,
                COALESCE(MIN(CASE WHEN type = 'Income' THEN amount END), 0) as min_income,
                COALESCE(MAX(CASE WHEN type = 'Income' THEN amount END), 0) as max_income,
                COALESCE(MIN(CASE WHEN type = 'Expense' THEN amount END), 0) as min_expense,
                COALESCE(MAX(CASE WHEN type = 'Expense' THEN amount END), 0) as max_expense
             FROM transactions t WHERE 1=1 ${dr.clause}`,
            dr.params
        );

        // Median calculation (can't use SQL MEDIAN directly)
        const [incomeVals] = await pool.query(
            `SELECT amount FROM transactions WHERE type = 'Income' ${dr.clause} ORDER BY amount`,
            dr.params
        );
        const [expenseVals] = await pool.query(
            `SELECT amount FROM transactions WHERE type = 'Expense' ${dr.clause} ORDER BY amount`,
            dr.params
        );

        function median(arr) {
            if (arr.length === 0) return 0;
            const mid = Math.floor(arr.length / 2);
            return arr.length % 2 === 0
                ? (parseFloat(arr[mid - 1].amount) + parseFloat(arr[mid].amount)) / 2
                : parseFloat(arr[mid].amount);
        }

        // Standard deviation
        function stdDev(arr, mean) {
            if (arr.length === 0) return 0;
            const sum = arr.reduce((s, r) => s + parseFloat(r.amount), 0);
            const m = mean || (sum / arr.length);
            const variance = arr.reduce((s, r) => s + Math.pow(parseFloat(r.amount) - m, 2), 0) / arr.length;
            return Math.sqrt(variance);
        }

        const totalIncome = parseFloat(stats[0].total_income);
        const totalExpense = parseFloat(stats[0].total_expense);
        const netIncome = totalIncome - totalExpense;
        const expenseRatio = totalIncome > 0 ? (totalExpense / totalIncome * 100) : 0;
        const savingsRate = totalIncome > 0 ? (netIncome / totalIncome * 100) : 0;

        const avgIncome = parseFloat(stats[0].avg_income);
        const avgExpense = parseFloat(stats[0].avg_expense);

        // Average daily/monthly expense
        const [dailyAvg] = await pool.query(
            `SELECT
                COALESCE(AVG(daily_total), 0) as avg_daily,
                COUNT(DISTINCT DATE(transaction_date)) as active_days
             FROM (
                 SELECT DATE(transaction_date) as daily_date, SUM(amount) as daily_total
                 FROM transactions WHERE type = 'Expense' ${dr.clause}
                 GROUP BY DATE(transaction_date)
             ) sub`,
            dr.params
        );

        // Top 10 largest transactions
        const [top10] = await pool.query(
            `SELECT t.id, t.type, t.amount, t.description, t.transaction_date,
                    c.name as category_name, u.name as user_name
             FROM transactions t
             JOIN categories c ON t.category_id = c.id
             JOIN users u ON t.user_id = u.id
             WHERE 1=1 ${dr.clause}
             ORDER BY t.amount DESC LIMIT 10`,
            dr.params
        );

        // Bottom 10
        const [bottom10] = await pool.query(
            `SELECT t.id, t.type, t.amount, t.description, t.transaction_date,
                    c.name as category_name, u.name as user_name
             FROM transactions t
             JOIN categories c ON t.category_id = c.id
             JOIN users u ON t.user_id = u.id
             WHERE 1=1 ${dr.clause}
             ORDER BY t.amount ASC LIMIT 10`,
            dr.params
        );

        // Top 10 users by expense
        const [topUsersExp] = await pool.query(
            `SELECT u.id, u.name, u.email, SUM(t.amount) as total_expense, COUNT(*) as count
             FROM transactions t JOIN users u ON t.user_id = u.id
             WHERE t.type = 'Expense' ${dr.clause}
             GROUP BY u.id, u.name, u.email ORDER BY total_expense DESC LIMIT 10`,
            dr.params
        );

        return res.json({
            success: true,
            data: {
                summary: {
                    totalIncome, totalExpense, netIncome,
                    expenseRatio: Math.round(expenseRatio * 100) / 100,
                    savingsRate: Math.round(savingsRate * 100) / 100,
                    transactionCount: stats[0].count,
                    averageIncome: Math.round(avgIncome),
                    averageExpense: Math.round(avgExpense),
                    medianIncome: median(incomeVals),
                    medianExpense: median(expenseVals),
                    minIncome: parseFloat(stats[0].min_income),
                    maxIncome: parseFloat(stats[0].max_income),
                    minExpense: parseFloat(stats[0].min_expense),
                    maxExpense: parseFloat(stats[0].max_expense),
                    stdDevIncome: Math.round(stdDev(incomeVals, avgIncome)),
                    stdDevExpense: Math.round(stdDev(expenseVals, avgExpense)),
                    averageDailyExpense: Math.round(parseFloat(dailyAvg[0].avg_daily)),
                    activeDays: dailyAvg[0].active_days
                },
                top10: top10.map(t => ({
                    id: t.id, type: t.type, amount: parseFloat(t.amount),
                    description: t.description, categoryName: t.category_name,
                    userName: t.user_name, transactionDate: t.transaction_date
                })),
                bottom10: bottom10.map(t => ({
                    id: t.id, type: t.type, amount: parseFloat(t.amount),
                    description: t.description, categoryName: t.category_name,
                    userName: t.user_name, transactionDate: t.transaction_date
                })),
                topUsersByExpense: topUsersExp.map(u => ({
                    id: u.id, name: u.name, email: u.email,
                    totalExpense: parseFloat(u.total_expense), count: u.count
                }))
            }
        });
    } catch (err) {
        next(err);
    }
});

/* ============================================================
   GET /api/admin/analytics/income — Income Analysis
   ============================================================ */
router.get('/analytics/income', async (req, res, next) => {
    try {
        const rangeFilter = req.query.range || 'this_year';
        const { dateFrom, dateTo } = buildDateRange(rangeFilter, req.query.dateFrom, req.query.dateTo);
        const dr = dateRangeClause(dateFrom, dateTo);

        const [summary] = await pool.query(
            `SELECT
                COUNT(*) as count,
                COALESCE(SUM(amount), 0) as total,
                COALESCE(AVG(amount), 0) as avg,
                COALESCE(MIN(amount), 0) as min,
                COALESCE(MAX(amount), 0) as max
             FROM transactions WHERE type = 'Income' ${dr.clause}`,
            dr.params
        );

        // Income by category
        const [byCat] = await pool.query(
            `SELECT c.id, c.name, SUM(t.amount) as total, COUNT(*) as count
             FROM transactions t JOIN categories c ON t.category_id = c.id
             WHERE t.type = 'Income' ${dr.clause}
             GROUP BY c.id, c.name ORDER BY total DESC`,
            dr.params
        );

        // Income by user (top 10)
        const [byUser] = await pool.query(
            `SELECT u.id, u.name, u.email, SUM(t.amount) as total, COUNT(*) as count
             FROM transactions t JOIN users u ON t.user_id = u.id
             WHERE t.type = 'Income' ${dr.clause}
             GROUP BY u.id, u.name, u.email ORDER BY total DESC LIMIT 10`,
            dr.params
        );

        // Income by month
        const [byMonth] = await pool.query(
            `SELECT
                DATE_FORMAT(t.transaction_date, '%Y-%m') as month,
                SUM(t.amount) as total, COUNT(*) as count
             FROM transactions t
             WHERE t.type = 'Income' ${dr.clause}
             GROUP BY DATE_FORMAT(t.transaction_date, '%Y-%m')
             ORDER BY month ASC`,
            dr.params
        );

        return res.json({
            success: true,
            data: {
                summary: {
                    count: summary[0].count,
                    total: parseFloat(summary[0].total),
                    average: Math.round(parseFloat(summary[0].avg)),
                    min: parseFloat(summary[0].min),
                    max: parseFloat(summary[0].max)
                },
                byCategory: byCat.map(r => ({ id: r.id, name: r.name, total: parseFloat(r.total), count: r.count })),
                byUser: byUser.map(r => ({ id: r.id, name: r.name, email: r.email, total: parseFloat(r.total), count: r.count })),
                byMonth: byMonth.map(r => ({ month: r.month, total: parseFloat(r.total), count: r.count }))
            }
        });
    } catch (err) {
        next(err);
    }
});

/* ============================================================
   GET /api/admin/analytics/expense — Expense Analysis
   ============================================================ */
router.get('/analytics/expense', async (req, res, next) => {
    try {
        const rangeFilter = req.query.range || 'this_year';
        const { dateFrom, dateTo } = buildDateRange(rangeFilter, req.query.dateFrom, req.query.dateTo);
        const dr = dateRangeClause(dateFrom, dateTo);

        const [summary] = await pool.query(
            `SELECT
                COUNT(*) as count,
                COALESCE(SUM(amount), 0) as total,
                COALESCE(AVG(amount), 0) as avg,
                COALESCE(MIN(amount), 0) as min,
                COALESCE(MAX(amount), 0) as max
             FROM transactions WHERE type = 'Expense' ${dr.clause}`,
            dr.params
        );

        // Expense by category
        const [byCat] = await pool.query(
            `SELECT c.id, c.name, SUM(t.amount) as total, COUNT(*) as count
             FROM transactions t JOIN categories c ON t.category_id = c.id
             WHERE t.type = 'Expense' ${dr.clause}
             GROUP BY c.id, c.name ORDER BY total DESC`,
            dr.params
        );

        // Expense by user (top 10)
        const [byUser] = await pool.query(
            `SELECT u.id, u.name, u.email, SUM(t.amount) as total, COUNT(*) as count
             FROM transactions t JOIN users u ON t.user_id = u.id
             WHERE t.type = 'Expense' ${dr.clause}
             GROUP BY u.id, u.name, u.email ORDER BY total DESC LIMIT 10`,
            dr.params
        );

        // Expense by month
        const [byMonth] = await pool.query(
            `SELECT
                DATE_FORMAT(t.transaction_date, '%Y-%m') as month,
                SUM(t.amount) as total, COUNT(*) as count
             FROM transactions t
             WHERE t.type = 'Expense' ${dr.clause}
             GROUP BY DATE_FORMAT(t.transaction_date, '%Y-%m')
             ORDER BY month ASC`,
            dr.params
        );

        // Expense by day of week
        const [byDayOfWeek] = await pool.query(
            `SELECT
                DAYOFWEEK(t.transaction_date) as day_of_week,
                SUM(t.amount) as total, COUNT(*) as count
             FROM transactions t
             WHERE t.type = 'Expense' ${dr.clause}
             GROUP BY DAYOFWEEK(t.transaction_date)
             ORDER BY day_of_week ASC`,
            dr.params
        );

        // Largest expenses (top 10)
        const [largest] = await pool.query(
            `SELECT t.id, t.amount, t.description, t.transaction_date,
                    c.name as category_name, u.name as user_name
             FROM transactions t
             JOIN categories c ON t.category_id = c.id
             JOIN users u ON t.user_id = u.id
             WHERE t.type = 'Expense' ${dr.clause}
             ORDER BY t.amount DESC LIMIT 10`,
            dr.params
        );

        return res.json({
            success: true,
            data: {
                summary: {
                    count: summary[0].count,
                    total: parseFloat(summary[0].total),
                    average: Math.round(parseFloat(summary[0].avg)),
                    min: parseFloat(summary[0].min),
                    max: parseFloat(summary[0].max)
                },
                byCategory: byCat.map(r => ({ id: r.id, name: r.name, total: parseFloat(r.total), count: r.count })),
                byUser: byUser.map(r => ({ id: r.id, name: r.name, email: r.email, total: parseFloat(r.total), count: r.count })),
                byMonth: byMonth.map(r => ({ month: r.month, total: parseFloat(r.total), count: r.count })),
                byDayOfWeek: byDayOfWeek.map(r => ({ day: r.day_of_week, total: parseFloat(r.total), count: r.count })),
                largest: largest.map(t => ({
                    id: t.id, amount: parseFloat(t.amount), description: t.description,
                    categoryName: t.category_name, userName: t.user_name,
                    transactionDate: t.transaction_date
                }))
            }
        });
    } catch (err) {
        next(err);
    }
});

/* ============================================================
   GET /api/admin/analytics/cashflow — Cash Flow Analysis
   ============================================================ */
router.get('/analytics/cashflow', async (req, res, next) => {
    try {
        const rangeFilter = req.query.range || 'this_year';
        const { dateFrom, dateTo } = buildDateRange(rangeFilter, req.query.dateFrom, req.query.dateTo);
        const dr = dateRangeClause(dateFrom, dateTo);

        // Totals
        const [totals] = await pool.query(
            `SELECT
                COALESCE(SUM(CASE WHEN type = 'Income' THEN amount ELSE 0 END), 0) as total_income,
                COALESCE(SUM(CASE WHEN type = 'Expense' THEN amount ELSE 0 END), 0) as total_expense
             FROM transactions t WHERE 1=1 ${dr.clause}`,
            dr.params
        );

        const totalIncome = parseFloat(totals[0].total_income);
        const totalExpense = parseFloat(totals[0].total_expense);

        // Opening balance (sum before dateFrom)
        let openingBalance = 0;
        if (dateFrom) {
            const [opening] = await pool.query(
                `SELECT
                    COALESCE(SUM(CASE WHEN type = 'Income' THEN amount ELSE 0 END), 0) -
                    COALESCE(SUM(CASE WHEN type = 'Expense' THEN amount ELSE 0 END), 0) as balance
                 FROM transactions WHERE transaction_date < ?`,
                [dateFrom]
            );
            openingBalance = parseFloat(opening[0].balance);
        }

        // Monthly cash flow
        const [monthly] = await pool.query(
            `SELECT
                DATE_FORMAT(t.transaction_date, '%Y-%m') as month,
                COALESCE(SUM(CASE WHEN t.type = 'Income' THEN t.amount ELSE 0 END), 0) as income,
                COALESCE(SUM(CASE WHEN t.type = 'Expense' THEN t.amount ELSE 0 END), 0) as expense
             FROM transactions t
             WHERE 1=1 ${dr.clause}
             GROUP BY DATE_FORMAT(t.transaction_date, '%Y-%m')
             ORDER BY month ASC`,
            dr.params
        );

        // Daily cash flow (last 30 days)
        const [daily] = await pool.query(
            `SELECT
                DATE(t.transaction_date) as date,
                COALESCE(SUM(CASE WHEN t.type = 'Income' THEN t.amount ELSE 0 END), 0) as income,
                COALESCE(SUM(CASE WHEN t.type = 'Expense' THEN t.amount ELSE 0 END), 0) as expense
             FROM transactions t
             WHERE t.transaction_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
             GROUP BY DATE(t.transaction_date)
             ORDER BY date ASC`
        );

        const closingBalance = openingBalance + totalIncome - totalExpense;

        // Positive / negative cash flow months
        const positiveMonths = monthly.filter(m => parseFloat(m.income) - parseFloat(m.expense) > 0).length;
        const negativeMonths = monthly.filter(m => parseFloat(m.income) - parseFloat(m.expense) < 0).length;

        return res.json({
            success: true,
            data: {
                openingBalance,
                totalIncome,
                totalExpense,
                closingBalance,
                netCashFlow: totalIncome - totalExpense,
                positiveCashFlowMonths: positiveMonths,
                negativeCashFlowMonths: negativeMonths,
                monthly: monthly.map(m => ({
                    month: m.month,
                    income: parseFloat(m.income),
                    expense: parseFloat(m.expense),
                    net: parseFloat(m.income) - parseFloat(m.expense)
                })),
                daily: daily.map(d => ({
                    date: d.date,
                    income: parseFloat(d.income),
                    expense: parseFloat(d.expense),
                    net: parseFloat(d.income) - parseFloat(d.expense)
                }))
            }
        });
    } catch (err) {
        next(err);
    }
});

/* ============================================================
   GET /api/admin/categories/usage — Category Usage Stats
   ============================================================ */
router.get('/categories/usage', async (req, res, next) => {
    try {
        const [rows] = await pool.query(
            `SELECT c.id, c.name, c.type, c.description, c.created_at,
                    COUNT(t.id) as transaction_count,
                    COALESCE(SUM(t.amount), 0) as total_amount
             FROM categories c
             LEFT JOIN transactions t ON t.category_id = c.id
             GROUP BY c.id, c.name, c.type, c.description, c.created_at
             ORDER BY c.type, total_amount DESC`
        );

        // Calculate percentages
        const incomeTotal = rows.filter(r => r.type === 'Income').reduce((s, r) => s + parseFloat(r.total_amount), 0);
        const expenseTotal = rows.filter(r => r.type === 'Expense').reduce((s, r) => s + parseFloat(r.total_amount), 0);

        return res.json({
            success: true,
            data: {
                items: rows.map(r => ({
                    id: r.id, name: r.name, type: r.type, description: r.description,
                    createdAt: r.created_at,
                    transactionCount: r.transaction_count,
                    totalAmount: parseFloat(r.total_amount),
                    percentageOfTotal: r.type === 'Income'
                        ? (incomeTotal > 0 ? Math.round(parseFloat(r.total_amount) / incomeTotal * 10000) / 100 : 0)
                        : (expenseTotal > 0 ? Math.round(parseFloat(r.total_amount) / expenseTotal * 10000) / 100 : 0)
                }))
            }
        });
    } catch (err) {
        next(err);
    }
});

/* ============================================================
   BUDGET MANAGEMENT
   ============================================================ */

// GET /api/admin/budgets
router.get('/budgets', async (req, res, next) => {
    try {
        const { page = 1, limit = 20, userId } = req.query;
        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
        const offset = (pageNum - 1) * limitNum;

        let where = 'WHERE 1=1';
        const params = [];
        if (userId) { where += ' AND b.user_id = ?'; params.push(parseInt(userId)); }

        const [countRows] = await pool.query(`SELECT COUNT(*) as total FROM budgets b ${where}`, params);
        const total = countRows[0].total;

        const [rows] = await pool.query(
            `SELECT b.id, b.user_id, b.category_id, b.amount, b.period, b.start_date, b.end_date, b.status,
                    b.created_at, b.updated_at,
                    u.name as user_name, u.email as user_email,
                    c.name as category_name, c.type as category_type
             FROM budgets b
             LEFT JOIN users u ON b.user_id = u.id
             LEFT JOIN categories c ON b.category_id = c.id
             ${where}
             ORDER BY b.created_at DESC
             LIMIT ? OFFSET ?`,
            [...params, limitNum, offset]
        );

        // Calculate actual spending for each budget
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
            const remaining = budgetAmount - spent;
            const percentage = budgetAmount > 0 ? (spent / budgetAmount * 100) : 0;
            let status;
            if (percentage >= 100) status = 'OVER_BUDGET';
            else if (percentage >= 90) status = 'CRITICAL';
            else if (percentage >= 70) status = 'WARNING';
            else status = 'UNDER_BUDGET';

            budgets.push({
                id: b.id, userId: b.user_id, userName: b.user_name, userEmail: b.user_email,
                categoryId: b.category_id, categoryName: b.category_name, categoryType: b.category_type,
                amount: budgetAmount, period: b.period,
                startDate: b.start_date, endDate: b.end_date, status: b.status,
                createdAt: b.created_at, updatedAt: b.updated_at,
                actual: spent, remaining, percentage: Math.round(percentage * 100) / 100,
                budgetStatus: status
            });
        }

        return res.json({
            success: true,
            data: {
                items: budgets,
                pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) }
            }
        });
    } catch (err) {
        next(err);
    }
});

// POST /api/admin/budgets
router.post('/budgets', async (req, res, next) => {
    try {
        const { userId, categoryId, amount, period, startDate, endDate } = req.body;

        if (!userId || !amount || !startDate) {
            return res.status(400).json({ success: false, message: 'userId, amount, and startDate are required.' });
        }

        const [result] = await pool.query(
            `INSERT INTO budgets (user_id, category_id, amount, period, start_date, end_date)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [parseInt(userId), categoryId || null, parseFloat(amount), period || 'monthly', startDate, endDate || null]
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

// PUT /api/admin/budgets/:id
router.put('/budgets/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const { amount, period, startDate, endDate, status, categoryId } = req.body;

        const [existing] = await pool.query('SELECT id FROM budgets WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Budget not found.' });
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

// DELETE /api/admin/budgets/:id
router.delete('/budgets/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const [existing] = await pool.query('SELECT id FROM budgets WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Budget not found.' });
        }

        await pool.query('DELETE FROM budgets WHERE id = ?', [id]);
        await logActivity(req.user.id, 'DELETE_BUDGET', `Budget #${id} deleted`, getClientIp(req));

        return res.json({ success: true, message: 'Budget deleted successfully!' });
    } catch (err) {
        next(err);
    }
});

/* ============================================================
   GET /api/admin/reports — Report Generator
   ============================================================ */
router.get('/reports', async (req, res, next) => {
    try {
        const {
            type = 'monthly',
            userId,
            categoryId,
            transactionType,
            dateFrom,
            dateTo,
            format = 'json'
        } = req.query;

        // Determine date range based on report type
        let reportDateFrom = dateFrom;
        let reportDateTo = dateTo;
        const now = new Date();

        if (!reportDateFrom || !reportDateTo) {
            switch (type) {
                case 'daily':
                    reportDateFrom = now.toISOString().split('T')[0];
                    reportDateTo = reportDateFrom;
                    break;
                case 'weekly':
                    const weekStart = new Date(now);
                    weekStart.setDate(weekStart.getDate() - 7);
                    reportDateFrom = weekStart.toISOString().split('T')[0];
                    reportDateTo = now.toISOString().split('T')[0];
                    break;
                case 'monthly':
                    reportDateFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
                    reportDateTo = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
                    break;
                case 'yearly':
                    reportDateFrom = new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0];
                    reportDateTo = new Date(now.getFullYear(), 11, 31).toISOString().split('T')[0];
                    break;
            }
        }

        let where = 'WHERE 1=1';
        const params = [];
        if (reportDateFrom) { where += ' AND t.transaction_date >= ?'; params.push(reportDateFrom); }
        if (reportDateTo) { where += ' AND t.transaction_date <= ?'; params.push(reportDateTo); }
        if (userId) { where += ' AND t.user_id = ?'; params.push(parseInt(userId)); }
        if (categoryId) { where += ' AND t.category_id = ?'; params.push(parseInt(categoryId)); }
        if (transactionType) { where += ' AND t.type = ?'; params.push(transactionType); }

        // Summary
        const [summary] = await pool.query(
            `SELECT
                COUNT(*) as count,
                COALESCE(SUM(CASE WHEN t.type = 'Income' THEN t.amount ELSE 0 END), 0) as income,
                COALESCE(SUM(CASE WHEN t.type = 'Expense' THEN t.amount ELSE 0 END), 0) as expense,
                COALESCE(AVG(t.amount), 0) as avg
             FROM transactions t ${where}`,
            params
        );

        // Breakdown by category
        const [byCategory] = await pool.query(
            `SELECT c.name, c.type, SUM(t.amount) as total, COUNT(*) as count
             FROM transactions t JOIN categories c ON t.category_id = c.id
             ${where}
             GROUP BY c.id, c.name, c.type ORDER BY total DESC`,
            params
        );

        // Breakdown by user
        const [byUser] = await pool.query(
            `SELECT u.id, u.name, u.email,
                    SUM(CASE WHEN t.type = 'Income' THEN t.amount ELSE 0 END) as income,
                    SUM(CASE WHEN t.type = 'Expense' THEN t.amount ELSE 0 END) as expense,
                    COUNT(*) as count
             FROM transactions t JOIN users u ON t.user_id = u.id
             ${where}
             GROUP BY u.id, u.name, u.email ORDER BY (income - expense) DESC`,
            params
        );

        const income = parseFloat(summary[0].income);
        const expense = parseFloat(summary[0].expense);

        // If CSV format, return CSV
        if (format === 'csv') {
            const [allTrx] = await pool.query(
                `SELECT t.transaction_date, t.type, t.amount, t.description,
                        c.name as category_name, u.name as user_name, u.email as user_email
                 FROM transactions t
                 JOIN categories c ON t.category_id = c.id
                 JOIN users u ON t.user_id = u.id
                 ${where}
                 ORDER BY t.transaction_date DESC`,
                params
            );

            let csv = 'transaction_date,type,category,description,amount,user_name,user_email\n';
            allTrx.forEach(t => {
                csv += [
                    t.transaction_date, t.type, t.category_name,
                    `"${(t.description || '').replace(/"/g, '""')}"`,
                    t.amount, `"${t.user_name}"`, t.user_email
                ].join(',') + '\n';
            });

            await logActivity(req.user.id, 'EXPORT_REPORT', `Report (${type}) exported as CSV`, getClientIp(req));

            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="report_${type}_${reportDateFrom}_to_${reportDateTo}.csv"`);
            return res.send(csv);
        }

        return res.json({
            success: true,
            data: {
                reportType: type,
                dateFrom: reportDateFrom,
                dateTo: reportDateTo,
                summary: {
                    transactionCount: summary[0].count,
                    totalIncome: income,
                    totalExpense: expense,
                    netCashFlow: income - expense,
                    averageTransaction: Math.round(parseFloat(summary[0].avg))
                },
                byCategory: byCategory.map(r => ({
                    name: r.name, type: r.type,
                    total: parseFloat(r.total), count: r.count
                })),
                byUser: byUser.map(r => ({
                    id: r.id, name: r.name, email: r.email,
                    income: parseFloat(r.income), expense: parseFloat(r.expense),
                    count: r.count, net: parseFloat(r.income) - parseFloat(r.expense)
                }))
            }
        });
    } catch (err) {
        next(err);
    }
});

/* ============================================================
   GET /api/admin/data-quality — Data Quality Checks
   ============================================================ */
router.get('/data-quality', async (req, res, next) => {
    try {
        const issues = [];

        // 1. Duplicate transactions (same user, amount, date, description)
        const [duplicates] = await pool.query(
            `SELECT user_id, amount, transaction_date, description, COUNT(*) as count
             FROM transactions
             GROUP BY user_id, amount, transaction_date, description
             HAVING count > 1`
        );
        if (duplicates.length > 0) {
            issues.push({
                issue: 'Duplicate transactions',
                count: duplicates.reduce((s, d) => s + d.count - 1, 0),
                severity: 'WARNING',
                details: `${duplicates.length} groups of duplicates found`
            });
        }

        // 2. Missing descriptions
        const [missingDesc] = await pool.query(
            `SELECT COUNT(*) as count FROM transactions WHERE description IS NULL OR description = ''`
        );
        if (missingDesc[0].count > 0) {
            issues.push({ issue: 'Missing description', count: missingDesc[0].count, severity: 'INFO' });
        }

        // 3. Invalid amounts (<= 0)
        const [invalidAmt] = await pool.query(
            `SELECT COUNT(*) as count FROM transactions WHERE amount <= 0`
        );
        if (invalidAmt[0].count > 0) {
            issues.push({ issue: 'Invalid amount (<= 0)', count: invalidAmt[0].count, severity: 'CRITICAL' });
        }

        // 4. Invalid dates (future dates)
        const [futureDates] = await pool.query(
            `SELECT COUNT(*) as count FROM transactions WHERE transaction_date > CURDATE()`
        );
        if (futureDates[0].count > 0) {
            issues.push({ issue: 'Future transaction dates', count: futureDates[0].count, severity: 'WARNING' });
        }

        // 5. Inactive users with transactions
        const [inactiveWithTrx] = await pool.query(
            `SELECT COUNT(DISTINCT t.user_id) as count
             FROM transactions t JOIN users u ON t.user_id = u.id
             WHERE u.status = 'INACTIVE'`
        );
        if (inactiveWithTrx[0].count > 0) {
            issues.push({ issue: 'Inactive users with transactions', count: inactiveWithTrx[0].count, severity: 'WARNING' });
        }

        // 6. Categories with no transactions
        const [unusedCats] = await pool.query(
            `SELECT COUNT(*) as count FROM categories WHERE id NOT IN (SELECT DISTINCT category_id FROM transactions)`
        );
        if (unusedCats[0].count > 0) {
            issues.push({ issue: 'Unused categories', count: unusedCats[0].count, severity: 'INFO' });
        }

        // 7. Users without any transactions
        const [usersNoTrx] = await pool.query(
            `SELECT COUNT(*) as count FROM users WHERE id NOT IN (SELECT DISTINCT user_id FROM transactions)`
        );
        if (usersNoTrx[0].count > 0) {
            issues.push({ issue: 'Users without transactions', count: usersNoTrx[0].count, severity: 'INFO' });
        }

        // Calculate data quality score
        const [totalTrx] = await pool.query('SELECT COUNT(*) as count FROM transactions');
        const totalTransactions = totalTrx[0].count;
        const problemCount = issues.reduce((s, i) => s + i.count, 0);
        const qualityScore = totalTransactions > 0
            ? Math.max(0, Math.round((1 - problemCount / (totalTransactions + problemCount)) * 10000) / 100)
            : 100;

        return res.json({
            success: true,
            data: {
                qualityScore,
                totalTransactions,
                totalIssues: issues.length,
                totalProblemRecords: problemCount,
                issues
            }
        });
    } catch (err) {
        next(err);
    }
});

/* ============================================================
   GET /api/admin/forecast — Financial Forecast
   ============================================================ */
router.get('/forecast', async (req, res, next) => {
    try {
        const months = parseInt(req.query.months) || 3;

        // Get historical data (last 12 months)
        const [history] = await pool.query(
            `SELECT
                DATE_FORMAT(transaction_date, '%Y-%m') as month,
                COALESCE(SUM(CASE WHEN type = 'Income' THEN amount ELSE 0 END), 0) as income,
                COALESCE(SUM(CASE WHEN type = 'Expense' THEN amount ELSE 0 END), 0) as expense
             FROM transactions
             WHERE transaction_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
             GROUP BY DATE_FORMAT(transaction_date, '%Y-%m')
             ORDER BY month ASC`
        );

        if (history.length < 3) {
            return res.json({
                success: true,
                data: {
                    historical: history.map(h => ({
                        month: h.month, income: parseFloat(h.income), expense: parseFloat(h.expense)
                    })),
                    forecast: [],
                    message: 'Not enough historical data for forecasting. Need at least 3 months of data.'
                }
            });
        }

        // Moving Average forecast
        function movingAverage(data, key, periods) {
            const values = data.map(d => d[key]);
            const avg = values.slice(-3).reduce((s, v) => s + v, 0) / Math.min(3, values.length);
            return avg;
        }

        // Linear trend forecast (simple linear regression)
        function linearTrend(data, key, periodsAhead) {
            const n = data.length;
            const values = data.map(d => d[key]);
            const xMean = (n - 1) / 2;
            const yMean = values.reduce((s, v) => s + v, 0) / n;

            let num = 0, den = 0;
            for (let i = 0; i < n; i++) {
                num += (i - xMean) * (values[i] - yMean);
                den += (i - xMean) * (i - xMean);
            }
            const slope = den === 0 ? 0 : num / den;
            const intercept = yMean - slope * xMean;

            const forecastX = n - 1 + periodsAhead;
            return Math.max(0, slope * forecastX + intercept);
        }

        // Generate forecast for next N months
        const forecast = [];
        const lastMonth = history[history.length - 1].month;
        const lastDate = new Date(lastMonth + '-01');

        for (let i = 1; i <= months; i++) {
            const forecastDate = new Date(lastDate.getFullYear(), lastDate.getMonth() + i, 1);
            const monthKey = forecastDate.toISOString().split('T')[0].substring(0, 7);

            const incomeForecast = linearTrend(history, 'income', i);
            const expenseForecast = linearTrend(history, 'expense', i);

            // Confidence (based on variance)
            const incomeValues = history.map(h => parseFloat(h.income));
            const expValues = history.map(h => parseFloat(h.expense));
            const incomeMean = incomeValues.reduce((s, v) => s + v, 0) / incomeValues.length;
            const expMean = expValues.reduce((s, v) => s + v, 0) / expValues.length;
            const incomeVar = incomeValues.reduce((s, v) => s + Math.pow(v - incomeMean, 2), 0) / incomeValues.length;
            const expVar = expValues.reduce((s, v) => s + Math.pow(v - expMean, 2), 0) / expValues.length;
            const incomeStdDev = Math.sqrt(incomeVar);
            const expStdDev = Math.sqrt(expVar);

            // Confidence: lower coefficient of variation = higher confidence
            const incomeCV = incomeMean > 0 ? incomeStdDev / incomeMean : 1;
            const expCV = expMean > 0 ? expStdDev / expMean : 1;
            const confidence = Math.max(20, Math.min(95, 100 - (Math.max(incomeCV, expCV) * 100)));

            forecast.push({
                month: monthKey,
                incomeForecast: Math.round(incomeForecast),
                expenseForecast: Math.round(expenseForecast),
                netForecast: Math.round(incomeForecast - expenseForecast),
                incomeConfidence: Math.round(confidence),
                expenseConfidence: Math.round(confidence)
            });
        }

        return res.json({
            success: true,
            data: {
                historical: history.map(h => ({
                    month: h.month, income: parseFloat(h.income), expense: parseFloat(h.expense)
                })),
                forecast,
                methods: ['Linear Trend', 'Moving Average (3-month)'],
                confidenceLevel: 'Based on historical variance'
            }
        });
    } catch (err) {
        next(err);
    }
});

/* ============================================================
   GET /api/admin/alerts — System Alerts
   ============================================================ */
router.get('/alerts', async (req, res, next) => {
    try {
        // Generate dynamic alerts from data
        const alerts = [];

        // 1. Budget alerts
        const [budgets] = await pool.query(
            `SELECT b.id, b.user_id, b.category_id, b.amount, b.start_date, b.end_date,
                    u.name as user_name, c.name as category_name
             FROM budgets b
             LEFT JOIN users u ON b.user_id = u.id
             LEFT JOIN categories c ON b.category_id = c.id
             WHERE b.status = 'ACTIVE'`
        );

        for (const b of budgets) {
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

            if (percentage >= 100) {
                alerts.push({
                    type: 'BUDGET_OVER',
                    severity: 'CRITICAL',
                    title: 'Budget Exceeded',
                    message: `Budget for ${b.category_name || 'all expenses'} (${b.user_name}) has exceeded ${Math.round(percentage)}% of the limit.`
                });
            } else if (percentage >= 90) {
                alerts.push({
                    type: 'BUDGET_CRITICAL',
                    severity: 'CRITICAL',
                    title: 'Budget Near Limit',
                    message: `Budget for ${b.category_name || 'all expenses'} (${b.user_name}) has reached ${Math.round(percentage)}% of the limit.`
                });
            } else if (percentage >= 70) {
                alerts.push({
                    type: 'BUDGET_WARNING',
                    severity: 'WARNING',
                    title: 'Budget Warning',
                    message: `Budget for ${b.category_name || 'all expenses'} (${b.user_name}) has reached ${Math.round(percentage)}% of the limit.`
                });
            }
        }

        // 2. Large transactions
        const [largeTrx] = await pool.query(
            `SELECT t.id, t.amount, t.description, t.type, u.name as user_name
             FROM transactions t JOIN users u ON t.user_id = u.id
             WHERE t.amount >= 5000000
             ORDER BY t.amount DESC LIMIT 10`
        );
        largeTrx.forEach(t => {
            alerts.push({
                type: 'LARGE_TRANSACTION',
                severity: 'WARNING',
                title: 'Large Transaction Detected',
                message: `${t.type} of Rp ${t.amount.toLocaleString('id-ID')} by ${t.user_name}: ${t.description}`
            });
        });

        // 3. Inactive users with transactions
        const [inactiveUsers] = await pool.query(
            `SELECT COUNT(DISTINCT t.user_id) as count
             FROM transactions t JOIN users u ON t.user_id = u.id
             WHERE u.status = 'INACTIVE'`
        );
        if (inactiveUsers[0].count > 0) {
            alerts.push({
                type: 'INACTIVE_USERS_WITH_DATA',
                severity: 'INFO',
                title: 'Inactive Users with Transactions',
                message: `${inactiveUsers[0].count} inactive user(s) still have transaction data.`
            });
        }

        // 4. High transaction frequency (more than 50 transactions in a day)
        const [highFreq] = await pool.query(
            `SELECT user_id, COUNT(*) as count, u.name as user_name
             FROM transactions t JOIN users u ON t.user_id = u.id
             WHERE DATE(t.transaction_date) = CURDATE()
             GROUP BY user_id, u.name HAVING count > 50`
        );
        highFreq.forEach(h => {
            alerts.push({
                type: 'HIGH_FREQUENCY',
                severity: 'WARNING',
                title: 'High Transaction Frequency',
                message: `User ${h.user_name} made ${h.count} transactions today.`
            });
        });

        // Also get stored alerts from database
        const [dbAlerts] = await pool.query(
            `SELECT id, type, severity, title, message, is_read, created_at
             FROM alerts ORDER BY created_at DESC LIMIT 50`
        );

        return res.json({
            success: true,
            data: {
                dynamic: alerts,
                stored: dbAlerts.map(a => ({
                    id: a.id, type: a.type, severity: a.severity,
                    title: a.title, message: a.message,
                    isRead: a.is_read === 1, createdAt: a.created_at
                }))
            }
        });
    } catch (err) {
        next(err);
    }
});

/* ============================================================
   POST /api/admin/alerts/:id/read — Mark alert as read
   ============================================================ */
router.post('/alerts/:id/read', async (req, res, next) => {
    try {
        const { id } = req.params;
        await pool.query('UPDATE alerts SET is_read = TRUE WHERE id = ?', [id]);
        return res.json({ success: true, message: 'Alert marked as read.' });
    } catch (err) {
        next(err);
    }
});

/* ============================================================
   GET /api/admin/activity-logs — Enhanced Activity Logs
   ============================================================ */
router.get('/activity-logs', async (req, res, next) => {
    try {
        const {
            action, search, userId,
            dateFrom, dateTo,
            page = 1, limit = 20,
            sortBy = 'created_at', sortOrder = 'DESC'
        } = req.query;
        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
        const offset = (pageNum - 1) * limitNum;

        const allowedSort = ['created_at', 'action', 'id'];
        const sortColumn = allowedSort.includes(sortBy) ? sortBy : 'created_at';
        const sortDir = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        let where = 'WHERE 1=1';
        const params = [];

        if (action) { where += ' AND al.action = ?'; params.push(action); }
        if (userId) { where += ' AND al.user_id = ?'; params.push(parseInt(userId)); }
        if (search) { where += ' AND (al.description LIKE ? OR u.name LIKE ? OR u.email LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
        if (dateFrom) { where += ' AND al.created_at >= ?'; params.push(dateFrom); }
        if (dateTo) { where += ' AND al.created_at <= ?'; params.push(dateTo); }

        const [countRows] = await pool.query(
            `SELECT COUNT(*) as total FROM activity_logs al LEFT JOIN users u ON al.user_id = u.id ${where}`,
            params
        );
        const total = countRows[0].total;

        const [rows] = await pool.query(
            `SELECT al.id, al.user_id, al.action, al.description, al.ip_address, al.created_at,
                    u.name as user_name, u.email as user_email
             FROM activity_logs al
             LEFT JOIN users u ON al.user_id = u.id
             ${where}
             ORDER BY al.${sortColumn} ${sortDir}
             LIMIT ? OFFSET ?`,
            [...params, limitNum, offset]
        );

        return res.json({
            success: true,
            data: {
                items: rows.map(l => ({
                    id: l.id, userId: l.user_id, userName: l.user_name, userEmail: l.user_email,
                    action: l.action, description: l.description,
                    ipAddress: l.ip_address, createdAt: l.created_at
                })),
                pagination: {
                    total, page: pageNum, limit: limitNum,
                    totalPages: Math.ceil(total / limitNum)
                }
            }
        });
    } catch (err) {
        next(err);
    }
});

/* ============================================================
   GET /api/admin/security — Security Center
   ============================================================ */
router.get('/security', async (req, res, next) => {
    try {
        // Failed login attempts (from activity_logs where action contains 'FAILED')
        const [failedLogins] = await pool.query(
            `SELECT al.id, al.user_id, al.description, al.ip_address, al.created_at,
                    u.name as user_name, u.email as user_email
             FROM activity_logs al
             LEFT JOIN users u ON al.user_id = u.id
             WHERE al.action = 'LOGIN_FAILED' OR al.description LIKE '%failed%'
             ORDER BY al.created_at DESC LIMIT 20`
        );

        // Recent logins
        const [recentLogins] = await pool.query(
            `SELECT al.id, al.user_id, al.ip_address, al.created_at,
                    u.name as user_name, u.email as user_email
             FROM activity_logs al
             LEFT JOIN users u ON al.user_id = u.id
             WHERE al.action = 'LOGIN'
             ORDER BY al.created_at DESC LIMIT 20`
        );

        // Admin actions (last 20)
        const [adminActions] = await pool.query(
            `SELECT al.id, al.action, al.description, al.ip_address, al.created_at,
                    u.name as user_name, u.email as user_email
             FROM activity_logs al
             LEFT JOIN users u ON al.user_id = u.id
             WHERE al.action LIKE 'ADMIN_%' OR al.action LIKE 'ROLE_%' OR al.action = 'PASSWORD_RESET'
             ORDER BY al.created_at DESC LIMIT 20`
        );

        // Suspicious: same IP multiple failed attempts
        const [suspiciousIps] = await pool.query(
            `SELECT ip_address, COUNT(*) as failed_count, MAX(created_at) as last_attempt
             FROM activity_logs
             WHERE action = 'LOGIN_FAILED' AND ip_address IS NOT NULL
             GROUP BY ip_address
             HAVING failed_count >= 3
             ORDER BY failed_count DESC LIMIT 10`
        );

        // Active users count
        const [activeUsersCount] = await pool.query(
            `SELECT COUNT(*) as count FROM users WHERE status = 'ACTIVE'`
        );

        // Inactive users count
        const [inactiveUsersCount] = await pool.query(
            `SELECT COUNT(*) as count FROM users WHERE status = 'INACTIVE'`
        );

        // Users with admin role
        const [adminCount] = await pool.query(
            `SELECT COUNT(*) as count FROM users WHERE role = 'ADMIN'`
        );

        return res.json({
            success: true,
            data: {
                failedLogins: failedLogins.map(l => ({
                    id: l.id, userId: l.user_id, userName: l.user_name, userEmail: l.user_email,
                    description: l.description, ipAddress: l.ip_address, createdAt: l.created_at
                })),
                recentLogins: recentLogins.map(l => ({
                    id: l.id, userId: l.user_id, userName: l.user_name, userEmail: l.user_email,
                    ipAddress: l.ip_address, createdAt: l.created_at
                })),
                adminActions: adminActions.map(a => ({
                    id: a.id, action: a.action, description: a.description,
                    userName: a.user_name, ipAddress: a.ip_address, createdAt: a.created_at
                })),
                suspiciousIps: suspiciousIps.map(s => ({
                    ipAddress: s.ip_address,
                    failedCount: s.failed_count,
                    lastAttempt: s.last_attempt
                })),
                stats: {
                    activeUsers: activeUsersCount[0].count,
                    inactiveUsers: inactiveUsersCount[0].count,
                    adminUsers: adminCount[0].count,
                    totalFailedLogins: failedLogins.length
                }
            }
        });
    } catch (err) {
        next(err);
    }
});

/* ============================================================
   GET /api/admin/system-health — System Health
   ============================================================ */
router.get('/system-health', async (req, res, next) => {
    try {
        // Database stats
        const [dbStats] = await pool.query(
            `SELECT
                (SELECT COUNT(*) FROM users) as user_count,
                (SELECT COUNT(*) FROM transactions) as transaction_count,
                (SELECT COUNT(*) FROM categories) as category_count,
                (SELECT COUNT(*) FROM activity_logs) as log_count,
                (SELECT COUNT(*) FROM budgets) as budget_count,
                (SELECT COUNT(*) FROM alerts) as alert_count`
        );

        // DB connection test
        let dbStatus = 'connected';
        try {
            await pool.query('SELECT 1');
        } catch (e) {
            dbStatus = 'disconnected';
        }

        // System info
        const memUsage = process.memoryUsage();
        const uptimeSec = process.uptime();

        return res.json({
            success: true,
            data: {
                api: {
                    status: 'running',
                    environment: process.env.NODE_ENV || 'development',
                    nodeVersion: process.version,
                    uptime: Math.round(uptimeSec),
                    uptimeFormatted: formatUptime(uptimeSec)
                },
                database: {
                    status: dbStatus,
                    name: process.env.DB_NAME || 'personal_finance',
                    host: process.env.DB_HOST || 'localhost',
                    tables: {
                        users: dbStats[0].user_count,
                        transactions: dbStats[0].transaction_count,
                        categories: dbStats[0].category_count,
                        activityLogs: dbStats[0].log_count,
                        budgets: dbStats[0].budget_count,
                        alerts: dbStats[0].alert_count
                    }
                },
                system: {
                    platform: process.platform,
                    arch: process.arch,
                    hostname: os.hostname(),
                    cpus: os.cpus().length,
                    totalMemory: os.totalmem(),
                    freeMemory: os.freemem(),
                    usedMemory: memUsage.heapUsed,
                    uptime: os.uptime()
                },
                timestamp: new Date().toISOString()
            }
        });
    } catch (err) {
        next(err);
    }
});

function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${days}d ${hours}h ${minutes}m`;
}

/* ============================================================
   GET /api/admin/settings — System Settings
   ============================================================ */
router.get('/settings', async (req, res, next) => {
    try {
        const [rows] = await pool.query('SELECT * FROM system_settings ORDER BY setting_key');
        const settings = {};
        rows.forEach(r => {
            settings[r.setting_key] = r.setting_value;
        });

        return res.json({
            success: true,
            data: {
                settings,
                raw: rows.map(r => ({
                    key: r.setting_key,
                    value: r.setting_value,
                    description: r.description
                }))
            }
        });
    } catch (err) {
        next(err);
    }
});

/* ============================================================
   PUT /api/admin/settings — Update Settings
   ============================================================ */
router.put('/settings', async (req, res, next) => {
    try {
        const { settings } = req.body;
        if (!settings || typeof settings !== 'object') {
            return res.status(400).json({ success: false, message: 'Settings object required.' });
        }

        for (const [key, value] of Object.entries(settings)) {
            await pool.query(
                `INSERT INTO system_settings (setting_key, setting_value)
                 VALUES (?, ?)
                 ON DUPLICATE KEY UPDATE setting_value = ?`,
                [key, value, value]
            );
        }

        await logActivity(req.user.id, 'UPDATE_SETTINGS', 'System settings updated', getClientIp(req));

        return res.json({ success: true, message: 'Settings updated successfully!' });
    } catch (err) {
        next(err);
    }
});

/* ============================================================
   GET /api/admin/insights — Automated Business Insights
   ============================================================ */
router.get('/insights', async (req, res, next) => {
    try {
        const insights = [];

        // Current month vs last month
        const now = new Date();
        const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastMonthKey = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;

        const [monthData] = await pool.query(
            `SELECT
                DATE_FORMAT(transaction_date, '%Y-%m') as month,
                COALESCE(SUM(CASE WHEN type = 'Income' THEN amount ELSE 0 END), 0) as income,
                COALESCE(SUM(CASE WHEN type = 'Expense' THEN amount ELSE 0 END), 0) as expense,
                COUNT(*) as count
             FROM transactions
             WHERE DATE_FORMAT(transaction_date, '%Y-%m') IN (?, ?)
             GROUP BY DATE_FORMAT(transaction_date, '%Y-%m')`,
            [thisMonthKey, lastMonthKey]
        );

        const thisMonth = monthData.find(d => d.month === thisMonthKey);
        const prevMonth = monthData.find(d => d.month === lastMonthKey);

        if (thisMonth && prevMonth) {
            const incomeChange = calcChange(parseFloat(thisMonth.income), parseFloat(prevMonth.income));
            const expenseChange = calcChange(parseFloat(thisMonth.expense), parseFloat(prevMonth.expense));

            if (incomeChange > 0) {
                insights.push({
                    type: 'INCOME_TREND',
                    title: 'Income Increased',
                    message: `Income this month increased by ${Math.round(incomeChange)}% compared to last month.`
                });
            } else if (incomeChange < 0) {
                insights.push({
                    type: 'INCOME_TREND',
                    title: 'Income Decreased',
                    message: `Income this month decreased by ${Math.round(Math.abs(incomeChange))}% compared to last month.`
                });
            }

            if (expenseChange > 0) {
                insights.push({
                    type: 'EXPENSE_TREND',
                    title: 'Expense Increased',
                    message: `Expense this month increased by ${Math.round(expenseChange)}% compared to last month.`
                });
            } else if (expenseChange < 0) {
                insights.push({
                    type: 'EXPENSE_TREND',
                    title: 'Expense Decreased',
                    message: `Expense this month decreased by ${Math.round(Math.abs(expenseChange))}% compared to last month.`
                });
            }
        }

        // Top expense category
        const [topExpCat] = await pool.query(
            `SELECT c.name, SUM(t.amount) as total
             FROM transactions t JOIN categories c ON t.category_id = c.id
             WHERE t.type = 'Expense' AND DATE_FORMAT(t.transaction_date, '%Y-%m') = ?
             GROUP BY c.name ORDER BY total DESC LIMIT 1`,
            [thisMonthKey]
        );
        if (topExpCat.length > 0) {
            const [totalExp] = await pool.query(
                `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
                 WHERE type = 'Expense' AND DATE_FORMAT(transaction_date, '%Y-%m') = ?`,
                [thisMonthKey]
            );
            const percentage = totalExp[0].total > 0
                ? Math.round(parseFloat(topExpCat[0].total) / parseFloat(totalExp[0].total) * 100)
                : 0;
            insights.push({
                type: 'TOP_CATEGORY',
                title: 'Highest Expense Category',
                message: `Category "${topExpCat[0].name}" represents ${percentage}% of total expenses this month.`
            });
        }

        // Top spender
        const [topSpender] = await pool.query(
            `SELECT u.name, SUM(t.amount) as total
             FROM transactions t JOIN users u ON t.user_id = u.id
             WHERE t.type = 'Expense' AND DATE_FORMAT(t.transaction_date, '%Y-%m') = ?
             GROUP BY u.id, u.name ORDER BY total DESC LIMIT 1`,
            [thisMonthKey]
        );
        if (topSpender.length > 0) {
            insights.push({
                type: 'TOP_SPENDER',
                title: 'Highest Spender',
                message: `${topSpender[0].name} has the highest expense this month: Rp ${parseFloat(topSpender[0].total).toLocaleString('id-ID')}.`
            });
        }

        // Savings rate insight
        if (thisMonth) {
            const income = parseFloat(thisMonth.income);
            const expense = parseFloat(thisMonth.expense);
            if (income > 0) {
                const rate = Math.round((income - expense) / income * 100);
                if (rate >= 20) {
                    insights.push({
                        type: 'SAVINGS_RATE',
                        title: 'Healthy Savings Rate',
                        message: `Savings rate this month is ${rate}%, which is excellent.`
                    });
                } else if (rate < 10 && rate >= 0) {
                    insights.push({
                        type: 'SAVINGS_RATE',
                        title: 'Low Savings Rate',
                        message: `Savings rate this month is only ${rate}%. Consider reducing expenses.`
                    });
                } else if (rate < 0) {
                    insights.push({
                        type: 'SAVINGS_RATE',
                        title: 'Negative Cash Flow',
                        message: `Expenses exceed income this month by Rp ${Math.abs(income - expense).toLocaleString('id-ID')}.`
                    });
                }
            }
        }

        // New users insight
        const [newUsers] = await pool.query(
            `SELECT COUNT(*) as count FROM users
             WHERE DATE_FORMAT(created_at, '%Y-%m') = ?`,
            [thisMonthKey]
        );
        if (newUsers[0].count > 0) {
            insights.push({
                type: 'USER_GROWTH',
                title: 'New Users',
                message: `${newUsers[0].count} new user(s) registered this month.`
            });
        }

        return res.json({
            success: true,
            data: { insights }
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;

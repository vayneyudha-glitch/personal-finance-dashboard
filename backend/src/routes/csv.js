/* ============================================================
   ROUTES/CSV.JS — CSV Import/Export (Admin only)
   ============================================================
   GET  /api/csv/export          — Export all transactions to CSV
   GET  /api/csv/template        — Download CSV template
   POST /api/csv/import          — Import transactions from CSV
   ============================================================ */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const pool = require('../config/db');
const { auth, requireAdmin } = require('../middleware/auth');
const { logActivity, getClientIp } = require('../middleware/activityLog');

// Multer config for CSV file upload
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'text/csv' || file.mimetype === 'application/vnd.ms-excel' || file.originalname.endsWith('.csv')) {
            cb(null, true);
        } else {
            cb(new Error('Only CSV files are allowed.'));
        }
    }
});

// Simple CSV line parser
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
            else { inQuotes = !inQuotes; }
        } else if (ch === ',' && !inQuotes) {
            result.push(current); current = '';
        } else { current += ch; }
    }
    result.push(current);
    return result;
}

// GET /api/csv/export
router.get('/export', auth, requireAdmin, async (req, res, next) => {
    try {
        const { type } = req.query; // 'transactions' (default), 'users', 'categories'
        const actualType = type || 'transactions';

        if (actualType === 'users') {
            const [rows] = await pool.query(
                'SELECT id, name, email, phone, role, status, created_at FROM users ORDER BY id ASC'
            );
            let csv = 'id,name,email,phone,role,status,created_at\n';
            rows.forEach(u => {
                csv += [u.id, `"${u.name}"`, u.email, u.phone || '', u.role, u.status, u.created_at].join(',') + '\n';
            });
            await logActivity(req.user.id, 'EXPORT_DATA', `Exported ${rows.length} users`, getClientIp(req));
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', 'attachment; filename="users_export.csv"');
            return res.send(csv);
        }

        if (actualType === 'categories') {
            const [rows] = await pool.query(
                'SELECT id, name, type, description FROM categories ORDER BY type, name'
            );
            let csv = 'id,name,type,description\n';
            rows.forEach(c => {
                csv += [c.id, `"${c.name}"`, c.type, `"${(c.description || '').replace(/"/g, '""')}"`].join(',') + '\n';
            });
            await logActivity(req.user.id, 'EXPORT_DATA', `Exported ${rows.length} categories`, getClientIp(req));
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', 'attachment; filename="categories_export.csv"');
            return res.send(csv);
        }

        // Default: transactions
        const [rows] = await pool.query(
            `SELECT t.transaction_date, t.type, t.amount, t.description,
                    c.name as category_name, u.name as user_name, u.email as user_email
             FROM transactions t
             JOIN categories c ON t.category_id = c.id
             JOIN users u ON t.user_id = u.id
             ORDER BY t.transaction_date DESC, t.id DESC`
        );

        let csv = 'transaction_date,type,category,description,amount,user_name,user_email\n';
        rows.forEach(t => {
            const desc = (t.description || '').replace(/"/g, '""');
            csv += [
                t.transaction_date,
                t.type,
                t.category_name,
                `"${desc}"`,
                t.amount,
                `"${t.user_name}"`,
                t.user_email
            ].join(',') + '\n';
        });

        await logActivity(req.user.id, 'EXPORT_DATA', `Exported ${rows.length} transactions`, getClientIp(req));

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="transactions_export.csv"');
        res.send(csv);
    } catch (err) {
        next(err);
    }
});

// GET /api/csv/template
router.get('/template', auth, requireAdmin, (req, res) => {
    const csv = 'transaction_date,type,category,description,amount\n2025-01-15,Income,Gaji,Gaji Januari,5000000\n2025-01-16,Expense,Makanan,Makan siang,50000\n';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="csv_template.csv"');
    res.send(csv);
});

// POST /api/csv/import — Accept multipart file upload
router.post('/import', auth, requireAdmin, upload.single('csvFile'), async (req, res, next) => {
    try {
        let csvText = '';

        if (req.file) {
            csvText = req.file.buffer.toString('utf8');
        } else if (req.body && req.body.csv) {
            csvText = req.body.csv;
        } else {
            return res.status(400).json({ success: false, message: 'No CSV data found. Upload a file or send CSV text.' });
        }

        const lines = csvText.split('\n').filter(l => l.trim());
        if (lines.length < 2) {
            return res.status(400).json({ success: false, message: 'CSV file is empty or invalid.' });
        }

        const header = lines[0].toLowerCase().split(',').map(h => h.trim());
        const di = header.indexOf('transaction_date') !== -1 ? header.indexOf('transaction_date') : header.indexOf('date');
        const ti = header.indexOf('type');
        const ci = header.indexOf('category');
        const dei = header.indexOf('description');
        const ai = header.indexOf('amount');

        if (di === -1 || ti === -1 || ci === -1 || dei === -1 || ai === -1) {
            return res.status(400).json({
                success: false,
                message: 'Invalid CSV header. Required: transaction_date,type,category,description,amount'
            });
        }

        // Get all categories for lookup
        const [categories] = await pool.query('SELECT id, name, type FROM categories');
        const catMap = {};
        categories.forEach(c => { catMap[c.name + '_' + c.type] = c.id; });

        let imported = 0;
        const errors = [];
        const adminId = req.user.id;

        for (let i = 1; i < lines.length; i++) {
            const parts = parseCSVLine(lines[i]);
            if (parts.length < 5) { errors.push(`Row ${i + 1}: incomplete columns`); continue; }

            const date = parts[di].trim();
            const type = parts[ti].trim();
            const category = parts[ci].trim();
            const description = parts[dei].trim();
            const amount = parseFloat(parts[ai].trim());

            if (!date || !type || !category || !description || !amount || amount <= 0) {
                errors.push(`Row ${i + 1}: invalid data`);
                continue;
            }
            if (type !== 'Income' && type !== 'Expense') {
                errors.push(`Row ${i + 1}: type must be Income or Expense`);
                continue;
            }

            const catKey = category + '_' + type;
            if (!catMap[catKey]) {
                errors.push(`Row ${i + 1}: category "${category}" not found for type ${type}`);
                continue;
            }

            try {
                await pool.query(
                    'INSERT INTO transactions (user_id, category_id, type, amount, description, transaction_date) VALUES (?, ?, ?, ?, ?, ?)',
                    [adminId, catMap[catKey], type, amount, description, date]
                );
                imported++;
            } catch (e) {
                errors.push(`Row ${i + 1}: ${e.message}`);
            }
        }

        await logActivity(req.user.id, 'IMPORT_DATA', `Imported ${imported} transactions, ${errors.length} errors`, getClientIp(req));

        return res.json({
            success: true,
            message: `${imported} transactions imported successfully.${errors.length > 0 ? ` ${errors.length} rows had errors.` : ''}`,
            data: { imported, errors: errors.length > 0 ? errors : [] }
        });
    } catch (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ success: false, message: 'File too large. Maximum 5MB.' });
        }
        if (err.message === 'Only CSV files are allowed.') {
            return res.status(400).json({ success: false, message: err.message });
        }
        next(err);
    }
});

module.exports = router;

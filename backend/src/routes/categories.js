/* ============================================================
   ROUTES/CATEGORIES.JS — Category CRUD
   ============================================================
   GET    /api/categories          — List all (authenticated)
   POST   /api/categories          — Create (admin)
   PUT    /api/categories/:id     — Update (admin)
   DELETE /api/categories/:id     — Delete (admin)
   ============================================================ */

const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { auth, requireAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { categoryRules } = require('../validators/category');
const { logActivity, getClientIp } = require('../middleware/activityLog');

// GET /api/categories
router.get('/', auth, async (req, res, next) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, name, type, description, created_at, updated_at FROM categories ORDER BY type, name'
        );

        const grouped = { Income: [], Expense: [] };
        rows.forEach(row => {
            grouped[row.type].push({
                id: row.id,
                name: row.name,
                type: row.type,
                description: row.description,
                createdAt: row.created_at,
                updatedAt: row.updated_at
            });
        });

        return res.json({
            success: true,
            data: { categories: rows, grouped }
        });
    } catch (err) {
        next(err);
    }
});

// POST /api/categories
router.post('/', auth, requireAdmin, categoryRules, validate, async (req, res, next) => {
    try {
        const { name, type, description } = req.body;

        const [existing] = await pool.query(
            'SELECT id FROM categories WHERE type = ? AND name = ?', [type, name.trim()]
        );
        if (existing.length > 0) {
            return res.status(409).json({ success: false, message: 'Category already exists.' });
        }

        const [result] = await pool.query(
            'INSERT INTO categories (name, type, description) VALUES (?, ?, ?)',
            [name.trim(), type, description ? description.trim() : null]
        );

        await logActivity(req.user.id, 'CREATE_CATEGORY', `Category "${name}" created`, getClientIp(req));

        return res.status(201).json({
            success: true,
            message: 'Category created successfully!',
            data: { id: result.insertId, name: name.trim(), type, description: description || null }
        });
    } catch (err) {
        next(err);
    }
});

// PUT /api/categories/:id
router.put('/:id', auth, requireAdmin, categoryRules, validate, async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, type, description } = req.body;

        const [existing] = await pool.query('SELECT id FROM categories WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Category not found.' });
        }

        // Check duplicate (exclude self)
        const [dup] = await pool.query(
            'SELECT id FROM categories WHERE type = ? AND name = ? AND id != ?', [type, name.trim(), id]
        );
        if (dup.length > 0) {
            return res.status(409).json({ success: false, message: 'Category name already exists for this type.' });
        }

        await pool.query(
            'UPDATE categories SET name = ?, type = ?, description = ? WHERE id = ?',
            [name.trim(), type, description ? description.trim() : null, id]
        );

        await logActivity(req.user.id, 'UPDATE_CATEGORY', `Category #${id} updated`, getClientIp(req));

        return res.json({ success: true, message: 'Category updated successfully!' });
    } catch (err) {
        next(err);
    }
});

// DELETE /api/categories/:id
router.delete('/:id', auth, requireAdmin, async (req, res, next) => {
    try {
        const { id } = req.params;

        const [existing] = await pool.query('SELECT id, name FROM categories WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Category not found.' });
        }

        // Check if category is in use
        const [usage] = await pool.query('SELECT COUNT(*) as count FROM transactions WHERE category_id = ?', [id]);
        if (usage[0].count > 0) {
            return res.status(400).json({
                success: false,
                message: `Cannot delete category. It is used in ${usage[0].count} transaction(s).`
            });
        }

        await pool.query('DELETE FROM categories WHERE id = ?', [id]);
        await logActivity(req.user.id, 'DELETE_CATEGORY', `Category "${existing[0].name}" deleted`, getClientIp(req));

        return res.json({ success: true, message: 'Category deleted successfully!' });
    } catch (err) {
        next(err);
    }
});

module.exports = router;

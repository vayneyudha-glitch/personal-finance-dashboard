/* ============================================================
   SERVER.JS — Entry point backend Node.js + Express
   ============================================================
   Architecture:
   Frontend (HTML/CSS/JS) → REST API (Express) → MySQL Database

   Features:
   - JWT Authentication (login, register, profile)
   - Role-based authorization (ADMIN, USER)
   - CRUD Transactions (owner-scoped for users)
   - CRUD Categories (admin creates/edits/deletes)
   - Dashboard API (stats, charts data)
   - Admin Dashboard API (user mgmt, all transactions, logs)
   - CSV Import/Export (admin)
   - bcrypt password hashing
   - Helmet security headers
   - CORS enabled
   - Rate limiting
   - Express validator input validation
   - Multer file upload for CSV
   - Centralized error handling
   - Activity logging
   ============================================================ */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

// Routes
const authRoutes = require('./routes/auth');
const transactionRoutes = require('./routes/transactions');
const categoryRoutes = require('./routes/categories');
const dashboardRoutes = require('./routes/dashboard');
const adminRoutes = require('./routes/admin');
const csvRoutes = require('./routes/csv');
const budgetRoutes = require('./routes/budgets');

// Middleware
const { errorHandler, notFound } = require('./middleware/errorHandler');

// ============================================================
// INIT APP
// ============================================================

const app = express();

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false, // Disable for API-only server
    crossOriginEmbedderPolicy: false
}));

// CORS — allow frontend
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8080';
app.use(cors({
    origin: [frontendUrl, 'http://127.0.0.1:8080', 'http://localhost:8080', 'http://localhost:5500', 'http://127.0.0.1:5500', 'http://localhost:50215'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging
app.use(morgan('dev'));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 500, // limit each IP to 500 requests per window
    message: {
        success: false,
        message: 'Too many requests. Please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false
});
app.use('/api/', limiter);

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: 'Personal Finance Management System API is running',
        timestamp: new Date().toISOString()
    });
});

// ============================================================
// ROUTES
// ============================================================

app.use('/api/auth', authRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/csv', csvRoutes);
app.use('/api/budgets', budgetRoutes);

// 404 handler
app.use(notFound);

// Error handler (must be last)
app.use(errorHandler);

// ============================================================
// START SERVER
// ============================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log('\n=================================');
    console.log('  Personal Finance Management System');
    console.log('  API running on http://localhost:' + PORT);
    console.log('  Environment: ' + (process.env.NODE_ENV || 'development'));
    console.log('  Frontend: ' + frontendUrl);
    console.log('=================================\n');
});

module.exports = app;

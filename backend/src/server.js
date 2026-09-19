require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const transactionRoutes = require('./routes/transactions');
const categoryRoutes = require('./routes/categories');
const dashboardRoutes = require('./routes/dashboard');
const adminRoutes = require('./routes/admin');
const csvRoutes = require('./routes/csv');
const budgetRoutes = require('./routes/budgets');
const otpRoutes = require('./routes/otp');
const webhookRoutes = require('./routes/webhooks');

const { errorHandler, notFound } = require('./middleware/errorHandler');
const { noCache } = require('./middleware/auth');
const { rawBodyMiddleware } = require('./middleware/rawBody');

const app = express();

app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));

const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8000';

const allowedOrigins = [
    frontendUrl,
    'http://localhost:8000',
    'http://127.0.0.1:8000',
    'http://localhost:8080',
    'http://localhost:8081',
    'http://127.0.0.1:8081',
    'http://127.0.0.1:8080',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:50215',
    'https://vayneyudha-glitch.github.io'
];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('CORS: Origin not allowed'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// WhatsApp Webhook — must be registered BEFORE express.json() so that
// rawBodyMiddleware can capture the raw body for HMAC signature verification.
// The webhook route parses JSON internally via req.body (rawBody captured first).
app.use('/api/webhooks', rawBodyMiddleware, webhookRoutes);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    message: {
        success: false,
        message: 'Too many requests. Please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false
});

app.use('/api/', limiter);

app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: 'Personal Finance Management System API is running',
        timestamp: new Date().toISOString(),
        database: process.env.DB_NAME || 'unknown',
        environment: process.env.NODE_ENV || 'development'
    });
});

// OTP routes (public — rate limited internally)
app.use('/api/otp', noCache, otpRoutes);

// Protected API routes — apply no-cache headers to prevent back-button cache leaks
app.use('/api/auth', noCache, authRoutes);
app.use('/api/transactions', noCache, transactionRoutes);
app.use('/api/categories', noCache, categoryRoutes);
app.use('/api/dashboard', noCache, dashboardRoutes);
app.use('/api/admin', noCache, adminRoutes);
app.use('/api/csv', noCache, csvRoutes);
app.use('/api/budgets', noCache, budgetRoutes);

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log('');
    console.log('=================================');
    console.log('  Personal Finance Management System');
    console.log('=================================');
    console.log('  API:      http://localhost:' + PORT);
    console.log('  Frontend: ' + frontendUrl);
    console.log('  Database: ' + (process.env.DB_NAME || 'unknown'));
    console.log('  Mode:     ' + (process.env.NODE_ENV || 'development'));
    console.log('=================================');
    console.log('');
});

module.exports = app;

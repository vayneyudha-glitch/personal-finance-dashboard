/* ============================================================
   MIDDLEWARE/ERRORHANDLER.JS — Centralized Error Handling
   ============================================================ */

function notFound(req, res, next) {
    return res.status(404).json({
        success: false,
        message: `Route not found: ${req.method} ${req.originalUrl}`
    });
}

function errorHandler(err, req, res, next) {
    console.error('[ERROR]', err.message);

    // MySQL duplicate entry
    if (err.code === 'ER_DUP_ENTRY') {
        const match = err.message.match(/for key '(\w+)'/);
        const field = match ? match[1] : 'data';
        return res.status(409).json({
            success: false,
            message: `Duplicate entry for ${field}.`
        });
    }

    // MySQL connection errors
    if (err.code === 'ECONNREFUSED' || err.code === 'ER_ACCESS_DENIED_ERROR') {
        return res.status(503).json({
            success: false,
            message: 'Database unavailable. Please contact administrator.'
        });
    }

    // Express validator errors
    if (err.array && typeof err.array === 'function') {
        return res.status(422).json({
            success: false,
            message: 'Validation failed',
            errors: err.array().map(e => ({ field: e.path, message: e.msg }))
        });
    }

    // JWT errors
    if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({
            success: false,
            message: 'Invalid token.'
        });
    }

    // Custom app errors
    if (err.statusCode) {
        return res.status(err.statusCode).json({
            success: false,
            message: err.message
        });
    }

    // Default server error
    return res.status(500).json({
        success: false,
        message: 'Internal server error.'
    });
}

module.exports = { errorHandler, notFound };

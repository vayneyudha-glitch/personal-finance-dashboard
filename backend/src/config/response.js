/* ============================================================
   CONFIG/RESPONSE.JS — Standardized API Response Helpers
   ============================================================ */

function success(res, data = {}, message = 'Success', statusCode = 200) {
    return res.status(statusCode).json({
        success: true,
        message,
        data
    });
}

function error(res, message = 'An error occurred', statusCode = 400, errors = []) {
    return res.status(statusCode).json({
        success: false,
        message,
        errors: errors.length > 0 ? errors : undefined
    });
}

function paginate(res, items, total, page, limit, message = 'Success') {
    return res.status(200).json({
        success: true,
        message,
        data: {
            items,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / limit)
            }
        }
    });
}

module.exports = { success, error, paginate };

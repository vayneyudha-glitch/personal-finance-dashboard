const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8081;
const FRONTEND = 'http://localhost:8000';
const BACKEND = 'http://localhost:3000';

// Protected HTML pages that require authentication — never cache
const PROTECTED_PAGES = [
    '/dashboard.html',
    '/transactions.html',
    '/budgets.html',
    '/charts.html',
    '/profile.html',
    '/import-export.html',
    '/admin.html',
    '/admin-activity.html',
    '/admin-alerts.html',
    '/admin-analytics.html',
    '/admin-budgets.html',
    '/admin-cashflow.html',
    '/admin-categories.html',
    '/admin-data-analysis.html',
    '/admin-data-quality.html',
    '/admin-expense.html',
    '/admin-forecast.html',
    '/admin-import-export.html',
    '/admin-income.html',
    '/admin-reports.html',
    '/admin-security.html',
    '/admin-settings.html',
    '/admin-system-health.html',
    '/admin-transactions.html',
    '/admin-user-detail.html',
    '/admin-users.html'
];

function isProtectedPage(urlPath) {
    return PROTECTED_PAGES.indexOf(urlPath) !== -1;
}

function proxyRequest(target, req, res) {
    const url = new URL(req.url, target);

    const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: req.method,
        headers: {
            ...req.headers,
            host: `${url.hostname}:${url.port}`
        }
    };

    const proxy = http.request(options, proxyRes => {
        // Inject no-cache headers for protected HTML pages
        if (isProtectedPage(url.pathname)) {
            var headers = { ...proxyRes.headers };
            headers['cache-control'] = 'no-store, no-cache, must-revalidate, private';
            headers['pragma'] = 'no-cache';
            headers['expires'] = '0';
            res.writeHead(proxyRes.statusCode, headers);
        } else {
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
        }
        proxyRes.pipe(res);
    });

    proxy.on('error', err => {
        console.error('Proxy error:', err.message);
        if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
        }
        res.end(JSON.stringify({
            success: false,
            message: 'Backend unavailable'
        }));
    });

    req.pipe(proxy);
}

const server = http.createServer((req, res) => {

    // API → Node.js backend :3000
    if (req.url.startsWith('/api')) {
        return proxyRequest(BACKEND, req, res);
    }

    // Everything else → frontend :8000
    proxyRequest(FRONTEND, req, res);
});

server.listen(PORT, () => {
    console.log('=================================');
    console.log(' Personal Finance Reverse Proxy');
    console.log('=================================');
    console.log(` Local: http://localhost:${PORT}`);
    console.log(` Frontend: ${FRONTEND}`);
    console.log(` API: ${BACKEND}`);
    console.log('=================================');
});
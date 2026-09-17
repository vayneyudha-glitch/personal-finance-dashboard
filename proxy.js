const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8081;
const FRONTEND = 'http://localhost:8000';
const BACKEND = 'http://localhost:3000';

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
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
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
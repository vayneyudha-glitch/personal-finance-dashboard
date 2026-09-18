/* ============================================================
   ROUTES/WEBHOOKS.JS — WhatsApp Meta Webhook Routes
   ============================================================
   GET  /api/webhooks/whatsapp  — Meta webhook verification
   POST /api/webhooks/whatsapp  — Receive WhatsApp webhook events

   Security:
   - GET verification uses constant-time token comparison
   - POST requests validated via X-Hub-Signature-256 (HMAC-SHA256)
   - Raw body preserved for signature verification (see rawBody middleware)
   - Verification token & app secret come from .env, never hardcoded
   - Errors are sanitized — no internal details or credentials exposed
   - Responds 200 fast to Meta, processes event asynchronously

   Meta docs:
   https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-receipt
   ============================================================ */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const { handleWebhookEvent } = require('../services/whatsappWebhookService');

/**
 * Constant-time string comparison to prevent timing attacks.
 * Falls back to === if crypto.timingSafeEqual is not available
 * (older Node.js versions).
 *
 * @param {string} a — Expected value
 * @param {string} b — Received value
 * @returns {boolean}
 */
function safeCompare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length !== b.length) return false;

    // Encode to buffers for timing-safe comparison
    var bufA = Buffer.from(a, 'utf8');
    var bufB = Buffer.from(b, 'utf8');

    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verify the X-Hub-Signature-256 header against the raw body.
 *
 * Meta sends: "sha256=" + HMAC-SHA256(rawBody, WHATSAPP_APP_SECRET)
 *
 * @param {string} signature — Value of X-Hub-Signature-256 header
 * @param {Buffer} rawBody — The raw request body bytes
 * @returns {boolean}
 */
function verifySignature(signature, rawBody) {
    var appSecret = process.env.WHATSAPP_APP_SECRET;
    if (!appSecret) {
        console.error('[Webhook] WHATSAPP_APP_SECRET not configured — cannot verify signature.');
        return false;
    }

    if (!signature || !signature.startsWith('sha256=')) {
        return false;
    }

    var expectedSig = signature.substring(7); // Remove "sha256=" prefix

    var computedHmac = crypto
        .createHmac('sha256', appSecret)
        .update(rawBody)
        .digest('hex');

    return safeCompare(expectedSig, computedHmac);
}

// ============================================================
// GET /api/webhooks/whatsapp — Meta Webhook Verification
// ============================================================
// Meta sends:
//   hub.mode=subscribe
//   hub.verify_token=<your verify token>
//   hub.challenge=<random string to echo back>
//
// We verify the token matches WHATSAPP_WEBHOOK_VERIFY_TOKEN,
// then return hub.challenge as plain text.
// ============================================================
router.get('/whatsapp', function(req, res) {
    var mode = req.query['hub.mode'];
    var verifyToken = req.query['hub.verify_token'];
    var challenge = req.query['hub.challenge'];

    // Check all required parameters are present
    if (!mode || !verifyToken || !challenge) {
        console.warn('[Webhook] GET missing parameters.');
        return res.status(400).send('Bad Request');
    }

    // Verify mode is "subscribe"
    if (mode !== 'subscribe') {
        console.warn('[Webhook] GET invalid mode: ' + mode);
        return res.status(403).send('Forbidden');
    }

    // Verify token matches our configured verify token (constant-time)
    var expectedToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    if (!expectedToken) {
        console.error('[Webhook] WHATSAPP_WEBHOOK_VERIFY_TOKEN not configured.');
        return res.status(500).send('Internal Server Error');
    }

    if (!safeCompare(verifyToken, expectedToken)) {
        console.warn('[Webhook] GET verification token mismatch.');
        return res.status(403).send('Forbidden');
    }

    // Success — return the challenge string as-is
    console.log('[Webhook] Verification successful.');
    return res.status(200).send(challenge);
});

// ============================================================
// POST /api/webhooks/whatsapp — Receive Webhook Events
// ============================================================
// Meta sends webhook events with:
//   Header: X-Hub-Signature-256: sha256=<HMAC>
//   Body: JSON webhook payload
//
// We verify the HMAC signature using WHATSAPP_APP_SECRET,
// then acknowledge 200 immediately and process asynchronously.
// ============================================================
router.post('/whatsapp', function(req, res) {
    // 1. Verify signature using raw body
    var signature = req.get('X-Hub-Signature-256');
    var rawBody = req.rawBody;

    if (!rawBody) {
        console.error('[Webhook] POST raw body missing.');
        return res.status(400).send('Bad Request');
    }

    if (!verifySignature(signature, rawBody)) {
        console.warn('[Webhook] POST signature verification failed.');
        return res.status(403).send('Forbidden');
    }

    // 2. Acknowledge immediately — Meta requires fast response
    //    Process the event asynchronously
    res.status(200).send('OK');

    // 3. Process event in the background (non-blocking)
    var payload = req.body;

    if (!payload) {
        // Body may not have been parsed if JSON was malformed
        // Try to parse raw body manually
        try {
            payload = JSON.parse(rawBody.toString('utf8'));
        } catch (e) {
            console.error('[Webhook] Failed to parse JSON payload.');
            return;
        }
    }

    // Process asynchronously — do not await
    handleWebhookEvent(payload).catch(function(err) {
        console.error('[Webhook] Async processing error: ' + err.message);
    });
});

module.exports = router;

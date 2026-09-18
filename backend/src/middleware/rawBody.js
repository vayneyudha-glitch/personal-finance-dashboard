/* ============================================================
   MIDDLEWARE/RAWBODY.JS — Raw Body Capture for Webhooks
   ============================================================
   Meta WhatsApp webhooks send an X-Hub-Signature-256 header
   containing an HMAC-SHA256 of the **raw** request body.

   Express's default express.json() consumes and parses the body,
   making the raw bytes unavailable for signature verification.

   This middleware:
   1. Captures the raw body bytes into req.rawBody
   2. Parses JSON and stores in req.body (so express.json()
      doesn't need to run for this route)
   3. Calls next() when done

   This route is registered BEFORE express.json() in server.js,
   so express.json() never runs for webhook requests — this
   middleware handles parsing entirely.

   Usage (in server.js):
     app.use('/api/webhooks', rawBodyMiddleware, webhookRoutes);

   For all OTHER routes, express.json() runs normally.
   ============================================================ */

/**
 * Capture raw request body for HMAC signature verification,
 * then parse JSON body.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {Function} next
 */
function rawBodyMiddleware(req, res, next) {
    // Only capture body for POST requests (GET webhook verification has no body)
    if (req.method !== 'POST') {
        return next();
    }

    var chunks = [];

    req.on('data', function(chunk) {
        chunks.push(chunk);

        // Prevent overly large payloads (security hardening — 2MB max)
        if (Buffer.concat(chunks).length > 2 * 1024 * 1024) {
            chunks = null;
            req.destroy();
            return res.status(413).send('Payload Too Large');
        }
    });

    req.on('end', function() {
        var raw = Buffer.concat(chunks);
        req.rawBody = raw;

        // Parse JSON body from raw bytes (replaces express.json for this route)
        if (raw.length > 0) {
            try {
                req.body = JSON.parse(raw.toString('utf8'));
            } catch (e) {
                // Malformed JSON — still proceed with rawBody for signature check
                // The route handler will deal with missing body
                req.body = null;
            }
        }

        next();
    });

    req.on('error', function() {
        // Don't leak internal errors — generic 400
        return res.status(400).send('Bad Request');
    });
}

module.exports = { rawBodyMiddleware };

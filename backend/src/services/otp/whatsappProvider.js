/* ============================================================
   SERVICES/OTP/WHATSAPPPROVIDER.JS — WhatsApp Business Cloud API
   ============================================================
   Sends OTP via WhatsApp Business Cloud API (Meta).
   Official docs: https://developers.facebook.com/docs/whatsapp/cloud-api

   Required environment variables:
     WHATSAPP_API_URL           — Base URL (e.g. https://graph.facebook.com/v21.0)
     WHATSAPP_API_TOKEN         — Permanent or system-user access token
     WHATSAPP_PHONE_NUMBER_ID   — WhatsApp Business phone number ID
     WHATSAPP_TEMPLATE_NAME     — Approved WhatsApp message template name
     WHATSAPP_TEMPLATE_LANGUAGE — Template language code (e.g. "en" or "id")

   SECURITY:
   - API token is NEVER logged.
   - API token is NEVER returned in API responses.
   - OTP is NEVER logged.
   - Errors from the provider are sanitized before reaching the client.
   - Phone numbers are masked in logs.
   - Provider checks for required credentials before sending;
     if missing, returns failure (does NOT silently fall back to console).
   ============================================================ */

const { maskPhone } = require('./mask');

const name = 'whatsapp';

// Timeout for WhatsApp API request (ms)
const REQUEST_TIMEOUT_MS = 15000;

/**
 * Validate that all required WhatsApp env vars are present.
 * @returns {{ valid: boolean, missing: string[] }}
 */
function validateConfig() {
    const required = [
        'WHATSAPP_API_URL',
        'WHATSAPP_API_TOKEN',
        'WHATSAPP_PHONE_NUMBER_ID',
        'WHATSAPP_TEMPLATE_NAME',
        'WHATSAPP_TEMPLATE_LANGUAGE'
    ];
    const missing = required.filter(function(k) {
        return !process.env[k] || process.env[k].trim() === '';
    });
    return { valid: missing.length === 0, missing: missing };
}

/**
 * Send OTP via WhatsApp Business Cloud API.
 *
 * Uses an approved message template with a single {{1}} parameter
 * for the OTP code. The template must be pre-approved in Meta Business Manager.
 *
 * API reference:
 *   POST {WHATSAPP_API_URL}/{WHATSAPP_PHONE_NUMBER_ID}/messages
 *   Headers: Authorization: Bearer {WHATSAPP_API_TOKEN}
 *   Body: {
 *     messaging_product: "whatsapp",
 *     to: <phone without +>,
 *     type: "template",
 *     template: {
 *       name: WHATSAPP_TEMPLATE_NAME,
 *       language: { code: WHATSAPP_TEMPLATE_LANGUAGE },
 *       components: [{
 *         type: "body",
 *         parameters: [{ type: "text", text: code }]
 *       }]
 *     }
 *   }
 *
 * @param {string} phone - Normalized phone (+62...)
 * @param {string} code  - 6-digit OTP code
 * @returns {Promise<{success: boolean, provider: string, messageId?: string}>}
 */
async function sendOtp(phone, code) {
    var config = validateConfig();
    if (!config.valid) {
        // Do NOT fall back to console — user must know WhatsApp is misconfigured
        console.error('[OTP/whatsapp] Configuration incomplete. Missing:', config.missing.join(', '));
        console.error('[OTP/whatsapp] Set these in backend/.env or switch OTP_PROVIDER=console for development.');
        return { success: false, provider: name };
    }

    // WhatsApp API expects phone number without the leading "+"
    var cleanPhone = phone.replace(/^\+/, '');

    var apiUrl = process.env.WHATSAPP_API_URL.replace(/\/+$/, '') +
        '/' + process.env.WHATSAPP_PHONE_NUMBER_ID + '/messages';

    var body = JSON.stringify({
        messaging_product: 'whatsapp',
        to: cleanPhone,
        type: 'template',
        template: {
            name: process.env.WHATSAPP_TEMPLATE_NAME,
            language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE },
            components: [{
                type: 'body',
                parameters: [{ type: 'text', text: code }]
            }]
        }
    });

    var controller = new AbortController();
    var timeoutId = setTimeout(function() { controller.abort(); }, REQUEST_TIMEOUT_MS);

    try {
        var response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + process.env.WHATSAPP_API_TOKEN,
                'Content-Type': 'application/json'
            },
            body: body,
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        var result = await response.json();

        // Meta Cloud API: success = HTTP 200 with "messages" array containing message_id
        if (response.ok && result.messages && result.messages.length > 0) {
            var messageId = result.messages[0].message_id || '';
            console.log('[OTP/whatsapp] Sent successfully to ' + maskPhone(phone) + ' (msg: ' + messageId + ')');
            return { success: true, provider: name, messageId: messageId };
        }

        // Provider returned an error status (400/401/403/429/500, etc.)
        // Log sanitized error — NEVER log the API token or full response with sensitive data
        var statusCode = response.status;
        var errorMsg = '';

        if (result.error) {
            // Meta error format: { error: { message, code, type, ... } }
            errorMsg = result.error.message || '';
        }

        console.error('[OTP/whatsapp] Provider returned HTTP ' + statusCode + ' for ' + maskPhone(phone) + '.');
        if (errorMsg) {
            console.error('[OTP/whatsapp] Provider error: ' + errorMsg);
        }

        return { success: false, provider: name };

    } catch (err) {
        clearTimeout(timeoutId);

        if (err.name === 'AbortError') {
            console.error('[OTP/whatsapp] Request timed out for ' + maskPhone(phone) + '.');
        } else {
            // Log the error message only — never the full error object (could contain headers/tokens)
            console.error('[OTP/whatsapp] Request failed for ' + maskPhone(phone) + ': ' + err.message);
        }

        return { success: false, provider: name };
    }
}

module.exports = { name, sendOtp, validateConfig };

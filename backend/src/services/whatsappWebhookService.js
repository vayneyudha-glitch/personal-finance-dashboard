/* ============================================================
   SERVICES/WHATSAPPWEBHOOKSERVICE.JS — Webhook Event Handler
   ============================================================
   Processes incoming WhatsApp webhook events from Meta.

   Supported event types:
     - messages    (incoming text/media from users)
     - statuses    (sent/delivered/read receipts)
     - errors      (delivery failures, etc.)
     - unknown     (future/unsupported events — logged, no crash)

   SECURITY:
   - Never logs full phone numbers (masked)
   - Never logs API tokens or app secrets
   - Never logs message content (may contain OTP codes)
   - Never exposes internal errors to the client

   This service is event-driven and designed to process
   webhooks asynchronously without blocking the HTTP response
   to Meta (Meta requires fast acknowledgment).
   ============================================================ */

const { maskPhone } = require('./otp/mask');

/**
 * Process an incoming WhatsApp webhook event.
 * This function is called asynchronously — it should not throw
 * uncaught errors that could crash the server.
 *
 * @param {object} payload — The parsed JSON webhook payload from Meta
 * @returns {Promise<void>}
 */
async function handleWebhookEvent(payload) {
    try {
        if (!payload || typeof payload !== 'object') {
            console.warn('[Webhook] Received non-object payload, ignoring.');
            return;
        }

        var objectType = payload.object;
        if (objectType !== 'whatsapp_business_account') {
            console.warn('[Webhook] Unexpected object type: ' + objectType);
            return;
        }

        var entries = payload.entry;
        if (!Array.isArray(entries) || entries.length === 0) {
            console.warn('[Webhook] No entries in payload.');
            return;
        }

        // Process each entry (usually just one per webhook)
        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            var wabaId = entry.id;

            var changes = entry.changes;
            if (!Array.isArray(changes)) continue;

            for (var j = 0; j < changes.length; j++) {
                var change = changes[j];
                var field = change.field;
                var value = change.value;

                if (!value) continue;

                var messagingProduct = value.messaging_product || 'unknown';

                switch (field) {
                    case 'messages':
                        processMessages(value, wabaId, messagingProduct);
                        break;
                    case 'statuses':
                        processStatuses(value, wabaId, messagingProduct);
                        break;
                    default:
                        if (value.errors && Array.isArray(value.errors)) {
                            processErrors(value.errors, wabaId);
                        } else {
                            console.log('[Webhook] Unhandled field: ' + field + ' (product: ' + messagingProduct + ')');
                        }
                }
            }
        }
    } catch (err) {
        // Never crash — log sanitized error
        console.error('[Webhook] Error processing event: ' + err.message);
    }
}

/**
 * Process incoming messages array.
 * Extracts: sender phone (masked), message type, timestamp.
 * Does NOT log message content (could contain OTP or PII).
 *
 * @param {object} value — The webhook value object
 * @param {string} wabaId — WhatsApp Business Account ID
 * @param {string} messagingProduct — "whatsapp" or other
 */
function processMessages(value, wabaId, messagingProduct) {
    var messages = value.messages;
    var contacts = value.contacts;
    var metadata = value.metadata || {};

    if (!Array.isArray(messages)) return;

    var phoneId = metadata.phone_number_id || 'unknown';
    var displayPhone = metadata.display_phone_number || 'unknown';

    for (var i = 0; i < messages.length; i++) {
        var msg = messages[i];
        var from = msg.from || 'unknown';
        var msgType = msg.type || 'unknown';
        var msgId = msg.id || '';
        var timestamp = msg.timestamp || '';
        var context = msg.context; // Present if this is a reply

        // Find contact name (masked)
        var contactName = 'unknown';
        if (Array.isArray(contacts)) {
            for (var k = 0; k < contacts.length; k++) {
                if (contacts[k].wa_id === from) {
                    contactName = contacts[k].name ? maskPhone(contacts[k].name) : 'unknown';
                    break;
                }
            }
        }

        console.log('[Webhook/Message] ' +
            'From: ' + maskPhone(from) + ', ' +
            'Type: ' + msgType + ', ' +
            'MsgID: ' + msgId + ', ' +
            'Time: ' + timestamp + ', ' +
            'PhoneID: ' + phoneId
        );

        // If this is a reply to a previously sent message
        if (context && context.message_id) {
            console.log('[Webhook/Message] Reply to: ' + context.message_id);
        }

        // Handle specific message types without logging content
        if (msgType === 'text') {
            // Text message — DO NOT log text content (could contain OTP)
            // To process text content for business logic:
            //   var text = msg.text && msg.text.body;
            // Future: route to appropriate handler
        } else if (msgType === 'button') {
            var buttonReply = msg.button && msg.button.text;
            console.log('[Webhook/Message] Button reply: ' + buttonReply);
        } else if (msgType === 'interactive') {
            var interactiveType = msg.interactive && msg.interactive.type;
            console.log('[Webhook/Message] Interactive type: ' + interactiveType);
        } else if (msgType === 'reaction') {
            var reaction = msg.reaction && msg.reaction.emoji;
            console.log('[Webhook/Message] Reaction: ' + reaction);
        }
        // Other types: image, audio, video, document, location, contacts, template, etc.
        // — handle as needed for future features
    }
}

/**
 * Process message status updates (sent, delivered, read, failed).
 *
 * @param {object} value — The webhook value object
 * @param {string} wabaId — WhatsApp Business Account ID
 * @param {string} messagingProduct
 */
function processStatuses(value, wabaId, messagingProduct) {
    var statuses = value.statuses;
    if (!Array.isArray(statuses)) return;

    for (var i = 0; i < statuses.length; i++) {
        var status = statuses[i];
        var recipient = status.recipient_id || 'unknown';
        var statusValue = status.status || 'unknown';
        var msgId = status.id || '';
        var timestamp = status.timestamp || '';
        var conversation = status.conversation;
        var pricing = status.pricing;
        var errors = status.errors;

        console.log('[Webhook/Status] ' +
            'To: ' + maskPhone(recipient) + ', ' +
            'Status: ' + statusValue + ', ' +
            'MsgID: ' + msgId + ', ' +
            'Time: ' + timestamp
        );

        // Log conversation & pricing metadata (no sensitive data)
        if (conversation && conversation.id) {
            console.log('[Webhook/Status] Conversation: ' + conversation.id +
                ' (type: ' + (conversation.conversation_type || 'unknown') +
                ', origin: ' + (conversation.origin && conversation.origin.type || 'unknown') + ')');
        }

        if (pricing && pricing.billable) {
            console.log('[Webhook/Status] Pricing: ' + pricing.pricing_model +
                ' category=' + pricing.category +
                ' billable=' + pricing.billable);
        }

        // Handle delivery errors
        if (Array.isArray(errors) && errors.length > 0) {
            for (var j = 0; j < errors.length; j++) {
                var err = errors[j];
                console.error('[Webhook/Status] Delivery error: code=' + err.code +
                    ' title=' + (err.title || '') +
                    ' (retries=' + (err.error_data && err.error_data.retries_after || 0) + ')');
            }
        }
    }
}

/**
 * Process webhook-level errors.
 *
 * @param {array} errors — Array of error objects
 * @param {string} wabaId — WhatsApp Business Account ID
 */
function processErrors(errors, wabaId) {
    for (var i = 0; i < errors.length; i++) {
        var err = errors[i];
        console.error('[Webhook/Error] WABA=' + wabaId +
            ' code=' + (err.code || 'unknown') +
            ' title=' + (err.title || '') +
            ' message=' + (err.message || ''));
    }
}

module.exports = {
    handleWebhookEvent,
    processMessages,
    processStatuses,
    processErrors
};

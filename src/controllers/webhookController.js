import lemonSqueezyService from "../services/lemonSqueezyService.js";
import logService from "../services/logService.js";

class WebhookController {
  async handleLemonSqueezyWebhook(req, res) {
    try {
      // Verify the webhook signature
      const signatureVerified = lemonSqueezyService.verifyWebhookSignature(req);
      if (!signatureVerified) {
        await logService.logSecurityEvent({
          event: 'lemon_squeezy_webhook_signature_mismatch',
          ipAddress: req.ip,
          details: { headers: req.headers, body: req.body }
        });
        return res.status(401).json({ error: 'Invalid signature' });
      }

      const event = req.body;
      const eventName = event.meta.event_name;

      switch (eventName) {
        case 'subscription_created':
        case 'subscription_updated':
        case 'subscription_cancelled':
        case 'subscription_resumed':
        case 'subscription_expired':
        case 'subscription_paused':
          await lemonSqueezyService.handleSubscriptionEvent(event);
          break;
        // Add other event types as needed
        default:
          console.log(`Unhandled Lemon Squeezy event: ${eventName}`);
      }

      res.status(200).json({ message: 'Webhook received' });
    } catch (error) {
      console.error('Error handling Lemon Squeezy webhook:', error);
      await logService.logApiRequest({
        endpoint: '/webhook/lemonsqueezy',
        method: 'POST',
        status: 500,
        error: error.message,
        details: { body: req.body }
      });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

export default new WebhookController();
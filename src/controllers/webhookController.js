import crypto from 'crypto';
import config from '../config/config.js';
import logService from "../services/logService.js";
import databaseService from "../services/databaseService.js";
import Subscription from "../models/Subscription.js";

const PADDLE_PLAN_TO_INTERNAL = Object.entries(
  config.paddle?.products || {}
).reduce((acc, [label, productId]) => {
  if (!productId) return acc;

  let plan = null;
  switch (label) {
    case "starter":
      plan = "basic";
      break;
    case "pro":
      plan = "pro";
      break;
    case "business":
      plan = "enterprise";
      break;
    default:
      plan = label;
  }

  const fallbackPages = Subscription.getDefaultPagesForPlan(plan) || 0;
  const configuredPages = Number(config.subscriptionPlans?.[label]);

  acc[String(productId)] = {
    plan,
    pages: Number.isFinite(configuredPages) ? configuredPages : fallbackPages,
  };
  return acc;
}, {});

const parsePassthrough = (value) => {
  if (!value) return {};
  if (typeof value === "object") return value;

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (error) {
      return {};
    }
  }

  return {};
};

const resolvePlanFromPayload = (payload) => {
  const candidateId =
    payload.subscription_plan_id ||
    payload.plan_id ||
    payload.product_id ||
    payload.product ||
    payload.subscription_plan_version_id;

  if (!candidateId) {
    return null;
  }

  return PADDLE_PLAN_TO_INTERNAL[String(candidateId)] || null;
};

const resolveNextReset = (payload) => {
  const next = payload.next_bill_date || payload.next_payment_date;
  if (next) {
    const parsed = new Date(next);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
};

class WebhookController {
  /**
   * Verifies Paddle webhook signature using the configured public key.
   * Returns false if verification cannot be performed.
   */
  verifyPaddleSignature(payload) {
    const publicKey = config.paddle?.publicKey;
    const signature = payload?.p_signature;

    if (!publicKey || !signature) {
      return { canVerify: false, isValid: false };
    }

    try {
      const fields = { ...payload };
      delete fields.p_signature;

      const serialized = Object.keys(fields)
        .sort()
        .reduce((acc, key) => {
          const value = fields[key];
          if (value !== null && typeof value === 'object') {
            acc[key] = JSON.stringify(value);
          } else {
            acc[key] = value;
          }
          return acc;
        }, {});

      const verifier = crypto.createVerify('sha1');
      verifier.update(JSON.stringify(serialized));
      verifier.end();

      const signatureBuffer = Buffer.from(signature, 'base64');
      const isValid = verifier.verify(publicKey, signatureBuffer);
      return { canVerify: true, isValid };
    } catch (error) {
      logService.error('[WEBHOOK] Failed to verify Paddle signature:', error);
      return { canVerify: true, isValid: false };
    }
  }

  async handlePaddleWebhook(req, res) {
    try {
      const { canVerify, isValid } = this.verifyPaddleSignature(req.body);

      if (canVerify && !isValid) {
        await logService.logSecurityEvent({
          event: 'paddle_webhook_signature_mismatch',
          ipAddress: req.ip,
          details: { headers: req.headers, body: req.body }
        });
        return res.status(401).json({ error: 'Invalid signature' });
      }

      if (!canVerify) {
        logService.warn('[WEBHOOK] Paddle public key not configured, skipping signature verification');
      }

      const alertName = req.body.alert_name;
      const passthrough = parsePassthrough(req.body.passthrough);
      const customerId =
        req.body.customer_id ||
        passthrough.customer_id ||
        passthrough.user_id ||
        null;
      const checkoutId = req.body.checkout_id || passthrough.checkout_id || null;

      logService.log('[WEBHOOK] Paddle alert received', { alertName });

      switch (alertName) {
        case 'subscription_created':
        case 'subscription_updated':
        case 'subscription_payment_succeeded': {
          const planConfig = resolvePlanFromPayload(req.body);

          if (!customerId) {
            logService.warn('[WEBHOOK] Paddle subscription event without customer identifier', {
              alertName,
            });
            break;
          }

          if (!planConfig) {
            logService.warn('[WEBHOOK] Unable to map Paddle plan to internal plan', {
              alertName,
              payloadPlan: req.body.plan_id || req.body.subscription_plan_id,
            });
            break;
          }

          await databaseService.updateSubscription({
            customer_id: customerId,
            checkout_id: checkoutId,
            plan: planConfig.plan,
            pages_remaining: planConfig.pages,
            renewed_at: new Date(req.body.event_time || Date.now()),
            next_reset: resolveNextReset(req.body),
          });

          logService.info('[WEBHOOK] Subscription updated', {
            alertName,
            plan: planConfig.plan,
            customerId,
          });
          break;
        }
        case 'subscription_cancelled':
        case 'subscription_payment_failed': {
          if (!customerId) {
            logService.warn('[WEBHOOK] Subscription cancellation without customer id');
            break;
          }

          await databaseService.updateSubscription({
            customer_id: customerId,
            checkout_id: checkoutId,
            plan: 'free',
            pages_remaining: Subscription.getDefaultPagesForPlan('free'),
            renewed_at: new Date(req.body.event_time || Date.now()),
            next_reset: resolveNextReset(req.body),
          });

          logService.info('[WEBHOOK] Subscription downgraded to free plan', {
            alertName,
            customerId,
          });
          break;
        }
        default:
          logService.warn('[WEBHOOK] Unhandled Paddle alert', { alertName });
      }

      await databaseService.logApiRequest({
        endpoint: '/webhook/paddle',
        method: 'POST',
        status: 200,
        details: { alertName }
      });

      res.status(200).json({ success: true });
    } catch (error) {
      logService.error('[WEBHOOK] Error handling Paddle webhook:', error);
      await databaseService.logApiRequest({
        endpoint: '/webhook/paddle',
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

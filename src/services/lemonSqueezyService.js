import { lemonSqueezySetup, getSubscription } from "@lemonsqueezy/lemonsqueezy.js";
import crypto from "crypto";
import config from "../config/config.js";
import supabaseService from "./supabaseService.js";

class LemonSqueezyService {
  constructor() {
    lemonSqueezySetup({
      apiKey: config.lemonSqueezy.apiKey,
      onError: (error) => {
        console.error("Error en la API de Lemon Squeezy:", error);
        // Opcionalmente, se podría registrar este error en un servicio de monitoreo
      },
    });
  }

  verifyWebhookSignature(request) {
    const secret = config.lemonSqueezy.webhookSecret;
    const hmac = crypto.createHmac("sha256", secret);
    const digest = Buffer.from(hmac.update(request.rawBody).digest("hex"), "utf8");
    const signature = Buffer.from(request.get("X-Signature") || "", "utf8");

    return crypto.timingSafeEqual(digest, signature);
  }

  getPlanFromVariantId(variantId) {
    const { variants } = config.lemonSqueezy;
    const variantIdStr = String(variantId);

    if (variantIdStr === variants.starter) return "starter";
    if (variantIdStr === variants.pro) return "pro";
    if (variantIdStr === variants.business) return "business";

    throw new Error(`Variante de plan no reconocida: ${variantId}`);
  }

  async handleSubscriptionEvent(event) {
    const {
      customer_id,
      variant_id,
      order_id,
      id: subscriptionId,
    } = event.data.attributes;

    // Obtener el plan correspondiente
    const plan = this.getPlanFromVariantId(variant_id);
    const pagesAllowed = config.subscriptionPlans[plan];

    // Verificar el evento con la API de Lemon Squeezy
    const { data: subscription, error } = await getSubscription(subscriptionId);

    if (error || !subscription) {
      throw new Error(
        `No se pudo verificar la suscripción ${subscriptionId} con Lemon Squeezy: ${
          error?.message || "No data"
        }`
      );
    }

    // Actualizar o crear suscripción en Supabase
    await supabaseService.updateSubscription({
      customer_id,
      checkout_id: order_id,
      plan,
      pages_remaining: pagesAllowed,
      renewed_at: new Date(),
      next_reset: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // +30 días
    });

    // Registrar el evento en el log
    await supabaseService.logPaymentEvent({
      event_type: event.meta.event_name,
      customer_id,
      checkout_id: order_id,
      plan,
      details: JSON.stringify({
        variant_id,
        subscription_id: subscriptionId,
        event_data: event.data.attributes,
      }),
    });
  }
}

export default new LemonSqueezyService(); 
import { createClient } from "@supabase/supabase-js";
import config from "../config/config.js";

class SupabaseService {
  constructor() {
    this.supabase = createClient(config.supabase.url, config.supabase.key);
  }

  async validateSession(token) {
    try {
      const { data: { user }, error } = await this.supabase.auth.getUser(token);
      if (error) throw error;
      return user;
    } catch (error) {
      throw new Error('Sesión inválida');
    }
  }

  async createUserProfile(userId, profileData) {
    const { data, error } = await this.supabase
      .from('users')
      .insert([
        {
          id: userId,
          email: profileData.email,
          name: profileData.name,
          created_at: new Date()
        }
      ]);
    
    if (error) throw error;

    // También crear una suscripción gratuita por defecto
    const { error: subscriptionError } = await this.supabase
      .from('subscriptions')
      .insert([
        {
          user_id: userId,
          plan: 'free',
          pages_remaining: 10, // 10 páginas gratis
          renewed_at: new Date(),
          next_reset: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 días
        }
      ]);

    if (subscriptionError) throw subscriptionError;
    return data;
  }

  async getSubscription(userId) {
    const { data, error } = await this.supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  }

  async getFreeUploadsUsed(userId) {
    const { data: { user }, error } = await this.supabase.auth.admin.getUserById(userId);
    if (error) throw error;
    return user?.user_metadata?.free_uploads_used || 0;
  }

  async incrementFreeUploadsUsed(userId) {
    const currentUploads = await this.getFreeUploadsUsed(userId);
    const { data: { user }, error } = await this.supabase.auth.admin.updateUserById(userId, {
      user_metadata: { free_uploads_used: currentUploads + 1 },
    });
    if (error) throw error;
    return user.user_metadata.free_uploads_used;
  }

  async getUserInfo(userId) {
    try {
      // Primero obtener la información del usuario
      const { data: userProfile, error: userError } = await this.supabase
        .from('users')
        .select('email, name, lemon_customer_id')
        .eq('id', userId)
        .single();

      if (userError && userError.code !== 'PGRST116') {
        throw userError;
      }

      // Luego obtener la información de la suscripción
      const { data: subscription, error: subscriptionError } = await this.supabase
        .from('subscriptions')
        .select('plan, pages_remaining, renewed_at, next_reset')
        .eq('user_id', userId)
        .single();

      if (subscriptionError && subscriptionError.code !== 'PGRST116') {
        throw subscriptionError;
      }

      // Combinar los datos
      return {
        ...userProfile,
        ...subscription
      };
    } catch (error) {
      console.error('[SUPABASE_SERVICE] getUserInfo error:', error);
      throw error;
    }
  }

  async getUserProfile(userId) {
    const { data, error } = await this.supabase
      .from('users')
      .select('id, email, name, lemon_customer_id')
      .eq('id', userId)
      .single();
    if (error) throw error;
    return data;
  }

  async updateUserProfile(userId, profileData) {
    const { data, error } = await this.supabase
      .from('users')
      .update(profileData)
      .eq('id', userId);
    if (error) throw error;
    return data;
  }

  async getConversions(userId) {
    const { data, error } = await this.supabase
      .from('conversions')
      .select('id, original_file_name, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10); // Limit to last 10 conversions
    if (error) throw error;
    return data;
  }

  async saveConversion(userId, originalFileName, pageCount) {
    const { data, error } = await this.supabase
      .from('conversions')
      .insert([
        { user_id: userId, original_file_name: originalFileName, page_count: pageCount }
      ]);
    if (error) throw error;
    return data;
  }

  async updatePagesRemaining(userId, pagesUsed) {
    // Usar una transacción para garantizar la atomicidad
    const { data: subscription, error: selectError } = await this.supabase
      .from('subscriptions')
      .select('pages_remaining')
      .eq('user_id', userId)
      .single();

    if (selectError) throw selectError;
    if (!subscription) throw new Error('Suscripción no encontrada');
    if (subscription.pages_remaining < pagesUsed) {
      throw new Error('Páginas insuficientes');
    }

    const { error: updateError } = await this.supabase
      .from('subscriptions')
      .update({ pages_remaining: subscription.pages_remaining - pagesUsed })
      .eq('user_id', userId)
      .select()
      .single();

    if (updateError) throw updateError;
    return subscription.pages_remaining - pagesUsed;
  }

  async resetSubscriptions() {
    const { data, error } = await this.supabase.rpc('reset_monthly_pages');
    if (error) throw error;
    return data;
  }

  async updateSubscription(subscriptionData) {
    const { customer_id, checkout_id } = subscriptionData;

    // Primero buscar usuario por customer_id o checkout_id
    const { data: user, error: userError } = await this.supabase
      .from('users')
      .select('id')
      .or(`lemon_customer_id.eq.${customer_id},lemon_checkout_id.eq.${checkout_id}`)
      .single();

    if (userError) throw userError;
    if (!user) throw new Error('Usuario no encontrado');

    // Actualizar o crear suscripción
    const { error: subscriptionError } = await this.supabase
      .from('subscriptions')
      .upsert({
        user_id: user.id,
        plan: subscriptionData.plan,
        pages_remaining: subscriptionData.pages_remaining,
        renewed_at: subscriptionData.renewed_at,
        next_reset: subscriptionData.next_reset
      }, {
        onConflict: 'user_id'
      });

    if (subscriptionError) throw subscriptionError;
  }

  async logPaymentEvent(eventData) {
    const { error } = await this.supabase
      .from('payments_log')
      .insert({
        event_type: eventData.event_type,
        customer_id: eventData.customer_id,
        checkout_id: eventData.checkout_id,
        plan: eventData.plan,
        details: eventData.details,
        created_at: new Date()
      });

    if (error) throw error;
  }

  async createLog(logData) {
    const { error } = await this.supabase
      .from('system_logs')
      .insert({
        ...logData,
        created_at: new Date()
      });

    if (error) throw error;
  }
}

export default new SupabaseService();
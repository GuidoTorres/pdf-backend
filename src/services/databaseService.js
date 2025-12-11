import { User, Subscription, Document, SystemLog, PaymentLog, UserSession } from '../models/index.js';
import jwt from 'jsonwebtoken';
import config from '../config/config.js';

class DatabaseService {
  async validateSession(token) {
    try {
      const decoded = jwt.verify(token, config.jwt.secret);
      const session = await UserSession.validateToken(token);
      
      if (!session) {
        throw new Error('Sesión inválida o expirada');
      }

      const user = await User.findByPk(decoded.userId, {
        include: [{
          model: Subscription,
          as: 'subscription'
        }]
      });

      if (!user) {
        throw new Error('Usuario no encontrado');
      }

      return user;
    } catch (error) {
      throw new Error('Sesión inválida');
    }
  }

  async createUserProfile(userData) {
    const user = await User.create({
      email: userData.email,
      name: userData.name,
      password_hash: userData.password,
      google_id: userData.google_id || null,
      email_verified: userData.email_verified || false
    });

    // Crear suscripción gratuita por defecto
    await Subscription.create({
      user_id: user.id,
      plan: 'free',
      pages_remaining: 10
    });

    return user;
  }

  async getSubscription(userId) {
    return await Subscription.findOne({
      where: { user_id: userId }
    });
  }

  async getUserInfo(userId) {
    const user = await User.findByPk(userId, {
      include: [{
        model: Subscription,
        as: 'subscription'
      }]
    });

    if (!user) {
      throw new Error('Usuario no encontrado');
    }

    // Si el usuario tiene plan ilimitado, mostrar páginas ilimitadas
    const isUnlimited = user.subscription?.plan === 'unlimited' || user.subscription?.plan === 'ilimitado';
    const pagesRemaining = isUnlimited ? 999999 : user.subscription?.pages_remaining;

    return {
      ...user.toJSON(),
      plan: user.subscription?.plan,
      pages_remaining: pagesRemaining,
      renewed_at: user.subscription?.renewed_at,
      next_reset: user.subscription?.next_reset
    };
  }

  async getUserProfile(userId) {
    return await User.findByPk(userId, {
      attributes: ['id', 'email', 'name', 'paddle_customer_id']
    });
  }

  async updateUserProfile(userId, profileData) {
    const user = await User.findByPk(userId);
    if (!user) {
      throw new Error('Usuario no encontrado');
    }

    return await user.update(profileData);
  }

  async getConversions(userId) {
    return await Document.findAll({
      where: { 
        user_id: userId,
        status: 'completed'
      },
      attributes: ['id', 'original_file_name', 'created_at'],
      order: [['created_at', 'DESC']],
      limit: 10
    });
  }

  async saveConversion(userId, originalFileName, pageCount) {
    return await Document.create({
      user_id: userId,
      original_file_name: originalFileName,
      page_count: pageCount,
      job_id: `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    });
  }

  async updatePagesRemaining(userId, pagesUsed) {
    const subscription = await Subscription.findOne({
      where: { user_id: userId }
    });

    if (!subscription) {
      throw new Error('Suscripción no encontrada');
    }

    // Verificar si el usuario tiene plan ilimitado
    if (subscription.plan === 'unlimited' || subscription.plan === 'ilimitado') {
      // Usuario con acceso ilimitado, no descontar páginas
      return 999999; // Retornar un número alto para mostrar "ilimitado"
    }

    if (subscription.pages_remaining < pagesUsed) {
      throw new Error('Páginas insuficientes');
    }

    const newPagesRemaining = subscription.pages_remaining - pagesUsed;
    await subscription.update({ pages_remaining: newPagesRemaining });

    return newPagesRemaining;
  }

  async resetSubscriptions() {
    return await Subscription.resetMonthlyPages();
  }

  async updateSubscription(subscriptionData) {
    const { customer_id, checkout_id } = subscriptionData;

    // Buscar usuario por customer_id o checkout_id de Paddle
    const user = await User.findOne({
      where: {
        [User.sequelize.Sequelize.Op.or]: [
          { paddle_customer_id: customer_id },
          { paddle_checkout_id: checkout_id }
        ]
      }
    });

    if (!user) {
      throw new Error('Usuario no encontrado');
    }

    // Actualizar o crear suscripción
    const plan = subscriptionData.plan || 'free';
    const defaultPages = Subscription.getDefaultPagesForPlan(plan);
    const pagesRemaining =
      subscriptionData.pages_remaining ?? defaultPages ?? 0;

    const renewedAt = subscriptionData.renewed_at
      ? new Date(subscriptionData.renewed_at)
      : new Date();
    const nextReset = subscriptionData.next_reset
      ? new Date(subscriptionData.next_reset)
      : new Date(renewedAt.getTime() + 30 * 24 * 60 * 60 * 1000);

    const [subscription] = await Subscription.upsert({
      user_id: user.id,
      plan,
      pages_remaining: pagesRemaining,
      renewed_at: renewedAt,
      next_reset: nextReset,
    });

    return subscription;
  }

  async logPaymentEvent(eventData) {
    return await PaymentLog.create({
      event_type: eventData.event_type,
      customer_id: eventData.customer_id,
      checkout_id: eventData.checkout_id,
      plan: eventData.plan,
      details: eventData.details
    });
  }

  async createLog(logData) {
    return await SystemLog.create(logData);
  }

  async logApiRequest(data) {
    return await SystemLog.logApiRequest(data);
  }

  // Document methods
  async createDocument(documentData) {
    return await Document.create(documentData);
  }

  async getDocument(identifier) {
    if (!identifier) {
      return null;
    }

    const byJob = await Document.findOne({
      where: { job_id: identifier }
    });

    if (byJob) {
      return byJob;
    }

    // Fallback to primary key lookup if not found by job_id
    try {
      return await Document.findByPk(identifier);
    } catch (error) {
      console.warn('[DATABASE_SERVICE] Failed document lookup by ID', {
        identifier,
        error: error.message
      });
      return null;
    }
  }

  async getDocumentByJobId(jobId) {
    return await Document.findOne({
      where: { job_id: jobId }
    });
  }

  async updateDocument(jobId, updateData) {
    const document = await this.getDocumentByJobId(jobId);

    if (!document) {
      throw new Error('Documento no encontrado');
    }

    return await document.update(updateData);
  }

  async getUserDocuments(userId) {
    return await Document.findAll({
      where: { user_id: userId },
      order: [['created_at', 'DESC']]
    });
  }

  async getDocumentById(id) {
    return await Document.findByPk(id);
  }

  async deleteDocumentById(documentId, userId) {
    const document = await Document.findOne({
      where: { 
        id: documentId,
        user_id: userId
      }
    });

    if (!document) {
      throw new Error('Document not found or access denied');
    }

    return await document.destroy();
  }

  async deleteDocument(identifier, userId = null) {
    const document = await this.getDocument(identifier);

    if (!document) {
      throw new Error('Document not found');
    }

    if (userId && document.user_id !== userId) {
      throw new Error('Access denied');
    }

    await document.destroy();
    return true;
  }

  // Auth methods
  async createSession(userId, token, expiresIn = '7d') {
    return await UserSession.createSession(userId, token, expiresIn);
  }

  async revokeSession(token) {
    return await UserSession.revokeToken(token);
  }

  async revokeAllUserSessions(userId) {
    return await UserSession.revokeAllUserSessions(userId);
  }

  // User methods
  async findUserByEmail(email) {
    return await User.findOne({
      where: { email },
      include: [{
        model: Subscription,
        as: 'subscription'
      }]
    });
  }

  async findUserByGoogleId(googleId) {
    return await User.findOne({
      where: { google_id: googleId },
      include: [{
        model: Subscription,
        as: 'subscription'
      }]
    });
  }
}

export default new DatabaseService();

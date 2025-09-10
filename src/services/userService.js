import User from '../models/User.js';
import Subscription from '../models/Subscription.js';
import logService from './logService.js';

class UserService {
  /**
   * Get user with subscription information
   * @param {string} userId - User ID
   * @returns {Promise<Object>} User with subscription data
   */
  async getUserWithSubscription(userId) {
    try {
      const user = await User.findByPk(userId, {
        include: [{
          model: Subscription,
          as: 'subscription',
          required: false // LEFT JOIN to handle users without subscriptions
        }]
      });

      if (!user) {
        throw new Error(`User not found: ${userId}`);
      }

      // Log unlimited_access status for debugging
      logService.log('[USER_SERVICE] Retrieved user data', {
        userId: user.id,
        email: user.email,
        unlimited_access: user.unlimited_access,
        hasSubscription: !!user.subscription,
        subscriptionPlan: user.subscription ? user.subscription.plan : null
      });

      return user;

    } catch (error) {
      logService.error('[USER_SERVICE] Error getting user with subscription:', error);
      throw error;
    }
  }

  /**
   * Get user subscription plan
   * @param {string} userId - User ID
   * @returns {Promise<string>} Subscription plan ('free', 'basic', 'pro', 'enterprise')
   */
  async getUserPlan(userId) {
    try {
      const user = await this.getUserWithSubscription(userId);
      
      // If no subscription exists, default to free
      if (!user.subscription) {
        logService.log('[USER_SERVICE] No subscription found for user, defaulting to free', { userId });
        return 'free';
      }

      // Check if subscription is active
      if (user.subscription.status !== 'active') {
        logService.log('[USER_SERVICE] Inactive subscription found, defaulting to free', { 
          userId, 
          status: user.subscription.status 
        });
        return 'free';
      }

      const plan = user.subscription.plan;
      logService.log('[USER_SERVICE] Retrieved user plan', { userId, plan });
      
      return plan;

    } catch (error) {
      logService.error('[USER_SERVICE] Error getting user plan:', error);
      // Default to free on error to prevent blocking
      return 'free';
    }
  }

  /**
   * Check if user has remaining pages
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Object with hasPages boolean and remaining count
   */
  async checkUserPages(userId) {
    try {
      const user = await this.getUserWithSubscription(userId);
      
      // Check if user has unlimited access first
      if (user.unlimited_access === true) {
        logService.log('[USER_SERVICE] User has unlimited access - pages check passed', {
          userId,
          hasPages: true,
          unlimited: true,
          remaining: user.subscription ? user.subscription.pages_remaining : 0,
          plan: user.subscription ? user.subscription.plan : 'unlimited'
        });
        
        return {
          hasPages: true,
          remaining: user.subscription ? user.subscription.pages_remaining : 999999,
          plan: user.subscription ? user.subscription.plan : 'unlimited',
          unlimited: true
        };
      }
      
      // If no subscription, default free limits
      if (!user.subscription) {
        return {
          hasPages: false,
          remaining: 0,
          plan: 'free'
        };
      }

      const subscription = user.subscription;
      const hasPages = subscription.pages_remaining > 0;
      
      logService.log('[USER_SERVICE] Checked user pages', {
        userId,
        hasPages,
        remaining: subscription.pages_remaining,
        plan: subscription.plan,
        unlimited: false
      });

      return {
        hasPages,
        remaining: subscription.pages_remaining,
        plan: subscription.plan
      };

    } catch (error) {
      logService.error('[USER_SERVICE] Error checking user pages:', error);
      throw error;
    }
  }

  /**
   * Deduct pages from user subscription
   * @param {string} userId - User ID
   * @param {number} pagesToDeduct - Number of pages to deduct
   * @returns {Promise<Object>} Updated subscription info
   */
  async deductPages(userId, pagesToDeduct) {
    try {
      const user = await this.getUserWithSubscription(userId);
      
      if (!user.subscription) {
        throw new Error('No subscription found for user');
      }

      // Check if user has unlimited access
      if (user.unlimited_access === true) {
        logService.log('[USER_SERVICE] User has unlimited access - no pages deducted', {
          userId,
          pagesToDeduct: 0,
          previousRemaining: user.subscription.pages_remaining,
          newRemaining: user.subscription.pages_remaining,
          unlimited: true
        });

        return {
          remaining: user.subscription.pages_remaining,
          deducted: 0,
          plan: user.subscription.plan,
          unlimited: true
        };
      }

      const subscription = user.subscription;
      const newPagesRemaining = Math.max(0, subscription.pages_remaining - pagesToDeduct);

      await subscription.update({
        pages_remaining: newPagesRemaining
      });

      logService.log('[USER_SERVICE] Deducted pages from user', {
        userId,
        pagesToDeduct,
        previousRemaining: subscription.pages_remaining,
        newRemaining: newPagesRemaining
      });

      return {
        remaining: newPagesRemaining,
        deducted: pagesToDeduct,
        plan: subscription.plan
      };

    } catch (error) {
      logService.error('[USER_SERVICE] Error deducting pages:', error);
      throw error;
    }
  }

  /**
   * Get priority level for user based on subscription
   * @param {string} userId - User ID
   * @returns {Promise<number>} Priority level (1 = highest, 4 = lowest)
   */
  async getUserPriority(userId) {
    try {
      const plan = await this.getUserPlan(userId);
      
      const priorityMap = {
        'enterprise': 1,
        'pro': 2,
        'basic': 3,
        'free': 4
      };

      return priorityMap[plan] || priorityMap['free'];

    } catch (error) {
      logService.error('[USER_SERVICE] Error getting user priority:', error);
      return 4; // Default to lowest priority on error
    }
  }
}

// Create singleton instance
const userService = new UserService();

export default userService;
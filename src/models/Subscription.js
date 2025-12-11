import { DataTypes } from 'sequelize';
import database from '../config/database.js';

const sequelize = database.getSequelize();

const Subscription = sequelize.define('Subscription', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  user_id: {
    type: DataTypes.UUID,
    allowNull: false,
    unique: true,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  plan: {
    type: DataTypes.ENUM('free', 'basic', 'pro', 'enterprise', 'unlimited'),
    defaultValue: 'free'
  },
  pages_remaining: {
    type: DataTypes.INTEGER,
    defaultValue: 10
  },
  renewed_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  next_reset: {
    type: DataTypes.DATE,
    defaultValue: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days from now
  },
  status: {
    type: DataTypes.ENUM('active', 'cancelled', 'expired'),
    defaultValue: 'active'
  }
}, {
  tableName: 'subscriptions'
});

// Class methods
Subscription.getDefaultPagesForPlan = function(plan) {
  switch (plan) {
    case 'free':
      return 10;
    case 'basic':
      return 50;
    case 'pro':
      return 200;
    case 'enterprise':
    case 'unlimited':
      return 999999;
    default:
      return null;
  }
};

Subscription.resetMonthlyPages = async function() {
  const now = new Date();
  const subscriptionsToReset = await this.findAll({
    where: {
      next_reset: {
        [sequelize.Sequelize.Op.lte]: now
      }
    }
  });

  for (const subscription of subscriptionsToReset) {
    const defaultPages = Subscription.getDefaultPagesForPlan(subscription.plan);
    if (defaultPages === null) {
      continue;
    }

    await subscription.update({
      pages_remaining: defaultPages,
      renewed_at: now,
      next_reset: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    });
  }

  return subscriptionsToReset.length;
};

export default Subscription;

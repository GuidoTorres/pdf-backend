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
    let newPages;
    switch (subscription.plan) {
      case 'free':
        newPages = 10;
        break;
      case 'basic':
        newPages = 50;
        break;
      case 'pro':
        newPages = 200;
        break;
      case 'enterprise':
        newPages = 999999;
        break;
      case 'unlimited':
        newPages = 999999;
        break;
      default:
        newPages = subscription.pages_remaining;
    }

    await subscription.update({
      pages_remaining: newPages,
      renewed_at: now,
      next_reset: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    });
  }

  return subscriptionsToReset.length;
};

export default Subscription;
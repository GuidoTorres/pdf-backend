import { DataTypes } from 'sequelize';
import database from '../config/database.js';
import crypto from 'crypto';

const sequelize = database.getSequelize();

const UserSession = sequelize.define('UserSession', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  user_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  token_hash: {
    type: DataTypes.STRING,
    allowNull: false
  },
  expires_at: {
    type: DataTypes.DATE,
    allowNull: false
  },
  last_used: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'user_sessions',
  indexes: [
    {
      fields: ['user_id']
    },
    {
      fields: ['token_hash']
    },
    {
      fields: ['expires_at']
    }
  ]
});

// Class methods
UserSession.createSession = async function(userId, token, expiresIn = '7d') {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  
  // Calculate expiration date
  let expiresAt;
  if (typeof expiresIn === 'string') {
    const unit = expiresIn.slice(-1);
    const value = parseInt(expiresIn.slice(0, -1));
    
    switch (unit) {
      case 'd':
        expiresAt = new Date(Date.now() + value * 24 * 60 * 60 * 1000);
        break;
      case 'h':
        expiresAt = new Date(Date.now() + value * 60 * 60 * 1000);
        break;
      default:
        expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // Default 7 days
    }
  } else {
    expiresAt = new Date(Date.now() + expiresIn);
  }

  return await this.create({
    user_id: userId,
    token_hash: tokenHash,
    expires_at: expiresAt
  });
};

UserSession.validateToken = async function(token) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  
  const session = await this.findOne({
    where: {
      token_hash: tokenHash,
      expires_at: {
        [sequelize.Sequelize.Op.gt]: new Date()
      }
    }
  });

  if (session) {
    // Update last used
    await session.update({ last_used: new Date() });
    return session;
  }

  return null;
};

UserSession.revokeToken = async function(token) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  
  return await this.destroy({
    where: {
      token_hash: tokenHash
    }
  });
};

UserSession.revokeAllUserSessions = async function(userId) {
  return await this.destroy({
    where: {
      user_id: userId
    }
  });
};

UserSession.cleanupExpiredSessions = async function() {
  return await this.destroy({
    where: {
      expires_at: {
        [sequelize.Sequelize.Op.lt]: new Date()
      }
    }
  });
};

export default UserSession;
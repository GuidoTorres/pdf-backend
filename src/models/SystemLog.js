import { DataTypes } from 'sequelize';
import database from '../config/database.js';

const sequelize = database.getSequelize();

const SystemLog = sequelize.define('SystemLog', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  user_id: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  level: {
    type: DataTypes.ENUM('info', 'warning', 'error'),
    defaultValue: 'info'
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  endpoint: {
    type: DataTypes.STRING,
    allowNull: true
  },
  method: {
    type: DataTypes.STRING(10),
    allowNull: true
  },
  status_code: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  details: {
    type: DataTypes.JSON,
    allowNull: true
  }
}, {
  tableName: 'system_logs',
  indexes: [
    {
      fields: ['user_id']
    },
    {
      fields: ['level']
    },
    {
      fields: ['created_at']
    }
  ]
});

// Class methods
SystemLog.logApiRequest = async function(data) {
  return await this.create({
    user_id: data.userId || null,
    level: data.level || 'info',
    message: data.message || `${data.method} ${data.endpoint}`,
    endpoint: data.endpoint,
    method: data.method,
    status_code: data.status,
    details: data.details || {}
  });
};

SystemLog.logError = async function(message, error, userId = null) {
  return await this.create({
    user_id: userId,
    level: 'error',
    message,
    details: {
      error: error.message,
      stack: error.stack
    }
  });
};

export default SystemLog;
import { DataTypes } from 'sequelize';
import database from '../config/database.js';

const sequelize = database.getSequelize();

const PaymentLog = sequelize.define('PaymentLog', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  event_type: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  customer_id: {
    type: DataTypes.STRING,
    allowNull: true
  },
  checkout_id: {
    type: DataTypes.STRING,
    allowNull: true
  },
  plan: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  details: {
    type: DataTypes.JSON,
    allowNull: true
  },
  processed: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
}, {
  tableName: 'payment_logs',
  indexes: [
    {
      fields: ['customer_id']
    },
    {
      fields: ['checkout_id']
    },
    {
      fields: ['processed']
    },
    {
      fields: ['created_at']
    }
  ]
});

export default PaymentLog;
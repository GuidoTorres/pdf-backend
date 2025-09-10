import User from './User.js';
import Subscription from './Subscription.js';
import Document from './Document.js';
import SystemLog from './SystemLog.js';
import PaymentLog from './PaymentLog.js';
import UserSession from './UserSession.js';
import WorkerMetrics from './WorkerMetrics.js';
import QueueStats from './QueueStats.js';
import JobMetrics from './JobMetrics.js';

// Define associations
User.hasOne(Subscription, {
  foreignKey: 'user_id',
  as: 'subscription'
});

Subscription.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user'
});

User.hasMany(Document, {
  foreignKey: 'user_id',
  as: 'documents'
});

Document.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user'
});

User.hasMany(SystemLog, {
  foreignKey: 'user_id',
  as: 'logs'
});

SystemLog.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user'
});

User.hasMany(UserSession, {
  foreignKey: 'user_id',
  as: 'sessions'
});

UserSession.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user'
});

// JobMetrics associations
JobMetrics.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user'
});

JobMetrics.belongsTo(Document, {
  foreignKey: 'document_id',
  as: 'document'
});

User.hasMany(JobMetrics, {
  foreignKey: 'user_id',
  as: 'jobMetrics'
});

Document.hasOne(JobMetrics, {
  foreignKey: 'document_id',
  as: 'jobMetrics'
});

export {
  User,
  Subscription,
  Document,
  SystemLog,
  PaymentLog,
  UserSession,
  WorkerMetrics,
  QueueStats,
  JobMetrics
};
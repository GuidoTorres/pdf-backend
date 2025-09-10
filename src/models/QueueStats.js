import { DataTypes } from "sequelize";
import database from "../config/database.js";

const sequelize = database.getSequelize();

const QueueStats = sequelize.define(
  "QueueStats",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    queue_name: {
      type: DataTypes.STRING,
      allowNull: false,
      index: true,
    },
    timestamp: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      index: true,
    },
    jobs_waiting: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    jobs_active: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    jobs_completed_hour: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    jobs_failed_hour: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    jobs_delayed: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    avg_wait_time: {
      type: DataTypes.FLOAT,
      allowNull: true,
      comment: 'Average wait time in seconds',
    },
    avg_processing_time: {
      type: DataTypes.FLOAT,
      allowNull: true,
      comment: 'Average processing time in seconds',
    },
    estimated_processing_time: {
      type: DataTypes.FLOAT,
      allowNull: true,
      comment: 'Estimated time to process current queue in seconds',
    },
    throughput_per_hour: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
      comment: 'Jobs processed per hour',
    },
    priority_distribution: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Distribution of jobs by priority level',
    },
    user_type_distribution: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Distribution of jobs by user subscription type',
    },
    file_size_stats: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Statistics about file sizes in queue',
    },
    error_rate: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
      comment: 'Error rate as percentage',
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Additional queue metadata and configuration',
    },
  },
  {
    tableName: "queue_stats",
    indexes: [
      {
        fields: ["queue_name", "timestamp"],
      },
      {
        fields: ["timestamp"],
      },
      {
        fields: ["queue_name"],
      },
    ],
  }
);

// Instance methods
QueueStats.prototype.updateJobCounts = async function (waiting, active, completed, failed, delayed) {
  return await this.update({
    jobs_waiting: waiting,
    jobs_active: active,
    jobs_completed_hour: completed,
    jobs_failed_hour: failed,
    jobs_delayed: delayed,
    error_rate: completed + failed > 0 ? (failed / (completed + failed)) * 100 : 0,
    throughput_per_hour: completed,
  });
};

QueueStats.prototype.updateTimingStats = async function (avgWaitTime, avgProcessingTime, estimatedTime) {
  return await this.update({
    avg_wait_time: avgWaitTime,
    avg_processing_time: avgProcessingTime,
    estimated_processing_time: estimatedTime,
  });
};

QueueStats.prototype.updateDistributions = async function (priorityDist, userTypeDist, fileSizeStats) {
  return await this.update({
    priority_distribution: priorityDist,
    user_type_distribution: userTypeDist,
    file_size_stats: fileSizeStats,
  });
};

// Static methods
QueueStats.getQueueHistory = async function (queueName, hours = 24) {
  const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);
  
  return await this.findAll({
    where: {
      queue_name: queueName,
      timestamp: {
        [sequelize.Sequelize.Op.gte]: startTime,
      },
    },
    order: [['timestamp', 'ASC']],
  });
};

QueueStats.getAllQueuesOverview = async function () {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  
  // Get latest stats for each queue
  const latestStats = await this.findAll({
    where: {
      timestamp: {
        [sequelize.Sequelize.Op.gte]: oneHourAgo,
      },
    },
    order: [['timestamp', 'DESC']],
  });
  
  // Group by queue name and get the most recent entry for each
  const queueMap = new Map();
  latestStats.forEach(stat => {
    if (!queueMap.has(stat.queue_name) || 
        queueMap.get(stat.queue_name).timestamp < stat.timestamp) {
      queueMap.set(stat.queue_name, stat);
    }
  });
  
  const queues = Array.from(queueMap.values());
  
  // Calculate system totals
  const totalWaiting = queues.reduce((sum, q) => sum + q.jobs_waiting, 0);
  const totalActive = queues.reduce((sum, q) => sum + q.jobs_active, 0);
  const totalCompleted = queues.reduce((sum, q) => sum + q.jobs_completed_hour, 0);
  const totalFailed = queues.reduce((sum, q) => sum + q.jobs_failed_hour, 0);
  const avgThroughput = queues.length > 0 
    ? queues.reduce((sum, q) => sum + q.throughput_per_hour, 0) / queues.length 
    : 0;
  
  return {
    queues: queues.map(q => ({
      name: q.queue_name,
      waiting: q.jobs_waiting,
      active: q.jobs_active,
      completed: q.jobs_completed_hour,
      failed: q.jobs_failed_hour,
      errorRate: q.error_rate,
      avgWaitTime: q.avg_wait_time,
      avgProcessingTime: q.avg_processing_time,
      estimatedTime: q.estimated_processing_time,
      throughput: q.throughput_per_hour,
      timestamp: q.timestamp,
    })),
    totals: {
      totalWaiting,
      totalActive,
      totalCompleted,
      totalFailed,
      systemErrorRate: totalCompleted + totalFailed > 0 
        ? (totalFailed / (totalCompleted + totalFailed)) * 100 
        : 0,
      avgThroughput,
      totalThroughput: queues.reduce((sum, q) => sum + q.throughput_per_hour, 0),
    },
  };
};

QueueStats.getPerformanceTrends = async function (hours = 24) {
  const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);
  
  const stats = await this.findAll({
    where: {
      timestamp: {
        [sequelize.Sequelize.Op.gte]: startTime,
      },
    },
    order: [['timestamp', 'ASC']],
  });
  
  // Group by hour for trend analysis
  const hourlyData = new Map();
  
  stats.forEach(stat => {
    const hour = new Date(stat.timestamp);
    hour.setMinutes(0, 0, 0); // Round to hour
    const hourKey = hour.toISOString();
    
    if (!hourlyData.has(hourKey)) {
      hourlyData.set(hourKey, {
        timestamp: hour,
        totalCompleted: 0,
        totalFailed: 0,
        totalWaiting: 0,
        totalActive: 0,
        avgProcessingTime: [],
        avgWaitTime: [],
        queues: new Set(),
      });
    }
    
    const hourData = hourlyData.get(hourKey);
    hourData.totalCompleted += stat.jobs_completed_hour;
    hourData.totalFailed += stat.jobs_failed_hour;
    hourData.totalWaiting += stat.jobs_waiting;
    hourData.totalActive += stat.jobs_active;
    
    if (stat.avg_processing_time) {
      hourData.avgProcessingTime.push(stat.avg_processing_time);
    }
    if (stat.avg_wait_time) {
      hourData.avgWaitTime.push(stat.avg_wait_time);
    }
    
    hourData.queues.add(stat.queue_name);
  });
  
  // Calculate averages and format data
  const trends = Array.from(hourlyData.values()).map(hour => ({
    timestamp: hour.timestamp,
    totalCompleted: hour.totalCompleted,
    totalFailed: hour.totalFailed,
    totalWaiting: hour.totalWaiting,
    totalActive: hour.totalActive,
    errorRate: hour.totalCompleted + hour.totalFailed > 0 
      ? (hour.totalFailed / (hour.totalCompleted + hour.totalFailed)) * 100 
      : 0,
    avgProcessingTime: hour.avgProcessingTime.length > 0 
      ? hour.avgProcessingTime.reduce((a, b) => a + b, 0) / hour.avgProcessingTime.length 
      : null,
    avgWaitTime: hour.avgWaitTime.length > 0 
      ? hour.avgWaitTime.reduce((a, b) => a + b, 0) / hour.avgWaitTime.length 
      : null,
    activeQueues: hour.queues.size,
  }));
  
  return trends.sort((a, b) => a.timestamp - b.timestamp);
};

QueueStats.getQueueComparison = async function (hours = 24) {
  const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);
  
  const stats = await this.findAll({
    where: {
      timestamp: {
        [sequelize.Sequelize.Op.gte]: startTime,
      },
    },
    order: [['timestamp', 'DESC']],
  });
  
  // Group by queue name
  const queueComparison = new Map();
  
  stats.forEach(stat => {
    if (!queueComparison.has(stat.queue_name)) {
      queueComparison.set(stat.queue_name, {
        name: stat.queue_name,
        totalCompleted: 0,
        totalFailed: 0,
        totalProcessingTime: 0,
        totalWaitTime: 0,
        samples: 0,
        maxWaiting: 0,
        maxActive: 0,
      });
    }
    
    const queueData = queueComparison.get(stat.queue_name);
    queueData.totalCompleted += stat.jobs_completed_hour;
    queueData.totalFailed += stat.jobs_failed_hour;
    queueData.maxWaiting = Math.max(queueData.maxWaiting, stat.jobs_waiting);
    queueData.maxActive = Math.max(queueData.maxActive, stat.jobs_active);
    
    if (stat.avg_processing_time) {
      queueData.totalProcessingTime += stat.avg_processing_time;
      queueData.samples++;
    }
    if (stat.avg_wait_time) {
      queueData.totalWaitTime += stat.avg_wait_time;
    }
  });
  
  // Calculate final metrics
  return Array.from(queueComparison.values()).map(queue => ({
    name: queue.name,
    totalCompleted: queue.totalCompleted,
    totalFailed: queue.totalFailed,
    errorRate: queue.totalCompleted + queue.totalFailed > 0 
      ? (queue.totalFailed / (queue.totalCompleted + queue.totalFailed)) * 100 
      : 0,
    avgProcessingTime: queue.samples > 0 ? queue.totalProcessingTime / queue.samples : null,
    avgWaitTime: queue.samples > 0 ? queue.totalWaitTime / queue.samples : null,
    maxWaiting: queue.maxWaiting,
    maxActive: queue.maxActive,
    throughput: queue.totalCompleted / (hours || 1), // Jobs per hour
  }));
};

export default QueueStats;
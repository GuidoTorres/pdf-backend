import { DataTypes } from "sequelize";
import database from "../config/database.js";

const sequelize = database.getSequelize();

const WorkerMetrics = sequelize.define(
  "WorkerMetrics",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    worker_id: {
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
    jobs_in_progress: {
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
    avg_processing_time: {
      type: DataTypes.FLOAT,
      allowNull: true,
      comment: 'Average processing time in seconds',
    },
    memory_usage_mb: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
    },
    cpu_usage_percent: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
    },
    status: {
      type: DataTypes.ENUM('active', 'idle', 'overloaded', 'failed', 'terminated'),
      allowNull: false,
      defaultValue: 'idle',
    },
    last_heartbeat: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    error_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    total_jobs_processed: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    uptime_seconds: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Additional worker metadata and configuration',
    },
  },
  {
    tableName: "worker_metrics",
    indexes: [
      {
        fields: ["worker_id", "timestamp"],
      },
      {
        fields: ["status"],
      },
      {
        fields: ["timestamp"],
      },
      {
        fields: ["worker_id"],
      },
    ],
  }
);

// Instance methods
WorkerMetrics.prototype.updateHeartbeat = async function () {
  return await this.update({
    last_heartbeat: new Date(),
  });
};

WorkerMetrics.prototype.incrementJobsCompleted = async function () {
  return await this.update({
    jobs_completed_hour: this.jobs_completed_hour + 1,
    total_jobs_processed: this.total_jobs_processed + 1,
  });
};

WorkerMetrics.prototype.incrementJobsFailed = async function () {
  return await this.update({
    jobs_failed_hour: this.jobs_failed_hour + 1,
    error_count: this.error_count + 1,
  });
};

WorkerMetrics.prototype.updateProcessingTime = async function (processingTime) {
  const currentAvg = this.avg_processing_time || 0;
  const totalJobs = this.total_jobs_processed || 1;
  
  // Calculate new average using incremental formula
  const newAvg = ((currentAvg * (totalJobs - 1)) + processingTime) / totalJobs;
  
  return await this.update({
    avg_processing_time: newAvg,
  });
};

WorkerMetrics.prototype.updateResourceUsage = async function (memoryMb, cpuPercent) {
  return await this.update({
    memory_usage_mb: memoryMb,
    cpu_usage_percent: cpuPercent,
  });
};

WorkerMetrics.prototype.setStatus = async function (status) {
  return await this.update({
    status: status,
    last_heartbeat: new Date(),
  });
};

// Static methods
WorkerMetrics.getActiveWorkers = async function () {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  
  return await this.findAll({
    where: {
      last_heartbeat: {
        [sequelize.Sequelize.Op.gte]: fiveMinutesAgo,
      },
      status: {
        [sequelize.Sequelize.Op.in]: ['active', 'idle'],
      },
    },
    order: [['last_heartbeat', 'DESC']],
  });
};

WorkerMetrics.getWorkerHistory = async function (workerId, hours = 24) {
  const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);
  
  return await this.findAll({
    where: {
      worker_id: workerId,
      timestamp: {
        [sequelize.Sequelize.Op.gte]: startTime,
      },
    },
    order: [['timestamp', 'ASC']],
  });
};

WorkerMetrics.getSystemOverview = async function () {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  
  const [activeWorkers, recentMetrics] = await Promise.all([
    this.getActiveWorkers(),
    this.findAll({
      where: {
        timestamp: {
          [sequelize.Sequelize.Op.gte]: oneHourAgo,
        },
      },
      order: [['timestamp', 'DESC']],
    }),
  ]);
  
  const totalJobsCompleted = recentMetrics.reduce((sum, metric) => sum + metric.jobs_completed_hour, 0);
  const totalJobsFailed = recentMetrics.reduce((sum, metric) => sum + metric.jobs_failed_hour, 0);
  const avgMemoryUsage = recentMetrics.length > 0 
    ? recentMetrics.reduce((sum, metric) => sum + metric.memory_usage_mb, 0) / recentMetrics.length 
    : 0;
  const avgCpuUsage = recentMetrics.length > 0 
    ? recentMetrics.reduce((sum, metric) => sum + metric.cpu_usage_percent, 0) / recentMetrics.length 
    : 0;
  
  return {
    activeWorkerCount: activeWorkers.length,
    totalJobsCompleted,
    totalJobsFailed,
    successRate: totalJobsCompleted + totalJobsFailed > 0 
      ? (totalJobsCompleted / (totalJobsCompleted + totalJobsFailed)) * 100 
      : 100,
    avgMemoryUsage,
    avgCpuUsage,
    workers: activeWorkers,
  };
};

export default WorkerMetrics;